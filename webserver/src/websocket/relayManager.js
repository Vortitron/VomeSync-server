/**
 * Relay control channel — the outbound tunnel for users' own Home Assistant.
 *
 * This is deliberately **separate** from the public, UID-keyed switch socket
 * (./manager.js).  That socket is fire-and-forget and unauthenticated; a relay
 * carries privileged HA calls, so it gets its own path (`/ws/relay`), real
 * connect-time authentication, and a request/response (RPC) protocol.
 *
 * Flow:
 *   1. The Vome component dials `wss://sync.vome.io/ws/relay` presenting a
 *      per-instance relay secret (`Authorization: Bearer <secret>`).
 *   2. We authenticate it via the portal (utils/relayPortal.verifySecret) which
 *      returns the owning `server_id`; we register `server_id → ws`.
 *   3. The portal POSTs an HA call to our internal dispatch endpoint
 *      (routes/internal-routes.js → dispatch()).  We send an `ha_rpc` down the
 *      socket, await the component's `ha_rpc_response`, and return it.
 *
 * Scope note: the registry is in-process, like the switch rooms in ./manager.js.
 * Because the API server and this WS server run in the same Node process, the
 * dispatch route can call dispatch() directly.  Running multiple backend
 * processes would need a Redis route (same limitation, and same fix, as the
 * existing switch rooms) — see docs/DEVELOPER_GUIDE.md.
 */
const WebSocket = require('ws');
const { v4: uuidv4 } = require('uuid');
const logger = require('../utils/logger');
const config = require('../config/config');
const relayPortal = require('../utils/relayPortal');
const uiAccess = require('../proxy/uiAccess');
const accessEventsFactory = require('../utils/accessEvents');
const { abortUpgrade } = require('./upgradeRouter');

// A home's self-reported batch is capped here as well as at the component:
// the component is trusted to be honest, not to be correct.
const HOME_EVENT_BATCH_MAX = 100;

const HEARTBEAT_INTERVAL_MS = 30000;
const IDLE_PING_AFTER_MS = 30000;
const MIN_RPC_MS = 1000;
const MAX_RPC_MS = 60000;
const RPC_BUFFER_MS = 2000;
// Full-UI forwarding: a whole browser HTTP request can be slower than an API
// call (large bundles), so it gets its own ceiling separate from ha_rpc.
const FORWARD_HTTP_MS = 60000;

/**
 * Extract the bearer secret from a WS upgrade request (Authorization header
 * only).  The component always presents `Authorization: Bearer <secret>`; a
 * query-string fallback would copy the credential into nginx/proxy access
 * logs, so it is deliberately not supported.
 */
function extractSecret(req) {
	const header = (req.headers && req.headers.authorization) || '';
	if (typeof header === 'string' && header.toLowerCase().startsWith('bearer ')) {
		return header.slice(7).trim();
	}
	return '';
}

class RelayManager {
	constructor() {
		this.wss = null;
		this.connections = new Map(); // server_id -> { ws, connectedAt, lastActivity }
		this.pending = new Map(); // requestId -> { resolve, timer }
		// Live full-UI WebSocket bridges: socketId -> { serverId, onAck, onData,
		// onClose }.  The browser-facing proxy (proxy/uiProxy) owns the socketId
		// lifecycle; this map lets component frames find their browser handler.
		this.tunnels = new Map();
		// Forwarded responses arriving in pieces: requestId -> { queue, ended,
		// error, onChunk, onEnd }.  A response whose body never ends -- the
		// Supervisor log tail, an event stream, a camera feed -- cannot be
		// buffered whole, so the component sends the head first and the body
		// after it.  Chunks can arrive before the browser-facing proxy has
		// attached its handlers, so they queue until it does rather than falling
		// into a gap of a few milliseconds.
		this.streams = new Map();
		// Injectable so tests don't need a live portal.
		this.verifyFn = (secret) => relayPortal.verifySecret(secret);
	}

	initialize(opts = {}) {
		if (typeof opts.verifyFn === 'function') {
			this.verifyFn = opts.verifyFn;
		}
		// noServer: upgrades arrive via handleUpgrade() from the shared
		// upgrade router (see ./upgradeRouter.js for why path-attached
		// servers must not be used).
		this.wss = new WebSocket.Server({ noServer: true });
		this.wss.on('connection', (ws, req) => this.handleConnection(ws, req));
		logger.info('Relay manager initialized');
	}

	/** Authenticate and complete a `/ws/relay` upgrade (called by the router). */
	handleUpgrade(req, socket, head) {
		const secret = extractSecret(req);
		if (!secret) {
			abortUpgrade(socket, 401, 'Unauthorized');
			return;
		}
		Promise.resolve(this.verifyFn(secret))
			.then((serverId) => {
				if (!serverId) {
					abortUpgrade(socket, 401, 'Unauthorized');
					return;
				}
				req.relayServerId = serverId;
				this.wss.handleUpgrade(req, socket, head, (ws) => {
					this.wss.emit('connection', ws, req);
				});
			})
			.catch((err) => {
				logger.error('Relay upgrade verification error:', err.message || err);
				abortUpgrade(socket, 500, 'Verification error');
			});
	}

	handleConnection(ws, req) {
		const serverId = req.relayServerId;
		if (!serverId) {
			ws.close(4001, 'Unauthorized');
			return;
		}

		// One live relay per server: replace a stale/previous connection.
		const prev = this.connections.get(serverId);
		if (prev && prev.ws !== ws) {
			try {
				prev.ws.close(4000, 'Replaced by a newer connection');
			} catch (_err) { /* ignore */ }
		}

		this.connections.set(serverId, { ws, connectedAt: Date.now(), lastActivity: Date.now() });
		logger.info(`Relay connected: ${serverId}`);
		this._safeSend(ws, { type: 'hello', server_id: serverId });

		ws.on('message', (message) => this.handleMessage(serverId, message));
		ws.on('close', () => this.handleDisconnection(serverId, ws));
		ws.on('error', (error) => logger.error(`Relay error for ${serverId}:`, error.message || error));
		ws.on('pong', () => {
			const conn = this.connections.get(serverId);
			if (conn) {
				conn.lastActivity = Date.now();
			}
		});
	}

	handleMessage(serverId, message) {
		let data;
		try {
			data = JSON.parse(message);
		} catch (_err) {
			logger.warn(`Relay ${serverId}: non-JSON message ignored`);
			return;
		}
		const conn = this.connections.get(serverId);
		if (conn) {
			conn.lastActivity = Date.now();
		}

		if (data.type === 'ha_rpc_response') {
			this._resolvePending(data.requestId, {
				status: data.status || 0,
				body: data.body,
				error: data.error
			});
			return;
		}
		if (data.type === 'http_proxy_response') {
			// A streaming response announces itself with the head and no body;
			// the body follows as http_proxy_chunk frames. Register before
			// resolving so chunks that arrive in the same tick are not lost.
			if (data.streaming) {
				this.streams.set(data.requestId, {
					queue: [], ended: false, error: null, onChunk: null, onEnd: null
				});
				this._resolvePending(data.requestId, {
					streaming: true,
					requestId: data.requestId,
					status: data.status || 0,
					headers: data.headers
				});
				return;
			}
			this._resolvePending(data.requestId, {
				status: data.status || 0,
				headers: data.headers,
				bodyB64: data.bodyB64,
				error: data.error
			});
			return;
		}
		if (data.type === 'http_proxy_chunk') {
			this._pushStream(data.requestId, data.dataB64);
			return;
		}
		if (data.type === 'http_proxy_end') {
			this._endStream(data.requestId, data.error || null);
			return;
		}
		// Full-UI WebSocket bridge: route component frames to the browser handler.
		if (data.type === 'ws_open_ack' || data.type === 'ws_data' || data.type === 'ws_close') {
			this._routeTunnel(data);
			return;
		}
		// Component-initiated request for a LAN-TCP tunnel bearer token (see
		// custom_components/vomesync/relay_client.py's request_lan_tcp_token).
		// Unlike ha_rpc/http_proxy/ws_open (backend → component), this is the
		// other direction: answer directly, no `pending` map needed.
		if (data.type === 'mint_lan_tcp_token' && conn) {
			// Never let a malformed mint request throw out of the message
			// handler (that would take down the relay connection): validate and
			// answer with an error field the component can surface instead.
			let token = null;
			let error = null;
			try {
				const slug = typeof data.slug === 'string' ? data.slug.trim() : '';
				if (!slug) {
					throw new Error('A LAN route slug is required.');
				}
				token = uiAccess.mintLanTcpToken({ serverId, slug, ttlSeconds: data.ttlSeconds });
			} catch (err) {
				error = (err && err.message) || 'Could not mint tunnel token.';
			}
			this._safeSend(conn.ws, {
				type: 'mint_lan_tcp_token_response', requestId: data.requestId, token, error
			});
			return;
		}
		// The home reporting what *it* saw: logins Core rejected, which for a
		// device on the owner's own network never passed our edge at all
		// (custom_components/vomesync/login_watch.py).  Fire and forget — the
		// component waits for nothing, and a bad batch is dropped, not answered.
		if (data.type === 'access_events') {
			this._recordHomeEvents(serverId, data.events);
			return;
		}
		if (data.type === 'ping' && conn) {
			this._safeSend(conn.ws, { type: 'pong', timestamp: Date.now() });
		}
	}

	/**
	 * Queue a home's self-reported access events for its owner's log.
	 *
	 * The server_id comes from the authenticated socket and never from the
	 * payload: a component may say what happened in its own house, and nothing
	 * at all about anyone else's.
	 */
	_recordHomeEvents(serverId, events) {
		if (!Array.isArray(events)) {
			return;
		}
		const emitter = accessEventsFactory.getAccessEvents();
		for (const event of events.slice(0, HOME_EVENT_BATCH_MAX)) {
			if (!event || typeof event !== 'object') {
				continue;
			}
			emitter.record({
				serverId,
				source: 'home',
				event: event.event,
				outcome: event.outcome,
				clientIp: event.client_ip,
				path: event.path,
				userAgent: event.user_agent,
				detail: event.detail,
				count: event.count
			});
		}
	}

	/** Buffer or deliver one body chunk of a streaming forward. */
	_pushStream(requestId, dataB64) {
		const entry = this.streams.get(requestId);
		if (!entry || entry.ended) {
			return;
		}
		let chunk;
		try {
			chunk = Buffer.from(String(dataB64 || ''), 'base64');
		} catch (_err) {
			return;
		}
		if (entry.onChunk) {
			entry.onChunk(chunk);
		} else {
			entry.queue.push(chunk);
		}
	}

	/** Mark a streaming forward finished (or failed) and release it. */
	_endStream(requestId, error) {
		const entry = this.streams.get(requestId);
		if (!entry) {
			return;
		}
		entry.ended = true;
		entry.error = error;
		if (entry.onEnd) {
			this.streams.delete(requestId);
			entry.onEnd(error);
		}
	}

	/**
	 * Attach the browser-facing handlers for a streaming forward.
	 *
	 * Flushes whatever queued while the caller was getting ready, then hands
	 * over live.  Returns a detach function; call it when the browser goes away
	 * so a log tail nobody is reading stops being carried.
	 */
	attachStream(requestId, { onChunk, onEnd } = {}) {
		const entry = this.streams.get(requestId);
		if (!entry) {
			// Already finished and released: nothing to deliver.
			if (typeof onEnd === 'function') {
				onEnd(null);
			}
			return () => {};
		}
		entry.onChunk = typeof onChunk === 'function' ? onChunk : () => {};
		entry.onEnd = typeof onEnd === 'function' ? onEnd : () => {};
		const queued = entry.queue;
		entry.queue = [];
		for (const chunk of queued) {
			entry.onChunk(chunk);
		}
		if (entry.ended) {
			this.streams.delete(requestId);
			entry.onEnd(entry.error);
			return () => {};
		}
		return () => {
			this.streams.delete(requestId);
		};
	}

	/**
	 * Tell the component to stop producing a streaming response.
	 *
	 * Without this a browser that closed its tab leaves the component reading a
	 * log tail forever, one open HTTP request per abandoned page.
	 */
	abortStream(serverId, requestId) {
		this.streams.delete(requestId);
		const conn = this.connections.get(serverId);
		if (!conn || conn.ws.readyState !== WebSocket.OPEN) {
			return;
		}
		this._safeSend(conn.ws, { type: 'http_proxy_abort', requestId });
	}

	/** Resolve and clear a pending RPC/forward waiter by requestId (no-op if gone). */
	_resolvePending(requestId, value) {
		const waiter = this.pending.get(requestId);
		if (waiter) {
			clearTimeout(waiter.timer);
			this.pending.delete(requestId);
			waiter.resolve(value);
		}
	}

	/** Deliver a ws_open_ack / ws_data / ws_close to its registered browser tunnel. */
	_routeTunnel(data) {
		const tunnel = this.tunnels.get(data.socketId);
		if (!tunnel) {
			return;
		}
		if (data.type === 'ws_open_ack') {
			tunnel.onAck();
		} else if (data.type === 'ws_data') {
			tunnel.onData(data);
		} else if (data.type === 'ws_close') {
			this.tunnels.delete(data.socketId);
			tunnel.onClose(data);
		}
	}

	handleDisconnection(serverId, ws) {
		const conn = this.connections.get(serverId);
		if (conn && conn.ws === ws) {
			this.connections.delete(serverId);
			this._dropTunnelsFor(serverId, 1011, 'Home Assistant relay disconnected');
			logger.info(`Relay disconnected: ${serverId}`);
		}
	}

	/** Close + forget every browser tunnel bound to a server (its relay is gone). */
	_dropTunnelsFor(serverId, code, reason) {
		for (const [socketId, tunnel] of this.tunnels.entries()) {
			if (tunnel.serverId === serverId) {
				this.tunnels.delete(socketId);
				try {
					tunnel.onClose({ code, reason });
				} catch (_err) { /* a closing browser socket may already be gone */ }
			}
		}
	}

	isConnected(serverId) {
		const conn = this.connections.get(serverId);
		return !!(conn && conn.ws.readyState === WebSocket.OPEN);
	}

	/**
	 * Push one HA call to a connected component and await its reply.
	 *
	 * Resolves to ``{ offline: true }`` when no component is connected, or
	 * ``{ status, body, error }`` otherwise (``status: 0`` on a timeout / send
	 * failure).  Never rejects — the caller maps the shape onto an HTTP response.
	 */
	dispatch(serverId, { method, path, body, expect, timeout, target } = {}) {
		return new Promise((resolve) => {
			const conn = this.connections.get(serverId);
			if (!conn || conn.ws.readyState !== WebSocket.OPEN) {
				resolve({ offline: true });
				return;
			}
			const requestId = uuidv4();
			const seconds = Number(timeout) || Math.round(config.relay.rpcTimeoutMs / 1000);
			const waitMs = Math.min(Math.max(seconds * 1000, MIN_RPC_MS), MAX_RPC_MS) + RPC_BUFFER_MS;
			const timer = setTimeout(() => {
				this.pending.delete(requestId);
				resolve({ status: 0, error: 'Relay RPC timed out.' });
			}, waitMs);
			this.pending.set(requestId, { resolve, timer });
			try {
				conn.ws.send(JSON.stringify({
					type: 'ha_rpc', requestId, method, path, body, expect, timeout, target
				}));
			} catch (err) {
				clearTimeout(timer);
				this.pending.delete(requestId);
				logger.error(`Relay send to ${serverId} failed:`, err.message || err);
				resolve({ status: 0, error: 'Relay send failed.' });
			}
		});
	}

	/**
	 * Forward one whole browser HTTP request to a connected component.
	 *
	 * Mirrors dispatch() but carries arbitrary paths + the browser's own headers
	 * (base64 body) and returns the component's `http_proxy_response` shape.
	 * Resolves `{ offline: true }` with no component, else
	 * `{ status, headers, bodyB64, error }` (`status: 0` on timeout/send failure).
	 */
	forwardHttp(serverId, { method, path, headers, bodyB64 } = {}) {
		return new Promise((resolve) => {
			const conn = this.connections.get(serverId);
			if (!conn || conn.ws.readyState !== WebSocket.OPEN) {
				resolve({ offline: true });
				return;
			}
			const requestId = uuidv4();
			const timer = setTimeout(() => {
				this.pending.delete(requestId);
				resolve({ status: 0, error: 'Relay HTTP forward timed out.' });
			}, FORWARD_HTTP_MS + RPC_BUFFER_MS);
			this.pending.set(requestId, { resolve, timer });
			try {
				// `stream: true` says only that this side can take a response in
				// pieces. A component that predates it ignores the key and
				// answers whole, exactly as before, so nothing has to be
				// upgraded in step.
				conn.ws.send(JSON.stringify({
					type: 'http_proxy', requestId, method, path, headers, bodyB64,
					stream: true
				}));
			} catch (err) {
				clearTimeout(timer);
				this.pending.delete(requestId);
				logger.error(`Relay HTTP forward to ${serverId} failed:`, err.message || err);
				resolve({ status: 0, error: 'Relay send failed.' });
			}
		});
	}

	// ── Full-UI WebSocket bridge control ────────────────────────────────────

	/** Register a browser tunnel's callbacks before opening the component side. */
	registerTunnel(socketId, serverId, { onAck, onData, onClose }) {
		this.tunnels.set(socketId, { serverId, onAck, onData, onClose });
	}

	/** Drop a tunnel registration (browser gone); does not message the component. */
	unregisterTunnel(socketId) {
		this.tunnels.delete(socketId);
	}

	/**
	 * Ask the component to open a local socket for this bridge.
	 *
	 * `target: 'esphome'` selects the ESPHome dashboard's command channel rather
	 * than a path on Home Assistant; the component resolves the dashboard's
	 * address itself and composes the spawn frame from `command`/`configuration`/
	 * `port`, so no caller-supplied frame is ever sent to a dashboard that has no
	 * authentication of its own.
	 */
	openWs(serverId, { socketId, path, headers, target, command, configuration, port } = {}) {
		const payload = { type: 'ws_open', socketId, path, headers };
		if (target) {
			payload.target = target;
			payload.command = command;
			payload.configuration = configuration;
			if (typeof port === 'string' && port) {
				payload.port = port;
			}
		}
		return this._tunnelSend(serverId, payload);
	}

	/** Forward one browser frame down to the component's local socket. */
	sendWs(serverId, { socketId, text, dataB64 } = {}) {
		return this._tunnelSend(serverId, { type: 'ws_data', socketId, text, dataB64 });
	}

	/** Tell the component the browser side closed this bridge. */
	closeWs(serverId, { socketId, code, reason } = {}) {
		return this._tunnelSend(serverId, { type: 'ws_close', socketId, code, reason });
	}

	_tunnelSend(serverId, payload) {
		const conn = this.connections.get(serverId);
		if (!conn || conn.ws.readyState !== WebSocket.OPEN) {
			return false;
		}
		return this._safeSend(conn.ws, payload);
	}

	getStats() {
		return {
			relays: this.connections.size,
			pending: this.pending.size,
			tunnels: this.tunnels.size,
			servers: Array.from(this.connections.keys())
		};
	}

	/**
	 * Forcibly close a server's relay socket (portal calls this when the link
	 * is deleted or its secret rotated).  Secrets are only verified at connect
	 * time, so without this a revoked link would keep its live socket until
	 * the next reconnect.  Returns true when a socket was actually closed.
	 */
	disconnect(serverId) {
		const conn = this.connections.get(serverId);
		this.connections.delete(serverId);
		this._dropTunnelsFor(serverId, 1008, 'link revoked');
		if (!conn || !conn.ws) {
			return false;
		}
		try {
			conn.ws.close(4001, 'link revoked');
		} catch (_err) {
			try { conn.ws.terminate(); } catch (_e) { /* already gone */ }
		}
		logger.info(`Relay ${serverId} disconnected (link revoked)`);
		return true;
	}

	startHeartbeat() {
		this._heartbeat = setInterval(() => {
			const now = Date.now();
			for (const [serverId, conn] of this.connections.entries()) {
				if (conn.ws.readyState === WebSocket.OPEN) {
					if (now - conn.lastActivity > IDLE_PING_AFTER_MS) {
						try {
							conn.ws.ping();
						} catch (_err) { /* ignore */ }
					}
				} else {
					this.connections.delete(serverId);
				}
			}
		}, HEARTBEAT_INTERVAL_MS);
		// Don't keep the event loop alive solely for the heartbeat.
		if (this._heartbeat.unref) {
			this._heartbeat.unref();
		}
	}

	_safeSend(ws, payload) {
		if (!ws || ws.readyState !== WebSocket.OPEN) {
			return false;
		}
		try {
			ws.send(JSON.stringify(payload));
			return true;
		} catch (_err) {
			return false;
		}
	}
}

module.exports = new RelayManager();
// Exposed for unit tests (use a fresh instance / the pure helper in isolation).
module.exports.RelayManager = RelayManager;
module.exports._extractSecret = extractSecret;

/**
 * Browser-facing reverse proxy for full-UI forwarding (the paid friendly domain).
 *
 * A friendly domain (`<slug>.home.vome.io`) reuses the SAME `*.<SERVER_DOMAIN>`
 * wildcard vhost that hosted-VM subdomains use; its nginx map.d entry routes the
 * host to this proxy's loopback port (so no new vhost/cert/DNS).  Because that
 * shared vhost rewrites the upstream `Host`, the real friendly host arrives in
 * `X-HA-Original-Host` (see originalHost).  Every request here is therefore *for*
 * a home behind the relay.  The flow:
 *
 *   browser ──HTTPS/WSS──▶ nginx (*.home.vome.io) ──▶ this proxy ──relay WS──▶ component ──▶ HA
 *                                                                          └──────────────▶ LAN /t/<slug>/
 *
 * A **hosted** instance is reached the other way: this process can dial its own
 * port, so its policy carries an upstream and the last hop is a plain HTTP
 * proxy (see ./directUpstream).  nginx used to route those straight at the
 * container, which meant everything here — the gate, the rate limits, the
 * brute-force block, the access log — applied to relay homes only, while a
 * hosted home's memorable hostname sat in front of a bare login form.
 *
 * Whatever is admitted or refused is reported to the portal for the owner to
 * read (see ../utils/accessEvents).  Home Assistant cannot tell them itself:
 * it sees our last hop, not the visitor, so its own "invalid authentication
 * from …" notification names a piece of our plumbing.
 *
 * HTTP: each request is buffered and handed to relayManager.forwardHttp, then the
 * component's response (status + headers + base64 body) is written back verbatim.
 * WebSocket (`/api/websocket`): the browser socket is bridged to a component-side
 * local HA socket, frame-for-frame, via relayManager's tunnel registry.
 *
 * Auth: a viewer must present a valid forwarding cookie (see ./uiAccess) — the
 * portal mints it only for an owner with an active subscription.  No cookie ⇒ a
 * 302 to the portal authorise page (HTTP) or a 401 (WebSocket).  Vome handles the
 * gate + TLS; the user still signs in to their own Home Assistant as normal.
 *
 * Two per-server opt-outs (owner-controlled in the portal, resolved via
 * utils/relayPortal.fetchForwardPolicy and cached briefly):
 *   - `webhooks`: cookie-less POST/PUT/GET/HEAD `/api/webhook/<id>` deliveries
 *     are admitted (Nabu Casa "cloudhook" parity — webhook ids are high-entropy
 *     secrets and HA treats the endpoint as unauthenticated by design).
 *   - `open`: the cookie gate is skipped entirely and HA's own login protects
 *     the instance (Nabu Casa "Remote UI" parity — required for the HA
 *     companion app, which cannot complete the portal cookie flow).
 * Policy misses fail closed to cookie-only.
 *
 * Anything admitted *without* the cookie — the 302 path, webhook deliveries,
 * and every request in `open` mode — is rate limited per client address before
 * it can reach the home (see limitUnauthenticated).  Without that, `open` mode
 * hands an attacker who learns the hostname an unmetered channel to HA's login
 * form.  Cookie-bearing requests skip it: Vome already vouched for them.
 */
const WebSocket = require('ws');
const logger = require('../utils/logger');
const config = require('../config/config');
const relayManagerSingleton = require('../websocket/relayManager');
const relayPortal = require('../utils/relayPortal');
const uiAccess = require('./uiAccess');
const loginGuardFactory = require('./loginGuard');
const relayBridge = require('../websocket/relayBridge');
const directUpstream = require('./directUpstream');
const accessEventsFactory = require('../utils/accessEvents');
const authManager = require('../utils/auth');
const { abortUpgrade } = require('../websocket/upgradeRouter');

// Friendly-host forwarding policy cache: a webhook burst or an app sync must
// not turn into one portal round-trip per request. Misses are cached too so an
// unauthenticated crawler can't hammer the portal through us.
const POLICY_CACHE_TTL_MS = 30 * 1000;

// One opaque webhook id segment: HA generates hex ids but custom automations
// may use any reasonable token. Slashes and dot segments stay excluded.
const WEBHOOK_PATH_RE = /^\/api\/webhook\/[A-Za-z0-9_~.-]+$/;
const WEBHOOK_METHODS = new Set(['POST', 'PUT', 'GET', 'HEAD']);

/** True when `path` (query excluded) is a single-id HA webhook endpoint. */
function isWebhookPath(path) {
	const portion = String(path || '').split('?', 1)[0];
	if (!WEBHOOK_PATH_RE.test(portion)) {
		return false;
	}
	const id = portion.slice('/api/webhook/'.length);
	return id !== '.' && id !== '..';
}

// Hop-by-hop headers are per-connection and must not cross the tunnel (RFC 7230
// §6.1); Host/Content-Length are re-derived at each hop.
const HOP_BY_HOP = new Set([
	'connection', 'keep-alive', 'proxy-authenticate', 'proxy-authorization',
	'te', 'trailer', 'transfer-encoding', 'upgrade', 'host', 'content-length'
]);

/**
 * Headers describing a hop on *Vome's* side of the tunnel.
 *
 * nginx sets these so this proxy can tell visitors apart for the rate limit
 * (see clientIp), and they must stop here.  Past the tunnel the component
 * dials Core over loopback inside the home, so Home Assistant is not behind
 * these proxies and the addresses in them are not its clients.
 *
 * Forwarding `X-Forwarded-For` does not merely mislead — HA's forwarded
 * middleware rejects any request carrying it unless the home has opted into
 * `http.use_x_forwarded_for`, which a stock install has not.  It answers 400
 * to *every* request, so leaking this header takes the whole friendly domain
 * down rather than degrading anything gracefully.
 *
 * The cost is that HA sees one loopback client for everyone, so its built-in
 * brute-force ban can't act per visitor.  That check belongs out here anyway:
 * this proxy sees the real address (limitUnauthenticated) before a request is
 * ever worth forwarding.
 */
const VOME_HOP_HEADERS = new Set([
	'x-forwarded-for', 'x-forwarded-host', 'x-forwarded-proto',
	'x-forwarded-port', 'x-real-ip', 'forwarded'
]);

/**
 * The browser's real host (the friendly domain).
 *
 * Friendly domains reuse the shared `*.<SERVER_DOMAIN>` wildcard vhost, whose
 * map.d route rewrites the upstream `Host` to this proxy's loopback address —
 * so the genuine `<slug>.<base>` arrives in `X-HA-Original-Host` instead.  Fall
 * back to `Host` for a direct hit (tests / a future dedicated vhost).
 */
function originalHost(req) {
	const h = req.headers || {};
	return String(h['x-ha-original-host'] || h.host || '');
}

/**
 * Paths where guessing pays off: Home Assistant's own login and token endpoints
 * (`/auth/login_flow`, `/auth/token`, `/auth/authorize`).  These get a much
 * smaller budget than ordinary traffic, because the thing being protected is a
 * password rather than bandwidth.
 */
const AUTH_PATH_RE = /^\/auth(\/|$)/;

/**
 * Query parameter carrying a one-time forwarding pass (see exchangePass).
 * Shared with the portal, which appends it when it sends a browser home.
 */
const PASS_PARAM = 'vome_pass';

/**
 * Home Assistant frontend/static files.  A cold UI load pulls hundreds of JS
 * chunks; Chrome with DevTools open then fetches a `.js.map` for each one.
 * Those are not a login-guessing surface, so they use a larger bucket than
 * SPA routes and REST (see limitUnauthenticated).
 */
const STATIC_FRONTEND_PATH_RE = new RegExp(
	'^/(?:'
	+ 'frontend_(?:latest|es5)/'
	+ '|static/'
	+ '|hacsfiles/'
	+ '|local/'
	+ '|webfonts/'
	+ '|sw(?:-modern)?\\.js$'
	+ '|service_worker\\.js$'
	+ '|manifest\\.json$'
	+ ')'
);

/** True when `path` (query excluded) is an HA frontend/static asset. */
function isStaticFrontendPath(path) {
	const portion = String(path || '').split('?', 1)[0];
	return STATIC_FRONTEND_PATH_RE.test(portion);
}

/**
 * The client's address, for rate-limit keying.
 *
 * nginx runs on the *portal* host and proxies here, so the socket's peer is
 * always nginx — every visitor would otherwise share one bucket.  The real
 * address arrives in `X-Real-IP`.  That header is only believed from a peer in
 * `relay.forwardTrustedProxies` (empty = believe anyone, relying on the
 * firewall rule that restricts this port); an untrusted peer is keyed on the
 * address it actually connected from, so it cannot mint itself a fresh bucket.
 */
function clientIp(req) {
	const peer = (req && req.socket && req.socket.remoteAddress) || '';
	const trusted = config.relay.forwardTrustedProxies;
	if (trusted.length === 0 || trusted.includes(peer)) {
		const real = req && req.headers && req.headers['x-real-ip'];
		if (real) {
			return String(real).trim();
		}
	}
	return peer || 'unknown';
}

/** Drop our own forwarding cookie from a Cookie header value (don't leak it to HA). */
function stripOwnCookie(value, cookieName) {
	const kept = String(value)
		.split(';')
		.map((p) => p.trim())
		.filter((p) => p && p.split('=')[0].trim() !== cookieName);
	return kept.join('; ');
}

/** Build a forwardable [name,value] header list from a request's raw headers. */
function collectRequestHeaders(req, cookieName) {
	const raw = req.rawHeaders || [];
	const out = [];
	for (let i = 0; i + 1 < raw.length; i += 2) {
		const name = raw[i];
		let value = raw[i + 1];
		if (HOP_BY_HOP.has(name.toLowerCase()) || VOME_HOP_HEADERS.has(name.toLowerCase())) {
			continue;
		}
		if (name.toLowerCase() === 'cookie') {
			value = stripOwnCookie(value, cookieName);
			if (!value) {
				continue;
			}
		}
		out.push([name, value]);
	}
	return out;
}

/** Filter a component response's header pairs (drop hop-by-hop; keep duplicates). */
function filterResponseHeaders(pairs) {
	const out = [];
	for (const pair of pairs || []) {
		if (!Array.isArray(pair) || pair.length < 2) {
			continue;
		}
		if (HOP_BY_HOP.has(String(pair[0]).toLowerCase())) {
			continue;
		}
		out.push([String(pair[0]), String(pair[1])]);
	}
	return out;
}

/** Apply header pairs to a Node response, coalescing duplicates (e.g. Set-Cookie). */
function applyResponseHeaders(res, pairs) {
	const merged = new Map();
	for (const [name, value] of pairs) {
		if (merged.has(name)) {
			const cur = merged.get(name);
			merged.set(name, Array.isArray(cur) ? cur.concat(value) : [cur, value]);
		} else {
			merged.set(name, value);
		}
	}
	for (const [name, value] of merged.entries()) {
		res.setHeader(name, value);
	}
}

function createUiProxy(deps = {}) {
	const relay = deps.relayManager || relayManagerSingleton;
	const verify = deps.verifyAccessToken || uiAccess.verifyAccessToken;
	const fetchPolicy = deps.fetchForwardPolicy || relayPortal.fetchForwardPolicy;
	const checkLimit = deps.checkRateLimit
		|| ((id, action, max, windowMs) => authManager.checkRateLimit(id, action, max, windowMs));
	const loginGuard = deps.loginGuard || loginGuardFactory.createLoginGuard();
	const accessEvents = deps.accessEvents || accessEventsFactory.getAccessEvents();
	const cookieName = config.relay.forwardCookieName;
	const maxBody = config.relay.forwardMaxBodyBytes;
	// noServer: the dedicated proxy server's `upgrade` event calls handleUpgrade.
	const wss = new WebSocket.Server({ noServer: true });

	const policyCache = new Map(); // host -> { policy|null, expiresAt }

	/** Cached forwarding policy for a friendly host (null = cookie-only). */
	async function policyFor(host) {
		if (!host) {
			return null;
		}
		const hit = policyCache.get(host);
		if (hit && hit.expiresAt > Date.now()) {
			return hit.policy;
		}
		const policy = await fetchPolicy(host);
		policyCache.set(host, { policy, expiresAt: Date.now() + POLICY_CACHE_TTL_MS });
		return policy;
	}

	/**
	 * Tell the owner something happened.  Never awaited on a request path.
	 *
	 * This proxy holds the only copy of a visitor's real address, so an event
	 * that stays here is an answer the customer never gets.
	 */
	function report(req, serverId, event, extra = {}) {
		if (!serverId) {
			return;
		}
		accessEvents.record({
			serverId,
			event,
			clientIp: clientIp(req),
			host: originalHost(req),
			method: req.method,
			path: String(req.url || '').split('?', 1)[0],
			userAgent: (req.headers || {})['user-agent'],
			...extra
		});
	}

	/**
	 * True for a request that represents somebody arriving, as opposed to the
	 * hundreds of asset and poll requests that follow.
	 *
	 * Without this the log would faithfully record every XHR of a live app
	 * session — complete, and unreadable.
	 */
	function isArrival(req) {
		const accept = String((req.headers || {}).accept || '');
		return String(req.method || '').toUpperCase() === 'GET'
			&& accept.includes('text/html')
			&& !isStaticFrontendPath(req.url);
	}

	/** The home behind a host if it is already known, without asking the portal. */
	function cachedServerId(host) {
		const hit = policyCache.get(host);
		return hit && hit.policy ? hit.policy.serverId : null;
	}

	/**
	 * How to reach the home behind this request.
	 *
	 * Falls back to the relay whenever the policy is unavailable: a
	 * cookie-bearing request for a linked home has to keep working through a
	 * portal blip, and that was the only kind of home this proxy ever served.
	 */
	async function upstreamFor(req) {
		try {
			const policy = await policyFor(originalHost(req));
			if (policy && policy.upstream
				&& policy.upstream.kind === 'direct' && policy.upstream.target) {
				return policy.upstream;
			}
		} catch (err) {
			logger.error('Upstream lookup failed:', err.message || err);
		}
		return { kind: 'relay', target: null };
	}

	/**
	 * Exchange a one-time pass in the query for a cookie on *this* host.
	 *
	 * The portal sets its cookie on the registrable base (`.vome.io`), which
	 * reaches every `*.home.vome.io` address and cannot, by the rules of
	 * cookies, reach a customer's own `ha.example.com`.  So an owner who put
	 * Vome's gate in front of a custom domain would have protected it by
	 * making it unopenable — the sign-in would succeed and the browser would
	 * arrive with nothing to show for it.
	 *
	 * The gate therefore also sends the pass in the URL, and this trades it
	 * for a host-only cookie and redirects to the same address without it.
	 * The token is short-lived, is spent immediately, and is gone from the
	 * address bar before Home Assistant ever loads — so it never reaches the
	 * page, the history or a Referer header.
	 *
	 * Returns true when it has answered the request.
	 */
	function exchangePass(req, res) {
		const [path, query] = String(req.url || '').split('?');
		if (!query || !query.includes(`${PASS_PARAM}=`)) {
			return false;
		}
		const params = new URLSearchParams(query);
		const token = params.get(PASS_PARAM);
		if (!token) {
			return false;
		}
		const host = originalHost(req);
		const access = verify(token, host);
		if (!access) {
			// A bad pass is not an error worth explaining to whoever sent it;
			// drop it and let the request carry on to the gate.
			params.delete(PASS_PARAM);
			const rest = params.toString();
			res.writeHead(302, { Location: rest ? `${path}?${rest}` : path });
			res.end();
			return true;
		}
		params.delete(PASS_PARAM);
		const rest = params.toString();
		res.writeHead(302, {
			Location: rest ? `${path}?${rest}` : path,
			// Host-only (no Domain attribute): this pass was minted for this
			// address and should not be offered to any other.
			'Set-Cookie': `${cookieName}=${encodeURIComponent(token)}; Path=/; `
				+ `Max-Age=${config.relay.forwardPassCookieMaxAge}; Secure; HttpOnly; SameSite=Lax`
		});
		res.end();
		report(req, access.serverId, 'session_opened', {
			outcome: 'allowed', detail: 'Signed in to Vome'
		});
		return true;
	}

	/** Resolve + authorise a request; returns access or null (caller responds). */
	function authorise(req) {
		const host = originalHost(req);
		const token = uiAccess.readCookie(req, cookieName);
		return verify(token, host);
	}

	/**
	 * Spend one unit of this client's unauthenticated budget.
	 *
	 * Returns `{ retryAfter }` when the caller must refuse, or null to proceed.
	 * Runs *before* the forwarding-policy lookup so a flood cannot be turned
	 * into portal load, and before anything crosses the relay.
	 *
	 * Fails open on a limiter error, deliberately: Redis being unreachable must
	 * not take remote access down with it.  The store is shared with the rest
	 * of the backend's limits, so this survives a proxy restart.
	 */
	async function limitUnauthenticated(req, { websocket = false } = {}) {
		const path = String(req.url || '').split('?', 1)[0];
		let action = 'fwd_unauth';
		let max = config.relay.forwardRateMax;
		if (websocket) {
			action = 'fwd_unauth_ws';
			max = config.relay.forwardWsRateMax;
		} else if (AUTH_PATH_RE.test(path)) {
			action = 'fwd_unauth_auth';
			max = config.relay.forwardAuthRateMax;
		} else if (isStaticFrontendPath(path)) {
			action = 'fwd_unauth_static';
			max = config.relay.forwardStaticRateMax;
		}
		if (!max || max <= 0) {
			return null;
		}
		let result;
		try {
			result = await checkLimit(clientIp(req), action, max, config.relay.forwardRateWindowMs);
		} catch (err) {
			logger.error('Forward rate-limit check failed:', err.message || err);
			return null;
		}
		if (!result || result.allowed !== false) {
			return null;
		}
		logger.warn(`Forward rate limit hit (${action}) for ${originalHost(req)}`);
		const remainingMs = (result.resetTime || 0) - Date.now();
		return { retryAfter: Math.max(1, Math.ceil(remainingMs / 1000)) };
	}

	/**
	 * Cookie-less admittance: `{ serverId }` when the owner's forwarding policy
	 * admits this request without the portal cookie, else null.
	 */
	async function cookielessAccess(req) {
		const policy = await policyFor(originalHost(req));
		if (!policy) {
			return null;
		}
		if (policy.open) {
			// `keyId` marks admittance by a device key (a secret hostname the
			// owner issued to one device) rather than by the address being
			// open to everyone.  The owner's log has to tell those apart.
			return {
				serverId: policy.serverId,
				keyId: policy.keyId || null,
				mode: policy.keyId ? 'key' : 'open'
			};
		}
		if (policy.webhooks
			&& WEBHOOK_METHODS.has(String(req.method || '').toUpperCase())
			&& isWebhookPath(req.url)) {
			return { serverId: policy.serverId, mode: 'webhook' };
		}
		return null;
	}

	/**
	 * Start reading the request body immediately, whatever happens next.
	 *
	 * The admittance checks below are asynchronous (rate limit, policy
	 * lookup), and a handler that subscribes to the request only *after*
	 * awaiting them is racing the stream it is meant to be reading.  Doing
	 * this first lets those checks take as long as they need.
	 */
	function readBody(req) {
		return new Promise((resolve) => {
			const chunks = [];
			let size = 0;
			let tooLarge = false;
			req.on('data', (chunk) => {
				size += chunk.length;
				if (size > maxBody) {
					tooLarge = true;
					return;
				}
				chunks.push(chunk);
			});
			req.on('error', () => resolve({ error: true }));
			req.on('end', () => resolve({
				tooLarge,
				body: tooLarge ? Buffer.alloc(0) : Buffer.concat(chunks)
			}));
		});
	}

	async function httpHandler(req, res) {
		const bodyPromise = readBody(req);
		// Before anything else: a browser arriving from the gate carries its
		// pass in the URL, and leaves with it in a cookie instead.
		if (exchangePass(req, res)) {
			return;
		}
		let access = authorise(req);
		// Cookie-bearing traffic is Vome-vouched: neither the rate limit nor
		// the brute-force block applies to it.
		const vouched = Boolean(access);
		if (!access) {
			const limited = await limitUnauthenticated(req);
			if (limited) {
				// Attributed only if the host is already resolved: spending the
				// budget before touching the portal is the point of the limit,
				// and a flood must not become portal load by way of the log.
				report(req, cachedServerId(originalHost(req)), 'rate_limited',
					{ outcome: 'denied', detail: 'Too many requests' });
				res.writeHead(429, {
					'Retry-After': String(limited.retryAfter),
					'Content-Type': 'text/plain'
				});
				res.end('Too many requests');
				return;
			}
			try {
				access = await cookielessAccess(req);
			} catch (err) {
				logger.error('Forward policy check failed:', err.message || err);
				access = null;
			}
		}
		// Only the login endpoints are barred, not the whole instance: a block
		// keyed on an address that may be a household's shared NAT should stop
		// the guessing, not cut everyone behind it off from their own home.
		if (access && !vouched && loginGuardFactory.isLoginFlowRequest(req.method, req.url)) {
			const blocked = await loginGuard.isBlocked(access.serverId, clientIp(req));
			if (blocked) {
				logger.warn(`Blocked login attempt for ${originalHost(req)}`);
				report(req, access.serverId, 'login_blocked', {
					outcome: 'blocked',
					detail: `Blocked for another ${blocked.retryAfter}s after repeated failures`
				});
				res.writeHead(429, {
					'Retry-After': String(blocked.retryAfter),
					'Content-Type': 'text/plain'
				});
				res.end('Too many failed login attempts');
				return;
			}
		}
		if (!access) {
			// The gate, not a bare sign-in: it can also offer the home's own
			// door password, which is the only way in for a visitor who has no
			// Vome account and never will (portal /remote/gate).
			const dest = `${config.relay.forwardAuthoriseUrl}?host=${encodeURIComponent(originalHost(req))}`;
			if (isArrival(req)) {
				const policy = await policyFor(originalHost(req));
				report(req, policy && policy.serverId, 'gate_shown', { outcome: 'denied' });
			}
			res.writeHead(302, { Location: dest });
			res.end();
			return;
		}
		if (isArrival(req)) {
			report(req, access.serverId,
				vouched ? 'session_opened'
					: (access.mode === 'key' ? 'key_used'
						: (access.mode === 'webhook' ? 'webhook_delivered' : 'open_admitted')),
				{ outcome: 'allowed', keyId: access.keyId || null });
		} else if (access.mode === 'webhook') {
			// Webhooks are never navigations, and are the one cookie-less path
			// a customer may genuinely want to audit call by call.
			report(req, access.serverId, 'webhook_delivered', { outcome: 'allowed' });
		}

		const isLoginFlow = loginGuardFactory.isLoginFlowRequest(req.method, req.url);
		const upstream = await upstreamFor(req);
		const collected = await bodyPromise;
		if (collected.error) {
			res.writeHead(400);
			res.end('Bad request');
			return;
		}
		if (collected.tooLarge) {
			res.writeHead(413);
			res.end('Request too large');
			return;
		}
		const headers = collectRequestHeaders(req, cookieName);

		// A hosted instance we can dial ourselves: same gate, same log, one hop
		// instead of a tunnel.  The response is streamed rather than buffered —
		// this path replaces a direct nginx proxy that never held one.
		if (upstream.kind === 'direct') {
			const result = await directUpstream.forwardHttp(upstream.target, req, res, {
				headers,
				body: collected.body,
				classify: Boolean(isLoginFlow)
			});
			if (result && isLoginFlow) {
				await observeLogin(req, access, vouched, result.status, result.bodyB64);
			}
			return;
		}

		const bodyB64 = collected.body.length ? collected.body.toString('base64') : undefined;
		let result;
		try {
			result = await relay.forwardHttp(access.serverId, {
				method: req.method, path: req.url, headers, bodyB64
			});
		} catch (err) {
			logger.error('UI forward failed:', err.message || err);
			res.writeHead(502);
			res.end('Forwarding failed.');
			return;
		}
		if (result.offline) {
			res.writeHead(502);
			res.end('Home Assistant is offline.');
			return;
		}
		if (!result.status) {
			res.writeHead(502);
			res.end(result.error || 'Forwarding failed.');
			return;
		}
		if (isLoginFlow) {
			await observeLogin(req, access, vouched, result.status, result.bodyB64);
		}
		// A response arriving in pieces is written out as it comes: its
		// length is not known up front and its end may be a long way off,
		// so there is no Content-Length and nothing to buffer.
		if (result.streaming) {
			applyResponseHeaders(res, filterResponseHeaders(result.headers));
			res.writeHead(result.status);
			let detach = () => {};
			let finished = false;
			// The browser closing the tab has to stop the component reading,
			// or an abandoned log tail is carried until the relay drops.
			res.on('close', () => {
				if (finished) {
					return;
				}
				finished = true;
				detach();
				relay.abortStream(access.serverId, result.requestId);
			});
			detach = relay.attachStream(result.requestId, {
				onChunk: (chunk) => {
					if (!finished) {
						res.write(chunk);
					}
				},
				onEnd: () => {
					if (finished) {
						return;
					}
					finished = true;
					detach();
					res.end();
				}
			});
			return;
		}
		const body = result.bodyB64 ? Buffer.from(result.bodyB64, 'base64') : Buffer.alloc(0);
		applyResponseHeaders(res, filterResponseHeaders(result.headers));
		res.setHeader('Content-Length', body.length);
		res.writeHead(result.status);
		res.end(body);
	}

	/**
	 * Classify a login-flow response and act on it: count it against the
	 * brute-force guard, and tell the owner.
	 *
	 * Home Assistant answers a wrong password with 200 and the error in the
	 * body, so the verdict is only visible here, on the way back.  Cookie-borne
	 * traffic is not guarded (Vome already vouched for it) but a failed login
	 * is still reported — an owner mistyping their own password is exactly the
	 * line that explains the notification they are about to get.
	 */
	async function observeLogin(req, access, vouched, status, bodyB64) {
		const verdict = loginGuardFactory.classifyLoginResponse(status, bodyB64);
		if (!verdict) {
			return;
		}
		let blocked = null;
		if (!vouched) {
			blocked = await loginGuard.observe(access.serverId, clientIp(req), verdict);
		}
		report(req, access.serverId,
			verdict === 'failure' ? 'login_failed' : 'login_ok',
			{
				outcome: verdict === 'failure' ? 'denied' : 'allowed',
				keyId: access.keyId || null,
				detail: blocked
					? `Blocked from trying again for ${blocked.retryAfter}s`
					: (vouched ? 'Signed in to Vome' : null)
			});
	}

	async function handleUpgrade(req, socket, head) {
		const pathname = (req.url || '').split('?')[0];
		// HA frontend socket, or a LAN-tunnel WebSocket under /t/<slug>/…
		const isHaFrontend = pathname === '/api/websocket';
		const isLanTunnel = /^\/t\/[a-z0-9](?:[a-z0-9-]{0,30}[a-z0-9])?(?:\/|$)/.test(pathname);
		if (!isHaFrontend && !isLanTunnel) {
			abortUpgrade(socket, 404, 'Not found');
			return;
		}
		let access = authorise(req);
		if (!access) {
			const limited = await limitUnauthenticated(req, { websocket: true });
			if (limited) {
				abortUpgrade(socket, 429, 'Too many requests');
				return;
			}
			// Only `open` (companion-app or device-key) mode admits a
			// cookie-less WebSocket; the webhook policy never applies here.
			try {
				const policy = await policyFor(originalHost(req));
				if (policy && policy.open) {
					access = { serverId: policy.serverId, keyId: policy.keyId || null };
				}
			} catch (err) {
				logger.error('Forward policy check failed:', err.message || err);
			}
		}
		if (!access) {
			abortUpgrade(socket, 401, 'Unauthorized');
			return;
		}
		const upstream = await upstreamFor(req);
		if (upstream.kind === 'direct') {
			// A hosted instance answers its own socket; we are a pipe.  LAN
			// tunnels are relay-only by definition — those routes exist inside
			// a house, not on our fleet.
			if (isLanTunnel) {
				abortUpgrade(socket, 404, 'Not found');
				return;
			}
			directUpstream.forwardUpgrade(upstream.target, req, socket, head, {
				headers: collectRequestHeaders(req, cookieName)
			});
			return;
		}
		if (!relay.isConnected(access.serverId)) {
			abortUpgrade(socket, 502, 'Home Assistant offline');
			return;
		}
		wss.handleUpgrade(req, socket, head, (browser) => bridge(browser, req, access.serverId));
	}

	/**
	 * Bridge one accepted browser WebSocket to a component-side local HA socket.
	 *
	 * Browser frames that arrive before the component acknowledges the open are
	 * queued (the HA frontend sends its `auth` message immediately), then flushed
	 * in order once `ws_open_ack` lands — see websocket/relayBridge.js, which
	 * this and the bearer-token CLI tunnel entry point (tcpTunnelManager.js)
	 * both use so that plumbing exists in one place.
	 */
	function bridge(browser, req, serverId) {
		const headers = collectRequestHeaders(req, cookieName);
		relayBridge.bridgeSocket(browser, relay, serverId, { path: req.url, headers });
	}

	return {
		httpHandler, handleUpgrade, bridge,
		_wss: wss, _policyCache: policyCache, _limitUnauthenticated: limitUnauthenticated
	};
}

module.exports = {
	createUiProxy,
	// Exposed for unit tests.
	originalHost,
	collectRequestHeaders,
	filterResponseHeaders,
	applyResponseHeaders,
	stripOwnCookie,
	isWebhookPath,
	isStaticFrontendPath,
	clientIp,
	HOP_BY_HOP,
	VOME_HOP_HEADERS,
	POLICY_CACHE_TTL_MS,
	AUTH_PATH_RE,
	PASS_PARAM
};

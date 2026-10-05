/**
 * End-to-end remote access: route raw TLS by name, never decrypt it.
 *
 * Listens on the E2E address (a second IP's :443). For each connection it
 * reads only the ClientHello, takes the server name and ALPN offer, asks
 * the portal which home owns that name, and then moves bytes both ways over
 * the home's relay link until either side closes. TLS ends inside the home
 * (the Vome component), with a key that never leaves it.
 *
 * ALPN `acme-tls/1` is Let's Encrypt validating the home's certificate
 * (TLS-ALPN-01); it goes to the home's challenge responder (target
 * `e2e-acme`) instead of its UI (target `e2e`).
 *
 * The frames are the same ws_open / ws_data / ws_close the LAN-TCP tunnel
 * uses (see websocket/relayBridge.js); a component too old to know the
 * targets refuses them (relayManager sends the sentinel path).
 */
const net = require('net');
const { v4: uuidv4 } = require('uuid');
const { parseClientHello, MAX_HELLO_BYTES } = require('./clientHello');
const loggerDefault = require('../utils/logger');

const ACME_TLS_ALPN = 'acme-tls/1';
const HELLO_TIMEOUT_MS = 10000;
// One DNS label, the shapes the portal hands out (a free slug, a paid slug,
// a hosted server id). Anything else is dropped before it costs a lookup.
const LABEL_RE = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;
// Tunnels open to one home at once. A page load opens a handful; this is
// far above that and well below what would swamp a home's link.
const MAX_TUNNELS_PER_HOME = 64;

/**
 * @param {object} deps
 * @param {object} deps.relayManager isConnected / registerTunnel / openWs / sendWs / closeWs / unregisterTunnel
 * @param {(host: string) => Promise<?string>} deps.resolveHost the home's server id for a name, or null
 * @param {string} deps.suffix e.g. 'e2e.vome.io'; other names are dropped
 */
function createSniRouter({ relayManager, resolveHost, suffix, logger = loggerDefault,
	helloTimeoutMs = HELLO_TIMEOUT_MS, maxTunnelsPerHome = MAX_TUNNELS_PER_HOME } = {}) {
	const tail = `.${String(suffix || '').toLowerCase()}`;
	const open = new Map(); // serverId -> tunnels open now

	function bridge(sock, serverId, target, host, initial) {
		const count = open.get(serverId) || 0;
		if (count >= maxTunnelsPerHome) {
			logger.warn(`E2E: ${host} already has ${count} tunnels open; refusing another`);
			sock.destroy();
			return;
		}
		open.set(serverId, count + 1);
		let released = false;
		const release = () => {
			if (released) {
				return;
			}
			released = true;
			const left = (open.get(serverId) || 1) - 1;
			if (left > 0) {
				open.set(serverId, left);
			} else {
				open.delete(serverId);
			}
		};
		const socketId = uuidv4();
		let acked = false;
		const queue = [initial];
		const send = (chunk) => relayManager.sendWs(serverId, {
			socketId, dataB64: Buffer.from(chunk).toString('base64')
		});

		relayManager.registerTunnel(socketId, serverId, {
			onAck: () => {
				acked = true;
				for (const chunk of queue) {
					send(chunk);
				}
				queue.length = 0;
			},
			onData: (data) => {
				if (data.dataB64 != null && !sock.destroyed) {
					sock.write(Buffer.from(data.dataB64, 'base64'));
				}
			},
			onClose: () => sock.destroy()
		});
		if (!relayManager.openWs(serverId, { socketId, target, host })) {
			relayManager.unregisterTunnel(socketId);
			release();
			sock.destroy();
			return;
		}
		sock.on('data', (chunk) => {
			if (acked) {
				send(chunk);
			} else {
				queue.push(chunk);
			}
		});
		sock.on('close', () => {
			release();
			relayManager.unregisterTunnel(socketId);
			relayManager.closeWs(serverId, { socketId, code: 1000, reason: '' });
		});
		sock.resume();
	}

	async function route(sock, hello, buf) {
		const host = hello.sni;
		if (!host || !host.endsWith(tail) || !LABEL_RE.test(host.slice(0, -tail.length))) {
			sock.destroy();
			return;
		}
		let serverId = null;
		try {
			serverId = await resolveHost(host);
		} catch (err) {
			logger.warn(`E2E: resolving ${host} failed: ${err.message || err}`);
		}
		if (!serverId || !relayManager.isConnected(serverId) || sock.destroyed) {
			sock.destroy();
			return;
		}
		const target = hello.alpn.includes(ACME_TLS_ALPN) ? 'e2e-acme' : 'e2e';
		bridge(sock, serverId, target, host, buf);
	}

	function handle(sock) {
		let buf = Buffer.alloc(0);
		const timer = setTimeout(() => sock.destroy(), helloTimeoutMs);
		sock.on('error', () => sock.destroy());
		const onData = (chunk) => {
			buf = Buffer.concat([buf, chunk]);
			const hello = parseClientHello(buf);
			if (hello.status === 'incomplete' && buf.length <= MAX_HELLO_BYTES + 1024) {
				return;
			}
			clearTimeout(timer);
			sock.removeListener('data', onData);
			sock.pause();
			if (hello.status !== 'ok') {
				sock.destroy();
				return;
			}
			route(sock, hello, buf);
		};
		sock.on('data', onData);
		sock.on('close', () => clearTimeout(timer));
	}

	const server = net.createServer(handle);
	return { server, handle };
}

module.exports = { createSniRouter, ACME_TLS_ALPN, LABEL_RE };

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
// A PROXY protocol v1 line is at most 107 bytes (haproxy's spec).
const PROXY_V1_MAX = 107;
// Connections passed on to another router at once.
const MAX_PASSED_ON = 256;
const PROXY_V1_RE = /^PROXY (TCP4|TCP6) ([0-9a-fA-F.:]+) ([0-9a-fA-F.:]+) (\d{1,5}) (\d{1,5})\r\n/;

/**
 * Read a PROXY v1 header off the front of `buf`.
 * @returns {{status: 'incomplete'} | {status: 'invalid'} |
 *   {status: 'ok', peer: string, rest: Buffer}}
 */
function parseProxyV1(buf) {
	const end = buf.indexOf('\r\n');
	if (end === -1) {
		return buf.length < PROXY_V1_MAX ? { status: 'incomplete' } : { status: 'invalid' };
	}
	const line = buf.subarray(0, end + 2).toString('ascii');
	const m = PROXY_V1_RE.exec(line);
	if (!m || net.isIP(m[2]) === 0) {
		return { status: 'invalid' };
	}
	return { status: 'ok', peer: m[2], rest: buf.subarray(end + 2) };
}

function proxyV1Line(sock) {
	const src = String(sock.remoteAddress || '').replace(/^::ffff:/, '');
	const dst = String(sock.localAddress || '').replace(/^::ffff:/, '');
	const family = net.isIP(src) === 6 || net.isIP(dst) === 6 ? 'TCP6' : 'TCP4';
	return `PROXY ${family} ${src} ${dst} ${sock.remotePort || 0} ${sock.localPort || 0}\r\n`;
}

/**
 * @param {object} deps
 * @param {object} deps.relayManager isConnected / registerTunnel / openWs / sendWs / closeWs / unregisterTunnel
 * @param {(host: string) => Promise<?string>} deps.resolveHost the home's server id for a name, or null
 * @param {string} deps.suffix e.g. 'e2e.vome.io'; other names are dropped
 */
function createSniRouter({ relayManager, resolveHost, suffix, logger = loggerDefault,
	helloTimeoutMs = HELLO_TIMEOUT_MS, maxTunnelsPerHome = MAX_TUNNELS_PER_HOME,
	forwards = [], acceptProxyFrom = [] } = {}) {
	const tail = `.${String(suffix || '').toLowerCase()}`;
	// Names this router does not serve itself but passes on, unopened, to
	// another router (the live lane fronts the staging lane's names), with a
	// PROXY line so that router still learns the visitor's address.
	const passOn = forwards.map((f) => ({ tail: `.${String(f.suffix).toLowerCase()}`, host: f.host, port: f.port }));
	// The routers whose PROXY line we believe. Anyone else sending one is
	// simply not speaking TLS, and is dropped.
	const trusted = new Set(acceptProxyFrom.map((a) => String(a)));
	let passedOn = 0;
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
		// The visitor's own address: the home's door rate-limits, blocks
		// repeated failed logins and logs by it, and nothing else can tell it.
		const peer = sock.vomePeer
			|| String(sock.remoteAddress || '').replace(/^::ffff:/, '') || null;
		if (!relayManager.openWs(serverId, { socketId, target, host, peer })) {
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

	function passOnTo(sock, target, buf) {
		if (passedOn >= MAX_PASSED_ON) {
			sock.destroy();
			return;
		}
		passedOn += 1;
		let released = false;
		const release = () => {
			if (!released) {
				released = true;
				passedOn -= 1;
			}
		};
		const out = net.connect(target.port, target.host, () => {
			out.write(proxyV1Line(sock));
			out.write(buf);
			sock.pipe(out);
			out.pipe(sock);
			sock.resume();
		});
		out.on('error', () => sock.destroy());
		sock.on('close', () => {
			release();
			out.destroy();
		});
		out.on('close', () => sock.destroy());
	}

	async function route(sock, hello, buf) {
		const host = hello.sni;
		const elsewhere = host && passOn.find((f) => host.endsWith(f.tail)
			&& LABEL_RE.test(host.slice(0, -f.tail.length)));
		if (elsewhere) {
			passOnTo(sock, elsewhere, buf);
			return;
		}
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
		let expectProxy = trusted.has(String(sock.remoteAddress || '').replace(/^::ffff:/, ''));
		const onData = (chunk) => {
			buf = Buffer.concat([buf, chunk]);
			if (expectProxy) {
				const proxied = parseProxyV1(buf);
				if (proxied.status === 'incomplete') {
					return;
				}
				if (proxied.status !== 'ok') {
					clearTimeout(timer);
					sock.destroy();
					return;
				}
				sock.vomePeer = proxied.peer;
				buf = proxied.rest;
				expectProxy = false;
				if (!buf.length) {
					return;
				}
			}
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

module.exports = { createSniRouter, ACME_TLS_ALPN, LABEL_RE, parseProxyV1 };

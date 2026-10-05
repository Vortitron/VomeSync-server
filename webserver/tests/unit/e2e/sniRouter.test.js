/**
 * The E2E router with a real TLS client and a stand-in home: the handshake
 * completes end to end through the router (which holds no key), names
 * outside the suffix and unknown homes are dropped, and acme-tls/1 goes to
 * the challenge target.
 */
const { execFileSync } = require('child_process');
const fs = require('fs');
const net = require('net');
const os = require('os');
const path = require('path');
const tls = require('tls');
const { createSniRouter, parseProxyV1 } = require('../../../src/e2e/sniRouter');

function pytestFail() {
	throw new Error('the front router must not look up another lane\'s names');
}

const quietLogger = { warn: () => {}, info: () => {}, error: () => {} };

function makeCert(name) {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'e2e-'));
	execFileSync('openssl', [
		'req', '-x509', '-newkey', 'ec', '-pkeyopt', 'ec_paramgen_curve:P-256', '-nodes',
		'-keyout', path.join(dir, 'k.pem'), '-out', path.join(dir, 'c.pem'), '-days', '1',
		'-subj', `/CN=${name}`, '-addext', `subjectAltName=DNS:${name}`
	], { stdio: 'ignore' });
	return { key: fs.readFileSync(path.join(dir, 'k.pem')), cert: fs.readFileSync(path.join(dir, 'c.pem')) };
}

/** A relayManager whose "home" is a real TLS server on loopback. */
function fakeRelay(homePort, { connected = true } = {}) {
	const tunnels = new Map();
	const conns = new Map();
	const opened = [];
	return {
		opened,
		isConnected: () => connected,
		registerTunnel: (id, serverId, cb) => tunnels.set(id, cb),
		unregisterTunnel: (id) => tunnels.delete(id),
		openWs: (serverId, payload) => {
			opened.push({ serverId, ...payload });
			const conn = net.connect(homePort, '127.0.0.1', () => tunnels.get(payload.socketId).onAck());
			conn.on('data', (d) => {
				const t = tunnels.get(payload.socketId);
				if (t) {
					t.onData({ dataB64: d.toString('base64') });
				}
			});
			conn.on('close', () => {
				const t = tunnels.get(payload.socketId);
				if (t) {
					t.onClose({});
				}
			});
			conns.set(payload.socketId, conn);
			return true;
		},
		sendWs: (serverId, { socketId, dataB64 }) => conns.get(socketId).write(Buffer.from(dataB64, 'base64')),
		closeWs: (serverId, { socketId }) => {
			const c = conns.get(socketId);
			if (c) {
				c.destroy();
			}
		}
	};
}

function listen(server) {
	return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server.address().port)));
}

describe('sniRouter', () => {
	const name = 'home1.e2e.vome.test';
	let home;
	let homePort;
	const cleanup = [];

	beforeAll(async () => {
		const creds = makeCert(name);
		home = tls.createServer({ ...creds, ALPNProtocols: ['http/1.1', 'acme-tls/1'] }, (s) => {
			s.end(`hello from the home over ${s.alpnProtocol}`);
		});
		homePort = await listen(home);
	});
	afterAll(() => home.close());
	afterEach(() => {
		while (cleanup.length) {
			cleanup.pop()();
		}
	});

	async function routerWith(relay, resolveHost) {
		const { server } = createSniRouter({ relayManager: relay, resolveHost, suffix: 'e2e.vome.test', logger: quietLogger });
		const port = await listen(server);
		cleanup.push(() => server.close());
		return port;
	}

	function connect(port, servername, alpn = ['http/1.1']) {
		return new Promise((resolve) => {
			const c = tls.connect({ port, host: '127.0.0.1', servername, ALPNProtocols: alpn, rejectUnauthorized: false });
			let body = '';
			c.on('data', (d) => { body += d; });
			c.on('end', () => resolve({ ok: body.length > 0, body, cert: c.getPeerCertificate() }));
			c.on('error', (err) => resolve({ ok: false, err }));
			c.on('close', () => resolve({ ok: body.length > 0, body }));
		});
	}

	test('a browser reaches the home and the home holds the certificate', async () => {
		const relay = fakeRelay(homePort);
		const port = await routerWith(relay, async (h) => (h === name ? 'rly-1' : null));
		const res = await connect(port, name);
		expect(res.body).toBe('hello from the home over http/1.1');
		expect(res.cert.subject.CN).toBe(name);
		expect(relay.opened).toEqual([expect.objectContaining({ serverId: 'rly-1', target: 'e2e', host: name, peer: '127.0.0.1' })]);
	});

	test('acme-tls/1 goes to the challenge target', async () => {
		const relay = fakeRelay(homePort);
		const port = await routerWith(relay, async () => 'rly-1');
		const res = await connect(port, name, ['acme-tls/1']);
		expect(res.body).toBe('hello from the home over acme-tls/1');
		expect(relay.opened[0].target).toBe('e2e-acme');
	});

	test('names outside the suffix, unknown homes and offline homes are dropped', async () => {
		for (const [relay, resolve, sni] of [
			[fakeRelay(homePort), async () => 'rly-1', 'evil.example.com'],
			[fakeRelay(homePort), async () => 'rly-1', 'e2e.vome.test'],
			[fakeRelay(homePort), async () => null, name],
			[fakeRelay(homePort, { connected: false }), async () => 'rly-1', name],
			[fakeRelay(homePort), async () => { throw new Error('portal down'); }, name]
		]) {
			const port = await routerWith(relay, resolve);
			const res = await connect(port, sni);
			expect(res.ok).toBe(false);
			expect(relay.opened).toEqual([]);
		}
	});

	test('a name that is not one plain label never costs a lookup', async () => {
		const asked = [];
		const relay = fakeRelay(homePort);
		const port = await routerWith(relay, async (h) => { asked.push(h); return 'rly-1'; });
		for (const sni of ['a.b.e2e.vome.test', '-x.e2e.vome.test', 'x-.e2e.vome.test', `${'a'.repeat(64)}.e2e.vome.test`, 'a_b.e2e.vome.test']) {
			const res = await connect(port, sni);
			expect(res.ok).toBe(false);
		}
		expect(asked).toEqual([]);
	});

	test('a home gets at most maxTunnelsPerHome at once', async () => {
		const relay = fakeRelay(homePort);
		const { server } = createSniRouter({
			relayManager: relay, resolveHost: async () => 'rly-1',
			suffix: 'e2e.vome.test', logger: quietLogger, maxTunnelsPerHome: 1
		});
		const port = await listen(server);
		cleanup.push(() => server.close());
		// Hold one tunnel open: a raw socket that sends a ClientHello and waits.
		const hold = await new Promise((resolve) => {
			const c = tls.connect({ port, host: '127.0.0.1', servername: name, rejectUnauthorized: false });
			c.on('secureConnect', () => resolve(c));
			c.on('error', () => {});
		});
		const second = await connect(port, name);
		expect(second.ok).toBe(false);
		hold.destroy();
		await new Promise((r) => setTimeout(r, 50));
		const third = await connect(port, name);
		expect(third.ok).toBe(true);
	});

	test('the front router passes another lane\'s names on, and that router learns the visitor', async () => {
		const backRelay = fakeRelay(homePort);
		const back = createSniRouter({
			relayManager: backRelay, resolveHost: async () => 'rly-staging',
			suffix: 'e2e-staging.vome.test', logger: quietLogger, acceptProxyFrom: ['127.0.0.1']
		});
		const backPort = await listen(back.server);
		cleanup.push(() => back.server.close());
		const frontRelay = fakeRelay(homePort);
		const front = createSniRouter({
			relayManager: frontRelay, resolveHost: async () => pytestFail(),
			suffix: 'e2e.vome.test', logger: quietLogger,
			forwards: [{ suffix: 'e2e-staging.vome.test', host: '127.0.0.1', port: backPort }]
		});
		const frontPort = await listen(front.server);
		cleanup.push(() => front.server.close());
		const res = await connect(frontPort, 'home1.e2e-staging.vome.test');
		expect(res.body).toBe('hello from the home over http/1.1');
		expect(frontRelay.opened).toEqual([]);
		expect(backRelay.opened).toEqual([expect.objectContaining({ serverId: 'rly-staging', peer: '127.0.0.1' })]);
	});

	test('a PROXY line names the visitor, from a trusted router only', async () => {
		const hello = await new Promise((resolve) => {
			const srv = net.createServer((s2) => {
				let b = Buffer.alloc(0);
				s2.on('data', (d) => { b = Buffer.concat([b, d]); if (b.length > 100) { s2.destroy(); srv.close(); resolve(b); } });
			});
			srv.listen(0, '127.0.0.1', () => {
				const c = tls.connect({ port: srv.address().port, host: '127.0.0.1', servername: name, rejectUnauthorized: false });
				c.on('error', () => {});
			});
		});
		const send = async (trusted) => {
			const relay = fakeRelay(homePort);
			const { server } = createSniRouter({
				relayManager: relay, resolveHost: async () => 'rly-1', suffix: 'e2e.vome.test',
				logger: quietLogger, acceptProxyFrom: trusted
			});
			const port = await listen(server);
			cleanup.push(() => server.close());
			await new Promise((resolve) => {
				const c = net.connect(port, '127.0.0.1', () => {
					c.write('PROXY TCP4 203.0.113.5 95.216.77.207 51234 443\r\n');
					c.write(hello);
				});
				c.on('error', () => {});
				c.on('close', resolve);
				setTimeout(() => { c.destroy(); resolve(); }, 300);
			});
			return relay.opened;
		};
		expect(await send(['127.0.0.1'])).toEqual([expect.objectContaining({ peer: '203.0.113.5' })]);
		expect(await send(['10.9.9.9'])).toEqual([]);
	});

	test('a connection that never sends a ClientHello is closed', async () => {
		const { server } = createSniRouter({
			relayManager: fakeRelay(homePort), resolveHost: async () => 'rly-1',
			suffix: 'e2e.vome.test', logger: quietLogger, helloTimeoutMs: 100
		});
		const port = await listen(server);
		cleanup.push(() => server.close());
		const closed = await new Promise((resolve) => {
			const c = net.connect(port, '127.0.0.1');
			c.on('close', () => resolve(true));
			c.on('error', () => {});
		});
		expect(closed).toBe(true);
	});
});

describe('parseProxyV1', () => {
	test('reads the visitor and leaves the rest', () => {
		const r = parseProxyV1(Buffer.from('PROXY TCP4 203.0.113.5 10.0.0.1 51234 443\r\nREST'));
		expect(r.status).toBe('ok');
		expect(r.peer).toBe('203.0.113.5');
		expect(r.rest.toString()).toBe('REST');
	});
	test('waits for the end of the line, but not forever', () => {
		expect(parseProxyV1(Buffer.from('PROXY TCP4 1.2.3.4')).status).toBe('incomplete');
		expect(parseProxyV1(Buffer.alloc(200, 65)).status).toBe('invalid');
	});
	test('refuses anything that is not a well-formed line', () => {
		for (const bad of ['PROXY UNKNOWN\r\n', 'PROXY TCP4 notanip 1.2.3.4 1 2\r\n', 'GET / HTTP/1.1\r\n']) {
			expect(parseProxyV1(Buffer.from(bad)).status).toBe('invalid');
		}
	});
});

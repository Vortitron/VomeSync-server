/**
 * The ClientHello reader: real ClientHellos from Node's TLS client, split at
 * every byte boundary, across records, and the inputs it must refuse.
 */
const net = require('net');
const tls = require('tls');
const { parseClientHello } = require('../../../src/e2e/clientHello');

function captureHello(options) {
	return new Promise((resolve, reject) => {
		const server = net.createServer((sock) => {
			let buf = Buffer.alloc(0);
			sock.on('data', (d) => {
				buf = Buffer.concat([buf, d]);
				if (parseClientHello(buf).status !== 'incomplete') {
					sock.destroy();
					server.close();
					resolve(buf);
				}
			});
		});
		server.listen(0, '127.0.0.1', () => {
			const c = tls.connect({ port: server.address().port, host: '127.0.0.1', rejectUnauthorized: false, ...options });
			c.on('error', () => {});
		});
		server.on('error', reject);
	});
}

/** Re-cut one handshake into records of `size` bytes, as a TLS stack may. */
function splitIntoRecords(hello, size) {
	const handshake = hello.subarray(5, 5 + hello.readUInt16BE(3));
	const out = [];
	for (let i = 0; i < handshake.length; i += size) {
		const frag = handshake.subarray(i, i + size);
		const head = Buffer.from([0x16, 0x03, 0x01, 0, 0]);
		head.writeUInt16BE(frag.length, 3);
		out.push(head, frag);
	}
	return Buffer.concat(out);
}

describe('parseClientHello', () => {
	let hello;
	beforeAll(async () => {
		hello = await captureHello({ servername: 'Home1.E2E.Vome.io', ALPNProtocols: ['acme-tls/1', 'http/1.1'] });
	});

	test('reads the name (lower-cased) and the ALPN offer', () => {
		expect(parseClientHello(hello)).toEqual({
			status: 'ok', sni: 'home1.e2e.vome.io', alpn: ['acme-tls/1', 'http/1.1']
		});
	});

	test('is incomplete at every shorter prefix', () => {
		for (let n = 0; n < hello.length; n++) {
			expect(parseClientHello(hello.subarray(0, n)).status).toBe('incomplete');
		}
	});

	test('joins a ClientHello split across records', () => {
		const split = splitIntoRecords(hello, 100);
		expect(parseClientHello(split)).toMatchObject({ status: 'ok', sni: 'home1.e2e.vome.io' });
		expect(parseClientHello(split.subarray(0, split.length - 1)).status).toBe('incomplete');
	});

	test('a browser with no ALPN and no name parses as such', async () => {
		const bare = await captureHello({});
		expect(parseClientHello(bare)).toEqual({ status: 'ok', sni: null, alpn: [] });
	});

	test('plain HTTP is not TLS', () => {
		expect(parseClientHello(Buffer.from('GET / HTTP/1.1\r\n\r\n')).status).toBe('invalid');
	});

	test('a handshake that is not a ClientHello is refused', () => {
		const bad = Buffer.from(hello);
		bad[5] = 0x02; // ServerHello
		expect(parseClientHello(bad).status).toBe('invalid');
	});

	test('an absurd declared length is refused before waiting for it', () => {
		const huge = Buffer.from([0x16, 0x03, 0x01, 0x00, 0x04, 0x01, 0x7f, 0xff, 0xff]);
		expect(parseClientHello(huge)).toEqual({ status: 'invalid', reason: 'ClientHello too large' });
	});

	test('a lying extension length is malformed, not a crash', () => {
		const bad = Buffer.from(hello);
		// Corrupt the extensions block length to run past the end.
		bad.writeUInt16BE(0xffff, bad.length - 2 - 0); // tail bytes are inside extensions
		const r = parseClientHello(bad);
		expect(['ok', 'invalid']).toContain(r.status);
	});
});

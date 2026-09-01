/**
 * Unit tests for forwarding to a hosted Home Assistant we can dial ourselves.
 *
 * These run against a real loopback HTTP server rather than a mocked `http`
 * module: the things worth checking here — that the Host header is re-derived,
 * that a body survives the hop, that a login-flow response comes back for
 * classification while everything else is streamed, that an unreachable
 * instance becomes a 502 rather than a hang — are all properties of talking to
 * a real socket.
 */
const http = require('http');
const { EventEmitter } = require('events');
const { forwardHttp, parseTarget, toHeaderObject } = require('../../../src/proxy/directUpstream');

function fakeReq({ method = 'GET', url = '/', headers = {} } = {}) {
	const req = new EventEmitter();
	req.method = method;
	req.url = url;
	req.headers = headers;
	return req;
}

function fakeRes() {
	let resolveDone;
	const done = new Promise((r) => { resolveDone = r; });
	const res = new EventEmitter();
	res.statusCode = 0;
	res.headers = {};
	res.chunks = [];
	res.headersSent = false;
	res.writeHead = (status, hdrs) => {
		res.statusCode = status;
		res.headersSent = true;
		if (hdrs) { Object.assign(res.headers, hdrs); }
	};
	res.setHeader = (k, v) => { res.headers[k] = v; };
	res.write = (chunk) => { res.chunks.push(Buffer.from(chunk)); return true; };
	res.end = (chunk) => {
		if (chunk) { res.chunks.push(Buffer.from(chunk)); }
		res.body = Buffer.concat(res.chunks).toString('utf8');
		resolveDone();
	};
	res.on = EventEmitter.prototype.on.bind(res);
	res.emit = EventEmitter.prototype.emit.bind(res);
	res.done = done;
	return res;
}

/** A one-off upstream that records what it was sent. */
function upstreamServer(handler) {
	return new Promise((resolve) => {
		const server = http.createServer(handler);
		server.listen(0, '127.0.0.1', () => {
			resolve({
				server,
				target: `127.0.0.1:${server.address().port}`,
				close: () => new Promise((done) => server.close(done))
			});
		});
	});
}

describe('parseTarget', () => {
	test('splits host:port and refuses anything else', () => {
		expect(parseTarget('10.0.0.9:8130')).toEqual({ host: '10.0.0.9', port: 8130 });
		expect(parseTarget('localhost:8123')).toEqual({ host: 'localhost', port: 8123 });
		expect(parseTarget('10.0.0.9')).toBeNull();
		expect(parseTarget(':8123')).toBeNull();
		expect(parseTarget('10.0.0.9:not-a-port')).toBeNull();
		expect(parseTarget('10.0.0.9:70000')).toBeNull();
		expect(parseTarget('')).toBeNull();
		expect(parseTarget(null)).toBeNull();
	});
});

describe('toHeaderObject', () => {
	test('keeps duplicates (Set-Cookie and friends)', () => {
		expect(toHeaderObject([['A', '1'], ['A', '2'], ['B', '3']]))
			.toEqual({ A: ['1', '2'], B: '3' });
	});
});

describe('forwardHttp', () => {
	test('re-derives Host and passes the path, method and body through', async () => {
		let seen = null;
		const up = await upstreamServer((req, res) => {
			const chunks = [];
			req.on('data', (c) => chunks.push(c));
			req.on('end', () => {
				seen = {
					method: req.method,
					url: req.url,
					host: req.headers.host,
					accept: req.headers.accept,
					body: Buffer.concat(chunks).toString('utf8')
				};
				res.writeHead(200, { 'Content-Type': 'application/json' });
				res.end('{"ok":true}');
			});
		});
		const res = fakeRes();
		await forwardHttp(up.target, fakeReq({ method: 'POST', url: '/api/states' }), res, {
			headers: [['Accept', 'application/json'], ['Host', 'gamlabio.home.vome.io']],
			body: Buffer.from('{"state":"on"}')
		});
		await res.done;
		// Home Assistant rejects a Host it does not know itself by, so the
		// friendly hostname must not survive the hop.
		expect(seen.host).toBe(up.target);
		expect(seen.method).toBe('POST');
		expect(seen.url).toBe('/api/states');
		expect(seen.accept).toBe('application/json');
		expect(seen.body).toBe('{"state":"on"}');
		expect(res.statusCode).toBe(200);
		await up.close();
	});

	test('streams an ordinary response back without holding it', async () => {
		const up = await upstreamServer((req, res) => {
			res.writeHead(200, { 'Content-Type': 'text/plain' });
			res.write('first ');
			res.end('second');
		});
		const res = fakeRes();
		const result = await forwardHttp(up.target, fakeReq(), res, { headers: [] });
		await res.done;
		expect(res.body).toBe('first second');
		// Nothing was buffered for the caller: only the login flow asks.
		expect(result.bodyB64).toBeUndefined();
		await up.close();
	});

	test('hands back a classified response body for the login flow', async () => {
		// Home Assistant answers a wrong password with 200 and the error in
		// the body, so the verdict is only visible if we read it.
		const up = await upstreamServer((req, res) => {
			res.writeHead(200, { 'Content-Type': 'application/json' });
			res.end('{"type":"form","errors":{"base":"invalid_auth"}}');
		});
		const res = fakeRes();
		const result = await forwardHttp(
			up.target, fakeReq({ method: 'POST', url: '/auth/login_flow/abc' }), res,
			{ headers: [], body: Buffer.from('{}'), classify: true });
		await res.done;
		expect(result.status).toBe(200);
		expect(Buffer.from(result.bodyB64, 'base64').toString('utf8'))
			.toContain('invalid_auth');
		// And the browser still gets the real answer.
		expect(res.body).toContain('invalid_auth');
		await up.close();
	});

	test('an unreachable instance is a 502, not a hang', async () => {
		const up = await upstreamServer(() => {});
		const target = up.target;
		await up.close(); // nothing is listening any more
		const res = fakeRes();
		await forwardHttp(target, fakeReq(), res, { headers: [] });
		await res.done;
		expect(res.statusCode).toBe(502);
	});

	test('an unusable upstream is refused rather than dialled', async () => {
		const res = fakeRes();
		const result = await forwardHttp('not-a-target', fakeReq(), res, { headers: [] });
		await res.done;
		expect(result).toBeNull();
		expect(res.statusCode).toBe(502);
	});
});

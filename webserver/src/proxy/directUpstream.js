/**
 * Forwarding to a Home Assistant this process can reach directly.
 *
 * The friendly-domain proxy was written for homes behind the relay, where the
 * only way in is the component's tunnel.  A *hosted* instance is different: it
 * runs on our own fleet and answers on a port we can dial.  Until now that
 * difference was expressed in nginx — a hosted home's friendly domain was
 * routed straight at the container — which meant the whole gate lived on one
 * path only.  A memorable hostname sat in front of a bare Home Assistant login
 * form, with no Vome sign-in, no per-address rate limit, no brute-force block,
 * and nothing anywhere that could tell the owner who had been knocking.  nginx
 * also (correctly) refuses to send `X-Forwarded-For` on that path, because
 * Home Assistant answers 400 to a forwarded header it was not told to trust —
 * so Core saw one address for every visitor on earth and could not act on it
 * either.
 *
 * This module closes that gap by giving the proxy a second way to forward, so
 * both kinds of home go through the same gate and produce the same access log.
 * Requests are **streamed**, not buffered like the relay path: a hosted
 * instance serves camera images and long-polling REST, and reading those into
 * memory to hand them straight back would be a regression against the direct
 * nginx route it replaces.  The one exception is a login-flow response, which
 * has to be read to be classified (Home Assistant answers a wrong password
 * with 200 and the error in the body) and is a few hundred bytes.
 *
 * Header handling deliberately mirrors the tunnel: the hop headers Vome adds
 * are stripped rather than forwarded.  Home Assistant is not behind those
 * proxies in any sense it has been told about, and passing them is what takes
 * a whole instance down with 400s.
 */
const http = require('http');
const logger = require('../utils/logger');
const config = require('../config/config');

/** Split a stored `host:port` upstream into request options. */
function parseTarget(target) {
	const text = String(target || '').trim();
	const index = text.lastIndexOf(':');
	if (index <= 0) {
		return null;
	}
	const host = text.slice(0, index);
	const port = parseInt(text.slice(index + 1), 10);
	if (!host || !Number.isInteger(port) || port <= 0 || port > 65535) {
		return null;
	}
	return { host, port };
}

/** Header pairs → a Node headers object, preserving duplicates as arrays. */
function toHeaderObject(pairs) {
	const out = {};
	for (const [name, value] of pairs || []) {
		const key = String(name);
		if (out[key] === undefined) {
			out[key] = value;
		} else if (Array.isArray(out[key])) {
			out[key].push(value);
		} else {
			out[key] = [out[key], value];
		}
	}
	return out;
}

/**
 * Proxy one HTTP request to a hosted instance.
 *
 * `body` is the already-buffered request body (see uiProxy.readBody).
 * `classify` asks for the *response* to be buffered and handed back, which
 * only the login flow needs — Home Assistant answers a wrong password with 200
 * and the error in the body, so the verdict is not in the status.  Everything
 * else is streamed straight through.
 *
 * Resolves once the response has been handed to the client.  Errors are
 * answered here (502) rather than thrown: the caller has already committed to
 * this request.
 */
function forwardHttp(target, req, res, { headers, body = null, classify = null } = {}) {
	return new Promise((resolve) => {
		const parsed = parseTarget(target);
		if (!parsed) {
			logger.error(`Direct forward has no usable upstream: ${target}`);
			res.writeHead(502);
			res.end('Forwarding failed.');
			resolve(null);
			return;
		}
		const upstream = http.request({
			host: parsed.host,
			port: parsed.port,
			method: req.method,
			path: req.url,
			headers: {
				...toHeaderObject(headers),
				// Re-derived per hop: the tenant's Home Assistant rejects a
				// Host it does not recognise, and it knows itself by address.
				host: `${parsed.host}:${parsed.port}`
			},
			timeout: config.relay.forwardDirectTimeoutMs
		});

		let settled = false;
		const fail = (err, status, message) => {
			if (settled) {
				return;
			}
			settled = true;
			logger.error(`Direct forward to ${target} failed:`, err && (err.message || err));
			if (!res.headersSent) {
				res.writeHead(status);
			}
			res.end(message);
			resolve(null);
		};

		upstream.on('error', (err) => fail(err, 502, 'Home Assistant is unreachable.'));
		upstream.on('timeout', () => {
			upstream.destroy();
			fail(new Error('timeout'), 504, 'Home Assistant took too long to answer.');
		});

		upstream.on('response', (upRes) => {
			if (!classify) {
				res.writeHead(upRes.statusCode || 502, upRes.headers);
				upRes.pipe(res);
				upRes.on('end', () => {
					settled = true;
					resolve({ status: upRes.statusCode });
				});
				upRes.on('error', (err) => fail(err, 502, 'Forwarding failed.'));
				return;
			}
			// Login flow: small, and the verdict is only visible in the body.
			const chunks = [];
			let size = 0;
			upRes.on('data', (chunk) => {
				size += chunk.length;
				if (size <= config.relay.forwardMaxBodyBytes) {
					chunks.push(chunk);
				}
			});
			upRes.on('error', (err) => fail(err, 502, 'Forwarding failed.'));
			upRes.on('end', () => {
				const body = Buffer.concat(chunks);
				settled = true;
				res.writeHead(upRes.statusCode || 502, upRes.headers);
				res.end(body);
				resolve({ status: upRes.statusCode, bodyB64: body.toString('base64') });
			});
		});

		// The body has already been read (the caller starts reading it before
		// the admittance checks, so those can take as long as they need).
		if (body && body.length) {
			upstream.write(body);
		}
		upstream.end();
	});
}

/**
 * Bridge an accepted WebSocket upgrade to a hosted instance.
 *
 * Node's HTTP client hands back the raw socket on `upgrade`, so this is a
 * plain two-way copy once the upstream's 101 has been replayed to the browser.
 * No frame parsing: the frontend's socket is Home Assistant's business, not
 * ours.
 */
function forwardUpgrade(target, req, socket, head, { headers } = {}) {
	const parsed = parseTarget(target);
	if (!parsed) {
		socket.destroy();
		return;
	}
	const upstream = http.request({
		host: parsed.host,
		port: parsed.port,
		method: req.method,
		path: req.url,
		headers: {
			...toHeaderObject(headers),
			host: `${parsed.host}:${parsed.port}`,
			connection: 'Upgrade',
			upgrade: 'websocket'
		}
	});

	upstream.on('error', (err) => {
		logger.error(`Direct upgrade to ${target} failed:`, err.message || err);
		socket.destroy();
	});

	// The upstream declining the upgrade is a real answer (401, 404, 502);
	// pass it on rather than dropping the connection with no explanation.
	upstream.on('response', (upRes) => {
		const lines = [`HTTP/1.1 ${upRes.statusCode} ${upRes.statusMessage || ''}`];
		for (const [name, value] of Object.entries(upRes.headers)) {
			lines.push(`${name}: ${value}`);
		}
		socket.write(`${lines.join('\r\n')}\r\n\r\n`);
		upRes.pipe(socket);
	});

	upstream.on('upgrade', (upRes, upSocket, upHead) => {
		const lines = [`HTTP/1.1 ${upRes.statusCode} ${upRes.statusMessage || 'Switching Protocols'}`];
		for (const [name, value] of Object.entries(upRes.headers)) {
			lines.push(`${name}: ${value}`);
		}
		socket.write(`${lines.join('\r\n')}\r\n\r\n`);
		if (upHead && upHead.length) {
			socket.unshift(upHead);
		}
		if (head && head.length) {
			upSocket.unshift(head);
		}
		upSocket.on('error', () => socket.destroy());
		socket.on('error', () => upSocket.destroy());
		upSocket.pipe(socket);
		socket.pipe(upSocket);
	});

	upstream.end();
}

module.exports = { forwardHttp, forwardUpgrade, parseTarget, toHeaderObject };

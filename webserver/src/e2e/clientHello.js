/**
 * Read the server name (SNI) and ALPN offer out of a TLS ClientHello.
 *
 * End-to-end remote access routes a raw TLS connection to a home without
 * decrypting it: the only things the router may know are which home the
 * browser asked for and, so Let's Encrypt's TLS-ALPN-01 validation can be
 * told apart from a browser, whether it offered `acme-tls/1`. Both sit in
 * the ClientHello in the clear. Nothing else is read and nothing is kept.
 *
 * A ClientHello may span several TLS records (large post-quantum key shares
 * push it past one), so handshake fragments are joined before parsing.
 */

const RECORD_HANDSHAKE = 0x16;
const HANDSHAKE_CLIENT_HELLO = 0x01;
const EXT_SERVER_NAME = 0x0000;
const EXT_ALPN = 0x0010;
const NAME_TYPE_HOST = 0x00;
// Far above any real ClientHello; a bound so a slow drip cannot grow us.
const MAX_HELLO_BYTES = 64 * 1024;

/**
 * @param {Buffer} buf every byte received on the connection so far
 * @returns {{status: 'incomplete'} | {status: 'invalid', reason: string} |
 *   {status: 'ok', sni: ?string, alpn: string[]}}
 */
function parseClientHello(buf) {
	const handshake = [];
	let handshakeLen = 0;
	let need = null;
	let offset = 0;
	while (need === null || handshakeLen < need) {
		if (buf.length < offset + 5) {
			return { status: 'incomplete' };
		}
		if (buf[offset] !== RECORD_HANDSHAKE) {
			return { status: 'invalid', reason: 'not a TLS handshake' };
		}
		const recordLen = buf.readUInt16BE(offset + 3);
		if (recordLen === 0 || recordLen > 16384 + 256) {
			return { status: 'invalid', reason: 'bad record length' };
		}
		if (buf.length < offset + 5 + recordLen) {
			return { status: 'incomplete' };
		}
		const fragment = buf.subarray(offset + 5, offset + 5 + recordLen);
		handshake.push(fragment);
		handshakeLen += fragment.length;
		offset += 5 + recordLen;
		if (need === null && handshakeLen >= 4) {
			const head = Buffer.concat(handshake);
			if (head[0] !== HANDSHAKE_CLIENT_HELLO) {
				return { status: 'invalid', reason: 'not a ClientHello' };
			}
			need = 4 + head.readUIntBE(1, 3);
			if (need > MAX_HELLO_BYTES) {
				return { status: 'invalid', reason: 'ClientHello too large' };
			}
		}
	}
	try {
		return parseBody(Buffer.concat(handshake).subarray(4, need));
	} catch (_err) {
		return { status: 'invalid', reason: 'malformed ClientHello' };
	}
}

function parseBody(body) {
	let p = 2 + 32; // legacy_version, random
	const take = (n) => {
		if (p + n > body.length) {
			throw new RangeError('short');
		}
		const out = body.subarray(p, p + n);
		p += n;
		return out;
	};
	take(body[p] + 1); // session id (length byte included)
	take(body.readUInt16BE(p) + 2); // cipher suites
	take(body[p] + 1); // compression methods
	let sni = null;
	const alpn = [];
	if (p === body.length) {
		return { status: 'ok', sni, alpn };
	}
	const extensions = take(body.readUInt16BE(p) + 2).subarray(2);
	let e = 0;
	while (e + 4 <= extensions.length) {
		const type = extensions.readUInt16BE(e);
		const len = extensions.readUInt16BE(e + 2);
		const data = extensions.subarray(e + 4, e + 4 + len);
		if (data.length !== len) {
			throw new RangeError('short extension');
		}
		if (type === EXT_SERVER_NAME && data.length >= 2) {
			const list = data.subarray(2, 2 + data.readUInt16BE(0));
			let n = 0;
			while (n + 3 <= list.length) {
				const nameLen = list.readUInt16BE(n + 1);
				if (list[n] === NAME_TYPE_HOST && sni === null) {
					sni = list.subarray(n + 3, n + 3 + nameLen).toString('ascii').toLowerCase();
				}
				n += 3 + nameLen;
			}
		} else if (type === EXT_ALPN && data.length >= 2) {
			const list = data.subarray(2, 2 + data.readUInt16BE(0));
			let n = 0;
			while (n < list.length) {
				const protoLen = list[n];
				alpn.push(list.subarray(n + 1, n + 1 + protoLen).toString('ascii'));
				n += 1 + protoLen;
			}
		}
		e += 4 + len;
	}
	return { status: 'ok', sni, alpn };
}

module.exports = { parseClientHello, MAX_HELLO_BYTES };

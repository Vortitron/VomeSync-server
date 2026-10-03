/**
 * The token that lets one reader follow one state watch.
 *
 * The portal signs it after checking the key (ha:read on that home); this
 * process only verifies it. It names the watch, the home and when it expires,
 * so it cannot be turned on another watch or another home, and a key revoked
 * in the portal stops a reader within one token's life (the portal re-checks
 * the key each time it renews one). The signing key is derived from the secret
 * the portal and this backend already share, under its own label, so it is no
 * new secret to keep and cannot be confused with any other use of that one.
 *
 * Format: `v1.<job_id>.<server_id>.<expires_unix>.<hmac_sha256_hex>`; the
 * portal's portal/state_watch.py mints the same.
 */
const crypto = require('crypto');

const LABEL = 'vome-state-watch-v1';

function signingKey(secret) {
	return crypto.createHmac('sha256', secret).update(LABEL).digest();
}

function sign(secret, jobId, serverId, expires) {
	const body = `v1.${jobId}.${serverId}.${expires}`;
	return `${body}.${crypto.createHmac('sha256', signingKey(secret)).update(body).digest('hex')}`;
}

/** `{ jobId, serverId }` for a good, unexpired token; null otherwise. Fails closed without a secret. */
function verify(secret, token, now = Date.now()) {
	if (!secret || typeof token !== 'string') {
		return null;
	}
	const parts = token.split('.');
	if (parts.length !== 5 || parts[0] !== 'v1') {
		return null;
	}
	const [, jobId, serverId, expiresText, mac] = parts;
	const expires = Number(expiresText);
	if (!Number.isFinite(expires) || expires * 1000 < now) {
		return null;
	}
	const expected = sign(secret, jobId, serverId, expiresText).split('.')[4];
	const a = Buffer.from(mac, 'hex');
	const b = Buffer.from(expected, 'hex');
	if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
		return null;
	}
	return { jobId, serverId };
}

module.exports = { sign, verify };

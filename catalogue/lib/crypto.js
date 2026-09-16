/**
 * VomeSync v2 owner/switch keys, matching the Home Assistant integration.
 *
 * Master seed is 32 bytes (base64url). Per-switch seeds are HMAC-SHA256 of
 * "vomesync:switch_seed:v1:" + index, keyed by the master seed — the same
 * derivation as custom_components/vomesync/crypto.py. UIDs stay stable if
 * the seed and index stay the same.
 */
const crypto = require('crypto');
const {
	stableJsonStringify,
	deriveOwnerIdFromOwnerPubKeyB64Url,
	deriveSwitchUidFromSwitchPubKeyB64Url
} = require('../../webserver/src/utils/crypto_v2');

const ED25519_PKCS8_PREFIX = Buffer.from('302e020100300506032b657004220420', 'hex');
const SWITCH_SEED_DERIVE_PREFIX = Buffer.from('vomesync:switch_seed:v1:', 'utf8');
const MASTER_SEED_BYTES = 32;

function decodeBase64Url(value, label) {
	if (typeof value !== 'string' || value.length === 0) {
		throw new TypeError(`${label} must be a non-empty string`);
	}
	if (!/^[A-Za-z0-9_-]+$/.test(value)) {
		throw new Error(`${label} must be base64url`);
	}
	return Buffer.from(value, 'base64url');
}

function encodeBase64Url(buffer) {
	return Buffer.from(buffer).toString('base64url');
}

function generateMasterSeedB64Url() {
	return encodeBase64Url(crypto.randomBytes(MASTER_SEED_BYTES));
}

function masterSeedBytes(masterSeedB64Url) {
	const seed = decodeBase64Url(masterSeedB64Url, 'master seed');
	if (seed.length !== MASTER_SEED_BYTES) {
		throw new Error('master seed must be 32 bytes');
	}
	return seed;
}

function privateKeyFromSeed(seed) {
	if (!Buffer.isBuffer(seed) || seed.length !== MASTER_SEED_BYTES) {
		throw new Error('Ed25519 seed must be 32 bytes');
	}
	const der = Buffer.concat([ED25519_PKCS8_PREFIX, seed]);
	return crypto.createPrivateKey({ key: der, format: 'der', type: 'pkcs8' });
}

function rawPublicKey(privateKey) {
	const publicKey = crypto.createPublicKey(privateKey);
	const spki = publicKey.export({ type: 'spki', format: 'der' });
	return spki.subarray(spki.length - MASTER_SEED_BYTES);
}

function ownerPrivateKey(masterSeedB64Url) {
	return privateKeyFromSeed(masterSeedBytes(masterSeedB64Url));
}

function deriveSwitchSeed(masterSeedB64Url, index) {
	if (!Number.isInteger(index) || index < 0) {
		throw new Error('index must be an integer >= 0');
	}
	const master = masterSeedBytes(masterSeedB64Url);
	const msg = Buffer.concat([SWITCH_SEED_DERIVE_PREFIX, Buffer.from(String(index), 'utf8')]);
	return crypto.createHmac('sha256', master).update(msg).digest();
}

function switchPrivateKey(masterSeedB64Url, index) {
	return privateKeyFromSeed(deriveSwitchSeed(masterSeedB64Url, index));
}

function ownerPubKeyB64Url(masterSeedB64Url) {
	return encodeBase64Url(rawPublicKey(ownerPrivateKey(masterSeedB64Url)));
}

function switchPubKeyB64Url(masterSeedB64Url, index) {
	return encodeBase64Url(rawPublicKey(switchPrivateKey(masterSeedB64Url, index)));
}

function switchUid(masterSeedB64Url, index) {
	return deriveSwitchUidFromSwitchPubKeyB64Url(switchPubKeyB64Url(masterSeedB64Url, index));
}

function ownerId(masterSeedB64Url) {
	return deriveOwnerIdFromOwnerPubKeyB64Url(ownerPubKeyB64Url(masterSeedB64Url));
}

function signB64Url(privateKey, message) {
	const sig = crypto.sign(null, Buffer.from(message, 'utf8'), privateKey);
	return encodeBase64Url(sig);
}

function newNonce() {
	return crypto.randomBytes(18).toString('base64url');
}

function nowTs(ts) {
	if (ts === undefined || ts === null) {
		return Date.now();
	}
	return Number(ts);
}

module.exports = {
	MASTER_SEED_BYTES,
	decodeBase64Url,
	encodeBase64Url,
	generateMasterSeedB64Url,
	ownerPrivateKey,
	switchPrivateKey,
	ownerPubKeyB64Url,
	switchPubKeyB64Url,
	switchUid,
	ownerId,
	signB64Url,
	newNonce,
	nowTs,
	stableJsonStringify
};

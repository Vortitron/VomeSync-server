/**
 * Signed v2 request bodies. Canonical JSON must match
 * webserver/src/routes/route-helpers.js or the server rejects the signature.
 */
const {
	ownerPrivateKey,
	switchPrivateKey,
	ownerPubKeyB64Url,
	switchPubKeyB64Url,
	switchUid,
	signB64Url,
	newNonce,
	nowTs,
	stableJsonStringify
} = require('./crypto');

function pickCreatePayload(meta) {
	const payload = {
		description: meta.description || '',
		location: meta.location || '',
		category: meta.category || 'Other',
		publicize: Boolean(meta.publicize),
		link: meta.link || ''
	};
	if (typeof meta.name === 'string') {
		payload.name = meta.name;
	}
	if (typeof meta.iconUrl === 'string') {
		payload.iconUrl = meta.iconUrl;
	}
	if (typeof meta.bannerUrl === 'string') {
		payload.bannerUrl = meta.bannerUrl;
	}
	return payload;
}

function buildCreateSwitchRequest(masterSeedB64Url, index, meta, options = {}) {
	const ts = nowTs(options.ts);
	const nonce = options.nonce || newNonce();
	const ownerPubKey = ownerPubKeyB64Url(masterSeedB64Url);
	const switchPubKey = switchPubKeyB64Url(masterSeedB64Url, index);
	const uid = switchUid(masterSeedB64Url, index);
	const payload = pickCreatePayload(meta);
	const canonical = stableJsonStringify({
		v: 2,
		action: 'create_switch',
		ownerPubKey,
		switchPubKey,
		uid,
		index,
		ts,
		nonce,
		payload
	});
	const body = {
		ownerPubKey,
		switchPubKey,
		index,
		ts,
		nonce,
		sigOwner: signB64Url(ownerPrivateKey(masterSeedB64Url), canonical),
		sigSwitch: signB64Url(switchPrivateKey(masterSeedB64Url, index), canonical),
		...payload
	};
	if (options.captchaToken) {
		body.captchaToken = options.captchaToken;
	}
	return { uid, body };
}

function buildMySwitchesRequest(masterSeedB64Url, options = {}) {
	const ts = nowTs(options.ts);
	const nonce = options.nonce || newNonce();
	const ownerPubKey = ownerPubKeyB64Url(masterSeedB64Url);
	const canonical = stableJsonStringify({
		v: 2,
		action: 'my_switches',
		ownerPubKey,
		ts,
		nonce
	});
	return {
		ownerPubKey,
		ts,
		nonce,
		sigOwner: signB64Url(ownerPrivateKey(masterSeedB64Url), canonical)
	};
}

function buildUpdateSwitchRequest(masterSeedB64Url, uid, updates, options = {}) {
	const ts = nowTs(options.ts);
	const nonce = options.nonce || newNonce();
	const ownerPubKey = ownerPubKeyB64Url(masterSeedB64Url);
	const canonical = stableJsonStringify({
		v: 2,
		action: 'update_switch',
		uid,
		ownerPubKey,
		ts,
		nonce,
		payload: updates
	});
	const body = {
		ownerPubKey,
		ts,
		nonce,
		sigOwner: signB64Url(ownerPrivateKey(masterSeedB64Url), canonical),
		...updates
	};
	if (options.captchaToken !== undefined) {
		body.captchaToken = options.captchaToken || '';
	}
	return body;
}

function buildSetStateRequest(masterSeedB64Url, uid, index, state, params, options = {}) {
	const ts = nowTs(options.ts);
	const nonce = options.nonce || newNonce();
	const paramsObj = params && typeof params === 'object' ? params : {};
	const canonical = stableJsonStringify({
		v: 2,
		action: 'set_state',
		uid,
		ts,
		nonce,
		state: Boolean(state),
		params: paramsObj
	});
	return {
		ts,
		nonce,
		sigSwitch: signB64Url(switchPrivateKey(masterSeedB64Url, index), canonical),
		state: Boolean(state),
		params: paramsObj
	};
}

function buildCreateAccessKeyRequest(masterSeedB64Url, uid, fields, options = {}) {
	const ts = nowTs(options.ts);
	const nonce = options.nonce || newNonce();
	const ownerPubKey = ownerPubKeyB64Url(masterSeedB64Url);
	const payload = {};
	if (fields.name !== undefined) {
		payload.name = String(fields.name);
	}
	if (fields.permissions !== undefined) {
		payload.permissions = [...fields.permissions];
	}
	if (fields.ttlSeconds !== undefined) {
		payload.ttlSeconds = Number(fields.ttlSeconds);
	}
	const canonical = stableJsonStringify({
		v: 2,
		action: 'create_access_key',
		uid,
		ownerPubKey,
		ts,
		nonce,
		payload
	});
	const body = {
		ownerPubKey,
		ts,
		nonce,
		sigOwner: signB64Url(ownerPrivateKey(masterSeedB64Url), canonical)
	};
	if (fields.name !== undefined) {
		body.name = String(fields.name);
	}
	if (fields.permissions !== undefined) {
		body.permissions = [...fields.permissions];
	}
	if (fields.ttlSeconds !== undefined) {
		body.ttlSeconds = Number(fields.ttlSeconds);
	}
	return body;
}

module.exports = {
	pickCreatePayload,
	buildCreateSwitchRequest,
	buildMySwitchesRequest,
	buildUpdateSwitchRequest,
	buildSetStateRequest,
	buildCreateAccessKeyRequest
};

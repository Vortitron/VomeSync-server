const fs = require('fs');
const path = require('path');
const { ownerId, switchUid } = require('./crypto');
const {
	buildCreateSwitchRequest,
	buildUpdateSwitchRequest,
	buildSetStateRequest,
	buildCreateAccessKeyRequest,
	buildMySwitchesRequest
} = require('./requests');
const { validateCatalogue } = require('./validate');
const { desiredState, desiredParams } = require('./refresh');
const { artIds, renderIconPng, renderBannerPng } = require('./artwork');
const { requestJson, sha256Hex } = require('./client');

const ACCESS_KEY_TTL_SECONDS = 30 * 24 * 60 * 60;
const ACCESS_KEY_PERMISSIONS = ['toggle', 'comment', 'metadata'];
const PREMIUM_DURATION_DAYS = 3650;

function sleep(ms) {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

function publicMeta(entry) {
	return {
		name: entry.name,
		description: entry.description,
		location: entry.location,
		category: entry.category,
		publicize: true,
		link: entry.link || ''
	};
}

function metadataDiffers(live, wanted) {
	if (!live) {
		return true;
	}
	return live.name !== wanted.name
		|| live.description !== wanted.description
		|| live.location !== wanted.location
		|| live.category !== wanted.category
		|| Boolean(live.publicize) !== true
		|| (live.link || '') !== (wanted.link || '');
}

function loadJsonFile(filePath, fallback) {
	if (!fs.existsSync(filePath)) {
		return fallback;
	}
	return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function saveJsonFile(filePath, data) {
	fs.mkdirSync(path.dirname(filePath), { recursive: true });
	fs.writeFileSync(filePath, `${JSON.stringify(data, null, '\t')}\n`, 'utf8');
}

async function grantPremium(apiBase, adminKey, owner, fetchImpl, log) {
	if (!adminKey) {
		log('No ADMIN_API_KEY; skipping premium grant');
		return false;
	}
	await requestJson(fetchImpl, apiBase, `/admin/owner/${owner}/tier`, {
		method: 'POST',
		headers: { 'X-Admin-Key': adminKey },
		body: { tier: 'premium', durationDays: PREMIUM_DURATION_DAYS }
	});
	log(`Granted premium to owner ${owner.slice(0, 8)}… for ${PREMIUM_DURATION_DAYS} days`);
	return true;
}

async function ensureAccessKey(ctx, entry, uid, stored) {
	if (stored && stored.accessKey) {
		return stored;
	}
	const body = buildCreateAccessKeyRequest(ctx.seed, uid, {
		name: `catalogue:${entry.id}`,
		permissions: ACCESS_KEY_PERMISSIONS,
		ttlSeconds: ACCESS_KEY_TTL_SECONDS
	});
	const created = await requestJson(ctx.fetchImpl, ctx.apiBase, `/v2/switch/${uid}/access-keys`, {
		method: 'POST',
		body
	});
	const data = created.data || {};
	return {
		...stored,
		uid,
		accessKey: data.apiKey,
		keyId: data.keyId
	};
}

async function uploadArtwork(ctx, entry, uid, stored) {
	const iconPng = await renderIconPng(entry.art, ctx.sharp);
	const bannerPng = await renderBannerPng(entry.art, ctx.sharp);
	const artHash = sha256Hex(Buffer.concat([iconPng, bannerPng]));
	if (stored && stored.artHash === artHash && stored.iconUploaded) {
		return stored;
	}
	const withKey = await ensureAccessKey(ctx, entry, uid, stored);
	if (!withKey.accessKey) {
		throw new Error(`${entry.id}: access key missing after create`);
	}
	const form = new FormData();
	form.append('iconFile', new Blob([iconPng], { type: 'image/png' }), `${entry.id}-icon.png`);
	form.append('bannerFile', new Blob([bannerPng], { type: 'image/png' }), `${entry.id}-banner.png`);
	await requestJson(ctx.fetchImpl, ctx.apiBase, `/v2/switch/${uid}/metadata`, {
		method: 'POST',
		headers: { 'X-Api-Key': withKey.accessKey },
		body: form
	});
	return { ...withKey, artHash, iconUploaded: true };
}

async function applyOne(ctx, entry, stored) {
	const uid = switchUid(ctx.seed, entry.index);
	const wanted = publicMeta(entry);
	const result = {
		id: entry.id,
		uid,
		created: false,
		updated: false,
		art: false,
		state: null
	};

	let live = null;
	try {
		const status = await requestJson(ctx.fetchImpl, ctx.apiBase, `/status/${uid}`);
		live = status.data || null;
	} catch (error) {
		if (error.status !== 404) {
			throw error;
		}
	}

	if (ctx.dryRun) {
		result.wouldCreate = !live;
		result.wouldUpdate = !live || metadataDiffers(live, wanted);
		result.desiredState = desiredState(entry, ctx.now);
		return { result, stored: { ...(stored || {}), uid } };
	}

	if (!live) {
		const created = buildCreateSwitchRequest(ctx.seed, entry.index, wanted, {
			captchaToken: ctx.captchaToken
		});
		await requestJson(ctx.fetchImpl, ctx.apiBase, '/v2/switch', {
			method: 'POST',
			body: created.body
		});
		result.created = true;
		live = { ...wanted, state: false };
		await sleep(ctx.pauseMs);
	}

	if (metadataDiffers(live, wanted)) {
		const updates = { ...wanted };
		const body = buildUpdateSwitchRequest(ctx.seed, uid, updates, {
			captchaToken: ctx.captchaToken
		});
		await requestJson(ctx.fetchImpl, ctx.apiBase, `/v2/switch/${uid}`, {
			method: 'POST',
			body
		});
		result.updated = true;
	}

	let nextStored = { ...(stored || {}), uid };
	if (ctx.skipImages) {
		result.art = 'skipped';
	} else {
		nextStored = await uploadArtwork(ctx, entry, uid, nextStored);
		result.art = true;
	}

	const wantOn = desiredState(entry, ctx.now);
	const haveOn = Boolean(live && live.state);
	if (wantOn !== haveOn || result.created) {
		const body = buildSetStateRequest(
			ctx.seed,
			uid,
			entry.index,
			wantOn,
			desiredParams(entry)
		);
		await requestJson(ctx.fetchImpl, ctx.apiBase, `/v2/switch/${uid}/state`, {
			method: 'POST',
			body
		});
		result.state = wantOn ? 'on' : 'off';
	} else {
		result.state = haveOn ? 'on' : 'off';
	}

	return { result, stored: nextStored };
}

async function applyCatalogue(options) {
	const log = options.log || (() => {});
	const entries = validateCatalogue(options.entries, artIds());
	const selected = options.onlyIds && options.onlyIds.length
		? entries.filter((entry) => options.onlyIds.includes(entry.id))
		: entries;
	if (options.onlyIds && options.onlyIds.length && selected.length !== options.onlyIds.length) {
		const have = new Set(selected.map((entry) => entry.id));
		const missing = options.onlyIds.filter((id) => !have.has(id));
		throw new Error(`unknown switch id(s): ${missing.join(', ')}`);
	}

	const ctx = {
		apiBase: options.apiBase,
		seed: options.seed,
		fetchImpl: options.fetchImpl || fetch,
		sharp: options.sharp,
		captchaToken: options.captchaToken || '',
		dryRun: Boolean(options.dryRun),
		skipImages: Boolean(options.skipImages),
		now: options.now || new Date(),
		pauseMs: Number.isFinite(options.pauseMs) ? options.pauseMs : 150,
		log
	};

	const owner = ownerId(ctx.seed);
	const state = { ownerId: owner, switches: { ...(options.state && options.state.switches ? options.state.switches : {}) } };

	if (!ctx.dryRun && options.adminKey) {
		try {
			await grantPremium(ctx.apiBase, options.adminKey, owner, ctx.fetchImpl, log);
		} catch (error) {
			log(`Premium grant failed (${error.message}); continuing`);
		}
	}

	const results = [];
	for (const entry of selected) {
		log(`${ctx.dryRun ? 'dry-run' : 'apply'} ${entry.id}`);
		const previous = state.switches[entry.id] || {};
		const { result, stored } = await applyOne(ctx, entry, previous);
		state.switches[entry.id] = stored;
		results.push(result);
		if (typeof options.onState === 'function') {
			options.onState(state);
		}
	}

	return { ownerId: owner, results, state };
}

async function refreshStates(options) {
	const log = options.log || (() => {});
	const entries = validateCatalogue(options.entries, artIds());
	const selected = options.onlyIds && options.onlyIds.length
		? entries.filter((entry) => options.onlyIds.includes(entry.id))
		: entries;
	const now = options.now || new Date();
	const results = [];
	for (const entry of selected) {
		const uid = switchUid(options.seed, entry.index);
		const wantOn = desiredState(entry, now);
		if (options.dryRun) {
			results.push({ id: entry.id, uid, state: wantOn ? 'on' : 'off', dryRun: true });
			continue;
		}
		const body = buildSetStateRequest(
			options.seed,
			uid,
			entry.index,
			wantOn,
			desiredParams(entry)
		);
		await requestJson(options.fetchImpl || fetch, options.apiBase, `/v2/switch/${uid}/state`, {
			method: 'POST',
			body
		});
		log(`${entry.id} → ${wantOn ? 'ON' : 'OFF'}`);
		results.push({ id: entry.id, uid, state: wantOn ? 'on' : 'off' });
	}
	return results;
}

async function listOwned(options) {
	const body = buildMySwitchesRequest(options.seed);
	const payload = await requestJson(options.fetchImpl || fetch, options.apiBase, '/v2/my-switches', {
		method: 'POST',
		body
	});
	return payload.data || payload;
}

function isTestDebris(item, keepUids) {
	const uid = String((item && item.uid) || '');
	if (keepUids && keepUids.has(uid)) {
		return false;
	}
	const name = String((item && item.name) || '').trim();
	const description = String((item && item.description) || '').trim();
	if (/gamla\s*bio/i.test(name)) {
		return false;
	}
	if (description === 'Public Test Switch') {
		return true;
	}
	if (!name) {
		return true;
	}
	return /^(?:e2e|websocket|public test|auth|ping|switch\s*\d)|claude-e2e-test|a2-registry-check/i.test(name);
}

async function listAllSwitchesAdmin(options) {
	if (options.fallbackUids && options.fallbackUids.length) {
		const switches = [];
		for (const uid of options.fallbackUids) {
			try {
				const status = await requestJson(options.fetchImpl || fetch, options.apiBase, `/status/${uid}`);
				switches.push({ uid, ...(status.data || {}) });
			} catch (error) {
				if (error.status !== 404) {
					throw error;
				}
			}
		}
		return switches;
	}
	const listed = await requestJson(options.fetchImpl || fetch, options.apiBase, '/admin/switches', {
		method: 'GET',
		headers: { 'X-Admin-Key': options.adminKey }
	});
	return (listed.data && listed.data.switches) || [];
}

async function delistTestSwitches(options) {
	const listed = await requestJson(options.fetchImpl || fetch, options.apiBase, '/public-switches');
	const switches = (listed.data && listed.data.switches) || [];
	const tests = switches.filter((item) => isTestDebris(item));
	if (options.dryRun) {
		return tests.map((item) => item.uid);
	}
	if (!options.adminKey) {
		throw new Error('ADMIN_API_KEY is required to delist test switches');
	}
	const removed = [];
	for (const item of tests) {
		await requestJson(options.fetchImpl || fetch, options.apiBase, `/admin/switch/${item.uid}/delist`, {
			method: 'POST',
			headers: { 'X-Admin-Key': options.adminKey },
			body: {}
		});
		removed.push(item.uid);
	}
	return removed;
}

async function purgeTestDebris(options) {
	if (!options.adminKey && !options.dryRun) {
		throw new Error('ADMIN_API_KEY is required to purge test switches');
	}
	const switches = await listAllSwitchesAdmin(options);
	const debris = switches.filter((item) => isTestDebris(item, options.keepUids));
	if (options.dryRun) {
		return debris.map((item) => ({ uid: item.uid, name: item.name || '', ownerId: item.ownerId || '' }));
	}
	const removed = [];
	for (const item of debris) {
		await requestJson(options.fetchImpl || fetch, options.apiBase, `/admin/switch/${item.uid}/delete`, {
			method: 'POST',
			headers: { 'X-Admin-Key': options.adminKey },
			body: {}
		});
		removed.push(item.uid);
	}
	return removed;
}

module.exports = {
	ACCESS_KEY_TTL_SECONDS,
	publicMeta,
	metadataDiffers,
	loadJsonFile,
	saveJsonFile,
	applyCatalogue,
	refreshStates,
	listOwned,
	isTestDebris,
	delistTestSwitches,
	purgeTestDebris,
	grantPremium
};

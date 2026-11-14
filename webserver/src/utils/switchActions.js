/**
 * Applying a state change, whoever makes it.
 *
 * Owner (signed), access-key holder, public visitor, paying visitor and the
 * auto-revert loop all go through applySwitchChange so the note/params,
 * event log, WebSocket payload and owner webhook stay the same everywhere.
 * See docs/SWITCH_EXTRAS.md.
 */
const crypto = require('crypto');
const redisClient = require('./redis');
const logger = require('./logger');
const media = require('./media');
const { targetStateFor } = require('./switchExtras');

const REVERTS_ZSET = 'switch_reverts';
const WEBHOOK_TIMEOUT_MS = 5000;
const SOURCES = new Set(['owner', 'key', 'public', 'paid', 'auto']);

const revertKey = (uid) => `switch_revert:${uid}`;
const cooldownKey = (uid) => `switch_cooldown:${uid}`;

function newWebhookSecret() {
	// Prefixed so the hash deserialiser never mistakes it for a number.
	return `whsec_${crypto.randomBytes(24).toString('hex')}`;
}

function signWebhook(secret, timestamp, rawBody) {
	return crypto.createHmac('sha256', secret).update(`${timestamp}.${rawBody}`).digest('hex');
}

/**
 * POST a signed event to the owner's webhook. Never throws and never makes
 * the caller wait: the owner's server being slow is not our visitor's problem.
 */
function dispatchOwnerWebhook(switchData, event, body = {}) {
	const url = switchData && switchData.commerce && switchData.commerce.webhookUrl;
	const secret = switchData && switchData.commerceWebhookSecret;
	if (!url || !secret) {
		return Promise.resolve(false);
	}
	const run = async () => {
		const ts = Date.now();
		const rawBody = JSON.stringify({ uid: switchData.uid, event, ...body, ts });
		await media.assertSafeRemoteUrl(url);
		const ac = new AbortController();
		const timer = setTimeout(() => ac.abort(), WEBHOOK_TIMEOUT_MS);
		try {
			const res = await fetch(url, {
				method: 'POST',
				redirect: 'manual',
				signal: ac.signal,
				headers: {
					'Content-Type': 'application/json',
					'User-Agent': 'VomeSync-Webhook/1',
					'X-VomeSync-Event': event,
					'X-VomeSync-Signature': `t=${ts},v1=${signWebhook(secret, ts, rawBody)}`
				},
				body: rawBody
			});
			return res.ok;
		} finally {
			clearTimeout(timer);
		}
	};
	return run().catch((error) => {
		logger.debug(`Owner webhook for ${switchData.uid} failed: ${error && error.message}`);
		return false;
	});
}

async function cancelRevert(uid) {
	await redisClient.client.zRem(REVERTS_ZSET, uid);
	await redisClient.client.del(revertKey(uid));
}

async function scheduleRevert(uid, targetState, holdSeconds) {
	if (!holdSeconds || holdSeconds <= 0) {
		return null;
	}
	const dueAt = Date.now() + (holdSeconds * 1000);
	await redisClient.client.hSet(revertKey(uid), { state: targetState ? 'on' : 'off', dueAt: `${dueAt}` });
	await redisClient.client.expire(revertKey(uid), holdSeconds + 3600);
	await redisClient.client.zAdd(REVERTS_ZSET, { score: dueAt, value: uid });
	return dueAt;
}

/**
 * Claim the per-switch cooldown. Returns { ok: true } or
 * { ok: false, retryAfterMs }.
 */
async function claimCooldown(uid, seconds) {
	const ms = Math.max(1, Math.floor(seconds * 1000));
	const set = await redisClient.client.set(cooldownKey(uid), '1', { NX: true, PX: ms });
	if (set === 'OK') {
		return { ok: true };
	}
	const left = await redisClient.client.pTTL(cooldownKey(uid));
	return { ok: false, retryAfterMs: left > 0 ? left : ms };
}

/**
 * Set a switch's state with a note and params.
 *
 * Every change replaces the previous note and params, so a change without
 * them clears them. Owner and key changes cancel a pending auto-revert.
 */
async function applySwitchChange(uid, {
	state,
	note = '',
	params = {},
	source = 'owner',
	actor = '',
	paid = null,
	existing = null
} = {}) {
	const switchData = existing || await redisClient.getSwitchState(uid);
	if (!switchData) {
		return null;
	}
	const origin = SOURCES.has(source) ? source : 'owner';
	const newState = Boolean(state);
	const oldState = Boolean(switchData.state);
	const timestamp = Date.now();
	const cleanParams = params && typeof params === 'object' ? params : {};

	await redisClient.setSwitchState(uid, newState, {
		params: cleanParams,
		lastNote: note || '',
		lastSource: origin,
		lastToggled: timestamp,
		lastChangeAt: timestamp
	});

	let toggleCount = switchData.toggleCount || 0;
	if (newState !== oldState) {
		toggleCount = await redisClient.incrementToggleCount(uid);
	}

	if (origin === 'owner' || origin === 'key') {
		await cancelRevert(uid);
	}

	await redisClient.appendEvent(uid, {
		type: 'state',
		state: newState,
		actor: actor || origin,
		viaApiKey: origin === 'key',
		source: origin,
		...(note ? { note } : {}),
		...(Object.keys(cleanParams).length > 0 ? { params: cleanParams } : {}),
		...(paid ? { amount: paid.amount, currency: paid.currency } : {}),
		timestamp
	});

	await redisClient.publishSwitchUpdate(uid, newState, cleanParams, {
		note,
		source: origin,
		paid,
		timestamp
	});

	if (origin !== 'owner') {
		dispatchOwnerWebhook(switchData, paid ? 'paid' : 'state', {
			state: newState,
			note: note || '',
			source: origin,
			...(paid ? { amount: paid.amount, currency: paid.currency } : {})
		});
	}

	return { uid, state: newState, timestamp, toggleCount, changed: newState !== oldState };
}

/**
 * Apply the owner's configured action for a public or paid visitor, and
 * schedule the hold-and-revert if the owner set one.
 */
async function applyVisitorAction(uid, switchData, { source, note = '', paid = null }) {
	const commerce = switchData.commerce || {};
	const target = targetStateFor(commerce.action || 'toggle', Boolean(switchData.state));
	const result = await applySwitchChange(uid, {
		state: target,
		note,
		params: {},
		source,
		actor: source === 'paid' ? 'paying visitor' : 'visitor',
		paid,
		existing: switchData
	});
	if (!result) {
		return null;
	}
	const hold = Number(commerce.holdSeconds) || 0;
	if (hold > 0 && result.changed) {
		result.revertsAt = await scheduleRevert(uid, !target, hold);
	}
	return result;
}

/** Apply every revert that is due. Only one process wins each ZREM. */
async function runDueReverts(now = Date.now()) {
	const due = await redisClient.client.zRangeByScore(REVERTS_ZSET, 0, now);
	let applied = 0;
	for (const uid of due) {
		const score = await redisClient.client.zScore(REVERTS_ZSET, uid);
		if (score === null || score > now) {
			continue;
		}
		const removed = await redisClient.client.zRem(REVERTS_ZSET, uid);
		if (!removed) {
			continue;
		}
		const data = await redisClient.client.hGetAll(revertKey(uid));
		await redisClient.client.del(revertKey(uid));
		if (!data || !data.state) {
			continue;
		}
		try {
			const result = await applySwitchChange(uid, { state: data.state === 'on', source: 'auto', actor: 'auto' });
			if (result) {
				applied += 1;
			}
		} catch (error) {
			logger.warn(`Auto-revert for ${uid} failed: ${error && error.message}`);
		}
	}
	return applied;
}

let revertTimer = null;

function startRevertLoop(intervalMs = 1000) {
	if (revertTimer) {
		return;
	}
	let running = false;
	revertTimer = setInterval(() => {
		if (running || !redisClient.client) {
			return;
		}
		running = true;
		runDueReverts()
			.catch((error) => logger.warn(`Revert loop: ${error && error.message}`))
			.finally(() => { running = false; });
	}, intervalMs);
	if (typeof revertTimer.unref === 'function') {
		revertTimer.unref();
	}
}

function stopRevertLoop() {
	if (revertTimer) {
		clearInterval(revertTimer);
		revertTimer = null;
	}
}

module.exports = {
	REVERTS_ZSET,
	newWebhookSecret,
	signWebhook,
	dispatchOwnerWebhook,
	scheduleRevert,
	cancelRevert,
	claimCooldown,
	applySwitchChange,
	applyVisitorAction,
	runDueReverts,
	startRevertLoop,
	stopRevertLoop
};

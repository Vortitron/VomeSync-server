/**
 * Money around switches: visitors paying to switch or tipping, owners taking
 * payments through Stripe Connect, and reward claims for acting on a switch.
 * Contract: docs/SWITCH_EXTRAS.md sections 4, 5 and 6.
 *
 * Owner-signed routes follow the v2 pattern: fresh timestamp, Ed25519
 * signature over a canonical JSON, then a one-time nonce.
 */
const crypto = require('crypto');
const express = require('express');
const Joi = require('joi');
const redisClient = require('../utils/redis');
const authManager = require('../utils/auth');
const logger = require('../utils/logger');
const config = require('../config/config');
const stripeUtil = require('../utils/stripe');
const connect = require('../utils/connect');
const switchActions = require('../utils/switchActions');
const { getSwitchEarnings } = require('./stripe-routes');
const {
	CURRENCIES,
	cleanAmount,
	cleanVisitorMessage,
	rewardQualifies
} = require('../utils/switchExtras');
const { validateRequest, validateUID } = require('../utils/validation');
const {
	stableJsonStringify,
	deriveOwnerIdFromOwnerPubKeyB64Url,
	verifyEd25519SignatureB64Url
} = require('../utils/crypto_v2');
const {
	assertFreshTimestamp,
	clockSkewError,
	isCatalogueOwner
} = require('./route-helpers');

const router = express.Router();

const NONCE_TTL_MS = 10 * 60 * 1000;
const MAX_CLAIMS = 1000;
const CLAIMS_TTL_SECONDS = 400 * 24 * 60 * 60;
const CHANGE_LOOKBACK_EVENTS = 50;
const CHANGE_LOOKBACK_STATES = 20;
const MAX_MY_REWARD_SWITCHES = 200;
const MAX_MY_REWARD_CLAIMS = 500;
const FUTURE_SKEW_MS = 60 * 1000;

const claimsKey = (uid) => `switch:${uid}:reward_claims`;
const claimSeenKey = (uid, claimant, changeAt) => `reward_claim_seen:${uid}:${claimant}:${changeAt}`;
const claimDayKey = (uid, claimant, day) => `reward_claims_day:${uid}:${claimant}:${day}`;
const ownerRewardsKey = (ownerId) => `owner_rewards:${ownerId}`;

// ── Schemas ────────────────────────────────────────────────────────────────────

const ownerSigned = {
	ownerPubKey: Joi.string().max(200).required(),
	ts: Joi.number().integer().min(0).required(),
	nonce: Joi.string().min(8).max(128).required(),
	sigOwner: Joi.string().max(200).required()
};

const schemas = {
	pay: Joi.object({
		kind: Joi.string().valid('switch', 'tip').required(),
		amount: Joi.number().integer().min(1).max(10000000).optional(),
		message: Joi.string().allow('').max(1000).optional()
	}),
	ownerConnect: Joi.object({ ...ownerSigned }),
	rewardClaim: Joi.object({
		...ownerSigned,
		changeAt: Joi.number().integer().min(1).required(),
		entities: Joi.number().integer().min(1).max(50).required()
	}),
	ownerRewardClaims: Joi.object({
		...ownerSigned,
		uid: Joi.string().max(128).required()
	}),
	myRewards: Joi.object({ ...ownerSigned }),
	markPaid: Joi.object({
		ids: Joi.array().items(Joi.string().max(64)).min(1).max(200).required()
	})
};

// ── Canonical JSON (what the owner's key signs) ────────────────────────────────

const canonicalConnect = (action, data) => stableJsonStringify({
	v: 2,
	action,
	ownerPubKey: data.ownerPubKey,
	ts: data.ts,
	nonce: data.nonce
});

const canonicalConnectOnboard = (data) => canonicalConnect('connect_onboard', data);
const canonicalConnectStatus = (data) => canonicalConnect('connect_status', data);
const canonicalMyRewards = (data) => canonicalConnect('my_rewards', data);

const canonicalRewardClaim = (uid, data) => stableJsonStringify({
	v: 2,
	action: 'reward_claim',
	uid,
	ownerPubKey: data.ownerPubKey,
	ts: data.ts,
	nonce: data.nonce,
	changeAt: data.changeAt,
	entities: data.entities
});

const canonicalRewardClaimsList = (data) => stableJsonStringify({
	v: 2,
	action: 'reward_claims_list',
	uid: data.uid,
	ownerPubKey: data.ownerPubKey,
	ts: data.ts,
	nonce: data.nonce
});

// ── Helpers ────────────────────────────────────────────────────────────────────

/**
 * Check timestamp, signature and nonce. Returns the owner id, or sends the
 * error response and returns null.
 */
async function verifyOwnerSigned(req, res, canonical) {
	const data = req.validatedData;
	if (!assertFreshTimestamp(data.ts)) {
		res.status(400).json(clockSkewError());
		return null;
	}
	let ownerId;
	try {
		ownerId = deriveOwnerIdFromOwnerPubKeyB64Url(data.ownerPubKey);
	} catch {
		res.status(400).json({ success: false, error: 'Invalid owner public key' });
		return null;
	}
	if (!verifyEd25519SignatureB64Url(data.ownerPubKey, canonical, data.sigOwner)) {
		res.status(401).json({ success: false, error: 'Invalid owner signature' });
		return null;
	}
	if (await redisClient.isOwnerBlocked(ownerId)) {
		res.status(403).json({ success: false, error: 'Owner blocked' });
		return null;
	}
	const claimed = await redisClient.claimV2Nonce(ownerId, data.nonce, NONCE_TTL_MS);
	if (!claimed) {
		res.status(409).json({ success: false, error: 'Nonce already used' });
		return null;
	}
	return ownerId;
}

function sendError(res, error, fallback, context) {
	if (error && error.expose) {
		return res.status(error.status || 400).json({ success: false, error: error.message });
	}
	if (error && error.type && String(error.type).startsWith('Stripe')) {
		logger.warn(`${context}: Stripe ${error.type} ${error.code || ''} ${error.message}`);
		return res.status(502).json({ success: false, error: fallback, stripeCode: error.code || undefined });
	}
	logger.error(`${context}:`, error);
	return res.status(500).json({ success: false, error: fallback });
}

function parseClaim(row) {
	try {
		const claim = JSON.parse(row);
		return claim && typeof claim === 'object' ? claim : null;
	} catch {
		return null;
	}
}

async function readClaims(uid) {
	const rows = await redisClient.client.lRange(claimsKey(uid), 0, MAX_CLAIMS - 1);
	return rows.map(parseClaim).filter(Boolean);
}

function addTo(bucket, currency, amount) {
	bucket[currency] = (bucket[currency] || 0) + (Number(amount) || 0);
}

/** Totals owed/paid by currency, and owed per claimant. */
function summariseClaims(claims) {
	const totals = { owed: {}, paid: {} };
	const perClaimant = new Map();
	for (const claim of claims) {
		const status = claim.status === 'paid' ? 'paid' : 'owed';
		addTo(totals[status], claim.currency, claim.amount);
		if (status !== 'owed') {
			continue;
		}
		const key = `${claim.claimant}|${claim.currency}`;
		const row = perClaimant.get(key) || { claimant: claim.claimant, currency: claim.currency, amount: 0, count: 0 };
		row.amount += Number(claim.amount) || 0;
		row.count += 1;
		perClaimant.set(key, row);
	}
	return { totals, owedByClaimant: [...perClaimant.values()] };
}

async function claimsListResponse(uid) {
	const claims = await readClaims(uid);
	return { uid, claims, ...summariseClaims(claims) };
}

function utcDay(ms) {
	return new Date(ms).toISOString().slice(0, 10);
}

/**
 * The switch's recent changes as { at, state }: the last change on the hash
 * plus the last 20 state events.
 */
async function recentChanges(uid, switchData) {
	const changes = [];
	if (switchData.lastChangeAt) {
		changes.push({ at: Number(switchData.lastChangeAt), state: Boolean(switchData.state) });
	}
	const events = await redisClient.getEvents(uid, CHANGE_LOOKBACK_EVENTS);
	let seen = 0;
	for (const event of events) {
		if (!event || event.type !== 'state') {
			continue;
		}
		seen += 1;
		if (seen > CHANGE_LOOKBACK_STATES) {
			break;
		}
		const at = Number(event.ts || event.timestamp);
		if (Number.isFinite(at) && at > 0) {
			changes.push({ at, state: Boolean(event.state) });
		}
	}
	return changes;
}

// ── Pay to switch / tip (public, Stripe Checkout) ──────────────────────────────

router.post('/v2/switch/:uid/pay',
	validateUID,
	authManager.rateLimit('v2_switch_pay', 20, 900000),
	validateRequest(schemas.pay),
	async (req, res) => {
		const { uid } = req.params;
		try {
			if (!stripeUtil.isPaymentsConfigured()) {
				return res.status(503).json({ success: false, error: 'Payments are not configured' });
			}
			const data = req.validatedData;
			const switchData = await redisClient.getSwitchState(uid);
			if (!switchData || switchData.authVersion !== 2 || !switchData.publicize) {
				return res.status(404).json({ success: false, error: 'Switch not found' });
			}
			const ownerId = switchData.ownerId || '';
			if (!ownerId || await redisClient.isOwnerBlocked(ownerId)) {
				return res.status(404).json({ success: false, error: 'Switch not found' });
			}
			const commerce = switchData.commerce || {};

			let amount;
			let currency;
			if (data.kind === 'switch') {
				if (commerce.toggleMode !== 'paid' || !commerce.price) {
					return res.status(409).json({ success: false, error: 'This switch does not take payments to switch' });
				}
				amount = Number(commerce.price.amount);
				currency = String(commerce.price.currency).toLowerCase();
				if (!CURRENCIES[currency]) {
					return res.status(409).json({ success: false, error: 'This switch has no valid price' });
				}
			} else {
				if (!commerce.tips) {
					return res.status(409).json({ success: false, error: 'This switch does not take tips' });
				}
				currency = String((commerce.price && commerce.price.currency) || 'eur').toLowerCase();
				if (!CURRENCIES[currency]) {
					currency = 'eur';
				}
				if (data.amount === undefined) {
					return res.status(400).json({ success: false, error: 'amount is required for a tip' });
				}
				amount = cleanAmount(data.amount, currency);
			}

			let message = '';
			if (commerce.allowMessage && data.message) {
				message = cleanVisitorMessage(data.message);
			}

			const platformSale = isCatalogueOwner(ownerId, config.limits && config.limits.catalogueOwnerId);
			let connectedAccountId = '';
			if (!platformSale) {
				const canTake = await redisClient.ownerCanTakePayments(ownerId);
				// The cached record may be up to 10 minutes old; re-read it if stale.
				const status = canTake ? await connect.getConnectStatus(ownerId) : null;
				if (!status || !status.ready || !status.accountId) {
					return res.status(409).json({ success: false, error: 'Owner cannot take payments yet' });
				}
				connectedAccountId = status.accountId;
			}

			let session;
			try {
				session = await stripeUtil.createSwitchPaymentSession({
					uid,
					ownerId,
					kind: data.kind,
					amount,
					currency,
					message,
					connectedAccountId,
					platformSale,
					switchName: switchData.name || ''
				});
			} catch (error) {
				if (!platformSale && error && error.type === 'StripeInvalidRequestError') {
					// Most likely the account lost a capability: re-check before the next visitor.
					await connect.markNotReady(ownerId).catch(() => {});
				}
				throw error;
			}
			return res.json({ success: true, data: { url: session.url, id: session.id } });
		} catch (error) {
			return sendError(res, error, 'Failed to start payment', `Pay for ${uid}`);
		}
	}
);

// ── Connect onboarding and status ──────────────────────────────────────────────

router.post('/v2/owner/connect',
	authManager.rateLimit('v2_owner_connect', 20, 900000),
	validateRequest(schemas.ownerConnect),
	async (req, res) => {
		try {
			const ownerId = await verifyOwnerSigned(req, res, canonicalConnectOnboard(req.validatedData));
			if (!ownerId) {
				return undefined;
			}
			if (!stripeUtil.isPaymentsConfigured()) {
				return res.status(503).json({ success: false, error: 'Payments are not configured' });
			}
			const link = await connect.createOnboardingLink(ownerId);
			return res.json({ success: true, data: { url: link.url } });
		} catch (error) {
			return sendError(res, error, 'Failed to start payment setup', 'Owner connect onboarding');
		}
	}
);

router.post('/v2/owner/connect/status',
	authManager.rateLimit('v2_owner_connect_status', 100, 900000),
	validateRequest(schemas.ownerConnect),
	async (req, res) => {
		try {
			const ownerId = await verifyOwnerSigned(req, res, canonicalConnectStatus(req.validatedData));
			if (!ownerId) {
				return undefined;
			}
			if (!stripeUtil.isPaymentsConfigured()) {
				return res.status(503).json({ success: false, error: 'Payments are not configured' });
			}
			const status = await connect.connectStatusResponse(ownerId);
			return res.json({ success: true, data: status });
		} catch (error) {
			return sendError(res, error, 'Failed to read payment status', 'Owner connect status');
		}
	}
);

router.post('/v2/switch/:uid/connect',
	validateUID,
	authManager.rateLimit('v2_switch_connect', 20, 900000, { perKey: true, keyLimit: 6 }),
	authManager.requireV2AccessKey('metadata'),
	async (req, res) => {
		const { uid } = req.params;
		try {
			if (!stripeUtil.isPaymentsConfigured()) {
				return res.status(503).json({ success: false, error: 'Payments are not configured' });
			}
			const ownerId = req.switchData && req.switchData.ownerId;
			if (!ownerId) {
				return res.status(400).json({ success: false, error: 'Switch has no owner' });
			}
			const link = await connect.createOnboardingLink(ownerId, { uid });
			return res.json({ success: true, data: { url: link.url } });
		} catch (error) {
			return sendError(res, error, 'Failed to start payment setup', `Switch connect onboarding ${uid}`);
		}
	}
);

router.post('/v2/switch/:uid/connect/status',
	validateUID,
	authManager.rateLimit('v2_switch_connect_status', 100, 900000, { perKey: true, keyLimit: 30 }),
	authManager.requireV2AccessKey('metadata'),
	async (req, res) => {
		const { uid } = req.params;
		try {
			const ownerId = req.switchData && req.switchData.ownerId;
			if (!ownerId) {
				return res.status(400).json({ success: false, error: 'Switch has no owner' });
			}
			const earnings = await getSwitchEarnings(uid);
			const platformSale = isCatalogueOwner(ownerId, config.limits && config.limits.catalogueOwnerId);
			if (!stripeUtil.isPaymentsConfigured()) {
				return res.json({
					success: true,
					data: { connected: false, ready: false, requirementsDue: 0, paymentsEnabled: false, earnings }
				});
			}
			const status = platformSale
				? { connected: true, ready: true, requirementsDue: 0 }
				: await connect.connectStatusResponse(ownerId);
			return res.json({
				success: true,
				data: { ...status, paymentsEnabled: true, platformSale, earnings }
			});
		} catch (error) {
			return sendError(res, error, 'Failed to read payment status', `Switch connect status ${uid}`);
		}
	}
);

// ── Reward claims ──────────────────────────────────────────────────────────────

router.post('/v2/switch/:uid/reward-claims',
	validateUID,
	authManager.rateLimit('v2_reward_claim', 300, 900000),
	validateRequest(schemas.rewardClaim),
	async (req, res) => {
		const { uid } = req.params;
		try {
			const data = req.validatedData;
			const claimant = await verifyOwnerSigned(req, res, canonicalRewardClaim(uid, data));
			if (!claimant) {
				return undefined;
			}
			const switchData = await redisClient.getSwitchState(uid);
			if (!switchData || switchData.authVersion !== 2) {
				return res.status(404).json({ success: false, error: 'Switch not found' });
			}
			if (switchData.ownerId && await redisClient.isOwnerBlocked(switchData.ownerId)) {
				return res.status(404).json({ success: false, error: 'Switch not found' });
			}
			const reward = switchData.reward;
			if (!reward) {
				return res.status(409).json({ success: false, error: 'This switch offers no reward' });
			}
			if (switchData.ownerId === claimant) {
				return res.status(403).json({ success: false, error: 'The publisher cannot claim their own reward' });
			}

			const now = Date.now();
			const changeAt = data.changeAt;
			const change = (await recentChanges(uid, switchData)).find((c) => c.at === changeAt);
			if (!change) {
				return res.status(404).json({ success: false, error: 'No such change on this switch' });
			}
			if (!rewardQualifies(reward, change.state)) {
				return res.status(409).json({ success: false, error: 'This change does not earn the reward' });
			}
			const windowMs = (Number(reward.windowSeconds) || 900) * 1000;
			if (changeAt > now + FUTURE_SKEW_MS || now - changeAt > windowMs) {
				return res.status(410).json({ success: false, error: 'The claim window for this change has closed' });
			}

			const seenKey = claimSeenKey(uid, claimant, changeAt);
			const fresh = await redisClient.client.set(seenKey, '1', {
				NX: true,
				EX: Math.ceil(windowMs / 1000) + 86400
			});
			if (fresh !== 'OK') {
				return res.status(409).json({ success: false, error: 'Already claimed for this change' });
			}
			const dayKey = claimDayKey(uid, claimant, utcDay(now));
			const today = await redisClient.client.incr(dayKey);
			if (today === 1) {
				await redisClient.client.expire(dayKey, 2 * 86400);
			}
			const maxPerDay = Number(reward.maxPerDay) || 5;
			if (today > maxPerDay) {
				await redisClient.client.decr(dayKey);
				await redisClient.client.del(seenKey);
				return res.status(429).json({ success: false, error: `At most ${maxPerDay} claims a day on this switch` });
			}

			const claim = {
				id: `rc_${crypto.randomBytes(9).toString('hex')}`,
				claimant,
				changeAt,
				claimedAt: now,
				entities: data.entities,
				amount: Number(reward.amount),
				currency: String(reward.currency),
				status: 'owed'
			};
			await redisClient.client.lPush(claimsKey(uid), JSON.stringify(claim));
			await redisClient.client.lTrim(claimsKey(uid), 0, MAX_CLAIMS - 1);
			await redisClient.client.expire(claimsKey(uid), CLAIMS_TTL_SECONDS);
			await redisClient.client.sAdd(ownerRewardsKey(claimant), uid);
			await redisClient.client.expire(ownerRewardsKey(claimant), CLAIMS_TTL_SECONDS);

			switchActions.dispatchOwnerWebhook(switchData, 'reward_claim', {
				state: change.state,
				note: '',
				source: 'reward',
				amount: claim.amount,
				currency: claim.currency,
				claimId: claim.id,
				claimant,
				changeAt,
				entities: claim.entities
			});

			return res.json({ success: true, data: { claim } });
		} catch (error) {
			return sendError(res, error, 'Failed to record the claim', `Reward claim ${uid}`);
		}
	}
);

router.post('/v2/switch/:uid/reward-claims/list',
	validateUID,
	authManager.rateLimit('v2_reward_claims_list', 200, 900000, { perKey: true }),
	authManager.requireV2AccessKey('metadata'),
	async (req, res) => {
		const { uid } = req.params;
		try {
			return res.json({ success: true, data: await claimsListResponse(uid) });
		} catch (error) {
			return sendError(res, error, 'Failed to list claims', `Reward claims list ${uid}`);
		}
	}
);

// Flip matching entries in place, atomically, so a claim pushed meanwhile
// cannot shift the index we write to. ARGV is pairs of old row, new row.
const MARK_PAID_SCRIPT = `
local rows = redis.call('LRANGE', KEYS[1], 0, -1)
local changed = 0
for i, row in ipairs(rows) do
	for j = 1, #ARGV, 2 do
		if row == ARGV[j] then
			redis.call('LSET', KEYS[1], i - 1, ARGV[j + 1])
			changed = changed + 1
			break
		end
	end
end
return changed
`;

router.post('/v2/switch/:uid/reward-claims/mark-paid',
	validateUID,
	authManager.rateLimit('v2_reward_claims_mark_paid', 100, 900000, { perKey: true }),
	authManager.requireV2AccessKey('metadata'),
	validateRequest(schemas.markPaid),
	async (req, res) => {
		const { uid } = req.params;
		try {
			const wanted = new Set(req.validatedData.ids);
			const rows = await redisClient.client.lRange(claimsKey(uid), 0, MAX_CLAIMS - 1);
			const pairs = [];
			const paidAt = Date.now();
			for (const row of rows) {
				const claim = parseClaim(row);
				if (claim && wanted.has(claim.id) && claim.status !== 'paid') {
					pairs.push(row, JSON.stringify({ ...claim, status: 'paid', paidAt }));
				}
			}
			let marked = 0;
			if (pairs.length > 0) {
				marked = Number(await redisClient.client.eval(MARK_PAID_SCRIPT, {
					keys: [claimsKey(uid)],
					arguments: pairs
				})) || 0;
			}
			return res.json({ success: true, data: { marked, ...(await claimsListResponse(uid)) } });
		} catch (error) {
			return sendError(res, error, 'Failed to mark claims paid', `Reward claims mark-paid ${uid}`);
		}
	}
);

router.post('/v2/owner/reward-claims',
	authManager.rateLimit('v2_owner_reward_claims', 100, 900000),
	validateRequest(schemas.ownerRewardClaims),
	async (req, res) => {
		try {
			const data = req.validatedData;
			const ownerId = await verifyOwnerSigned(req, res, canonicalRewardClaimsList(data));
			if (!ownerId) {
				return undefined;
			}
			const switchData = await redisClient.getSwitchState(data.uid);
			if (!switchData || switchData.ownerId !== ownerId) {
				return res.status(404).json({ success: false, error: 'Switch not found' });
			}
			return res.json({ success: true, data: await claimsListResponse(data.uid) });
		} catch (error) {
			return sendError(res, error, 'Failed to list claims', 'Owner reward claims');
		}
	}
);

router.post('/v2/owner/my-rewards',
	authManager.rateLimit('v2_owner_my_rewards', 100, 900000),
	validateRequest(schemas.myRewards),
	async (req, res) => {
		try {
			const claimant = await verifyOwnerSigned(req, res, canonicalMyRewards(req.validatedData));
			if (!claimant) {
				return undefined;
			}
			const uids = (await redisClient.client.sMembers(ownerRewardsKey(claimant))).slice(0, MAX_MY_REWARD_SWITCHES);
			const claims = [];
			for (const uid of uids) {
				const own = (await readClaims(uid)).filter((c) => c.claimant === claimant);
				if (own.length === 0) {
					continue;
				}
				const switchData = await redisClient.getSwitchState(uid);
				const switchName = (switchData && switchData.name) ? String(switchData.name) : '';
				for (const claim of own) {
					claims.push({ uid, switchName, ...claim });
				}
			}
			claims.sort((a, b) => (b.claimedAt || 0) - (a.claimedAt || 0));
			const { totals } = summariseClaims(claims);
			return res.json({
				success: true,
				data: { claims: claims.slice(0, MAX_MY_REWARD_CLAIMS), totals }
			});
		} catch (error) {
			return sendError(res, error, 'Failed to list rewards', 'My rewards');
		}
	}
);

module.exports = router;
module.exports.schemas = schemas;
module.exports.canonical = {
	connectOnboard: canonicalConnectOnboard,
	connectStatus: canonicalConnectStatus,
	myRewards: canonicalMyRewards,
	rewardClaim: canonicalRewardClaim,
	rewardClaimsList: canonicalRewardClaimsList
};

/**
 * Stripe Connect for switch owners (Accounts v2).
 *
 * One connected account per owner (Ed25519 owner id). The owner is the
 * settlement merchant for paid switches and tips; Vome takes an application
 * fee. See docs/SWITCH_EXTRAS.md section 5.
 *
 * Redis hash `owner_connect:<ownerId>`:
 *   accountId        acct_… (Accounts v2 ids work with v1 payment APIs)
 *   createdAt        ms
 *   ready            'true' | 'false'  (redis.ownerCanTakePayments reads this)
 *   checkedAt        ms of the last status read from Stripe
 *   requirementsDue  how many requirements wait on the owner
 *
 * Fields are read with hGetAll and parsed here, never through the switch
 * hash deserialiser.
 */
const redisClient = require('./redis');
const logger = require('./logger');
const config = require('../config/config');
const { getStripe } = require('./stripe');

// A ready account rarely changes; one that is still onboarding changes as
// soon as the owner finishes, so it is re-read much sooner.
const READY_CACHE_MS = 10 * 60 * 1000;
const NOT_READY_CACHE_MS = 30 * 1000;
const CREATE_LOCK_SECONDS = 30;

const ACCOUNT_INCLUDE = ['configuration.merchant', 'configuration.recipient', 'requirements'];
const ONBOARDING_CONFIGURATIONS = ['merchant', 'recipient'];

const connectKey = (ownerId) => `owner_connect:${ownerId}`;
const createLockKey = (ownerId) => `owner_connect_lock:${ownerId}`;

class ConnectError extends Error {
	constructor(message, status = 400) {
		super(message);
		this.name = 'ConnectError';
		this.status = status;
		this.expose = true;
	}
}

function requireStripe() {
	const stripe = getStripe();
	if (!stripe) {
		throw new ConnectError('Payments are not configured', 503);
	}
	return stripe;
}

function publicBaseUrl() {
	return String((config.stripe && config.stripe.publicBaseUrl) || 'https://sync.vome.io').replace(/\/+$/, '');
}

function connectReturnUrls(uid) {
	const base = publicBaseUrl();
	const path = uid ? `/switch/${encodeURIComponent(uid)}` : '/';
	return {
		return_url: `${base}${path}?connect=return`,
		refresh_url: `${base}${path}?connect=refresh`
	};
}

async function getConnectRecord(ownerId) {
	if (!ownerId) {
		return null;
	}
	const raw = await redisClient.client.hGetAll(connectKey(ownerId));
	if (!raw || !raw.accountId) {
		return null;
	}
	return {
		accountId: String(raw.accountId),
		createdAt: Number(raw.createdAt) || 0,
		ready: raw.ready === 'true',
		checkedAt: Number(raw.checkedAt) || 0,
		requirementsDue: Number(raw.requirementsDue) || 0
	};
}

/**
 * Ready = card_payments (merchant) and stripe_transfers (recipient) both
 * active. Destination charges with on_behalf_of need both.
 */
function readinessFromAccount(account) {
	const configuration = (account && account.configuration) || {};
	const merchantCaps = (configuration.merchant && configuration.merchant.capabilities) || {};
	const recipientCaps = (configuration.recipient && configuration.recipient.capabilities) || {};
	const cardPayments = (merchantCaps.card_payments && merchantCaps.card_payments.status) || 'missing';
	const stripeTransfers = (recipientCaps.stripe_balance
		&& recipientCaps.stripe_balance.stripe_transfers
		&& recipientCaps.stripe_balance.stripe_transfers.status) || 'missing';
	const entries = (account && account.requirements && Array.isArray(account.requirements.entries))
		? account.requirements.entries
		: [];
	const requirementsDue = entries.filter((entry) => {
		const status = entry && entry.minimum_deadline && entry.minimum_deadline.status;
		const fromUser = !entry || !entry.awaiting_action_from || entry.awaiting_action_from === 'user';
		return fromUser && (status === 'currently_due' || status === 'past_due');
	}).length;
	return {
		ready: cardPayments === 'active' && stripeTransfers === 'active',
		cardPayments,
		stripeTransfers,
		requirementsDue
	};
}

async function writeStatus(ownerId, readiness, now = Date.now()) {
	await redisClient.client.hSet(connectKey(ownerId), {
		ready: readiness.ready ? 'true' : 'false',
		checkedAt: `${now}`,
		requirementsDue: `${readiness.requirementsDue || 0}`
	});
}

/**
 * Create the owner's connected account if they have none. A short lock
 * keeps two quick clicks from creating two accounts.
 */
async function ensureConnectAccount(ownerId, { displayName = '' } = {}) {
	if (!ownerId) {
		throw new ConnectError('Owner id required');
	}
	const existing = await getConnectRecord(ownerId);
	if (existing) {
		return existing;
	}
	const stripe = requireStripe();
	const locked = await redisClient.client.set(createLockKey(ownerId), '1', { NX: true, EX: CREATE_LOCK_SECONDS });
	if (locked !== 'OK') {
		const raced = await getConnectRecord(ownerId);
		if (raced) {
			return raced;
		}
		throw new ConnectError('Payment account setup is already in progress, try again in a moment', 409);
	}
	try {
		const params = {
			dashboard: 'express',
			defaults: {
				responsibilities: {
					fees_collector: 'application',
					losses_collector: 'application'
				}
			},
			configuration: {
				merchant: {
					capabilities: { card_payments: { requested: true } }
				},
				recipient: {
					capabilities: { stripe_balance: { stripe_transfers: { requested: true } } }
				}
			},
			metadata: { vomesyncOwnerId: String(ownerId) }
		};
		const name = String(displayName || '').trim().slice(0, 100);
		if (name) {
			params.display_name = name;
		}
		const account = await stripe.v2.core.accounts.create(params);
		if (!account || !account.id) {
			throw new Error('Stripe did not return an account id');
		}
		const now = Date.now();
		await redisClient.client.hSet(connectKey(ownerId), {
			accountId: account.id,
			createdAt: `${now}`,
			ready: 'false',
			checkedAt: '0',
			requirementsDue: '0'
		});
		logger.info(`Connect account ${account.id} created for owner ${String(ownerId).slice(0, 8)}…`);
		return { accountId: account.id, createdAt: now, ready: false, checkedAt: 0, requirementsDue: 0 };
	} finally {
		await redisClient.client.del(createLockKey(ownerId));
	}
}

/** Start or resume onboarding. Returns { url, accountId }. */
async function createOnboardingLink(ownerId, { uid = '', displayName = '' } = {}) {
	const record = await ensureConnectAccount(ownerId, { displayName });
	const stripe = requireStripe();
	const link = await stripe.v2.core.accountLinks.create({
		account: record.accountId,
		use_case: {
			type: 'account_onboarding',
			account_onboarding: {
				configurations: ONBOARDING_CONFIGURATIONS,
				...connectReturnUrls(uid)
			}
		}
	});
	if (!link || !link.url) {
		throw new Error('Stripe did not return an onboarding link');
	}
	return { url: link.url, accountId: record.accountId, expiresAt: link.expires_at || null };
}

/**
 * The owner's status, read from Stripe when the cached copy is stale.
 * Returns { connected, ready, requirementsDue, accountId, checkedAt }.
 */
async function getConnectStatus(ownerId, { force = false, now = Date.now() } = {}) {
	const record = await getConnectRecord(ownerId);
	if (!record) {
		return { connected: false, ready: false, requirementsDue: 0, accountId: '', checkedAt: 0 };
	}
	const maxAge = record.ready ? READY_CACHE_MS : NOT_READY_CACHE_MS;
	if (!force && record.checkedAt > 0 && now - record.checkedAt < maxAge) {
		return { connected: true, ...record };
	}
	const stripe = requireStripe();
	const account = await stripe.v2.core.accounts.retrieve(record.accountId, { include: ACCOUNT_INCLUDE });
	const readiness = readinessFromAccount(account);
	await writeStatus(ownerId, readiness, now);
	return {
		connected: true,
		accountId: record.accountId,
		createdAt: record.createdAt,
		ready: readiness.ready,
		requirementsDue: readiness.requirementsDue,
		checkedAt: now
	};
}

/**
 * Express Dashboard login link (v1 Login Link API; it accepts Accounts v2
 * ids with dashboard 'express'). Only for ready accounts; null on failure.
 */
async function createDashboardLink(accountId) {
	if (!accountId) {
		return null;
	}
	try {
		const stripe = requireStripe();
		const link = await stripe.accounts.createLoginLink(accountId);
		return (link && link.url) || null;
	} catch (error) {
		logger.debug(`Express login link for ${accountId} failed: ${error && error.message}`);
		return null;
	}
}

/** Status for an API response: { connected, ready, requirementsDue, dashboardUrl? }. */
async function connectStatusResponse(ownerId, options = {}) {
	const status = await getConnectStatus(ownerId, options);
	const out = {
		connected: Boolean(status.connected),
		ready: Boolean(status.ready),
		requirementsDue: status.requirementsDue || 0
	};
	if (status.ready) {
		const dashboardUrl = await createDashboardLink(status.accountId);
		if (dashboardUrl) {
			out.dashboardUrl = dashboardUrl;
		}
	}
	return out;
}

/** Mark an owner not ready right away (e.g. Stripe refused a charge). */
async function markNotReady(ownerId) {
	const record = await getConnectRecord(ownerId);
	if (!record) {
		return;
	}
	await redisClient.client.hSet(connectKey(ownerId), { ready: 'false', checkedAt: '0' });
}

module.exports = {
	READY_CACHE_MS,
	NOT_READY_CACHE_MS,
	ACCOUNT_INCLUDE,
	ConnectError,
	connectKey,
	connectReturnUrls,
	getConnectRecord,
	readinessFromAccount,
	ensureConnectAccount,
	createOnboardingLink,
	getConnectStatus,
	createDashboardLink,
	connectStatusResponse,
	markNotReady
};

/**
 * Stripe webhook (raw body) and public billing flags.
 *
 * The webhook route is mounted in server.js *before* express.json so the
 * signature still matches. Tests that need it should call mountStripeWebhook.
 */
const express = require('express');
const logger = require('../utils/logger');
const redisClient = require('../utils/redis');
const config = require('../config/config');
const stripeUtil = require('../utils/stripe');
const switchActions = require('../utils/switchActions');
const { cleanVisitorMessage, CURRENCIES } = require('../utils/switchExtras');
const { nextPromotedUntil } = require('../utils/promote');

const PREMIUM_LIVE_STATUSES = new Set(['active', 'trialing', 'past_due']);
// Stripe retries a webhook for three days; keep the "seen" marker far longer.
const PAID_SESSION_TTL_SECONDS = 90 * 24 * 60 * 60;
const EARNINGS_TTL_SECONDS = 400 * 24 * 60 * 60;
const SWITCH_PAYMENT_KINDS = new Set(['vomesync_paid_switch', 'vomesync_tip']);

const paidSessionKey = (sessionId) => `paid_session:${sessionId}`;
const earningsKey = (uid) => `switch:${uid}:earnings`;

function sessionOwnerId(session) {
	return (session && session.metadata && session.metadata.ownerId)
		|| session.client_reference_id
		|| '';
}

async function applyPromoteSession(session) {
	if (!session || !session.metadata || session.metadata.kind !== 'vomesync_promote') {
		return { applied: false, reason: 'ignored' };
	}
	if (session.payment_status && session.payment_status !== 'paid') {
		return { applied: false, reason: 'unpaid' };
	}
	const uid = (session.metadata && session.metadata.uid) || session.client_reference_id;
	if (!uid) {
		return { applied: false, reason: 'missing-uid' };
	}
	const switchData = await redisClient.getSwitchState(uid);
	if (!switchData) {
		logger.warn(`Promote webhook: switch ${uid} not found`);
		return { applied: false, reason: 'missing-switch' };
	}
	if (switchData.promotedSessionId && switchData.promotedSessionId === session.id) {
		return { applied: false, reason: 'duplicate' };
	}
	const parsed = Number((session.metadata && session.metadata.durationDays)
		|| config.stripe.promoteDurationDays);
	const durationDays = Number.isFinite(parsed) && parsed > 0
		? parsed
		: config.stripe.promoteDurationDays;
	const promotedUntil = nextPromotedUntil(switchData.promotedUntil, durationDays);
	await redisClient.updateSwitch(uid, {
		promotedUntil,
		promotedSessionId: session.id
	});
	logger.info(`Promoted ${uid} until ${new Date(promotedUntil).toISOString()}`);
	return { applied: true, uid, promotedUntil };
}

async function applyPremiumSession(session) {
	if (!session || !session.metadata || session.metadata.kind !== 'vomesync_premium') {
		return { applied: false, reason: 'ignored' };
	}
	if (session.payment_status && session.payment_status !== 'paid') {
		return { applied: false, reason: 'unpaid' };
	}
	const ownerId = sessionOwnerId(session);
	if (!ownerId) {
		return { applied: false, reason: 'missing-owner' };
	}
	const existing = await redisClient.getOwnerTier(ownerId);
	if (existing.stripeSessionId && existing.stripeSessionId === session.id) {
		return { applied: false, reason: 'duplicate' };
	}
	const subscriptionId = typeof session.subscription === 'string'
		? session.subscription
		: (session.subscription && session.subscription.id) || '';
	const customerId = typeof session.customer === 'string'
		? session.customer
		: (session.customer && session.customer.id) || '';
	await redisClient.setOwnerTier(ownerId, 'premium', 0, existing.promoCode || '', {
		stripeSessionId: session.id || '',
		stripeSubscriptionId: subscriptionId,
		stripeCustomerId: customerId
	});
	logger.info(`Premium granted to owner ${String(ownerId).slice(0, 8)}…`);
	return { applied: true, ownerId };
}

async function applySubscriptionChange(subscription) {
	if (!subscription) {
		return { applied: false, reason: 'ignored' };
	}
	const ownerId = (subscription.metadata && subscription.metadata.ownerId) || '';
	if (!ownerId) {
		return { applied: false, reason: 'missing-owner' };
	}
	const status = String(subscription.status || '');
	if (PREMIUM_LIVE_STATUSES.has(status)) {
		const existing = await redisClient.getOwnerTier(ownerId);
		await redisClient.setOwnerTier(ownerId, 'premium', 0, existing.promoCode || '', {
			stripeSubscriptionId: subscription.id || '',
			stripeCustomerId: typeof subscription.customer === 'string'
				? subscription.customer
				: ''
		});
		return { applied: true, ownerId, status };
	}
	const existing = await redisClient.getOwnerTier(ownerId);
	if (existing.promoCode && existing.expiresAt && existing.expiresAt > Date.now()) {
		await redisClient.setOwnerTier(ownerId, existing.tier || 'premium', existing.expiresAt, existing.promoCode, {
			stripeSubscriptionId: '',
			stripeCustomerId: existing.stripeCustomerId || ''
		});
		return { applied: false, reason: 'promo-kept' };
	}
	await redisClient.clearOwnerTier(ownerId);
	logger.info(`Premium cleared for owner ${String(ownerId).slice(0, 8)}… (${status || 'deleted'})`);
	return { applied: true, ownerId, status: status || 'deleted' };
}

function sessionMoney(session) {
	const meta = session.metadata || {};
	const metaCurrency = String(meta.currency || '').toLowerCase();
	const metaAmount = Number(meta.amount);
	if (CURRENCIES[metaCurrency] && Number.isInteger(metaAmount) && metaAmount > 0) {
		return { amount: metaAmount, currency: metaCurrency };
	}
	return {
		amount: Number(session.amount_total) || 0,
		currency: String(session.currency || '').toLowerCase()
	};
}

function sessionMessage(session) {
	const raw = (session.metadata && session.metadata.message) || '';
	if (!raw) {
		return '';
	}
	try {
		return cleanVisitorMessage(raw);
	} catch {
		return '';
	}
}

/** Paid-change and tip totals for a switch, e.g. { paidCount, tipCount, paid: { eur: 300 }, tip: {} }. */
async function getSwitchEarnings(uid) {
	const raw = await redisClient.client.hGetAll(earningsKey(uid));
	const out = { paidCount: 0, tipCount: 0, paid: {}, tip: {} };
	for (const [field, value] of Object.entries(raw || {})) {
		const n = Number(value) || 0;
		if (field === 'paidCount' || field === 'tipCount') {
			out[field] = n;
			continue;
		}
		const [bucket, currency] = field.split(':');
		if ((bucket === 'paid' || bucket === 'tip') && currency) {
			out[bucket][currency] = n;
		}
	}
	return out;
}

async function bumpEarnings(uid, bucket, money) {
	const key = earningsKey(uid);
	await redisClient.client.hIncrBy(key, `${bucket}Count`, 1);
	if (money.currency && money.amount > 0) {
		await redisClient.client.hIncrBy(key, `${bucket}:${money.currency}`, money.amount);
	}
	await redisClient.client.expire(key, EARNINGS_TTL_SECONDS);
}

/**
 * A visitor paid to switch, or tipped. Idempotent on the Checkout Session id:
 * the first delivery claims `paid_session:<id>`; if applying then fails the
 * claim is released so Stripe's retry can try again.
 */
async function applySwitchPaymentSession(session) {
	const kind = session && session.metadata && session.metadata.kind;
	if (!SWITCH_PAYMENT_KINDS.has(kind)) {
		return { applied: false, reason: 'ignored' };
	}
	if (session.payment_status && session.payment_status !== 'paid') {
		return { applied: false, reason: 'unpaid' };
	}
	const uid = session.metadata.uid || session.client_reference_id;
	if (!uid || !session.id) {
		return { applied: false, reason: 'missing-uid' };
	}
	const claimed = await redisClient.client.set(paidSessionKey(session.id), `${Date.now()}`, {
		NX: true,
		EX: PAID_SESSION_TTL_SECONDS
	});
	if (claimed !== 'OK') {
		return { applied: false, reason: 'duplicate' };
	}
	try {
		const switchData = await redisClient.getSwitchState(uid);
		if (!switchData) {
			logger.warn(`Switch payment ${session.id}: switch ${uid} not found (money taken, nothing to switch)`);
			return { applied: false, reason: 'missing-switch' };
		}
		const money = sessionMoney(session);
		const message = sessionMessage(session);

		if (kind === 'vomesync_paid_switch') {
			// The visitor has paid, so the change happens even if the owner
			// turned paid mode off while they were in Checkout.
			const result = await switchActions.applyVisitorAction(uid, switchData, {
				source: 'paid',
				note: message || 'Paid by a visitor',
				paid: { amount: money.amount, currency: money.currency }
			});
			await bumpEarnings(uid, 'paid', money);
			logger.info(`Paid switch ${uid}: ${money.amount} ${money.currency}`);
			return { applied: true, uid, kind, state: result ? result.state : switchData.state };
		}

		const timestamp = Date.now();
		await redisClient.appendEvent(uid, {
			type: 'tip',
			amount: money.amount,
			currency: money.currency,
			note: message,
			timestamp
		});
		await bumpEarnings(uid, 'tip', money);
		switchActions.dispatchOwnerWebhook(switchData, 'tip', {
			state: Boolean(switchData.state),
			note: message,
			source: 'tip',
			amount: money.amount,
			currency: money.currency
		});
		logger.info(`Tip for ${uid}: ${money.amount} ${money.currency}`);
		return { applied: true, uid, kind };
	} catch (error) {
		await redisClient.client.del(paidSessionKey(session.id)).catch(() => {});
		throw error;
	}
}

async function handleStripeWebhook(req, res) {
	if (!stripeUtil.isStripeConfigured() && !stripeUtil.isPaymentsConfigured()) {
		return res.status(503).json({ success: false, error: 'Stripe is not configured' });
	}
	const signature = req.headers['stripe-signature'];
	if (!signature) {
		return res.status(400).json({ success: false, error: 'Missing Stripe-Signature' });
	}
	if (!Buffer.isBuffer(req.body)) {
		return res.status(400).json({ success: false, error: 'Webhook body must be raw' });
	}
	let event;
	try {
		event = stripeUtil.constructWebhookEvent(req.body, signature);
	} catch (error) {
		logger.warn(`Stripe webhook signature failed: ${error.message}`);
		return res.status(400).json({ success: false, error: 'Invalid signature' });
	}
	try {
		if (event.type === 'checkout.session.completed'
			|| event.type === 'checkout.session.async_payment_succeeded') {
			const session = event.data && event.data.object;
			const kind = session && session.metadata && session.metadata.kind;
			if (kind === 'vomesync_premium') {
				await applyPremiumSession(session);
			} else if (kind === 'vomesync_promote') {
				await applyPromoteSession(session);
			} else if (SWITCH_PAYMENT_KINDS.has(kind)) {
				await applySwitchPaymentSession(session);
			} else {
				logger.debug(`Stripe webhook: ignoring Checkout kind ${kind || '(none)'}`);
			}
		}
		if (event.type === 'customer.subscription.deleted'
			|| event.type === 'customer.subscription.updated') {
			await applySubscriptionChange(event.data && event.data.object);
		}
		return res.json({ received: true });
	} catch (error) {
		logger.error('Stripe webhook handler failed:', error);
		return res.status(500).json({ success: false, error: 'Webhook handler failed' });
	}
}

function mountStripeWebhook(app) {
	app.post('/api/stripe/webhook', express.raw({ type: 'application/json' }), handleStripeWebhook);
}

module.exports = {
	applyPromoteSession,
	applySwitchPaymentSession,
	getSwitchEarnings,
	applyPremiumSession,
	applySubscriptionChange,
	handleStripeWebhook,
	mountStripeWebhook
};

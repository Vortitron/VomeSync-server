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
const { nextPromotedUntil } = require('../utils/promote');

const PREMIUM_LIVE_STATUSES = new Set(['active', 'trialing', 'past_due']);

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

async function handleStripeWebhook(req, res) {
	if (!stripeUtil.isStripeConfigured()) {
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
			} else {
				await applyPromoteSession(session);
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
	applyPremiumSession,
	applySubscriptionChange,
	handleStripeWebhook,
	mountStripeWebhook
};

/**
 * Stripe helpers for directory promotion and owner premium.
 *
 * Hosted Checkout Sessions (no payment_method_types — Dashboard decides
 * methods). Restricted keys (rk_) preferred over sk_ in production.
 */
const crypto = require('crypto');
const Stripe = require('stripe');
const config = require('../config/config');

const STRIPE_API_VERSION = '2026-05-27.dahlia';
const LETTERS = 'abcdefghijklmnopqrstuvwxyz';

let stripeClient = null;

function hasStripeKeys() {
	const stripe = config.stripe || {};
	return Boolean(stripe.secretKey && stripe.webhookSecret);
}

function isPromoteConfigured() {
	const stripe = config.stripe || {};
	return hasStripeKeys() && Boolean(stripe.pricePromote || stripe.promoteAmount);
}

function isPremiumConfigured() {
	const stripe = config.stripe || {};
	return hasStripeKeys() && Boolean(stripe.pricePremium || stripe.premiumAmount);
}

function isStripeConfigured() {
	return isPromoteConfigured() || isPremiumConfigured();
}

function getStripe() {
	if (stripeClient) {
		return stripeClient;
	}
	const key = config.stripe && config.stripe.secretKey;
	if (!key) {
		return null;
	}
	stripeClient = new Stripe(key, { apiVersion: STRIPE_API_VERSION });
	return stripeClient;
}

function setStripeForTests(client) {
	stripeClient = client;
}

function integrationIdentifier(kind) {
	let suffix = '';
	for (let i = 0; i < 8; i += 1) {
		suffix += LETTERS[crypto.randomInt(LETTERS.length)];
	}
	return `${kind}_${suffix}`;
}

function publicBaseUrl() {
	return String(config.stripe.publicBaseUrl).replace(/\/+$/, '');
}

function promoteLineItems() {
	const stripe = config.stripe;
	if (stripe.pricePromote) {
		return [{ price: stripe.pricePromote, quantity: 1 }];
	}
	return [{
		quantity: 1,
		price_data: {
			currency: stripe.promoteCurrency,
			unit_amount: stripe.promoteAmount,
			product_data: {
				name: `VomeSync promoted listing (${stripe.promoteDurationDays} days)`
			}
		}
	}];
}

function premiumLineItems() {
	const stripe = config.stripe;
	if (stripe.pricePremium) {
		return [{ price: stripe.pricePremium, quantity: 1 }];
	}
	return [{
		quantity: 1,
		price_data: {
			currency: stripe.premiumCurrency,
			unit_amount: stripe.premiumAmount,
			recurring: { interval: 'month' },
			product_data: {
				name: 'VomeSync premium'
			}
		}
	}];
}

async function createPromoteCheckoutSession({ uid, ownerId, durationDays }) {
	const stripe = getStripe();
	if (!stripe) {
		throw new Error('Stripe is not configured');
	}
	const publicBase = publicBaseUrl();
	const session = await stripe.checkout.sessions.create({
		mode: 'payment',
		line_items: promoteLineItems(),
		success_url: `${publicBase}/switch/${encodeURIComponent(uid)}?promoted=success`,
		cancel_url: `${publicBase}/switch/${encodeURIComponent(uid)}?promoted=cancel`,
		client_reference_id: uid,
		integration_identifier: integrationIdentifier('vomesync_promote'),
		metadata: {
			kind: 'vomesync_promote',
			uid,
			ownerId: ownerId || '',
			durationDays: String(durationDays)
		}
	});
	if (!session.url) {
		throw new Error('Stripe Checkout did not return a URL');
	}
	return { id: session.id, url: session.url };
}

async function createPremiumCheckoutSession({ ownerId, uid }) {
	const stripe = getStripe();
	if (!stripe) {
		throw new Error('Stripe is not configured');
	}
	const publicBase = publicBaseUrl();
	const switchPath = uid
		? `/switch/${encodeURIComponent(uid)}`
		: '';
	const session = await stripe.checkout.sessions.create({
		mode: 'subscription',
		line_items: premiumLineItems(),
		success_url: `${publicBase}${switchPath || '/'}?premium=success`,
		cancel_url: `${publicBase}${switchPath || '/'}?premium=cancel`,
		client_reference_id: ownerId,
		integration_identifier: integrationIdentifier('vomesync_premium'),
		metadata: {
			kind: 'vomesync_premium',
			ownerId: ownerId || '',
			uid: uid || ''
		},
		subscription_data: {
			metadata: {
				kind: 'vomesync_premium',
				ownerId: ownerId || ''
			}
		}
	});
	if (!session.url) {
		throw new Error('Stripe Checkout did not return a URL');
	}
	return { id: session.id, url: session.url };
}

function constructWebhookEvent(rawBody, signature) {
	const stripe = getStripe();
	if (!stripe) {
		throw new Error('Stripe is not configured');
	}
	return stripe.webhooks.constructEvent(rawBody, signature, config.stripe.webhookSecret);
}

module.exports = {
	STRIPE_API_VERSION,
	isStripeConfigured,
	isPromoteConfigured,
	isPremiumConfigured,
	getStripe,
	setStripeForTests,
	createPromoteCheckoutSession,
	createPremiumCheckoutSession,
	constructWebhookEvent
};

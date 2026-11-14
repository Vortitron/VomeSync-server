const redisClient = require('../../../src/utils/redis');
const {
	applyPromoteSession,
	applyPremiumSession,
	applySubscriptionChange,
	applySwitchPaymentSession,
	getSwitchEarnings,
	handleStripeWebhook
} = require('../../../src/routes/stripe-routes');
const stripeUtil = require('../../../src/utils/stripe');
const switchActions = require('../../../src/utils/switchActions');

function mockRes() {
	const res = {
		statusCode: 200,
		body: null,
		status(code) {
			this.statusCode = code;
			return this;
		},
		json(payload) {
			this.body = payload;
			return this;
		}
	};
	return res;
}

describe('stripe promotion webhook', () => {
	afterEach(() => {
		jest.restoreAllMocks();
	});

	test('applyPromoteSession writes promotedUntil once per session', async () => {
		const now = Date.now();
		jest.spyOn(redisClient, 'getSwitchState').mockResolvedValue({
			uid: 'vs_promo',
			promotedUntil: 0
		});
		const update = jest.spyOn(redisClient, 'updateSwitch').mockResolvedValue({});

		const first = await applyPromoteSession({
			id: 'cs_1',
			payment_status: 'paid',
			metadata: { kind: 'vomesync_promote', uid: 'vs_promo', durationDays: '7' }
		});
		expect(first.applied).toBe(true);
		expect(first.promotedUntil).toBeGreaterThan(now);
		expect(update).toHaveBeenCalledWith('vs_promo', expect.objectContaining({
			promotedSessionId: 'cs_1'
		}));

		jest.spyOn(redisClient, 'getSwitchState').mockResolvedValue({
			uid: 'vs_promo',
			promotedUntil: first.promotedUntil,
			promotedSessionId: 'cs_1'
		});
		const second = await applyPromoteSession({
			id: 'cs_1',
			payment_status: 'paid',
			metadata: { kind: 'vomesync_promote', uid: 'vs_promo', durationDays: '7' }
		});
		expect(second).toEqual({ applied: false, reason: 'duplicate' });
	});

	test('applyPromoteSession ignores other products and unpaid sessions', async () => {
		expect(await applyPromoteSession({
			id: 'cs_other',
			payment_status: 'paid',
			metadata: { kind: 'vomesync_premium' }
		})).toEqual({ applied: false, reason: 'ignored' });

		expect(await applyPromoteSession({
			id: 'cs_unpaid',
			payment_status: 'unpaid',
			metadata: { kind: 'vomesync_promote', uid: 'vs_promo' }
		})).toEqual({ applied: false, reason: 'unpaid' });
	});

	test('webhook refuses to run without Stripe config', async () => {
		jest.spyOn(stripeUtil, 'isStripeConfigured').mockReturnValue(false);
		const res = mockRes();
		await handleStripeWebhook({ headers: {}, body: Buffer.from('{}') }, res);
		expect(res.statusCode).toBe(503);
	});

	test('webhook requires a raw body and a signature', async () => {
		jest.spyOn(stripeUtil, 'isStripeConfigured').mockReturnValue(true);
		const missingSig = mockRes();
		await handleStripeWebhook({ headers: {}, body: Buffer.from('{}') }, missingSig);
		expect(missingSig.statusCode).toBe(400);

		const parsedBody = mockRes();
		await handleStripeWebhook({
			headers: { 'stripe-signature': 't=1,v1=abc' },
			body: '{"id":"evt"}'
		}, parsedBody);
		expect(parsedBody.statusCode).toBe(400);
		expect(parsedBody.body.error).toMatch(/raw/i);
	});

	test('webhook applies a paid Checkout session', async () => {
		jest.spyOn(stripeUtil, 'isStripeConfigured').mockReturnValue(true);
		jest.spyOn(stripeUtil, 'constructWebhookEvent').mockReturnValue({
			type: 'checkout.session.completed',
			data: {
				object: {
					id: 'cs_live',
					payment_status: 'paid',
					metadata: { kind: 'vomesync_promote', uid: 'vs_promo', durationDays: '7' }
				}
			}
		});
		jest.spyOn(redisClient, 'getSwitchState').mockResolvedValue({
			uid: 'vs_promo',
			promotedUntil: 0
		});
		jest.spyOn(redisClient, 'updateSwitch').mockResolvedValue({});

		const res = mockRes();
		await handleStripeWebhook({
			headers: { 'stripe-signature': 't=1,v1=abc' },
			body: Buffer.from('{"ok":true}')
		}, res);
		expect(res.body).toEqual({ received: true });
		expect(redisClient.updateSwitch).toHaveBeenCalled();
	});
});

describe('stripe premium webhook', () => {
	afterEach(() => {
		jest.restoreAllMocks();
	});

	test('applyPremiumSession grants owner premium once per session', async () => {
		jest.spyOn(redisClient, 'getOwnerTier').mockResolvedValue({ tier: 'free' });
		const setTier = jest.spyOn(redisClient, 'setOwnerTier').mockResolvedValue(true);

		const first = await applyPremiumSession({
			id: 'cs_prem',
			payment_status: 'paid',
			subscription: 'sub_1',
			customer: 'cus_1',
			metadata: { kind: 'vomesync_premium', ownerId: 'owner-abc' }
		});
		expect(first).toEqual({ applied: true, ownerId: 'owner-abc' });
		expect(setTier).toHaveBeenCalledWith(
			'owner-abc',
			'premium',
			0,
			'',
			expect.objectContaining({
				stripeSessionId: 'cs_prem',
				stripeSubscriptionId: 'sub_1',
				stripeCustomerId: 'cus_1'
			})
		);

		jest.spyOn(redisClient, 'getOwnerTier').mockResolvedValue({
			tier: 'premium',
			stripeSessionId: 'cs_prem'
		});
		const second = await applyPremiumSession({
			id: 'cs_prem',
			payment_status: 'paid',
			metadata: { kind: 'vomesync_premium', ownerId: 'owner-abc' }
		});
		expect(second).toEqual({ applied: false, reason: 'duplicate' });
	});

	test('subscription deleted clears premium unless a promo remains', async () => {
		jest.spyOn(redisClient, 'getOwnerTier').mockResolvedValue({ tier: 'premium' });
		const clear = jest.spyOn(redisClient, 'clearOwnerTier').mockResolvedValue(true);
		const result = await applySubscriptionChange({
			id: 'sub_1',
			status: 'canceled',
			metadata: { ownerId: 'owner-abc' }
		});
		expect(result.applied).toBe(true);
		expect(clear).toHaveBeenCalledWith('owner-abc');
	});

	test('past_due keeps premium', async () => {
		jest.spyOn(redisClient, 'getOwnerTier').mockResolvedValue({ tier: 'premium' });
		const setTier = jest.spyOn(redisClient, 'setOwnerTier').mockResolvedValue(true);
		const result = await applySubscriptionChange({
			id: 'sub_1',
			status: 'past_due',
			customer: 'cus_1',
			metadata: { ownerId: 'owner-abc' }
		});
		expect(result.applied).toBe(true);
		expect(setTier).toHaveBeenCalledWith(
			'owner-abc',
			'premium',
			0,
			'',
			expect.objectContaining({ stripeSubscriptionId: 'sub_1' })
		);
	});
});

describe('stripe webhook dispatch by kind', () => {
	afterEach(() => {
		jest.restoreAllMocks();
	});

	test('unknown Checkout kinds are ignored, not treated as promotions', async () => {
		jest.spyOn(stripeUtil, 'isStripeConfigured').mockReturnValue(true);
		jest.spyOn(stripeUtil, 'constructWebhookEvent').mockReturnValue({
			type: 'checkout.session.completed',
			data: { object: { id: 'cs_x', payment_status: 'paid', metadata: { kind: 'something_else', uid: 'vs_promo' } } }
		});
		const update = jest.spyOn(redisClient, 'updateSwitch').mockResolvedValue({});
		const getSwitch = jest.spyOn(redisClient, 'getSwitchState').mockResolvedValue({ uid: 'vs_promo' });
		const res = mockRes();
		await handleStripeWebhook({ headers: { 'stripe-signature': 't=1,v1=abc' }, body: Buffer.from('{}') }, res);
		expect(res.body).toEqual({ received: true });
		expect(update).not.toHaveBeenCalled();
		expect(getSwitch).not.toHaveBeenCalled();
	});
});

describe('paid switch and tip webhook', () => {
	const uid = 'vs_paidswitch0000000000000000';

	beforeAll(async () => {
		await redisClient.connect();
	});

	afterAll(async () => {
		if (redisClient.isConnected) {
			await redisClient.disconnect();
		}
	});

	beforeEach(async () => {
		await redisClient.client.flushDb();
		await redisClient.createSwitchV2(uid, 'owner-paid', 'opk', 'spk', 0, { name: 'Lamp', publicize: true });
		await redisClient.updateSwitch(uid, {
			commerce: { toggleMode: 'paid', action: 'on', holdSeconds: 0, price: { amount: 500, currency: 'eur' }, tips: true }
		});
	});

	afterEach(() => {
		jest.restoreAllMocks();
	});

	const session = (overrides = {}) => ({
		id: 'cs_paid_1',
		payment_status: 'paid',
		amount_total: 500,
		currency: 'eur',
		metadata: { kind: 'vomesync_paid_switch', uid, ownerId: 'owner-paid', message: 'Hello there', amount: '500', currency: 'eur' },
		...overrides
	});

	test('a paid switch applies the action once per session and counts earnings', async () => {
		const visitor = jest.spyOn(switchActions, 'applyVisitorAction');
		const first = await applySwitchPaymentSession(session());
		expect(first).toMatchObject({ applied: true, uid, kind: 'vomesync_paid_switch', state: true });
		expect(visitor).toHaveBeenCalledWith(uid, expect.objectContaining({ uid }), {
			source: 'paid',
			note: 'Hello there',
			paid: { amount: 500, currency: 'eur' }
		});
		const sw = await redisClient.getSwitchState(uid);
		expect(sw.state).toBe(true);
		expect(sw.lastSource).toBe('paid');
		expect(sw.lastNote).toBe('Hello there');

		const again = await applySwitchPaymentSession(session());
		expect(again).toEqual({ applied: false, reason: 'duplicate' });
		expect(visitor).toHaveBeenCalledTimes(1);

		expect(await getSwitchEarnings(uid)).toEqual({ paidCount: 1, tipCount: 0, paid: { eur: 500 }, tip: {} });
		const events = await redisClient.getEvents(uid, 5);
		expect(events[0]).toMatchObject({ type: 'state', source: 'paid', amount: 500, currency: 'eur' });
	});

	test('no message means the default note', async () => {
		const visitor = jest.spyOn(switchActions, 'applyVisitorAction');
		await applySwitchPaymentSession(session({
			id: 'cs_paid_2',
			metadata: { kind: 'vomesync_paid_switch', uid, ownerId: 'owner-paid', message: '', amount: '500', currency: 'eur' }
		}));
		expect(visitor.mock.calls[0][2].note).toBe('Paid by a visitor');
	});

	test('a tip records an event, fires the owner webhook and counts, without switching', async () => {
		const hook = jest.spyOn(switchActions, 'dispatchOwnerWebhook').mockResolvedValue(true);
		const visitor = jest.spyOn(switchActions, 'applyVisitorAction');
		const result = await applySwitchPaymentSession(session({
			id: 'cs_tip_1',
			metadata: { kind: 'vomesync_tip', uid, ownerId: 'owner-paid', message: 'Nice lamp', amount: '300', currency: 'eur' }
		}));
		expect(result).toEqual({ applied: true, uid, kind: 'vomesync_tip' });
		expect(visitor).not.toHaveBeenCalled();
		expect((await redisClient.getSwitchState(uid)).state).toBe(false);
		const events = await redisClient.getEvents(uid, 5);
		expect(events[0]).toMatchObject({ type: 'tip', amount: 300, currency: 'eur', note: 'Nice lamp' });
		expect(hook).toHaveBeenCalledWith(expect.objectContaining({ uid }), 'tip', expect.objectContaining({
			amount: 300, currency: 'eur', note: 'Nice lamp', source: 'tip'
		}));
		expect(await getSwitchEarnings(uid)).toEqual({ paidCount: 0, tipCount: 1, paid: {}, tip: { eur: 300 } });
	});

	test('unpaid sessions wait for async_payment_succeeded', async () => {
		expect(await applySwitchPaymentSession(session({ payment_status: 'unpaid' })))
			.toEqual({ applied: false, reason: 'unpaid' });
		expect(await redisClient.client.exists('paid_session:cs_paid_1')).toBe(0);
	});

	test('a failure releases the session so Stripe can retry', async () => {
		jest.spyOn(switchActions, 'applyVisitorAction').mockRejectedValueOnce(new Error('redis hiccup'));
		await expect(applySwitchPaymentSession(session())).rejects.toThrow('redis hiccup');
		expect(await redisClient.client.exists('paid_session:cs_paid_1')).toBe(0);
		jest.restoreAllMocks();
		expect((await applySwitchPaymentSession(session())).applied).toBe(true);
	});

	test('the webhook routes paid-switch sessions through the handler', async () => {
		jest.spyOn(stripeUtil, 'isStripeConfigured').mockReturnValue(true);
		jest.spyOn(stripeUtil, 'constructWebhookEvent').mockReturnValue({
			type: 'checkout.session.completed',
			data: { object: session({ id: 'cs_paid_hook' }) }
		});
		const res = mockRes();
		await handleStripeWebhook({ headers: { 'stripe-signature': 't=1,v1=abc' }, body: Buffer.from('{}') }, res);
		expect(res.body).toEqual({ received: true });
		expect((await redisClient.getSwitchState(uid)).state).toBe(true);
	});
});

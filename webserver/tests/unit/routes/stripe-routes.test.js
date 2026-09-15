const redisClient = require('../../../src/utils/redis');
const {
	applyPromoteSession,
	applyPremiumSession,
	applySubscriptionChange,
	handleStripeWebhook
} = require('../../../src/routes/stripe-routes');
const stripeUtil = require('../../../src/utils/stripe');

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

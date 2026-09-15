const {
	createPromoteCheckoutSession,
	createPremiumCheckoutSession,
	setStripeForTests,
	isStripeConfigured
} = require('../../../src/utils/stripe');

describe('stripe checkout helper', () => {
	afterEach(() => {
		setStripeForTests(null);
	});

	test('is disabled without keys', () => {
		expect(isStripeConfigured()).toBe(false);
	});

	test('creates a hosted Checkout Session without payment_method_types', async () => {
		const create = jest.fn().mockResolvedValue({
			id: 'cs_test_promote',
			url: 'https://checkout.stripe.com/c/pay/cs_test_promote'
		});
		setStripeForTests({ checkout: { sessions: { create } } });

		const session = await createPromoteCheckoutSession({
			uid: 'vs_rh66f3z5z6hmffa82nte1nxmg0',
			ownerId: 'owner-1',
			durationDays: 7
		});

		expect(session).toEqual({
			id: 'cs_test_promote',
			url: 'https://checkout.stripe.com/c/pay/cs_test_promote'
		});
		expect(create).toHaveBeenCalledTimes(1);
		const payload = create.mock.calls[0][0];
		expect(payload.mode).toBe('payment');
		expect(payload.payment_method_types).toBeUndefined();
		expect(payload.metadata).toEqual({
			kind: 'vomesync_promote',
			uid: 'vs_rh66f3z5z6hmffa82nte1nxmg0',
			ownerId: 'owner-1',
			durationDays: '7'
		});
		expect(payload.success_url).toContain('/switch/vs_rh66f3z5z6hmffa82nte1nxmg0?promoted=success');
		expect(payload.cancel_url).toContain('/switch/vs_rh66f3z5z6hmffa82nte1nxmg0?promoted=cancel');
	});

	test('creates a hosted subscription Checkout Session for premium', async () => {
		const create = jest.fn().mockResolvedValue({
			id: 'cs_test_premium',
			url: 'https://checkout.stripe.com/c/pay/cs_test_premium'
		});
		setStripeForTests({ checkout: { sessions: { create } } });

		const session = await createPremiumCheckoutSession({
			ownerId: 'owner-1',
			uid: 'vs_rh66f3z5z6hmffa82nte1nxmg0'
		});

		expect(session.id).toBe('cs_test_premium');
		const payload = create.mock.calls[0][0];
		expect(payload.mode).toBe('subscription');
		expect(payload.payment_method_types).toBeUndefined();
		expect(payload.metadata).toEqual({
			kind: 'vomesync_premium',
			ownerId: 'owner-1',
			uid: 'vs_rh66f3z5z6hmffa82nte1nxmg0'
		});
		expect(payload.subscription_data.metadata).toEqual({
			kind: 'vomesync_premium',
			ownerId: 'owner-1'
		});
		expect(payload.line_items[0].price_data.recurring).toEqual({ interval: 'month' });
	});
});

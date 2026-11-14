const {
	createPromoteCheckoutSession,
	createPremiumCheckoutSession,
	createBillingPortalSession,
	createSwitchPaymentSession,
	switchPaymentFee,
	setStripeForTests,
	isStripeConfigured,
	isPaymentsConfigured
} = require('../../../src/utils/stripe');
const config = require('../../../src/config/config');

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
		expect(payload.automatic_tax).toEqual({ enabled: true });
		expect(payload.tax_id_collection).toEqual({ enabled: true });
		expect(payload.adaptive_pricing).toEqual({ enabled: true });
		expect(payload.line_items[0].price_data.tax_behavior).toBe('inclusive');
		expect(payload.line_items[0].price_data.product_data.tax_code).toBe('txcd_10103000');
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
		expect(payload.automatic_tax).toEqual({ enabled: true });
		expect(payload.tax_id_collection).toEqual({ enabled: true });
		expect(payload.line_items[0].price_data.tax_behavior).toBe('inclusive');
		expect(payload.line_items[0].price_data.product_data.tax_code).toBe('txcd_10103000');
	});

	test('creates a Customer Portal session for an existing Stripe customer', async () => {
		const create = jest.fn().mockResolvedValue({
			id: 'bps_test',
			url: 'https://billing.stripe.com/p/session/bps_test'
		});
		setStripeForTests({ billingPortal: { sessions: { create } } });

		const session = await createBillingPortalSession({
			customerId: 'cus_test',
			uid: 'vs_rh66f3z5z6hmffa82nte1nxmg0'
		});

		expect(session).toEqual({
			id: 'bps_test',
			url: 'https://billing.stripe.com/p/session/bps_test'
		});
		expect(create).toHaveBeenCalledWith({
			customer: 'cus_test',
			return_url: expect.stringContaining('/switch/vs_rh66f3z5z6hmffa82nte1nxmg0?billing=return')
		});
	});

	test('paid switches need only the keys', () => {
		expect(isPaymentsConfigured()).toBe(false);
		const saved = { ...config.stripe };
		config.stripe.secretKey = 'sk_test_x';
		config.stripe.webhookSecret = 'whsec_x';
		try {
			expect(isPaymentsConfigured()).toBe(true);
		} finally {
			Object.assign(config.stripe, saved);
		}
	});

	test('application fee is percent plus fixed, capped at the amount', () => {
		expect(switchPaymentFee(1000)).toBe(130);
		expect(switchPaymentFee(100)).toBe(40);
		const saved = { ...config.stripe };
		config.stripe.connectFeePercent = 0;
		config.stripe.connectFeeFixed = 0;
		try {
			expect(switchPaymentFee(1000)).toBe(0);
		} finally {
			Object.assign(config.stripe, saved);
		}
	});

	test('paid switch through an owner is a destination charge on their behalf, without Vome tax', async () => {
		const create = jest.fn().mockResolvedValue({ id: 'cs_test_paid', url: 'https://checkout.stripe.com/c/pay/cs_test_paid' });
		setStripeForTests({ checkout: { sessions: { create } } });

		const session = await createSwitchPaymentSession({
			uid: 'vs_rh66f3z5z6hmffa82nte1nxmg0',
			ownerId: 'owner-1',
			kind: 'switch',
			amount: 1000,
			currency: 'sek',
			message: 'Hej',
			connectedAccountId: 'acct_owner',
			switchName: 'Window lamp'
		});
		expect(session).toEqual({ id: 'cs_test_paid', url: 'https://checkout.stripe.com/c/pay/cs_test_paid' });
		const payload = create.mock.calls[0][0];
		expect(payload.mode).toBe('payment');
		expect(payload.payment_method_types).toBeUndefined();
		expect(payload.line_items).toEqual([{
			quantity: 1,
			price_data: { currency: 'sek', unit_amount: 1000, product_data: { name: 'Switch Window lamp' } }
		}]);
		expect(payload.payment_intent_data).toEqual({
			on_behalf_of: 'acct_owner',
			transfer_data: { destination: 'acct_owner' },
			application_fee_amount: 130,
			metadata: payload.metadata
		});
		expect(payload.metadata).toEqual({
			kind: 'vomesync_paid_switch',
			uid: 'vs_rh66f3z5z6hmffa82nte1nxmg0',
			ownerId: 'owner-1',
			message: 'Hej',
			amount: '1000',
			currency: 'sek'
		});
		expect(payload.automatic_tax).toBeUndefined();
		expect(payload.tax_id_collection).toBeUndefined();
		expect(payload.success_url).toMatch(/\/switch\/vs_rh66f3z5z6hmffa82nte1nxmg0\?paid=success$/);
		expect(payload.cancel_url).toMatch(/\/switch\/vs_rh66f3z5z6hmffa82nte1nxmg0\?paid=cancel$/);
	});

	test('catalogue-owner tip is a plain platform sale with the usual tax', async () => {
		const create = jest.fn().mockResolvedValue({ id: 'cs_test_tip', url: 'https://checkout.stripe.com/c/pay/cs_test_tip' });
		setStripeForTests({ checkout: { sessions: { create } } });

		await createSwitchPaymentSession({
			uid: 'vs_rh66f3z5z6hmffa82nte1nxmg0',
			ownerId: 'catalogue',
			kind: 'tip',
			amount: 300,
			currency: 'eur',
			platformSale: true
		});
		const payload = create.mock.calls[0][0];
		expect(payload.metadata.kind).toBe('vomesync_tip');
		expect(payload.payment_intent_data).toEqual({ metadata: payload.metadata });
		expect(payload.automatic_tax).toEqual({ enabled: true });
		expect(payload.line_items[0].price_data.tax_behavior).toBe('inclusive');
		expect(payload.line_items[0].price_data.product_data.tax_code).toBe('txcd_10103000');
	});

	test('refuses an owner sale without a connected account', async () => {
		setStripeForTests({ checkout: { sessions: { create: jest.fn() } } });
		await expect(createSwitchPaymentSession({
			uid: 'vs_x', ownerId: 'o', kind: 'switch', amount: 100, currency: 'eur'
		})).rejects.toThrow(/connected account/);
		await expect(createSwitchPaymentSession({
			uid: 'vs_x', ownerId: 'o', kind: 'boost', amount: 100, currency: 'eur', platformSale: true
		})).rejects.toThrow(/Unknown payment kind/);
	});
});

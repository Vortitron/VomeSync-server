const redisClient = require('../../../src/utils/redis');
const { setStripeForTests } = require('../../../src/utils/stripe');
const connect = require('../../../src/utils/connect');

function account({ card = 'active', transfers = 'active', entries = [] } = {}) {
	return {
		id: 'acct_test_1',
		configuration: {
			merchant: { applied: true, capabilities: { card_payments: { status: card, status_details: [] } } },
			recipient: {
				applied: true,
				capabilities: { stripe_balance: { stripe_transfers: { status: transfers, status_details: [] } } }
			}
		},
		requirements: { entries }
	};
}

function fakeStripe(overrides = {}) {
	const fake = {
		v2: {
			core: {
				accounts: {
					create: jest.fn().mockResolvedValue({ id: 'acct_test_1' }),
					retrieve: jest.fn().mockResolvedValue(account({ card: 'pending', transfers: 'pending' }))
				},
				accountLinks: {
					create: jest.fn().mockResolvedValue({
						url: 'https://connect.stripe.com/setup/e/acct_test_1/abc',
						expires_at: '2026-10-30T12:00:00.000Z'
					})
				}
			}
		},
		accounts: {
			createLoginLink: jest.fn().mockResolvedValue({ url: 'https://connect.stripe.com/express/login/abc' })
		}
	};
	Object.assign(fake.v2.core.accounts, overrides.accounts || {});
	Object.assign(fake.accounts, overrides.v1accounts || {});
	setStripeForTests(fake);
	return fake;
}

describe('Stripe Connect (Accounts v2)', () => {
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
	});

	afterEach(() => {
		setStripeForTests(null);
	});

	describe('readinessFromAccount', () => {
		test('ready only when card payments and transfers are both active', () => {
			expect(connect.readinessFromAccount(account()).ready).toBe(true);
			expect(connect.readinessFromAccount(account({ card: 'pending' })).ready).toBe(false);
			expect(connect.readinessFromAccount(account({ transfers: 'restricted' })).ready).toBe(false);
			expect(connect.readinessFromAccount({ id: 'acct_x' })).toEqual({
				ready: false,
				cardPayments: 'missing',
				stripeTransfers: 'missing',
				requirementsDue: 0
			});
		});

		test('counts requirements the owner still has to provide', () => {
			const readiness = connect.readinessFromAccount(account({
				card: 'restricted',
				entries: [
					{ awaiting_action_from: 'user', minimum_deadline: { status: 'currently_due' } },
					{ awaiting_action_from: 'user', minimum_deadline: { status: 'past_due' } },
					{ awaiting_action_from: 'user', minimum_deadline: { status: 'eventually_due' } },
					{ awaiting_action_from: 'stripe', minimum_deadline: { status: 'currently_due' } }
				]
			}));
			expect(readiness.requirementsDue).toBe(2);
		});
	});

	test('creates one express account with the contract settings and an onboarding link', async () => {
		const stripe = fakeStripe();
		const link = await connect.createOnboardingLink('owner-1', { uid: 'vs_abc' });
		expect(link.url).toContain('connect.stripe.com');
		expect(link.accountId).toBe('acct_test_1');

		expect(stripe.v2.core.accounts.create).toHaveBeenCalledTimes(1);
		const params = stripe.v2.core.accounts.create.mock.calls[0][0];
		expect(params.dashboard).toBe('express');
		expect(params.defaults.responsibilities).toEqual({
			fees_collector: 'application',
			losses_collector: 'application'
		});
		expect(params.configuration.merchant.capabilities.card_payments.requested).toBe(true);
		expect(params.configuration.recipient.capabilities.stripe_balance.stripe_transfers.requested).toBe(true);
		expect(params.metadata).toEqual({ vomesyncOwnerId: 'owner-1' });

		const linkParams = stripe.v2.core.accountLinks.create.mock.calls[0][0];
		expect(linkParams.account).toBe('acct_test_1');
		expect(linkParams.use_case.type).toBe('account_onboarding');
		expect(linkParams.use_case.account_onboarding.configurations).toEqual(['merchant', 'recipient']);
		expect(linkParams.use_case.account_onboarding.return_url).toMatch(/\/switch\/vs_abc\?connect=return$/);
		expect(linkParams.use_case.account_onboarding.refresh_url).toMatch(/\/switch\/vs_abc\?connect=refresh$/);

		const stored = await redisClient.client.hGetAll('owner_connect:owner-1');
		expect(stored.accountId).toBe('acct_test_1');
		expect(stored.ready).toBe('false');
		expect(Number(stored.createdAt)).toBeGreaterThan(0);

		// Resuming reuses the account.
		await connect.createOnboardingLink('owner-1');
		expect(stripe.v2.core.accounts.create).toHaveBeenCalledTimes(1);
		const second = stripe.v2.core.accountLinks.create.mock.calls[1][0];
		expect(second.use_case.account_onboarding.return_url).toMatch(/\/\?connect=return$/);
	});

	test('a second create while one is in flight is refused, not duplicated', async () => {
		const stripe = fakeStripe();
		await redisClient.client.set('owner_connect_lock:owner-2', '1');
		await expect(connect.ensureConnectAccount('owner-2')).rejects.toMatchObject({ status: 409 });
		expect(stripe.v2.core.accounts.create).not.toHaveBeenCalled();
	});

	test('status without an account says not connected and never calls Stripe', async () => {
		const stripe = fakeStripe();
		const status = await connect.connectStatusResponse('nobody');
		expect(status).toEqual({ connected: false, ready: false, requirementsDue: 0 });
		expect(stripe.v2.core.accounts.retrieve).not.toHaveBeenCalled();
	});

	test('status reads Stripe with the includes, caches, and keeps ready for ownerCanTakePayments', async () => {
		const stripe = fakeStripe({
			accounts: { retrieve: jest.fn().mockResolvedValue(account()) }
		});
		await connect.ensureConnectAccount('owner-3');
		const now = Date.now();
		const status = await connect.getConnectStatus('owner-3', { now });
		expect(status.ready).toBe(true);
		expect(stripe.v2.core.accounts.retrieve).toHaveBeenCalledWith('acct_test_1', {
			include: ['configuration.merchant', 'configuration.recipient', 'requirements']
		});
		expect(await redisClient.ownerCanTakePayments('owner-3')).toBe(true);

		await connect.getConnectStatus('owner-3', { now: now + 60 * 1000 });
		expect(stripe.v2.core.accounts.retrieve).toHaveBeenCalledTimes(1);
		await connect.getConnectStatus('owner-3', { now: now + connect.READY_CACHE_MS + 1 });
		expect(stripe.v2.core.accounts.retrieve).toHaveBeenCalledTimes(2);
	});

	test('a not-ready account is re-read after 30 seconds', async () => {
		const stripe = fakeStripe();
		await connect.ensureConnectAccount('owner-4');
		const now = Date.now();
		expect((await connect.getConnectStatus('owner-4', { now })).ready).toBe(false);
		await connect.getConnectStatus('owner-4', { now: now + 10 * 1000 });
		expect(stripe.v2.core.accounts.retrieve).toHaveBeenCalledTimes(1);
		stripe.v2.core.accounts.retrieve.mockResolvedValue(account());
		const later = await connect.getConnectStatus('owner-4', { now: now + connect.NOT_READY_CACHE_MS + 1 });
		expect(later.ready).toBe(true);
		expect(await redisClient.client.hGet('owner_connect:owner-4', 'ready')).toBe('true');
	});

	test('a ready owner gets an Express dashboard link; a failed link is left out', async () => {
		const stripe = fakeStripe({ accounts: { retrieve: jest.fn().mockResolvedValue(account()) } });
		await connect.ensureConnectAccount('owner-5');
		const status = await connect.connectStatusResponse('owner-5');
		expect(status).toEqual({
			connected: true,
			ready: true,
			requirementsDue: 0,
			dashboardUrl: 'https://connect.stripe.com/express/login/abc'
		});
		expect(stripe.accounts.createLoginLink).toHaveBeenCalledWith('acct_test_1');

		stripe.accounts.createLoginLink.mockRejectedValue(new Error('nope'));
		const without = await connect.connectStatusResponse('owner-5');
		expect(without.dashboardUrl).toBeUndefined();
		expect(without.ready).toBe(true);
	});

	test('markNotReady forces the next check and stops payments at once', async () => {
		fakeStripe({ accounts: { retrieve: jest.fn().mockResolvedValue(account()) } });
		await connect.ensureConnectAccount('owner-6');
		await connect.getConnectStatus('owner-6');
		expect(await redisClient.ownerCanTakePayments('owner-6')).toBe(true);
		await connect.markNotReady('owner-6');
		expect(await redisClient.ownerCanTakePayments('owner-6')).toBe(false);
	});

	test('without Stripe keys, onboarding fails with 503', async () => {
		setStripeForTests(null);
		await expect(connect.createOnboardingLink('owner-7')).rejects.toMatchObject({ status: 503 });
	});
});

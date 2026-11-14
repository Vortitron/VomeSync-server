const loadWith = (env) => {
	const saved = { ...process.env };
	Object.assign(process.env, env);
	let mod;
	jest.isolateModules(() => {
		mod = {
			config: require('../../../src/config/config'),
			paid: require('../../../src/utils/paidOwners')
		};
	});
	process.env = saved;
	return mod;
};

describe('invite-only paid switching', () => {
	test('a live key with nothing listed lets nobody take money but the catalogue owner', () => {
		const { config, paid } = loadWith({ STRIPE_SECRET_KEY: 'rk_live_x', STRIPE_PAID_SWITCHING_OWNERS: '', CATALOGUE_OWNER_ID: 'CatOwner' });
		expect(config.stripe.paidSwitchingOwners).toEqual([]);
		expect(paid.isPaidSwitchingAllowed('someone')).toBe(false);
		expect(paid.isPaidSwitchingAllowed('catowner')).toBe(true);
		expect(paid.isPaidSwitchingAllowed('')).toBe(false);
	});

	test('listed owners are let in, case-insensitively', () => {
		const { paid } = loadWith({ STRIPE_SECRET_KEY: 'sk_live_x', STRIPE_PAID_SWITCHING_OWNERS: ' AbC , def ' });
		expect(paid.isPaidSwitchingAllowed('abc')).toBe(true);
		expect(paid.isPaidSwitchingAllowed('DEF')).toBe(true);
		expect(paid.isPaidSwitchingAllowed('ghi')).toBe(false);
	});

	test('a test-mode key with nothing listed is open to everyone (no real money)', () => {
		const { paid } = loadWith({ STRIPE_SECRET_KEY: 'sk_test_x', STRIPE_PAID_SWITCHING_OWNERS: '' });
		expect(paid.isPaidSwitchingAllowed('anyone')).toBe(true);
	});
});

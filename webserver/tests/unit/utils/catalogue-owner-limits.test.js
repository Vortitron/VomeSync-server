const { isCatalogueOwner, checkFreeTierLimits } = require('../../../src/routes/route-helpers');

describe('catalogue owner cap exemption', () => {
	test('matches the configured owner id case-insensitively', () => {
		expect(isCatalogueOwner('AbCdef', 'abcdef')).toBe(true);
		expect(isCatalogueOwner('abcdef', 'abcdef')).toBe(true);
		expect(isCatalogueOwner('other', 'abcdef')).toBe(false);
		expect(isCatalogueOwner('', 'abcdef')).toBe(false);
		expect(isCatalogueOwner('abcdef', '')).toBe(false);
		expect(isCatalogueOwner('', '')).toBe(false);
	});

	test('checkFreeTierLimits skips the catalogue owner even on create', async () => {
		const result = await checkFreeTierLimits({
			ownerId: 'staff-catalogue',
			catalogueOwnerId: 'staff-catalogue',
			isCreate: true,
			wantsPublicize: true
		});
		expect(result).toBeNull();
	});
});

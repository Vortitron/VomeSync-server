const {
	isPromoted,
	listingPromotion,
	promotionBlockReason,
	sortPublicSwitches,
	nextPromotedUntil,
	MS_PER_DAY
} = require('../../../src/utils/promote');

describe('promote helpers', () => {
	const now = new Date('2026-09-15T12:00:00.000Z');

	test('listingPromotion hides expired stamps', () => {
		expect(listingPromotion({ promotedUntil: now.getTime() - 1 }, now)).toEqual({
			promoted: false,
			promotedUntil: 0
		});
		expect(listingPromotion({ promotedUntil: now.getTime() + 1 }, now)).toEqual({
			promoted: true,
			promotedUntil: now.getTime() + 1
		});
	});

	test('promotionBlockReason refuses tests, v1, private, and unnamed listings', () => {
		expect(promotionBlockReason(null)).toBe('Switch not found');
		expect(promotionBlockReason({ authVersion: 1, publicize: true, name: 'A' }))
			.toBe('Only v2 switches can be promoted');
		expect(promotionBlockReason({ authVersion: 2, publicize: false, name: 'A' }))
			.toBe('Switch must be public to be promoted');
		expect(promotionBlockReason({ authVersion: 2, publicize: true, name: '  ' }))
			.toBe('Switch needs a name');
		expect(promotionBlockReason({
			authVersion: 2,
			publicize: true,
			name: 'Lab',
			category: 'Test'
		})).toBe('Test listings cannot be promoted');
		expect(promotionBlockReason({
			authVersion: 2,
			publicize: true,
			name: 'Lab',
			description: 'Public Test Switch'
		})).toBe('Test listings cannot be promoted');
		expect(promotionBlockReason({
			authVersion: 2,
			publicize: true,
			name: 'Tower Bridge',
			category: 'Event',
			description: 'ON when the bascules are up'
		})).toBeNull();
	});

	test('sortPublicSwitches pins live promotions first and keeps the rest', () => {
		const organic = { uid: 'vs_organic', promotedUntil: 0 };
		const featured = { uid: 'vs_featured', promotedUntil: now.getTime() + 1000 };
		const expired = { uid: 'vs_expired', promotedUntil: now.getTime() - 1000 };
		expect(sortPublicSwitches([organic, featured, expired], now).map((item) => item.uid))
			.toEqual(['vs_featured', 'vs_organic', 'vs_expired']);
		expect(isPromoted(featured, now)).toBe(true);
		expect(isPromoted(expired, now)).toBe(false);
	});

	test('nextPromotedUntil stacks from now or an unexpired end', () => {
		expect(nextPromotedUntil(0, 7, now)).toBe(now.getTime() + 7 * MS_PER_DAY);
		const existing = now.getTime() + 2 * MS_PER_DAY;
		expect(nextPromotedUntil(existing, 7, now)).toBe(existing + 7 * MS_PER_DAY);
		expect(() => nextPromotedUntil(0, 0, now)).toThrow(/positive number of days/);
	});
});

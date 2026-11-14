const extras = require('../../../src/utils/switchExtras');

describe('switchExtras', () => {
	describe('properties', () => {
		test('keeps text, numbers and booleans, trimmed', () => {
			expect(extras.cleanProperties({ wattage: 40, colour: '  warm   white ', dimmable: true }))
				.toEqual({ wattage: 40, colour: 'warm white', dimmable: true });
		});

		test('accepts a JSON string from a multipart form', () => {
			expect(extras.cleanProperties('{"radio":"P3"}')).toEqual({ radio: 'P3' });
		});

		test('refuses bad keys, nested values and too many entries', () => {
			expect(() => extras.cleanProperties({ 'Bad Key': 1 })).toThrow(extras.ExtrasError);
			expect(() => extras.cleanProperties({ nested: { a: 1 } })).toThrow(/text, a number/);
			expect(() => extras.cleanProperties({ long: 'x'.repeat(201) })).toThrow(/200/);
			const many = {};
			for (let i = 0; i < 13; i += 1) {
				many[`k${i}`] = i;
			}
			expect(() => extras.cleanProperties(many)).toThrow(/At most 12/);
		});

		test('merge deletes keys sent as null', () => {
			const patch = extras.cleanProperties({ a: null, c: 3 }, { allowNullDeletes: true });
			expect(extras.mergeProperties({ a: 1, b: 2 }, patch)).toEqual({ b: 2, c: 3 });
		});
	});

	describe('note and params', () => {
		test('note strips control characters and collapses whitespace', () => {
			expect(extras.cleanNote('Now\u0000 playing:\n\nSOS‮')).toBe('Now playing: SOS');
			expect(extras.cleanNote(undefined)).toBe('');
			expect(() => extras.cleanNote('x'.repeat(281))).toThrow(/280/);
		});

		test('visitor messages are short and have no links', () => {
			expect(extras.cleanVisitorMessage('Merry Christmas!')).toBe('Merry Christmas!');
			expect(() => extras.cleanVisitorMessage('see https://spam.example')).toThrow(/links/);
			expect(() => extras.cleanVisitorMessage('www.spam.example')).toThrow(/links/);
			expect(() => extras.cleanVisitorMessage('x'.repeat(141))).toThrow(/140/);
		});

		test('params keep light settings and clip instead of refusing', () => {
			const ok = { rgb_color: [255, 0, 0], brightness: 200, song: 'SOS', live: true, gone: null };
			expect(extras.cleanParams(ok)).toEqual(ok);
			expect(extras.cleanParams({ deep: { a: 1 } })).toEqual({ deep: '{"a":1}' });
			expect(extras.cleanParams({ list: [1, 2, 3, 4, 5, 6, 7, 8, 9] }).list).toHaveLength(8);
			expect(extras.cleanParams({ 'bad-key': 1, fine: 2 })).toEqual({ fine: 2 });
			expect(extras.cleanParams({ lastError: 'e'.repeat(500) }).lastError).toHaveLength(200);
			const wide = {};
			for (let i = 0; i < 20; i += 1) {
				wide[`k${i}`] = 'y'.repeat(190);
			}
			const clipped = extras.cleanParams(wide);
			expect(JSON.stringify(clipped).length).toBeLessThanOrEqual(2048);
			expect(Object.keys(clipped).length).toBeLessThanOrEqual(16);
			expect(() => extras.cleanParams([1, 2])).toThrow(/object/);
		});
	});

	describe('commerce', () => {
		test('full clean fills defaults; partial keeps only sent fields', () => {
			expect(extras.cleanCommerce({ tips: true })).toEqual({ ...extras.COMMERCE_DEFAULTS, tips: true });
			expect(extras.cleanCommerce({ tips: true }, { partial: true })).toEqual({ tips: true });
		});

		test('prices respect per-currency floors', () => {
			expect(extras.cleanCommerce({ price: { amount: 100, currency: 'EUR' } }).price)
				.toEqual({ amount: 100, currency: 'eur' });
			expect(() => extras.cleanCommerce({ price: { amount: 500, currency: 'sek' } })).toThrow(/between 1000/);
			expect(() => extras.cleanCommerce({ price: { amount: 100, currency: 'nok' } })).toThrow(/Currency/);
		});

		test('webhook must be https without credentials; unknown fields refused', () => {
			expect(() => extras.cleanCommerce({ webhookUrl: 'http://example.com/hook' })).toThrow(/https/);
			expect(() => extras.cleanCommerce({ webhookUrl: 'https://u:p@example.com/' })).toThrow(/password/);
			expect(() => extras.cleanCommerce({ surprise: 1 })).toThrow(/Unknown commerce field/);
		});

		test('paid mode needs a price; public mode has a cooldown floor', () => {
			expect(() => extras.finaliseCommerce(null, { toggleMode: 'paid' })).toThrow(/price/);
			expect(extras.finaliseCommerce(null, { toggleMode: 'public', cooldownSeconds: 0 }).cooldownSeconds)
				.toBe(extras.PUBLIC_MIN_COOLDOWN_SECONDS);
		});

		test('public summary hides the webhook URL and is null when nothing is on', () => {
			expect(extras.publicCommerce({ ...extras.COMMERCE_DEFAULTS })).toBeNull();
			const shown = extras.publicCommerce({ ...extras.COMMERCE_DEFAULTS, tips: true, webhookUrl: 'https://x.example/h' });
			expect(shown.tips).toBe(true);
			expect(shown.webhookUrl).toBeUndefined();
			expect(shown.canTakePayments).toBe(false);
		});
	});

	describe('reward', () => {
		test('fills defaults and validates', () => {
			expect(extras.cleanReward({ amount: 200, currency: 'sek' })).toEqual({
				amount: 200, currency: 'sek', on: 'on', windowSeconds: 900, maxPerDay: 5, note: ''
			});
			expect(extras.cleanReward(null)).toBeNull();
			expect(() => extras.cleanReward({ amount: 0, currency: 'sek' })).toThrow(/reward.amount/);
			expect(() => extras.cleanReward({ amount: 5, currency: 'eur', on: 'sideways' })).toThrow(/reward.on/);
		});

		test('qualifies by direction', () => {
			expect(extras.rewardQualifies({ on: 'on' }, true)).toBe(true);
			expect(extras.rewardQualifies({ on: 'on' }, false)).toBe(false);
			expect(extras.rewardQualifies({ on: 'any' }, false)).toBe(true);
			expect(extras.rewardQualifies(null, true)).toBe(false);
		});
	});

	test('target state and application fee', () => {
		expect(extras.targetStateFor('toggle', true)).toBe(false);
		expect(extras.targetStateFor('on', true)).toBe(true);
		expect(extras.targetStateFor('off', true)).toBe(false);
		expect(extras.applicationFee(100)).toBe(40);
		expect(extras.applicationFee(1000, { percent: 5, fixed: 0 })).toBe(50);
		expect(extras.applicationFee(20)).toBe(20);
	});
});

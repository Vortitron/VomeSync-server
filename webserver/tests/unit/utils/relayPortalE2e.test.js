/**
 * The E2E router's lookup: which home an e2e name belongs to. Fails closed,
 * caches answers (misses too) briefly, and never caches an error.
 */
const relayPortal = require('../../../src/utils/relayPortal');
const config = require('../../../src/config/config');

describe('fetchE2eRoute', () => {
	const realFetch = global.fetch;
	const saved = { ...config.relay };
	beforeEach(() => {
		config.relay.internalSecret = 'test-secret';
		config.relay.e2eRouteUrl = 'http://portal.test/internal/e2e-route';
		relayPortal._e2eRouteCache.clear();
	});
	afterEach(() => {
		global.fetch = realFetch;
		Object.assign(config.relay, saved);
	});

	test('asks with the shared secret and returns the route', async () => {
		global.fetch = jest.fn(async () => ({ ok: true, json: async () => ({ ok: true, route_id: 'rly-1' }) }));
		expect(await relayPortal.fetchE2eRoute('a.e2e.vome.io')).toBe('rly-1');
		const [url, init] = global.fetch.mock.calls[0];
		expect(url).toBe('http://portal.test/internal/e2e-route');
		expect(init.headers.Authorization).toBe('Bearer test-secret');
		expect(JSON.parse(init.body)).toEqual({ host: 'a.e2e.vome.io' });
	});

	test('answers and misses are cached; errors are not', async () => {
		global.fetch = jest.fn(async () => ({ ok: true, json: async () => ({ ok: false }) }));
		expect(await relayPortal.fetchE2eRoute('b.e2e.vome.io')).toBeNull();
		expect(await relayPortal.fetchE2eRoute('b.e2e.vome.io')).toBeNull();
		expect(global.fetch).toHaveBeenCalledTimes(1);

		global.fetch = jest.fn(async () => { throw new Error('portal down'); });
		expect(await relayPortal.fetchE2eRoute('c.e2e.vome.io')).toBeNull();
		expect(await relayPortal.fetchE2eRoute('c.e2e.vome.io')).toBeNull();
		expect(global.fetch).toHaveBeenCalledTimes(2);
	});

	test('no shared secret, no lookup', async () => {
		config.relay.internalSecret = '';
		global.fetch = jest.fn();
		expect(await relayPortal.fetchE2eRoute('d.e2e.vome.io')).toBeNull();
		expect(global.fetch).not.toHaveBeenCalled();
	});
});

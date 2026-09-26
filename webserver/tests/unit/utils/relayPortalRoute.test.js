/**
 * The forward policy carries the relay link that answers for a home CHAP has
 * moved to a local install (portal friendly_domains.forward_policy_for_host).
 */
const { fetchForwardPolicy } = require('../../../src/utils/relayPortal');
const config = require('../../../src/config/config');

describe('fetchForwardPolicy route_id', () => {
	const realFetch = global.fetch;
	const saved = { ...config.relay };
	beforeEach(() => {
		config.relay.internalSecret = 'test-secret';
		config.relay.forwardPolicyUrl = 'http://portal.test/internal/forward-policy';
	});
	afterEach(() => {
		global.fetch = realFetch;
		Object.assign(config.relay, saved);
	});

	function answer(body) {
		global.fetch = jest.fn(async () => ({ ok: true, json: async () => body }));
	}

	test('a route is read into upstream.routeId', async () => {
		answer({ ok: true, server_id: 'vm-1', upstream: { kind: 'relay', route_id: 'rly-home' } });
		const policy = await fetchForwardPolicy('gamlabio.home.vome.io');
		expect(policy.upstream).toEqual({ kind: 'relay', target: null, routeId: 'rly-home' });
	});

	test('no route is null', async () => {
		answer({ ok: true, server_id: 'rly-1', upstream: { kind: 'relay' } });
		const policy = await fetchForwardPolicy('x.home.vome.io');
		expect(policy.upstream.routeId).toBeNull();
	});
});

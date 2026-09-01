/**
 * Unit tests for the access-event emitter.
 *
 * The properties that matter are the ones that keep a customer's log readable
 * and this process healthy while somebody is attacking one of our homes:
 * repeats merge, the queue is bounded, a failed post is dropped rather than
 * retried forever, and recording never throws into a request path.
 */
const { createAccessEvents, mergeKey } = require('../../../src/utils/accessEvents');

function emitter(overrides = {}) {
	const posted = [];
	const events = createAccessEvents({
		url: 'https://vome.io/api/internal/relay/access-events',
		secret: 'internal-secret',
		flushMs: 60000, // tests flush by hand
		queueMax: 5,
		batchMax: 3,
		fetch: async (_url, options) => {
			posted.push(JSON.parse(options.body));
			return { ok: true, status: 200 };
		},
		...overrides
	});
	return { events, posted };
}

const failure = (over = {}) => ({
	serverId: 'srv-1',
	event: 'login_failed',
	clientIp: '203.0.113.9',
	host: 'gamlabio.home.vome.io',
	...over
});

afterEach(() => {
	jest.restoreAllMocks();
});

describe('recording', () => {
	test('merges repeats into one line with a count', async () => {
		const { events, posted } = emitter();
		for (let i = 0; i < 40; i += 1) {
			events.record(failure());
		}
		await events.flush();
		expect(posted[0].events).toHaveLength(1);
		expect(posted[0].events[0].count).toBe(40);
		events.stop();
	});

	test('a different address is a different line', async () => {
		const { events, posted } = emitter();
		events.record(failure({ clientIp: '203.0.113.9' }));
		events.record(failure({ clientIp: '198.51.100.4' }));
		await events.flush();
		expect(posted[0].events).toHaveLength(2);
		events.stop();
	});

	test('the queue is bounded — a flood cannot grow memory without limit', () => {
		const { events } = emitter();
		for (let i = 0; i < 50; i += 1) {
			events.record(failure({ clientIp: `203.0.113.${i}` }));
		}
		expect(events._queue.size).toBe(5); // queueMax
		events.stop();
	});

	test('refuses events with no home or no name', () => {
		const { events } = emitter();
		expect(events.record({ event: 'login_failed' })).toBe(false);
		expect(events.record({ serverId: 'srv-1' })).toBe(false);
		expect(events._queue.size).toBe(0);
		events.stop();
	});

	test('does nothing at all when reporting is not configured', () => {
		const { events } = emitter({ url: '', secret: '' });
		expect(events.enabled()).toBe(false);
		expect(events.record(failure())).toBe(false);
		events.stop();
	});
});

describe('flushing', () => {
	test('posts to the portal with the shared secret', async () => {
		const calls = [];
		const { events } = emitter({
			fetch: async (url, options) => {
				calls.push({ url, options });
				return { ok: true, status: 200 };
			}
		});
		events.record(failure());
		await events.flush();
		expect(calls[0].url).toContain('/api/internal/relay/access-events');
		expect(calls[0].options.headers.Authorization).toBe('Bearer internal-secret');
		events.stop();
	});

	test('sends at most one batch per flush and keeps the rest queued', async () => {
		const { events, posted } = emitter();
		for (let i = 0; i < 5; i += 1) {
			events.record(failure({ clientIp: `203.0.113.${i}` }));
		}
		await events.flush();
		expect(posted[0].events).toHaveLength(3); // batchMax
		expect(events._queue.size).toBe(2);
		events.stop();
	});

	test('a failed post is dropped, never requeued', async () => {
		// The portal being down must not turn into a growing backlog aimed at
		// it — that is how a small outage becomes a large one.
		const { events } = emitter({
			fetch: async () => { throw new Error('connect ECONNREFUSED'); }
		});
		events.record(failure());
		await events.flush();
		expect(events._queue.size).toBe(0);
		events.stop();
	});

	test('a rejection is dropped too', async () => {
		const { events } = emitter({ fetch: async () => ({ ok: false, status: 401 }) });
		events.record(failure());
		expect(await events.flush()).toBe(0);
		expect(events._queue.size).toBe(0);
		events.stop();
	});

	test('flushing an empty queue posts nothing', async () => {
		const { events, posted } = emitter();
		expect(await events.flush()).toBe(0);
		expect(posted).toHaveLength(0);
		events.stop();
	});
});

describe('mergeKey', () => {
	test('groups by home, source, event, address and host', () => {
		const base = {
			server_id: 'srv-1', source: 'edge', event: 'login_failed',
			client_ip: '203.0.113.9', host: 'gamlabio.home.vome.io'
		};
		expect(mergeKey(base)).toBe(mergeKey({ ...base, path: '/auth/token' }));
		expect(mergeKey(base)).not.toBe(mergeKey({ ...base, source: 'home' }));
		expect(mergeKey(base)).not.toBe(mergeKey({ ...base, client_ip: '198.51.100.4' }));
	});
});

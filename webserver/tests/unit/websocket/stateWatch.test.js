/**
 * Live states for a dashboard: a watch started on the home's component, a
 * reader that waits here for the next change, and a token that names one watch
 * on one home. A fake RelayManager stands in for the component socket.
 */
const { StateWatchJobs } = require('../../../src/websocket/stateWatch');
const watchToken = require('../../../src/utils/watchToken');

function fakeManager({ online = true } = {}) {
	return {
		online,
		opened: [],
		closed: [],
		tunnels: new Map(),
		registerTunnel(socketId, serverId, handlers) {
			this.tunnels.set(socketId, handlers);
		},
		unregisterTunnel(socketId) {
			this.tunnels.delete(socketId);
		},
		openWs(serverId, payload) {
			this.opened.push({ serverId, payload });
			return this.online;
		},
		closeWs(serverId, payload) {
			this.closed.push({ serverId, payload });
			return true;
		}
	};
}

const frame = (event, states) => ({ text: JSON.stringify({ event, states }) });

describe('StateWatchJobs', () => {
	test('asks the component to watch only entity ids', () => {
		expect(StateWatchJobs.entitiesOrError(['light.kitchen_2', '../x', 'light.kitchen_2', 7]).ids).toEqual(['light.kitchen_2']);
		expect(StateWatchJobs.entitiesOrError(['../x']).error).toBeTruthy();
		const manager = fakeManager();
		const jobs = new StateWatchJobs(manager);
		jobs.start('rly-1', ['light.kitchen_2']);
		expect(manager.opened[0].payload).toEqual(expect.objectContaining({ target: 'states', entityIds: ['light.kitchen_2'] }));
	});

	test('a first read gets every state; a later one waits for the next change and gets just that', async () => {
		const manager = fakeManager();
		const jobs = new StateWatchJobs(manager);
		const { jobId } = jobs.start('rly-1', ['light.kitchen_2', 'switch.socket']);
		const handlers = manager.tunnels.get(jobId);
		handlers.onData(frame('snapshot', [{ entity_id: 'light.kitchen_2', state: 'on' }, { entity_id: 'switch.socket', state: 'off' }]));
		const first = await jobs.read(jobId, 'rly-1', 0, 0);
		expect(first.full).toBe(true);
		expect(first.states.map((s) => s.state)).toEqual(['on', 'off']);

		const waiting = jobs.read(jobId, 'rly-1', first.cursor, 5000);
		handlers.onData(frame('states', [{ entity_id: 'light.kitchen_2', state: 'off' }]));
		const next = await waiting;
		expect(next.full).toBe(false);
		expect(next.states).toEqual([{ entity_id: 'light.kitchen_2', state: 'off' }]);
	});

	test('ignores states for entities it was not asked to watch', async () => {
		const manager = fakeManager();
		const jobs = new StateWatchJobs(manager);
		const { jobId } = jobs.start('rly-1', ['light.kitchen_2']);
		manager.tunnels.get(jobId).onData(frame('states', [{ entity_id: 'lock.front_door', state: 'unlocked' }]));
		expect((await jobs.read(jobId, 'rly-1', 0, 0)).states).toEqual([]);
	});

	test("one home's watch is not another's", async () => {
		const jobs = new StateWatchJobs(fakeManager());
		const { jobId } = jobs.start('rly-1', ['light.kitchen_2']);
		expect(await jobs.read(jobId, 'rly-2', 0, 0)).toBe(null);
		expect(jobs.isAlive(jobId, 'rly-2')).toBe(false);
		expect(jobs.cancel(jobId, 'rly-2')).toBe(false);
	});

	test('a watch nobody reads is closed at the home', () => {
		const manager = fakeManager();
		const jobs = new StateWatchJobs(manager);
		const { jobId } = jobs.start('rly-1', ['light.kitchen_2']);
		jobs.sweep(Date.now() + 4 * 60 * 1000);
		expect(manager.closed[0]).toEqual({ serverId: 'rly-1', payload: expect.objectContaining({ socketId: jobId }) });
		expect(jobs.isAlive(jobId, 'rly-1')).toBe(false);
	});

	test('a home holds a bounded number of watches', () => {
		const jobs = new StateWatchJobs(fakeManager());
		for (let i = 0; i < 10; i++) jobs.start('rly-1', ['light.kitchen_2']);
		expect(jobs.start('rly-1', ['light.kitchen_2']).busy).toBe(true);
	});
});

describe('watch tokens', () => {
	const later = Math.floor(Date.now() / 1000) + 300;
	test('name one watch on one home until they expire', () => {
		const token = watchToken.sign('secret', 'job-1', 'rly-1', later);
		expect(watchToken.verify('secret', token)).toEqual({ jobId: 'job-1', serverId: 'rly-1' });
		expect(watchToken.verify('other', token)).toBe(null);
		expect(watchToken.verify('secret', token.replace('rly-1', 'rly-2'))).toBe(null);
		expect(watchToken.verify('secret', watchToken.sign('secret', 'job-1', 'rly-1', Math.floor(Date.now() / 1000) - 1))).toBe(null);
		expect(watchToken.verify('', token)).toBe(null);
	});
});

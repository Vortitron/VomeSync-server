/**
 * Unit tests for brokered ESPHome build/log streams.
 *
 * These are what let a remote agent flash a device and read its logs through the
 * relay instead of reaching the dashboard directly — the path that keeps scope
 * checks and the audit log in front of every build. A fake RelayManager stands
 * in for the component socket.
 */
const { EsphomeStreamJobs } = require('../../../src/websocket/esphomeStream');

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

function line(data) {
	return { text: JSON.stringify({ event: 'line', data }) };
}
function exit(code) {
	return { text: JSON.stringify({ event: 'exit', code }) };
}

describe('EsphomeStreamJobs.policyError', () => {
	it('refuses a command the dashboard does not have', () => {
		expect(EsphomeStreamJobs.policyError({ command: 'rm', configuration: 'a.yaml' }))
			.toMatch(/unsupported esphome command/);
	});

	it('refuses a configuration that is not a plain filename', () => {
		for (const bad of ['../secrets.yaml', 'a b.yaml', '', 'x'.repeat(200), null]) {
			expect(EsphomeStreamJobs.policyError({ command: 'compile', configuration: bad }))
				.toMatch(/plain filename/);
		}
	});

	it('accepts a well-formed request', () => {
		expect(EsphomeStreamJobs.policyError({ command: 'upload', configuration: 'living-room.yaml' }))
			.toBeNull();
	});
});

describe('EsphomeStreamJobs', () => {
	it('asks the component for an esphome target rather than a path', () => {
		const manager = fakeManager();
		const jobs = new EsphomeStreamJobs(manager);

		const { jobId } = jobs.start('rly-1', { command: 'compile', configuration: 'lr.yaml' });

		expect(jobId).toBeTruthy();
		expect(manager.opened[0].serverId).toBe('rly-1');
		expect(manager.opened[0].payload).toMatchObject({
			socketId: jobId,
			target: 'esphome',
			command: 'compile',
			configuration: 'lr.yaml'
		});
	});

	it('reports offline and leaves no job behind when nothing is connected', () => {
		const manager = fakeManager({ online: false });
		const jobs = new EsphomeStreamJobs(manager);

		expect(jobs.start('rly-1', { command: 'compile', configuration: 'lr.yaml' }).offline).toBe(true);
		expect(manager.tunnels.size).toBe(0);
		expect(jobs.jobs.size).toBe(0);
	});

	it('accumulates output and finishes on the exit frame', () => {
		const manager = fakeManager();
		const jobs = new EsphomeStreamJobs(manager);
		const { jobId } = jobs.start('rly-1', { command: 'compile', configuration: 'lr.yaml' });
		const handlers = manager.tunnels.get(jobId);

		handlers.onData(line('Compiling\n'));
		handlers.onData(line('Linking\n'));
		const mid = jobs.read(jobId, 0);
		expect(mid.lines).toEqual(['Compiling\n', 'Linking\n']);
		expect(mid.done).toBe(false);

		handlers.onData(exit(0));
		const end = jobs.read(jobId, mid.cursor);
		expect(end.lines).toEqual([]);
		expect(end.done).toBe(true);
		expect(end.exit_code).toBe(0);
	});

	it('returns only what is new for a given cursor', () => {
		const manager = fakeManager();
		const jobs = new EsphomeStreamJobs(manager);
		const { jobId } = jobs.start('rly-1', { command: 'logs', configuration: 'lr.yaml' });
		const handlers = manager.tunnels.get(jobId);

		handlers.onData(line('a'));
		const first = jobs.read(jobId, 0);
		handlers.onData(line('b'));
		const second = jobs.read(jobId, first.cursor);

		expect(first.lines).toEqual(['a']);
		expect(second.lines).toEqual(['b']);
		expect(second.cursor).toBe(2);
	});

	it('keeps a finished job until its reader has caught up, then drops it', () => {
		const manager = fakeManager();
		const jobs = new EsphomeStreamJobs(manager);
		const { jobId } = jobs.start('rly-1', { command: 'compile', configuration: 'lr.yaml' });
		const handlers = manager.tunnels.get(jobId);

		handlers.onData(line('only line'));
		handlers.onData(exit(0));

		// The last poll must still see the output — otherwise every build would
		// race the cleanup and lose its tail.
		const final = jobs.read(jobId, 0);
		expect(final.lines).toEqual(['only line']);
		expect(final.done).toBe(true);
		expect(jobs.read(jobId, final.cursor)).toBeNull();
	});

	it('records an error when the dashboard closes before reporting an exit', () => {
		const manager = fakeManager();
		const jobs = new EsphomeStreamJobs(manager);
		const { jobId } = jobs.start('rly-1', { command: 'upload', configuration: 'lr.yaml' });

		manager.tunnels.get(jobId).onClose({ code: 1011, reason: 'ESPHome add-on is not running.' });

		const result = jobs.read(jobId, 0);
		expect(result.done).toBe(true);
		expect(result.error).toMatch(/not running/);
	});

	it('keeps unparseable frames rather than dropping build output', () => {
		const manager = fakeManager();
		const jobs = new EsphomeStreamJobs(manager);
		const { jobId } = jobs.start('rly-1', { command: 'compile', configuration: 'lr.yaml' });

		manager.tunnels.get(jobId).onData({ text: 'not json at all' });

		expect(jobs.read(jobId, 0).lines).toEqual(['not json at all']);
	});

	it('caps captured output so a boot-looping device cannot grow it without bound', () => {
		const manager = fakeManager();
		const jobs = new EsphomeStreamJobs(manager);
		const { jobId } = jobs.start('rly-1', { command: 'logs', configuration: 'lr.yaml' });
		const handlers = manager.tunnels.get(jobId);

		for (let i = 0; i < 20050; i++) {
			handlers.onData(line(`line ${i}\n`));
		}

		const result = jobs.read(jobId, 0);
		expect(result.truncated).toBe(true);
		expect(result.lines.length).toBe(20000);
	});

	it('cancels a job whose reader has gone away', () => {
		const manager = fakeManager();
		const jobs = new EsphomeStreamJobs(manager);
		const { jobId } = jobs.start('rly-1', { command: 'logs', configuration: 'lr.yaml' });

		// Six minutes with no poll: the caller is gone, so the socket must not
		// stay open on the component.
		jobs.sweep(Date.now() + 6 * 60 * 1000);

		expect(manager.closed[0].payload.socketId).toBe(jobId);
		expect(jobs.jobs.size).toBe(0);
	});

	it('cancel closes the component side and forgets the job', () => {
		const manager = fakeManager();
		const jobs = new EsphomeStreamJobs(manager);
		const { jobId } = jobs.start('rly-1', { command: 'compile', configuration: 'lr.yaml' });

		expect(jobs.cancel(jobId)).toBe(true);
		expect(manager.closed[0].payload.socketId).toBe(jobId);
		expect(jobs.cancel(jobId)).toBe(false);
	});
});

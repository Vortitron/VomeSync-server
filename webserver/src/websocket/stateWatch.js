/**
 * Live states for a dashboard, over the relay.
 *
 * A dashboard pane showed a home's lights by polling their states every few
 * seconds through the portal: each poll a brokered call counted against the
 * key, a press still seen late, and four synchronous portal workers tied up
 * by whoever was waiting. A watch instead asks the component (inside Home
 * Assistant, on the outbound link every home has, relay-linked or hosted) to
 * send each change to the entities it names; this process keeps the latest
 * state of each and a short numbered log of changes, and a reader waits here,
 * in Node, for the next one. Nothing waits in the portal.
 *
 * Who may read is the portal's decision, made once per token: it checks the
 * key (ha:read on that home) before it starts a watch or signs a token for one,
 * and a token names one watch on one home until it expires (see watchToken.js).
 * The component accepts only entity ids, and reads states through Home
 * Assistant's own events: a watch can report states, never change them.
 *
 * Like the ESPHome jobs, state is in memory: a watch means nothing once this
 * process no longer holds the component's socket.
 */
const { v4: uuidv4 } = require('uuid');
const logger = require('../utils/logger');

const ENTITY_RE = /^[a-z0-9_]+\.[a-z0-9_]+$/;
const MAX_ENTITIES = 200;
// Per home: a few panes and agents, not an unbounded number.
const MAX_WATCHES_PER_SERVER = 10;
// A watch nobody has read for this long has lost its reader: close it at the home.
const IDLE_TTL_MS = 3 * 60 * 1000;
// Changes kept for readers that fall behind; one further back gets the whole current picture.
const MAX_CHANGES = 2000;
// The longest a read waits for a change before answering empty.
const MAX_WAIT_MS = 25 * 1000;
const SWEEP_INTERVAL_MS = 30 * 1000;

class StateWatchJobs {
	constructor(manager) {
		this.manager = manager;
		this.jobs = new Map();
		this.sweeper = null;
	}

	/** The entity ids worth watching, or an error string. */
	static entitiesOrError(entityIds) {
		if (!Array.isArray(entityIds) || entityIds.length === 0) {
			return { error: 'entity_ids must be a non-empty list' };
		}
		const ids = [...new Set(entityIds.filter((e) => typeof e === 'string' && ENTITY_RE.test(e)))].slice(0, MAX_ENTITIES);
		return ids.length > 0 ? { ids } : { error: 'no valid entity ids' };
	}

	start(serverId, entityIds) {
		const running = [...this.jobs.values()].filter((j) => j.serverId === serverId && !j.done);
		if (running.length >= MAX_WATCHES_PER_SERVER) {
			return { busy: true };
		}
		const jobId = uuidv4();
		const now = Date.now();
		const job = {
			jobId,
			serverId,
			entityIds,
			latest: new Map(),
			changes: [],
			seq: 0,
			snapshotSeq: 0,
			done: false,
			error: null,
			startedAt: now,
			lastReadAt: now,
			waiters: new Set()
		};
		this.jobs.set(jobId, job);
		this.manager.registerTunnel(jobId, serverId, {
			onAck: () => {},
			onData: (data) => this._onData(job, data),
			onClose: (data) => this._onClose(job, data)
		});
		const sent = this.manager.openWs(serverId, { socketId: jobId, target: 'states', entityIds });
		if (!sent) {
			this.manager.unregisterTunnel(jobId);
			this.jobs.delete(jobId);
			return { offline: true };
		}
		this._startSweeper();
		logger.info(`State watch of ${entityIds.length} entities started for ${serverId} (job ${jobId})`);
		return { jobId };
	}

	/** Whether this watch is running for this home: a renewal must not adopt someone else's. */
	isAlive(jobId, serverId) {
		const job = this.jobs.get(jobId);
		return !!job && !job.done && job.serverId === serverId;
	}

	_onData(job, data) {
		const text = data && typeof data.text === 'string' ? data.text : null;
		if (!text || job.done) {
			return;
		}
		let frame;
		try {
			frame = JSON.parse(text);
		} catch (_err) {
			return;
		}
		const states = Array.isArray(frame && frame.states) ? frame.states : [];
		for (const one of states) {
			if (!one || typeof one.entity_id !== 'string' || !job.entityIds.includes(one.entity_id)) {
				continue;
			}
			job.seq += 1;
			job.latest.set(one.entity_id, one);
			job.changes.push({ seq: job.seq, state: one });
		}
		if (frame && frame.event === 'snapshot') {
			job.snapshotSeq = job.seq;
		}
		if (job.changes.length > MAX_CHANGES) {
			job.changes.splice(0, job.changes.length - MAX_CHANGES);
		}
		this._wake(job);
	}

	_onClose(job, data) {
		job.done = true;
		job.error = (data && data.reason) || 'The home closed the watch.';
		this.manager.unregisterTunnel(job.jobId);
		this._wake(job);
	}

	_wake(job) {
		for (const wake of job.waiters) {
			wake();
		}
		job.waiters.clear();
	}

	/**
	 * Changes after `cursor`, waiting up to `waitMs` for one if there are none.
	 * Cursor 0, or one older than the changes kept, gets every entity's current
	 * state (`full: true`). Null for an unknown watch or another home's.
	 */
	async read(jobId, serverId, cursor, waitMs) {
		const job = this.jobs.get(jobId);
		if (!job || job.serverId !== serverId) {
			return null;
		}
		job.lastReadAt = Date.now();
		const answer = () => {
			const oldest = job.changes.length > 0 ? job.changes[0].seq : job.seq + 1;
			if (cursor <= 0 || cursor < oldest - 1) {
				return { cursor: job.seq, full: true, states: [...job.latest.values()], done: job.done, error: job.error };
			}
			const states = job.changes.filter((c) => c.seq > cursor).map((c) => c.state);
			return { cursor: job.seq, full: false, states, done: job.done, error: job.error };
		};
		const now = answer();
		if (now.states.length > 0 || job.done || waitMs <= 0) {
			return now;
		}
		await new Promise((resolve) => {
			const timer = setTimeout(resolve, Math.min(waitMs, MAX_WAIT_MS));
			job.waiters.add(() => {
				clearTimeout(timer);
				resolve();
			});
		});
		job.lastReadAt = Date.now();
		return answer();
	}

	cancel(jobId, serverId) {
		const job = this.jobs.get(jobId);
		if (!job || job.serverId !== serverId) {
			return false;
		}
		this._end(job, 'cancelled');
		return true;
	}

	_end(job, reason) {
		if (!job.done) {
			this.manager.closeWs(job.serverId, { socketId: job.jobId, code: 1000, reason });
		}
		job.done = true;
		this.manager.unregisterTunnel(job.jobId);
		this._wake(job);
		this.jobs.delete(job.jobId);
	}

	sweep(now = Date.now()) {
		for (const job of this.jobs.values()) {
			if (now - job.lastReadAt > IDLE_TTL_MS) {
				logger.info(`State watch ${job.jobId} for ${job.serverId} idle; closing`);
				this._end(job, 'idle');
			}
		}
	}

	_startSweeper() {
		if (this.sweeper) {
			return;
		}
		this.sweeper = setInterval(() => this.sweep(), SWEEP_INTERVAL_MS);
		if (typeof this.sweeper.unref === 'function') {
			this.sweeper.unref();
		}
	}
}

module.exports = { StateWatchJobs, MAX_WAIT_MS };

/**
 * Brokered ESPHome build/log streams.
 *
 * The ESPHome dashboard runs its long commands (validate/compile/upload/logs/
 * clean) over WebSocket channels, which the request/response `ha_rpc` path
 * cannot carry. The relay *can* carry them — `ws_open`/`ws_data`/`ws_close`
 * already bridge arbitrary sockets for the full-UI proxy and LAN TCP tunnels —
 * but a compile runs for minutes, far longer than any HTTP hop between the
 * portal and here should be held open.
 *
 * So a stream is modelled as a **job**: start it, then poll it. The relay holds
 * the socket and accumulates output; callers read from a cursor and get
 * whatever has arrived. That survives a timeout at any hop, needs no streaming
 * plumbing through nginx or the portal, and matches how the consuming MCP tool
 * already behaves — it buffers the whole build log and returns it once.
 *
 * Job state is in memory on purpose: it is only meaningful while this process
 * holds the component's WebSocket, which is exactly the lifetime of
 * `RelayManager.connections`. Nothing here outlives a reconnect, and nothing
 * needs to.
 */
const { v4: uuidv4 } = require('uuid');
const logger = require('../utils/logger');

// Mirrors ESPHOME_STREAM_COMMANDS in the component's const.py. Checked here too
// so the relay refuses what the component would refuse — a stale or modified
// component is never the only guard.
const ESPHOME_STREAM_COMMANDS = new Set(['validate', 'compile', 'upload', 'logs', 'clean']);
const CONFIG_RE = /^[A-Za-z0-9._-]{1,128}$/;

// A full clean build of a large config is the worst case worth supporting.
const JOB_TTL_MS = 20 * 60 * 1000;
// A job nobody has polled for this long has lost its reader; drop it so an
// abandoned `logs` stream cannot pin a socket open indefinitely.
const IDLE_TTL_MS = 5 * 60 * 1000;
// Caps on one job's captured output, so a device stuck in a boot loop cannot
// grow a buffer without bound.
const MAX_LINES = 20000;
const MAX_BYTES = 4 * 1024 * 1024;
const SWEEP_INTERVAL_MS = 30 * 1000;

// Signatures of a component too old to know the `esphome` ws_open target. It
// refuses the sentinel path by name (relayManager.ESPHOME_SENTINEL_PATH) rather
// than mis-routing the request, and these are the two ways it says so.
const OLD_COMPONENT_SIGNATURES = [
	/WebSocket path not permitted/i,
	/Full-UI forwarding is disabled/i,
];

// ESPHome split its dashboard out into `esphome-device-builder`, which replaced
// the per-command WebSockets with a single multiplexed /ws API. Components from
// the brief window that still spoke the old protocol reach a path that now
// serves the single-page app, so the upgrade comes back 200 instead of 101.
const MISSING_ENDPOINT_SIGNATURE = /Local WebSocket error:\s*200/i;

/**
 * Turn a close reason into something the person reading it can act on.
 *
 * Version skew is the case worth naming: everything else about the request is
 * correct, and "the dashboard closed the connection" sends people looking at
 * their ESPHome add-on when the answer is to update Vome.
 */
function describeStreamClose(reason, command) {
	if (MISSING_ENDPOINT_SIGNATURE.test(reason)) {
		return (
			`This home's Vome add-on talks to ESPHome the old way, and the dashboard no ` +
			`longer answers there ('/${command}' now serves the web app rather than a ` +
			'socket). Update the Vome add-on to 0.3.30 or later, then restart Home ' +
			'Assistant (an add-on update alone does not reload the integration).'
		);
	}
	if (OLD_COMPONENT_SIGNATURES.some((re) => re.test(reason))) {
		return (
			"This home's Vome add-on is too old to run ESPHome commands over the relay. " +
			'Update the Vome add-on to 0.3.29 or later, then restart Home Assistant ' +
			'(an add-on update alone does not reload the integration).'
		);
	}
	return reason || 'The ESPHome dashboard closed the connection before the command finished.';
}

class EsphomeStreamJobs {
	constructor(manager) {
		this.manager = manager;
		this.jobs = new Map();
		this.sweeper = null;
	}

	/** Validate a start request. Returns an error string, or null when acceptable. */
	static policyError({ command, configuration } = {}) {
		if (!ESPHOME_STREAM_COMMANDS.has(command)) {
			return `unsupported esphome command: ${String(command)}`;
		}
		if (typeof configuration !== 'string' || !CONFIG_RE.test(configuration)) {
			return 'configuration must be a plain filename, e.g. living-room.yaml';
		}
		return null;
	}

	_startSweeper() {
		if (this.sweeper) {
			return;
		}
		this.sweeper = setInterval(() => this.sweep(), SWEEP_INTERVAL_MS);
		// Never hold the process open just to expire jobs.
		if (typeof this.sweeper.unref === 'function') {
			this.sweeper.unref();
		}
	}

	/**
	 * Ask the component to spawn one ESPHome command and start collecting its
	 * output. Returns `{ jobId }`, or `{ offline: true }` when no component is
	 * connected for this server.
	 */
	start(serverId, { command, configuration, port } = {}) {
		const jobId = uuidv4();
		const now = Date.now();
		const job = {
			jobId,
			serverId,
			command,
			configuration,
			lines: [],
			bytes: 0,
			truncated: false,
			exitCode: null,
			done: false,
			error: null,
			startedAt: now,
			lastReadAt: now
		};
		this.jobs.set(jobId, job);

		this.manager.registerTunnel(jobId, serverId, {
			onAck: () => {},
			onData: (data) => this._onData(job, data),
			onClose: (data) => this._onClose(job, data)
		});

		const sent = this.manager.openWs(serverId, {
			socketId: jobId,
			target: 'esphome',
			command,
			configuration,
			port
		});
		if (!sent) {
			this.manager.unregisterTunnel(jobId);
			this.jobs.delete(jobId);
			return { offline: true };
		}
		this._startSweeper();
		logger.info(`ESPHome ${command} ${configuration} started for ${serverId} (job ${jobId})`);
		return { jobId };
	}

	/**
	 * The dashboard speaks `{event:"line"}` frames terminated by
	 * `{event:"exit"}`. Anything unparseable is kept as a raw line rather than
	 * dropped — build output is the whole point, and a frame we failed to
	 * understand is still evidence.
	 */
	_onData(job, data) {
		if (job.done) {
			return;
		}
		const text = data && typeof data.text === 'string' ? data.text : null;
		if (text === null) {
			return;
		}
		let frame = null;
		try {
			frame = JSON.parse(text);
		} catch (_err) {
			this._append(job, text);
			return;
		}
		if (frame && frame.event === 'line' && typeof frame.data === 'string') {
			this._append(job, frame.data);
		} else if (frame && frame.event === 'exit') {
			job.exitCode = typeof frame.code === 'number' ? frame.code : null;
			this._finish(job);
		}
	}

	_append(job, line) {
		if (job.lines.length >= MAX_LINES || job.bytes >= MAX_BYTES) {
			job.truncated = true;
			return;
		}
		job.lines.push(line);
		job.bytes += Buffer.byteLength(line, 'utf8');
	}

	_onClose(job, data) {
		// A close before the exit frame means the command did not report a
		// result — the dashboard refused it, the add-on went away, or the home
		// is running a component that predates ESPHome streaming.
		if (!job.done && job.exitCode === null) {
			const reason = data && data.reason ? String(data.reason) : '';
			job.error = describeStreamClose(reason, job.command);
		}
		this._finish(job);
	}

	_finish(job) {
		if (job.done) {
			return;
		}
		job.done = true;
		this.manager.unregisterTunnel(job.jobId);
	}

	/**
	 * Read output from `cursor` onward. Returns null when the job is unknown, or
	 * when it belongs to a different server.
	 *
	 * The `serverId` check is the authorisation, not a sanity check: the portal
	 * verifies the caller owns the *instance* in the URL, but the job id is a
	 * separate namespace it cannot vouch for. Without matching the two, anyone
	 * holding a job id could read another home's build output through their own
	 * instance. Job ids are unguessable, which is obscurity, not access control.
	 */
	read(jobId, cursor = 0, serverId = null) {
		const job = this.jobs.get(jobId);
		if (!job || (serverId !== null && job.serverId !== serverId)) {
			return null;
		}
		job.lastReadAt = Date.now();
		const from = Number.isInteger(cursor) && cursor > 0 ? Math.min(cursor, job.lines.length) : 0;
		const lines = job.lines.slice(from);
		// A finished job is kept until the reader has caught up, then dropped —
		// otherwise the last poll of every build would race the sweeper.
		if (job.done && from + lines.length >= job.lines.length) {
			this.jobs.delete(jobId);
		}
		return {
			lines,
			cursor: from + lines.length,
			done: job.done,
			exit_code: job.exitCode,
			truncated: job.truncated,
			error: job.error,
			command: job.command,
			configuration: job.configuration
		};
	}

	/** Stop a job and tell the component to close its side. Scoped like `read`. */
	cancel(jobId, serverId = null) {
		const job = this.jobs.get(jobId);
		if (!job || (serverId !== null && job.serverId !== serverId)) {
			return false;
		}
		this.manager.closeWs(job.serverId, { socketId: jobId, code: 1000, reason: 'cancelled' });
		this.manager.unregisterTunnel(jobId);
		this.jobs.delete(jobId);
		return true;
	}

	/** Expire jobs that ran too long or lost their reader. */
	sweep(now = Date.now()) {
		for (const [jobId, job] of this.jobs.entries()) {
			const tooOld = now - job.startedAt > JOB_TTL_MS;
			const abandoned = now - job.lastReadAt > IDLE_TTL_MS;
			if (tooOld || abandoned) {
				logger.warn(
					`ESPHome job ${jobId} expired (${tooOld ? 'ran too long' : 'no reader'})`
				);
				this.cancel(jobId);
			}
		}
	}
}

module.exports = { EsphomeStreamJobs, ESPHOME_STREAM_COMMANDS, describeStreamClose };

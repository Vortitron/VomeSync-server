/**
 * Telling a customer who reached their home.
 *
 * Home Assistant cannot tell them itself.  Whichever way a request arrives it
 * reaches Core from an address that is not the visitor's — loopback inside the
 * house on the relay path, the container host on the direct one — so Core's
 * "Login attempt or request with invalid authentication from …" notification
 * names a piece of our plumbing.  This proxy holds the only copy of the real
 * address, which makes it the only place the true answer exists, and an answer
 * that stays in a server log the customer cannot read is not an answer.
 *
 * So notable events are posted to the portal, which stores them against the
 * home and shows them to its owner (portal/remote_access_log.py).  Three
 * properties matter more than completeness:
 *
 *   - **Never block a request.**  Recording is a queue push; the network call
 *     happens on a timer, elsewhere.
 *   - **Never grow without bound.**  A scanner can produce events far faster
 *     than we can post them, so the queue is capped and repeats are merged
 *     rather than appended — 4,000 identical failures become one line with a
 *     count, which is also the only form anybody would read.
 *   - **Never retry into a wall.**  A failed post is dropped, not requeued.
 *     The portal being down must not turn into a growing backlog aimed at it.
 */
const logger = require('./logger');
const config = require('../config/config');

/** What makes two events "the same thing happening again". */
function mergeKey(event) {
	return [
		event.server_id, event.source, event.event, event.client_ip || '', event.host || ''
	].join('|');
}

function createAccessEvents(deps = {}) {
	const url = deps.url || config.relay.accessEventsUrl;
	const secret = deps.secret || config.relay.internalSecret;
	const flushMs = deps.flushMs || config.relay.accessEventsFlushMs;
	const queueMax = deps.queueMax || config.relay.accessEventsQueueMax;
	const batchMax = deps.batchMax || config.relay.accessEventsBatchMax;
	const doFetch = deps.fetch || ((...args) => fetch(...args));

	// Insertion-ordered so a flush preserves the order things happened in.
	const queue = new Map();
	let dropped = 0;
	let timer = null;

	function enabled() {
		return Boolean(url && secret);
	}

	/**
	 * Queue one event.  Returns true if it was kept.
	 *
	 * `count` may be greater than one so a caller that has already aggregated
	 * (the login guard's block, say) does not have to call this in a loop.
	 */
	function record(event) {
		if (!enabled() || !event || !event.serverId || !event.event) {
			return false;
		}
		const entry = {
			server_id: String(event.serverId),
			source: event.source || 'edge',
			event: String(event.event),
			outcome: event.outcome || null,
			client_ip: event.clientIp || null,
			host: event.host || null,
			method: event.method || null,
			path: event.path || null,
			user_agent: event.userAgent || null,
			key_id: event.keyId || null,
			detail: event.detail || null,
			count: Math.max(1, parseInt(event.count, 10) || 1),
			at: Math.floor(Date.now() / 1000)
		};
		const key = mergeKey(entry);
		const existing = queue.get(key);
		if (existing) {
			existing.count += entry.count;
			existing.at = entry.at;
			// Keep the newest path/agent: the last thing they tried is more
			// use than the first when reading a burst after the fact.
			existing.path = entry.path || existing.path;
			existing.user_agent = entry.user_agent || existing.user_agent;
			return true;
		}
		if (queue.size >= queueMax) {
			dropped += 1;
			return false;
		}
		queue.set(key, entry);
		start();
		return true;
	}

	/** Post whatever is queued.  Errors are logged and the batch is dropped. */
	async function flush() {
		if (!enabled() || queue.size === 0) {
			return 0;
		}
		const events = Array.from(queue.values()).slice(0, batchMax);
		for (let i = 0; i < events.length; i += 1) {
			queue.delete(mergeKey(events[i]));
		}
		if (dropped) {
			logger.warn(`Dropped ${dropped} access events (queue full)`);
			dropped = 0;
		}
		try {
			const resp = await doFetch(url, {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json',
					Authorization: `Bearer ${secret}`
				},
				body: JSON.stringify({ events }),
				signal: AbortSignal.timeout(config.relay.accessEventsTimeoutMs)
			});
			if (!resp.ok) {
				logger.warn(`Access event post rejected: ${resp.status}`);
				return 0;
			}
		} catch (err) {
			// Deliberately not requeued: see the file comment.
			logger.warn('Access event post failed:', err.message || err);
			return 0;
		}
		return events.length;
	}

	function start() {
		if (timer || !enabled()) {
			return;
		}
		timer = setInterval(() => {
			flush().catch(() => {});
		}, flushMs);
		// The flush timer must never be the reason the process stays alive.
		if (typeof timer.unref === 'function') {
			timer.unref();
		}
	}

	function stop() {
		if (timer) {
			clearInterval(timer);
			timer = null;
		}
	}

	return { record, flush, stop, enabled, _queue: queue };
}

// One shared emitter: the proxy, the login guard and the relay all report the
// same customer-visible stream, and a per-module queue would defeat the
// merging that keeps a scanner's output readable.
let singleton = null;

function getAccessEvents() {
	if (!singleton) {
		singleton = createAccessEvents();
	}
	return singleton;
}

module.exports = { createAccessEvents, getAccessEvents, mergeKey };

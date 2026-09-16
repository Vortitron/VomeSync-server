/**
 * Pull live sources into catalogue entries, then the CLI writes JSON and
 * pushes ON/OFF. A short fetch error leaves that switch's last state
 * alone. Once `observedAt` is older than `staleAfterHours` (default 24),
 * the listing is forced OFF until the feed works again.
 */
const { observeEntry } = require('./sources');
const { observationIsStale } = require('./stale');

function cloneEntry(entry) {
	return {
		...entry,
		schedule: {
			...(entry.schedule || {}),
			params: entry.schedule && entry.schedule.params
				? { ...entry.schedule.params }
				: undefined
		}
	};
}

function applyObservation(entry, seen, now) {
	const next = cloneEntry(entry);
	const previousOn = Boolean(next.schedule.state);
	next.schedule.state = Boolean(seen.on);
	next.schedule.observedAt = now.toISOString();
	const params = {
		...(next.schedule.params || {}),
		...((seen.params && typeof seen.params === 'object') ? seen.params : {})
	};
	delete params.stale;
	delete params.lastError;
	next.schedule.params = Object.keys(params).length ? params : undefined;
	let metaChanged = false;
	for (const field of ['name', 'description', 'onMeans', 'offMeans', 'link']) {
		if (typeof seen[field] === 'string' && seen[field] && seen[field] !== next[field]) {
			next[field] = seen[field];
			metaChanged = true;
		}
	}
	return {
		entry: next,
		changed: previousOn !== Boolean(seen.on) || metaChanged,
		metaChanged,
		on: Boolean(seen.on)
	};
}

function forceStaleOff(entry, error) {
	const next = cloneEntry(entry);
	const previousOn = Boolean(next.schedule.state);
	next.schedule.state = false;
	next.schedule.params = {
		...(next.schedule.params || {}),
		stale: true,
		lastError: error
	};
	return {
		entry: next,
		changed: previousOn !== false,
		on: false
	};
}

async function observeOne(entry, options) {
	const now = options.now || new Date();
	if (!entry.schedule || entry.schedule.kind !== 'observe') {
		return {
			id: entry.id,
			ok: true,
			skipped: true,
			on: Boolean(entry.schedule && entry.schedule.state),
			changed: false,
			metaChanged: false,
			entry
		};
	}
	try {
		const seen = await observeEntry(entry, {
			fetchImpl: options.fetchImpl,
			now
		});
		const applied = applyObservation(entry, seen, now);
		return {
			id: entry.id,
			ok: true,
			skipped: false,
			on: applied.on,
			changed: applied.changed,
			metaChanged: applied.metaChanged,
			entry: applied.entry
		};
	} catch (error) {
		const message = error.message;
		if (observationIsStale(entry.schedule, now)) {
			const forced = forceStaleOff(entry, message);
			return {
				id: entry.id,
				ok: false,
				skipped: false,
				staleOff: true,
				on: forced.on,
				changed: forced.changed,
				metaChanged: false,
				error: message,
				entry: forced.entry
			};
		}
		return {
			id: entry.id,
			ok: false,
			skipped: false,
			on: Boolean(entry.schedule && entry.schedule.state),
			changed: false,
			metaChanged: false,
			error: message,
			entry
		};
	}
}

async function observeCatalogue(options) {
	const now = options.now || new Date();
	const log = options.log || (() => {});
	const entries = options.entries;
	const selected = options.onlyIds && options.onlyIds.length
		? entries.filter((entry) => options.onlyIds.includes(entry.id))
		: entries;
	if (options.onlyIds && options.onlyIds.length && selected.length !== options.onlyIds.length) {
		const have = new Set(selected.map((entry) => entry.id));
		const missing = options.onlyIds.filter((id) => !have.has(id));
		throw new Error(`unknown switch id(s): ${missing.join(', ')}`);
	}

	const replacements = new Map();
	const results = [];
	for (const entry of selected) {
		log(`observe ${entry.id}`);
		const result = await observeOne(entry, { ...options, now });
		replacements.set(entry.id, result.entry);
		results.push({
			id: result.id,
			ok: result.ok,
			skipped: Boolean(result.skipped),
			staleOff: Boolean(result.staleOff),
			on: result.on,
			changed: result.changed,
			metaChanged: result.metaChanged,
			error: result.error || null
		});
		if (!result.ok && result.staleOff) {
			log(`${entry.id}: stale — forced OFF (${result.error})`);
		} else if (!result.ok) {
			log(`${entry.id}: keep last state (${result.error})`);
		} else if (result.skipped) {
			log(`${entry.id}: not a live source`);
		} else {
			log(`${entry.id} → ${result.on ? 'ON' : 'OFF'}${result.metaChanged ? ' (copy updated)' : ''}`);
		}
	}

	return {
		entries: entries.map((entry) => replacements.get(entry.id) || entry),
		results,
		now
	};
}

module.exports = {
	cloneEntry,
	applyObservation,
	forceStaleOff,
	observeOne,
	observeCatalogue
};

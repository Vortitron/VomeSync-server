const CATEGORIES = Object.freeze([
	'Community',
	'Personal',
	'Event',
	'Transport',
	'Government',
	'Holiday',
	'Weather',
	'IsUp',
	'Test',
	'Other'
]);
const ID_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const MAX_NAME_LENGTH = 80;
const MAX_DESCRIPTION_LENGTH = 500;
const MAX_LOCATION_LENGTH = 100;
const MAX_URL_LENGTH = 500;
const { SOURCE_IDS } = require('./sources');
const { MIN_STALE_AFTER_HOURS, MAX_STALE_AFTER_HOURS } = require('./stale');

const SCHEDULE_KINDS = Object.freeze([
	'manual',
	'held',
	'observe',
	'windows',
	'annual',
	'month',
	'month_days',
	'nth_weekday',
	'full_moon'
]);

function assertString(value, field, max) {
	if (typeof value !== 'string') {
		throw new Error(`${field} must be a string`);
	}
	if (value.length > max) {
		throw new Error(`${field} exceeds ${max} characters`);
	}
}

function assertHttpUrl(value, field) {
	assertString(value, field, MAX_URL_LENGTH);
	if (!value) {
		return;
	}
	let parsed;
	try {
		parsed = new URL(value);
	} catch {
		throw new Error(`${field} must be an http(s) URL`);
	}
	if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
		throw new Error(`${field} must be an http(s) URL`);
	}
}

function validateSchedule(schedule, id) {
	if (!schedule || typeof schedule !== 'object') {
		throw new Error(`${id}: schedule is required`);
	}
	if (!SCHEDULE_KINDS.includes(schedule.kind)) {
		throw new Error(`${id}: unknown schedule kind ${schedule.kind}`);
	}
	if (schedule.kind === 'manual' || schedule.kind === 'held' || schedule.kind === 'observe') {
		if (typeof schedule.state !== 'boolean') {
			throw new Error(`${id}: ${schedule.kind} schedule needs a boolean state`);
		}
	}
	if (schedule.kind === 'observe') {
		if (typeof schedule.source !== 'string' || !SOURCE_IDS.includes(schedule.source)) {
			throw new Error(`${id}: observe schedule needs a known source`);
		}
		if (Object.prototype.hasOwnProperty.call(schedule, 'staleAfterHours')) {
			const hours = Number(schedule.staleAfterHours);
			if (!Number.isFinite(hours) || hours < MIN_STALE_AFTER_HOURS || hours > MAX_STALE_AFTER_HOURS) {
				throw new Error(`${id}: staleAfterHours must be ${MIN_STALE_AFTER_HOURS}-${MAX_STALE_AFTER_HOURS}`);
			}
		}
		if (Object.prototype.hasOwnProperty.call(schedule, 'observeEveryMinutes')) {
			const minutes = Number(schedule.observeEveryMinutes);
			if (!Number.isInteger(minutes) || minutes < 1 || minutes > 60) {
				throw new Error(`${id}: observeEveryMinutes must be an integer 1-60`);
			}
		}
	}
	if (schedule.kind === 'windows') {
		if (!Array.isArray(schedule.windows) || schedule.windows.length === 0) {
			throw new Error(`${id}: windows schedule needs windows[]`);
		}
		for (const window of schedule.windows) {
			if (!window || !window.start || !window.end) {
				throw new Error(`${id}: each window needs start and end`);
			}
			if (Number.isNaN(Date.parse(window.start)) || Number.isNaN(Date.parse(window.end))) {
				throw new Error(`${id}: window dates must be ISO-8601`);
			}
		}
	}
	if (schedule.kind === 'annual') {
		if (!Number.isInteger(schedule.month) || schedule.month < 1 || schedule.month > 12) {
			throw new Error(`${id}: annual schedule needs month 1-12`);
		}
		if (!Number.isInteger(schedule.day) || schedule.day < 1 || schedule.day > 31) {
			throw new Error(`${id}: annual schedule needs day 1-31`);
		}
	}
	if (schedule.kind === 'month') {
		if (!Number.isInteger(schedule.month) || schedule.month < 1 || schedule.month > 12) {
			throw new Error(`${id}: month schedule needs month 1-12`);
		}
	}
	if (schedule.kind === 'month_days') {
		const startDay = schedule.startDay;
		const endDay = schedule.endDay;
		if (!Number.isInteger(startDay) || startDay < 1 || startDay > 31) {
			throw new Error(`${id}: month_days needs startDay 1-31`);
		}
		if (!Number.isInteger(endDay) || endDay < 1 || endDay > 31) {
			throw new Error(`${id}: month_days needs endDay 1-31`);
		}
		if (endDay < startDay) {
			throw new Error(`${id}: month_days endDay must be >= startDay`);
		}
	}
	if (schedule.kind === 'nth_weekday') {
		if (!Number.isInteger(schedule.month) || schedule.month < 1 || schedule.month > 12) {
			throw new Error(`${id}: nth_weekday needs month 1-12`);
		}
		if (!Number.isInteger(schedule.weekday) || schedule.weekday < 0 || schedule.weekday > 6) {
			throw new Error(`${id}: nth_weekday needs weekday 0-6 (Sun-Sat)`);
		}
		if (schedule.nth !== 'last' && !Number.isInteger(schedule.nth)) {
			throw new Error(`${id}: nth_weekday needs nth as an integer or "last"`);
		}
	}
	if (schedule.kind === 'full_moon') {
		if (!Array.isArray(schedule.instants) || schedule.instants.length === 0) {
			throw new Error(`${id}: full_moon schedule needs instants[]`);
		}
		for (const instant of schedule.instants) {
			if (Number.isNaN(Date.parse(instant))) {
				throw new Error(`${id}: full_moon instant must be ISO-8601`);
			}
		}
	}
}

function validateEntry(entry, artIds) {
	if (!entry || typeof entry !== 'object') {
		throw new Error('switch entry must be an object');
	}
	assertString(entry.id, 'id', 80);
	if (!ID_PATTERN.test(entry.id)) {
		throw new Error(`${entry.id}: id must be lowercase kebab-case`);
	}
	if (!Number.isInteger(entry.index) || entry.index < 0) {
		throw new Error(`${entry.id}: index must be an integer >= 0`);
	}
	assertString(entry.name, `${entry.id}.name`, MAX_NAME_LENGTH);
	if (!entry.name.trim()) {
		throw new Error(`${entry.id}: name is required`);
	}
	assertString(entry.description, `${entry.id}.description`, MAX_DESCRIPTION_LENGTH);
	if (!entry.description.trim()) {
		throw new Error(`${entry.id}: description is required`);
	}
	assertString(entry.location, `${entry.id}.location`, MAX_LOCATION_LENGTH);
	if (!CATEGORIES.includes(entry.category)) {
		throw new Error(`${entry.id}: category must be one of ${CATEGORIES.join(', ')}`);
	}
	assertHttpUrl(entry.link || '', `${entry.id}.link`);
	assertString(entry.art, `${entry.id}.art`, 80);
	if (artIds && !artIds.has(entry.art)) {
		throw new Error(`${entry.id}: unknown art id ${entry.art}`);
	}
	assertString(entry.onMeans || '', `${entry.id}.onMeans`, MAX_DESCRIPTION_LENGTH);
	assertString(entry.offMeans || '', `${entry.id}.offMeans`, MAX_DESCRIPTION_LENGTH);
	validateSchedule(entry.schedule, entry.id);
	return entry;
}

function validateCatalogue(entries, artIds) {
	if (!Array.isArray(entries)) {
		throw new Error('catalogue must be an array');
	}
	const ids = new Set();
	const indexes = new Set();
	for (const entry of entries) {
		validateEntry(entry, artIds);
		if (ids.has(entry.id)) {
			throw new Error(`duplicate id ${entry.id}`);
		}
		if (indexes.has(entry.index)) {
			throw new Error(`duplicate index ${entry.index} (${entry.id})`);
		}
		ids.add(entry.id);
		indexes.add(entry.index);
	}
	return entries;
}

function nextIndex(entries) {
	if (!Array.isArray(entries) || entries.length === 0) {
		return 0;
	}
	return Math.max(...entries.map((entry) => entry.index)) + 1;
}

function addEntry(entries, spec) {
	const next = {
		...spec,
		index: Number.isInteger(spec.index) ? spec.index : nextIndex(entries)
	};
	const combined = [...entries, next];
	validateCatalogue(combined);
	return combined;
}

module.exports = {
	CATEGORIES,
	ID_PATTERN,
	MAX_NAME_LENGTH,
	MAX_DESCRIPTION_LENGTH,
	MAX_LOCATION_LENGTH,
	SCHEDULE_KINDS,
	validateEntry,
	validateCatalogue,
	nextIndex,
	addEntry
};

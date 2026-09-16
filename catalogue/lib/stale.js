/**
 * Live observers keep the last good ON/OFF through a short outage. After
 * that, a silent feed is more dangerous than a conservative OFF — Tower
 * Bridge once stuck "open" overnight when lift-times failed to fetch.
 *
 * The clock is last successful `observedAt`. A listing that has never
 * fetched successfully is not treated as stale (seed it OFF).
 */
const DEFAULT_STALE_AFTER_HOURS = 24;
const MIN_STALE_AFTER_HOURS = 1;
const MAX_STALE_AFTER_HOURS = 720;
const MS_PER_HOUR = 60 * 60 * 1000;

function staleAfterHours(schedule) {
	const hours = Number(schedule && schedule.staleAfterHours);
	if (Number.isFinite(hours) && hours >= MIN_STALE_AFTER_HOURS) {
		return hours;
	}
	return DEFAULT_STALE_AFTER_HOURS;
}

function observationIsStale(schedule, now = new Date()) {
	if (!schedule || schedule.kind !== 'observe') {
		return false;
	}
	const at = Date.parse(schedule.observedAt || '');
	if (Number.isNaN(at)) {
		return false;
	}
	return now.getTime() - at > staleAfterHours(schedule) * MS_PER_HOUR;
}

module.exports = {
	DEFAULT_STALE_AFTER_HOURS,
	MIN_STALE_AFTER_HOURS,
	MAX_STALE_AFTER_HOURS,
	staleAfterHours,
	observationIsStale
};

/**
 * Desired ON/OFF for a catalogue entry at a point in time.
 *
 * Calendar kinds are UTC unless a window says otherwise. Lunar dates are
 * stored as explicit windows/instants so we do not pretend to sight the moon.
 * Live events use kind `observe`: last fetched state, updated by the timer.
 */
function parseInstant(value) {
	const ms = Date.parse(value);
	if (Number.isNaN(ms)) {
		throw new Error(`invalid timestamp: ${value}`);
	}
	return ms;
}

function utcYmd(date) {
	return {
		year: date.getUTCFullYear(),
		month: date.getUTCMonth() + 1,
		day: date.getUTCDate(),
		weekday: date.getUTCDay()
	};
}

function lastWeekdayOfMonth(year, month, weekday) {
	const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
	const date = new Date(Date.UTC(year, month - 1, lastDay));
	while (date.getUTCDay() !== weekday) {
		date.setUTCDate(date.getUTCDate() - 1);
	}
	return date;
}

function nthWeekdayOfMonth(year, month, weekday, nth) {
	if (nth === 'last') {
		return lastWeekdayOfMonth(year, month, weekday);
	}
	const first = new Date(Date.UTC(year, month - 1, 1));
	const delta = (weekday - first.getUTCDay() + 7) % 7;
	const day = 1 + delta + (nth - 1) * 7;
	return new Date(Date.UTC(year, month - 1, day));
}

function inWindows(now, windows) {
	const t = now.getTime();
	return windows.some((window) => {
		const start = parseInstant(window.start);
		const end = parseInstant(window.end);
		return t >= start && t < end;
	});
}

function onAnnualDay(now, month, day) {
	const parts = utcYmd(now);
	return parts.month === month && parts.day === day;
}

function onNthWeekday(now, schedule) {
	const parts = utcYmd(now);
	const target = nthWeekdayOfMonth(parts.year, schedule.month, schedule.weekday, schedule.nth);
	return parts.month === schedule.month
		&& target.getUTCFullYear() === parts.year
		&& target.getUTCMonth() + 1 === parts.month
		&& target.getUTCDate() === parts.day;
}

function onFullMoonUtcDay(now, instants) {
	const today = utcYmd(now);
	return instants.some((instant) => {
		const at = new Date(parseInstant(instant));
		const parts = utcYmd(at);
		return parts.year === today.year && parts.month === today.month && parts.day === today.day;
	});
}

function desiredState(entry, now = new Date()) {
	const schedule = entry.schedule || { kind: 'manual', state: false };
	switch (schedule.kind) {
		case 'manual':
		case 'held':
		case 'observe':
			return Boolean(schedule.state);
		case 'windows':
			return inWindows(now, schedule.windows);
		case 'annual':
			return onAnnualDay(now, schedule.month, schedule.day);
		case 'month':
			return utcYmd(now).month === schedule.month;
		case 'nth_weekday':
			return onNthWeekday(now, schedule);
		case 'full_moon':
			return onFullMoonUtcDay(now, schedule.instants);
		default:
			throw new Error(`${entry.id}: unknown schedule kind ${schedule.kind}`);
	}
}

function desiredParams(entry) {
	const schedule = entry.schedule || {};
	if (schedule.params && typeof schedule.params === 'object') {
		return { ...schedule.params };
	}
	return {};
}

module.exports = {
	utcYmd,
	lastWeekdayOfMonth,
	nthWeekdayOfMonth,
	desiredState,
	desiredParams
};

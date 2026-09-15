/**
 * Live observers for catalogue switches that are not a UTC calendar.
 *
 * Each source returns { on, params?, name?, description?, onMeans?, offMeans? }.
 * Fetch failures must throw so the caller keeps the last good state.
 */
const { fetchText, fetchJson } = require('./http');

const TOWER_LIFT_MS = 15 * 60 * 1000;
const SWEDEN_POLLS_CLOSE_MS = Date.parse('2026-09-13T18:00:00Z');
const MONTHS = Object.freeze([
	'january', 'february', 'march', 'april', 'may', 'june',
	'july', 'august', 'september', 'october', 'november', 'december'
]);

const OFFICES = Object.freeze({
	'uk-pm': {
		officeId: 'Q14211',
		name: (holder) => `UK Prime Minister: ${holder}`,
		description: (holder) => `ON while ${holder} is Prime Minister. It turns off when the office-holder changes, then the listing is renamed. Source: Wikidata / GOV.UK.`,
		onMeans: (holder) => `${holder} currently holds the office.`,
		offMeans: 'Someone else is Prime Minister, or the office is vacant.',
		link: 'https://www.gov.uk/government/ministers/prime-minister'
	},
	'us-president': {
		officeId: 'Q11696',
		name: (holder) => `US President: ${holder}`,
		description: (holder) => `ON while ${holder} is President of the United States. It turns off on a change of office-holder, then the listing is renamed. Source: Wikidata.`,
		onMeans: (holder) => `${holder} currently holds the office.`,
		offMeans: 'Someone else is President, or the office is vacant.',
		link: 'https://www.whitehouse.gov/'
	},
	pope: {
		officeId: 'Q19546',
		name: (holder) => `Pope: ${holder}`,
		description: (holder) => `ON while ${holder} is Pope. It turns off during a sede vacante or a new pontificate. Pair with the conclave switch for the gap in between.`,
		onMeans: (holder) => `${holder} is the reigning Pope.`,
		offMeans: 'The Holy See is vacant, or another Pope has been elected.',
		link: 'https://www.vatican.va/'
	}
});

function zonedParts(date, timeZone) {
	const fmt = new Intl.DateTimeFormat('en-GB', {
		timeZone,
		year: 'numeric',
		month: 'numeric',
		day: 'numeric',
		weekday: 'long',
		hour: 'numeric',
		minute: 'numeric',
		hourCycle: 'h23'
	});
	const parts = Object.fromEntries(fmt.formatToParts(date).map((part) => [part.type, part.value]));
	return {
		year: Number(parts.year),
		month: Number(parts.month),
		day: Number(parts.day),
		hour: Number(parts.hour),
		minute: Number(parts.minute),
		weekday: String(parts.weekday || '')
	};
}

function monthName(monthNumber) {
	return MONTHS[monthNumber - 1];
}

function stripTags(html) {
	return String(html || '').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();
}

function decodeEntities(text) {
	return String(text || '')
		.replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCharCode(parseInt(hex, 16)))
		.replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
		.replace(/&amp;/g, '&')
		.replace(/&aring;/g, 'å')
		.replace(/&AElig;/g, 'Æ')
		.replace(/&oslash;/g, 'ø');
}

function claimStartMs(claim) {
	const values = (((claim || {}).qualifiers || {}).P580) || [];
	for (const snak of values) {
		const raw = (((snak || {}).datavalue || {}).value || {}).time;
		if (!raw) {
			continue;
		}
		const ms = Date.parse(String(raw).replace(/^\+/, '').replace('-00-00', '-01-01').replace(/T00:00:00Z$/, 'T00:00:00Z'));
		if (!Number.isNaN(ms)) {
			return ms;
		}
	}
	return null;
}

function pickOfficeClaim(claims) {
	const live = (claims || []).filter((claim) => claim && claim.rank !== 'deprecated');
	const preferred = live.filter((claim) => claim.rank === 'preferred');
	const pool = preferred.length ? preferred : live;
	if (pool.length === 0) {
		return null;
	}
	return pool.slice().sort((a, b) => (claimStartMs(b) || 0) - (claimStartMs(a) || 0))[0];
}

function parseTowerLiftTimes(html) {
	const stamps = [];
	const seen = new Set();
	const pattern = /datetime="(\d{10})"/g;
	let match;
	while ((match = pattern.exec(html))) {
		const seconds = Number(match[1]);
		if (!seen.has(seconds)) {
			seen.add(seconds);
			stamps.push(seconds * 1000);
		}
	}
	return stamps;
}

function towerBridgeOpen(html, now) {
	const t = now.getTime();
	return parseTowerLiftTimes(html).some((start) => t >= start && t < start + TOWER_LIFT_MS);
}

function parseCommonsDayType(csv, now) {
	const parts = zonedParts(now, 'Europe/London');
	const needle = `${parts.day},${parts.weekday},`;
	const line = String(csv || '').split(/\r?\n/).find((row) => row.startsWith(needle) || row.startsWith(`${parts.day},`));
	if (!line) {
		return '';
	}
	return line.split(',')[2] || '';
}

function parseHouseSchedule(html, now) {
	const parts = zonedParts(now, 'America/New_York');
	const meta = String(html || '').match(/property="og:description" content="([^"]+)"/i)
		|| String(html || '').match(/name="og:description" content="([^"]+)"/i)
		|| String(html || '').match(/name="twitter:description" content="([^"]+)"/i);
	const blurb = (meta ? meta[1] : html).replace(/\s+/g, ' ');
	const label = `${monthName(parts.month)} ${parts.day}`;
	return new RegExp(label, 'i').test(blurb) && /house will meet/i.test(blurb);
}

function geomagneticFromScales(payload) {
	const current = payload && payload['0'] && payload['0'].G;
	const scale = Number(current && current.Scale);
	return Number.isFinite(scale) ? scale : 0;
}

function storebaeltClosedNow(html) {
	const text = decodeEntities(stripTags(html)).toLowerCase();
	if (/lukket for biltrafik/.test(text) || /broen er lukket/.test(text) || /broen er spærret/.test(text) || /closed to (?:road|car) traffic/.test(text)) {
		return true;
	}
	if (/åben for biltrafik/.test(text) || /aben for biltrafik/.test(text) || /open (?:to|for) (?:road|car) traffic/.test(text)) {
		return false;
	}
	// Wind / weight warnings still mean the crossing is open to cars.
	if (/trafikstatus/.test(text)) {
		return false;
	}
	throw new Error('could not read Storebælt traffic status');
}

function oresundClosedNow(html, now) {
	const text = decodeEntities(stripTags(html));
	const windowMatch = text.match(/closed to motorway traffic in both directions on (\w+ \d+, \d{4}) from (\d{2}:\d{2}) to (\d{2}:\d{2})/i);
	if (windowMatch) {
		const start = Date.parse(`${windowMatch[1]} ${windowMatch[2]} GMT+0200`);
		const end = Date.parse(`${windowMatch[1]} ${windowMatch[3]} GMT+0200`);
		if (!Number.isNaN(start) && !Number.isNaN(end) && now.getTime() >= start && now.getTime() < end) {
			return true;
		}
	}
	if (/open 24 hours a day/.test(text.toLowerCase())) {
		return false;
	}
	throw new Error('could not read Øresund traffic status');
}

async function wikidataOfficeholder(officeId, options) {
	const url = `https://www.wikidata.org/w/api.php?action=wbgetentities&ids=${encodeURIComponent(officeId)}&props=claims&format=json`;
	const data = await fetchJson(url, options);
	const entity = data.entities && data.entities[officeId];
	if (!entity) {
		throw new Error(`Wikidata missing ${officeId}`);
	}
	const claim = pickOfficeClaim((entity.claims || {}).P1308);
	if (!claim) {
		return { qid: '', holder: '', startMs: null };
	}
	const qid = ((((claim.mainsnak || {}).datavalue || {}).value) || {}).id || '';
	if (!qid) {
		return { qid: '', holder: '', startMs: claimStartMs(claim) };
	}
	const labels = await fetchJson(
		`https://www.wikidata.org/w/api.php?action=wbgetentities&ids=${encodeURIComponent(qid)}&props=labels&languages=en&format=json`,
		options
	);
	const holder = ((((labels.entities || {})[qid] || {}).labels || {}).en || {}).value || qid;
	return { qid, holder, startMs: claimStartMs(claim) };
}

function officeResult(spec, holder) {
	if (!holder) {
		return { on: false };
	}
	return {
		on: true,
		name: spec.name(holder),
		description: spec.description(holder),
		onMeans: spec.onMeans(holder),
		offMeans: spec.offMeans,
		params: { holder }
	};
}

async function observeOffice(source, options) {
	const spec = OFFICES[source];
	const seen = await wikidataOfficeholder(spec.officeId, options);
	return officeResult(spec, seen.holder);
}

const OBSERVERS = Object.freeze({
	async 'tower-bridge'(options) {
		const html = await fetchText('https://www.towerbridge.org.uk/flat/lift-times', options);
		const on = towerBridgeOpen(html, options.now);
		return { on, params: { source: 'towerbridge.org.uk/flat/lift-times' } };
	},
	async erasmusbrug(options) {
		const data = await fetchJson('https://isdetunnelopen.nl/api/status/erasmusbrug', options);
		// isOpen true = road traffic can cross, so the span is NOT open to ships.
		const on = data.hasBridgeEvent === true || data.isOpen === false;
		return { on, params: { source: 'isdetunnelopen.nl', hasBridgeEvent: Boolean(data.hasBridgeEvent) } };
	},
	async oresund(options) {
		const html = await fetchText('https://www.oresundsbron.com/en/traffic-information', options);
		const closed = oresundClosedNow(html, options.now);
		return { on: !closed, params: { source: 'oresundsbron.com/traffic-information' } };
	},
	async storebaelt(options) {
		const html = await fetchText('https://storebaelt.dk/trafik-vejr/', options);
		const closed = storebaeltClosedNow(html);
		return { on: !closed, params: { source: 'storebaelt.dk/trafik-vejr' } };
	},
	async 'uk-commons'(options) {
		const parts = zonedParts(options.now, 'Europe/London');
		const csv = await fetchText(
			`https://api.parliament.uk/egg-timer/calendar/${parts.year}/${String(parts.month).padStart(2, '0')}/${String(parts.day).padStart(2, '0')}`,
			options
		);
		const type = parseCommonsDayType(csv, options.now);
		const sittingDay = /^sitting day$/i.test(type);
		const on = sittingDay && parts.hour >= 9 && parts.hour < 23;
		return { on, params: { dayType: type || 'unknown' } };
	},
	async 'us-congress'(options) {
		const html = await fetchText('https://www.majorityleader.gov/schedule/', options);
		const sittingDay = parseHouseSchedule(html, options.now);
		const parts = zonedParts(options.now, 'America/New_York');
		const on = sittingDay && parts.hour >= 9 && parts.hour < 23;
		return { on, params: { sittingDay } };
	},
	'uk-pm': (options) => observeOffice('uk-pm', options),
	'us-president': (options) => observeOffice('us-president', options),
	pope: (options) => observeOffice('pope', options),
	async conclave(options) {
		const seen = await wikidataOfficeholder(OFFICES.pope.officeId, options);
		return { on: !seen.holder, params: { vacant: !seen.holder, holder: seen.holder || '' } };
	},
	async 'uk-election'(options) {
		const parts = zonedParts(options.now, 'Europe/London');
		const csv = await fetchText(
			`https://api.parliament.uk/egg-timer/calendar/${parts.year}/${String(parts.month).padStart(2, '0')}/${String(parts.day).padStart(2, '0')}`,
			options
		);
		const type = parseCommonsDayType(csv, options.now);
		const on = /dissolution|polling/i.test(type);
		return { on, params: { dayType: type || 'unknown' } };
	},
	async geomagnetic(options) {
		const payload = await fetchJson('https://services.swpc.noaa.gov/products/noaa-scales.json', options);
		const scale = geomagneticFromScales(payload);
		return { on: scale >= 4, params: { gScale: scale } };
	},
	async 'sweden-election'(options) {
		if (options.now.getTime() < SWEDEN_POLLS_CLOSE_MS) {
			return { on: false, params: { phase: 'before-polls' } };
		}
		const [md5, office] = await Promise.all([
			fetchText('https://resultat.val.se/resultatfiler/val2026/index.md5', options),
			wikidataOfficeholder('Q687075', options)
		]);
		const hasPrelim = /Val_2026_preliminar_00_RD\.zip/i.test(md5);
		const hasFinal = /Val_2026_slutlig_00_RD\.zip/i.test(md5);
		const counting = hasPrelim && !hasFinal;
		const governmentRenewed = Boolean(office.startMs && office.startMs >= SWEDEN_POLLS_CLOSE_MS);
		const on = counting || !governmentRenewed;
		return {
			on,
			params: {
				phase: counting ? 'count' : (governmentRenewed ? 'government-formed' : 'formation'),
				pm: office.holder || ''
			}
		};
	}
});

const SOURCE_IDS = Object.freeze(Object.keys(OBSERVERS));

async function observeEntry(entry, options = {}) {
	const source = entry.schedule && entry.schedule.source;
	const observer = OBSERVERS[source];
	if (!observer) {
		throw new Error(`${entry.id}: unknown observe source ${source}`);
	}
	const now = options.now || new Date();
	return observer({ ...options, now });
}

module.exports = {
	TOWER_LIFT_MS,
	SWEDEN_POLLS_CLOSE_MS,
	SOURCE_IDS,
	OFFICES,
	zonedParts,
	parseTowerLiftTimes,
	towerBridgeOpen,
	parseCommonsDayType,
	parseHouseSchedule,
	geomagneticFromScales,
	oresundClosedNow,
	storebaeltClosedNow,
	pickOfficeClaim,
	observeEntry
};

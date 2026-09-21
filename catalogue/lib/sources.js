/**
 * Live observers for catalogue switches that are not a UTC calendar.
 *
 * Each source returns { on, params?, name?, description?, onMeans?, offMeans? }.
 * Fetch failures must throw so the caller keeps the last good state
 * until the observation is stale, then forces OFF.
 */
const { fetchText, fetchJson } = require('./http');
const { OFFICES } = require('./offices');
const { extraDutchBridgeSpecs } = require('./dutch-bridges');
const { extraUptimeSpecs, observeUptime } = require('./uptime');

const TOWER_LIFT_MS = 15 * 60 * 1000;
const SWEDEN_POLLS_CLOSE_MS = Date.parse('2026-09-13T18:00:00Z');
// Six weeks after polls close. A continuing prime minister does not get a new
// Wikidata start date, so formation must end on the clock or the lamp stays ON.
const SWEDEN_FORMATION_UNTIL_MS = Date.parse('2026-10-25T18:00:00Z');
const GDACS_CURRENT_GRACE_MS = 12 * 60 * 60 * 1000;
const COMMONS_ANNUNCIATOR_URL = 'https://now-api.parliament.uk/api/Message/message/CommonsMain/current';
const LAUNCH_LIVE_BEFORE_MS = 20 * 60 * 1000;
const LAUNCH_LIVE_AFTER_MS = 20 * 60 * 1000;
const LAUNCH_ON_STATUS = Object.freeze(['Go', 'Hold', 'In Flight']);
const MONTHS = Object.freeze([
	'january', 'february', 'march', 'april', 'may', 'june',
	'july', 'august', 'september', 'october', 'november', 'december'
]);

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

function isWikidataItemId(value) {
	return /^Q[1-9]\d*$/i.test(String(value || '').trim());
}

function englishEntityLabel(entities, qid) {
	const labels = ((entities || {})[qid] || {}).labels || {};
	const value = (labels.en && labels.en.value)
		|| (labels['en-gb'] && labels['en-gb'].value)
		|| (labels['en-us'] && labels['en-us'].value)
		|| '';
	const trimmed = String(value).trim();
	// Missing labels used to fall back to the Q-id and that shipped as
	// "US President: Q22686" on the public directory.
	if (!trimmed || isWikidataItemId(trimmed)) {
		throw new Error(`Wikidata missing English label for ${qid}`);
	}
	return trimmed;
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

function slideIsCommonsDivision(slide) {
	if (!slide || typeof slide !== 'object') {
		return false;
	}
	if (slide.type === 'Division' || slide.soundToPlay === 'DivisionBell') {
		return true;
	}
	const lines = Array.isArray(slide.lines) ? slide.lines : [];
	return lines.some((line) => line && line.style === 'Division');
}

function commonsDivisionInProgress(message) {
	const source = 'now-api.parliament.uk';
	if (!message || typeof message !== 'object') {
		return { on: false, params: { source, reason: 'empty' } };
	}
	const publishTime = String(message.publishTime || '');
	if (message.showCommonsBell === true) {
		return { on: true, params: { source, reason: 'bell', publishTime } };
	}
	const slides = Array.isArray(message.slides) ? message.slides : [];
	if (slides.some(slideIsCommonsDivision)) {
		return { on: true, params: { source, reason: 'slide', publishTime } };
	}
	return { on: false, params: { source, reason: 'none', publishTime } };
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

function significantQuakes(payload) {
	const features = payload && Array.isArray(payload.features) ? payload.features : [];
	let mag = 0;
	let place = '';
	for (const feature of features) {
		const nextMag = Number((feature.properties || {}).mag);
		if (Number.isFinite(nextMag) && nextMag > mag) {
			mag = nextMag;
			place = String((feature.properties || {}).place || '');
		}
	}
	return { count: features.length, mag, place };
}

// TfL statusSeverity: 10 is Good Service. 6 and below is severe delays,
// closures, or suspension — the kind of disruption worth automating on.
const TFL_SEVERE_MAX = 6;

function disruptedTubeLines(payload) {
	const lines = Array.isArray(payload) ? payload : [];
	const disrupted = [];
	for (const line of lines) {
		const statuses = Array.isArray(line.lineStatuses) ? line.lineStatuses : [];
		const severe = statuses.some((status) => {
			const severity = Number(status && status.statusSeverity);
			return Number.isFinite(severity) && severity <= TFL_SEVERE_MAX;
		});
		if (severe) {
			disrupted.push(String(line.name || line.id || 'line'));
		}
	}
	return disrupted;
}

function dutchSpanOpenToShips(data) {
	if (!data || (data.isOpen == null && data.hasBridgeEvent == null)) {
		throw new Error('could not read Dutch span status');
	}
	return data.hasBridgeEvent === true || data.isOpen === false;
}

function dutchBridgeObserver(slug) {
	return async function dutchBridge(options) {
		const data = await fetchJson(`https://isdetunnelopen.nl/api/status/${encodeURIComponent(slug)}`, options);
		const on = dutchSpanOpenToShips(data);
		return {
			on,
			params: {
				source: 'isdetunnelopen.nl',
				bridge: data.bridge || slug,
				hasBridgeEvent: Boolean(data.hasBridgeEvent)
			}
		};
	};
}

function launchLive(payload, now) {
	const results = payload && Array.isArray(payload.results) ? payload.results : [];
	const t = now.getTime();
	for (const row of results) {
		const abbrev = String((row.status || {}).abbrev || '');
		const name = String(row.name || '');
		if (abbrev === 'In Flight') {
			return { on: true, name, abbrev };
		}
		if (!LAUNCH_ON_STATUS.includes(abbrev)) {
			continue;
		}
		const net = Date.parse(row.net || '');
		const start = Date.parse(row.window_start || '');
		const end = Date.parse(row.window_end || '');
		const from = (Number.isFinite(start) ? start : net) - LAUNCH_LIVE_BEFORE_MS;
		const to = (Number.isFinite(end) ? end : net) + LAUNCH_LIVE_AFTER_MS;
		if (Number.isFinite(from) && Number.isFinite(to) && t >= from && t < to) {
			return { on: true, name, abbrev };
		}
	}
	const next = results[0] || {};
	return { on: false, name: String(next.name || ''), abbrev: String((next.status || {}).abbrev || '') };
}

function elevatedVolcanoes(payload) {
	const rows = Array.isArray(payload) ? payload : [];
	return rows.filter((row) => {
		const color = String(row.color_code || '').toUpperCase();
		const level = String(row.alert_level || '').toUpperCase();
		return color === 'ORANGE' || color === 'RED' || level === 'WATCH' || level === 'WARNING';
	});
}

function gdacsInstant(value) {
	const raw = String(value || '').trim();
	if (!raw) {
		return NaN;
	}
	const withZone = /[zZ]|[+-]\d{2}:?\d{2}$/.test(raw) ? raw : `${raw}Z`;
	return Date.parse(withZone);
}

function gdacsRedEvents(payload, now = new Date()) {
	const features = payload && Array.isArray(payload.features) ? payload.features : [];
	const t = now.getTime();
	return features.filter((feature) => {
		const props = feature.properties || {};
		// alertlevel stays Red on the event after it is over. The live
		// signal is the current episode, and only while that episode has
		// not finished (plus a short grace for a late close).
		const episode = String(props.episodealertlevel || '').toLowerCase();
		if (episode !== 'red') {
			return false;
		}
		const to = gdacsInstant(props.todate);
		if (!Number.isFinite(to)) {
			return false;
		}
		return t < to + GDACS_CURRENT_GRACE_MS;
	});
}

function swedenElectionLive(now, md5, officeStartMs) {
	if (now.getTime() < SWEDEN_POLLS_CLOSE_MS) {
		return { on: false, phase: 'before-polls' };
	}
	const hasPrelim = /Val_2026_preliminar_00_RD\.zip/i.test(md5);
	const hasFinal = /Val_2026_slutlig_00_RD\.zip/i.test(md5);
	const counting = hasPrelim && !hasFinal;
	const governmentRenewed = Boolean(officeStartMs && officeStartMs >= SWEDEN_POLLS_CLOSE_MS);
	const formationOpen = now.getTime() < SWEDEN_FORMATION_UNTIL_MS;
	let phase = 'formation';
	if (counting) {
		phase = 'count';
	} else if (governmentRenewed) {
		phase = 'government-formed';
	} else if (!formationOpen) {
		phase = 'formation-closed';
	}
	return {
		on: counting || (formationOpen && !governmentRenewed),
		phase
	};
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
		`https://www.wikidata.org/w/api.php?action=wbgetentities&ids=${encodeURIComponent(qid)}&props=labels&languages=en&languagefallback=1&format=json`,
		options
	);
	const holder = englishEntityLabel(labels.entities, qid);
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

function officeObservers() {
	const observers = {};
	for (const id of Object.keys(OFFICES)) {
		observers[id] = (options) => observeOffice(id, options);
	}
	return observers;
}

function dutchBridgeObservers() {
	const observers = { erasmusbrug: dutchBridgeObserver('erasmusbrug') };
	for (const spec of extraDutchBridgeSpecs()) {
		observers[spec.id] = dutchBridgeObserver(spec.id);
	}
	return observers;
}

function uptimeObservers() {
	const observers = {};
	for (const spec of extraUptimeSpecs()) {
		const source = spec.schedule.source;
		observers[source] = (options) => observeUptime(source, options);
	}
	return observers;
}

const OBSERVERS = Object.freeze({
	async 'tower-bridge'(options) {
		const html = await fetchText('https://www.towerbridge.org.uk/flat/lift-times', options);
		const on = towerBridgeOpen(html, options.now);
		return { on, params: { source: 'towerbridge.org.uk/flat/lift-times' } };
	},
	...dutchBridgeObservers(),
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
	async 'uk-commons-division'(options) {
		const message = await fetchJson(COMMONS_ANNUNCIATOR_URL, options);
		return commonsDivisionInProgress(message);
	},
	async 'us-congress'(options) {
		const html = await fetchText('https://www.majorityleader.gov/schedule/', options);
		const sittingDay = parseHouseSchedule(html, options.now);
		const parts = zonedParts(options.now, 'America/New_York');
		const on = sittingDay && parts.hour >= 9 && parts.hour < 23;
		return { on, params: { sittingDay } };
	},
	...officeObservers(),
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
		const [md5, office] = options.now.getTime() < SWEDEN_POLLS_CLOSE_MS
			? ['', { holder: '', startMs: null }]
			: await Promise.all([
				fetchText('https://resultat.val.se/resultatfiler/val2026/index.md5', options),
				wikidataOfficeholder('Q687075', options)
			]);
		const seen = swedenElectionLive(options.now, md5, office.startMs);
		return {
			on: seen.on,
			params: {
				phase: seen.phase,
				pm: office.holder || ''
			}
		};
	},
	async earthquake(options) {
		const payload = await fetchJson(
			'https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/significant_day.geojson',
			options
		);
		const seen = significantQuakes(payload);
		return {
			on: seen.count > 0,
			params: {
				source: 'earthquake.usgs.gov/significant_day',
				count: seen.count,
				mag: seen.mag,
				place: seen.place
			}
		};
	},
	async 'london-underground'(options) {
		const payload = await fetchJson('https://api.tfl.gov.uk/Line/Mode/tube/Status', options);
		const disrupted = disruptedTubeLines(payload);
		return {
			on: disrupted.length > 0,
			params: {
				source: 'api.tfl.gov.uk/Line/Mode/tube/Status',
				disrupted: disrupted.slice(0, 8).join(', ')
			}
		};
	},
	async launch(options) {
		const payload = await fetchJson('https://ll.thespacedevs.com/2.2.0/launch/upcoming/?limit=8', options);
		const seen = launchLive(payload, options.now);
		return {
			on: seen.on,
			params: {
				source: 'll.thespacedevs.com',
				name: seen.name,
				status: seen.abbrev
			}
		};
	},
	async volcano(options) {
		const payload = await fetchJson('https://volcanoes.usgs.gov/hans-public/api/volcano/getElevatedVolcanoes', options);
		const hot = elevatedVolcanoes(payload);
		return {
			on: hot.length > 0,
			params: {
				source: 'volcanoes.usgs.gov',
				count: hot.length,
				names: hot.slice(0, 6).map((row) => row.volcano_name).filter(Boolean).join(', ')
			}
		};
	},
	async 'gdacs-red'(options) {
		const payload = await fetchJson(
			'https://www.gdacs.org/gdacsapi/api/events/geteventlist/SEARCH?eventlist=EQ,TC,FL,VO,DR,WF',
			options
		);
		const red = gdacsRedEvents(payload, options.now);
		const first = (red[0] && red[0].properties) || {};
		return {
			on: red.length > 0,
			params: {
				source: 'gdacs.org',
				count: red.length,
				name: String(first.name || first.eventname || '')
			}
		};
	},
	...uptimeObservers()
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
	SWEDEN_FORMATION_UNTIL_MS,
	GDACS_CURRENT_GRACE_MS,
	COMMONS_ANNUNCIATOR_URL,
	SOURCE_IDS,
	OFFICES,
	zonedParts,
	parseTowerLiftTimes,
	towerBridgeOpen,
	parseCommonsDayType,
	commonsDivisionInProgress,
	parseHouseSchedule,
	geomagneticFromScales,
	oresundClosedNow,
	storebaeltClosedNow,
	significantQuakes,
	disruptedTubeLines,
	dutchSpanOpenToShips,
	launchLive,
	elevatedVolcanoes,
	gdacsRedEvents,
	swedenElectionLive,
	TFL_SEVERE_MAX,
	pickOfficeClaim,
	isWikidataItemId,
	englishEntityLabel,
	observeEntry
};

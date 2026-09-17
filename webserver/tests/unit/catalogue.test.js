const path = require('path');
const fs = require('fs');
const {
	stableJsonStringify,
	deriveSwitchUidFromSwitchPubKeyB64Url,
	deriveOwnerIdFromOwnerPubKeyB64Url,
	verifyEd25519SignatureB64Url
} = require('../../src/utils/crypto_v2');
const catalogueCrypto = require('../../../catalogue/lib/crypto');
const { pickCreatePayload, buildCreateSwitchRequest } = require('../../../catalogue/lib/requests');
const {
	validateCatalogue,
	addEntry,
	nextIndex
} = require('../../../catalogue/lib/validate');
const { desiredState, lastWeekdayOfMonth } = require('../../../catalogue/lib/refresh');
const { observationIsStale } = require('../../../catalogue/lib/stale');
const { artIds, renderIconSvg, renderBannerSvg } = require('../../../catalogue/lib/artwork');
const { parseArgs, loadDotEnv } = require('../../../catalogue/cli');
const { metadataDiffers, publicMeta } = require('../../../catalogue/lib/apply');
const { extraLiveListings } = require('../../../catalogue/lib/live-listings');
const {
	DEFAULT_LIVE_DIR,
	repoCataloguePath,
	resolveCataloguePath
} = require('../../../catalogue/lib/paths');

const CATALOGUE_PATH = path.resolve(__dirname, '../../../catalogue/switches.json');

function loadEntries() {
	const doc = JSON.parse(fs.readFileSync(CATALOGUE_PATH, 'utf8'));
	return doc.switches;
}

describe('public switch catalogue', () => {
	test('switches.json validates and has unique ids and indexes', () => {
		const entries = validateCatalogue(loadEntries(), artIds());
		expect(entries.length).toBe(105);
		expect(entries.every((entry) => entry.name && entry.description && entry.art)).toBe(true);
		expect(entries.some((entry) => entry.id === 'yom-kippur')).toBe(true);
		expect(entries.some((entry) => entry.id === 'tower-bridge')).toBe(true);
		expect(entries.some((entry) => entry.id === 'sweden-election-2026')).toBe(true);
		expect(entries.some((entry) => entry.id === 'oresund-bridge')).toBe(true);
		expect(entries.some((entry) => entry.id === 'great-belt-bridge')).toBe(true);
		expect(entries.some((entry) => entry.id === 'halloween')).toBe(true);
		expect(entries.some((entry) => entry.id === 'london-underground')).toBe(true);
		expect(entries.some((entry) => entry.id === 'significant-earthquake')).toBe(true);
		expect(entries.some((entry) => entry.id === 'orbital-launch')).toBe(true);
		expect(entries.some((entry) => entry.id === 'french-president')).toBe(true);
		expect(entries.some((entry) => entry.id === 'brienenoordbrug')).toBe(true);
		expect(entries.some((entry) => entry.id === 'aliexpress-sale')).toBe(true);
		const cats = new Set(entries.map((entry) => entry.category));
		for (const name of ['Transport', 'Government', 'Holiday', 'Weather', 'Event', 'Community']) {
			expect(cats.has(name)).toBe(true);
		}
	});

	test('extra listings are civic feeds plus named AliExpress tentpoles', () => {
		const extra = extraLiveListings();
		expect(extra).toHaveLength(61);
		const observe = extra.filter((entry) => entry.schedule.kind === 'observe');
		const sales = extra.filter((entry) => entry.schedule.kind === 'windows');
		expect(observe).toHaveLength(57);
		expect(sales).toHaveLength(4);
		expect(observe.every((entry) => entry.schedule.source)).toBe(true);
		expect(extra.some((entry) => entry.id === 'uk-commons-division' && entry.schedule.observeEveryMinutes === 1)).toBe(true);
		expect(extra.some((entry) => entry.id === 'aliexpress-sale')).toBe(true);
		const have = new Set(loadEntries().map((entry) => entry.id));
		for (const entry of extra) {
			expect(have.has(entry.id)).toBe(true);
		}
	});

	test('every art key used in the catalogue has a glyph', () => {
		const ids = artIds();
		for (const entry of loadEntries()) {
			expect(ids.has(entry.art)).toBe(true);
			const icon = renderIconSvg(entry.art);
			const banner = renderBannerSvg(entry.art);
			expect(icon).toContain('viewBox="0 0 256 256"');
			expect(banner).toContain('viewBox="0 0 1600 900"');
			expect(icon).not.toMatch(/<text/i);
			expect(banner).not.toMatch(/<text/i);
		}
	});

	test('addEntry assigns the next index', () => {
		const entries = loadEntries();
		const expected = nextIndex(entries);
		const combined = addEntry(entries, {
			id: 'nowruz-test',
			name: 'Nowruz',
			description: 'ON on 21 March UTC. A spring new year switch.',
			location: 'Worldwide',
			category: 'Event',
			link: 'https://en.wikipedia.org/wiki/Nowruz',
			art: 'new-year',
			onMeans: '21 March UTC',
			offMeans: 'any other day',
			schedule: { kind: 'annual', month: 3, day: 21 }
		});
		expect(combined[combined.length - 1].index).toBe(expected);
		expect(() => addEntry(entries, {
			id: 'Bad_Id',
			name: 'x',
			description: 'y',
			location: 'z',
			category: 'Event',
			link: '',
			art: 'new-year',
			schedule: { kind: 'manual', state: false }
		})).toThrow(/kebab-case/);
	});
});

describe('catalogue v2 crypto', () => {
	const seed = catalogueCrypto.generateMasterSeedB64Url();

	test('owner id and switch uid match the server helpers', () => {
		const pub = catalogueCrypto.ownerPubKeyB64Url(seed);
		expect(catalogueCrypto.ownerId(seed)).toBe(deriveOwnerIdFromOwnerPubKeyB64Url(pub));
		const switchPub = catalogueCrypto.switchPubKeyB64Url(seed, 0);
		expect(catalogueCrypto.switchUid(seed, 0)).toBe(deriveSwitchUidFromSwitchPubKeyB64Url(switchPub));
		expect(catalogueCrypto.switchUid(seed, 0)).toMatch(/^vs_[0-9a-hjkmnpqrstvwxyz]{26}$/);
		expect(catalogueCrypto.switchUid(seed, 0)).not.toBe(catalogueCrypto.switchUid(seed, 1));
	});

	test('create-switch signatures verify with the server canonical form', () => {
		const meta = {
			name: 'Yom Kippur',
			description: 'ON during Yom Kippur.',
			location: 'Worldwide',
			category: 'Event',
			publicize: true,
			link: 'https://www.hebcal.com/'
		};
		const { uid, body } = buildCreateSwitchRequest(seed, 16, meta, {
			ts: 1_700_000_000_000,
			nonce: 'test-nonce-catalogue'
		});
		const canonical = stableJsonStringify({
			v: 2,
			action: 'create_switch',
			ownerPubKey: body.ownerPubKey,
			switchPubKey: body.switchPubKey,
			uid,
			index: 16,
			ts: body.ts,
			nonce: body.nonce,
			payload: pickCreatePayload(meta)
		});
		expect(verifyEd25519SignatureB64Url(body.ownerPubKey, canonical, body.sigOwner)).toBe(true);
		expect(verifyEd25519SignatureB64Url(body.switchPubKey, canonical, body.sigSwitch)).toBe(true);
	});
});

describe('catalogue schedule', () => {
	const byId = Object.fromEntries(loadEntries().map((entry) => [entry.id, entry]));

	test('Yom Kippur 2026 is on during the fast and off the week before', () => {
		expect(desiredState(byId['yom-kippur'], new Date('2026-09-21T12:00:00Z'))).toBe(true);
		expect(desiredState(byId['yom-kippur'], new Date('2026-09-15T09:00:00Z'))).toBe(false);
	});

	test('Christmas is only 25 December UTC', () => {
		expect(desiredState(byId.christmas, new Date('2026-12-25T12:00:00Z'))).toBe(true);
		expect(desiredState(byId.christmas, new Date('2026-12-24T23:00:00Z'))).toBe(false);
	});

	test('Pride Month is June UTC and Earth Hour is the last Saturday of March', () => {
		expect(desiredState(byId['pride-month'], new Date('2026-06-15T00:00:00Z'))).toBe(true);
		expect(desiredState(byId['pride-month'], new Date('2026-09-15T00:00:00Z'))).toBe(false);
		expect(lastWeekdayOfMonth(2026, 3, 6).toISOString().startsWith('2026-03-28')).toBe(true);
		expect(desiredState(byId['earth-hour'], new Date('2026-03-28T12:00:00Z'))).toBe(true);
		expect(desiredState(byId['earth-hour'], new Date('2026-03-21T12:00:00Z'))).toBe(false);
	});

	test('full moon uses the UTC civil day of the listed instant', () => {
		expect(desiredState(byId['full-moon'], new Date('2026-09-26T08:00:00Z'))).toBe(true);
		expect(desiredState(byId['full-moon'], new Date('2026-09-15T08:00:00Z'))).toBe(false);
	});

	test('held governments are on', () => {
		expect(desiredState(byId['uk-government'], new Date('2026-09-15T00:00:00Z'))).toBe(true);
		expect(desiredState(byId['papal-conclave'], new Date('2026-09-15T00:00:00Z'))).toBe(false);
	});

	test('live listings observe a source instead of waiting for an operator', () => {
		const live = [
			'tower-bridge', 'erasmusbrug', 'uk-commons', 'uk-commons-division', 'us-congress',
			'uk-government', 'us-government', 'pope', 'papal-conclave',
			'uk-election', 'geomagnetic-storm', 'sweden-election-2026',
			'oresund-bridge', 'great-belt-bridge',
			'significant-earthquake', 'london-underground'
		];
		for (const id of live) {
			expect(byId[id].schedule.kind).toBe('observe');
			expect(byId[id].schedule.source).toBeTruthy();
		}
		expect(byId.christmas.schedule.kind).toBe('annual');
	});

	test('Swedish election 2026 and the Øresund / Great Belt crossings are on', () => {
		const now = new Date('2026-09-15T10:00:00Z');
		expect(desiredState(byId['sweden-election-2026'], now)).toBe(true);
		expect(byId['sweden-election-2026'].schedule.source).toBe('sweden-election');
		expect(desiredState(byId['oresund-bridge'], now)).toBe(true);
		expect(desiredState(byId['great-belt-bridge'], now)).toBe(true);
		expect(desiredState(byId['tower-bridge'], now)).toBe(false);
	});

	test('Thanksgiving is the fourth Thursday of November UTC', () => {
		expect(desiredState(byId.thanksgiving, new Date('2026-11-26T12:00:00Z'))).toBe(true);
		expect(desiredState(byId.thanksgiving, new Date('2026-11-19T12:00:00Z'))).toBe(false);
		expect(desiredState(byId.nowruz, new Date('2026-03-21T12:00:00Z'))).toBe(true);
		expect(desiredState(byId.halloween, new Date('2026-10-31T12:00:00Z'))).toBe(true);
		expect(desiredState(byId.midsummer, new Date('2026-06-19T12:00:00Z'))).toBe(true);
		expect(desiredState(byId.holi, new Date('2026-03-03T12:00:00Z'))).toBe(true);
	});

	test('AliExpress tentpoles follow listed UTC windows', () => {
		expect(desiredState(byId['aliexpress-sale'], new Date('2026-09-17T12:00:00Z'))).toBe(false);
		expect(desiredState(byId['aliexpress-sale'], new Date('2026-03-20T12:00:00Z'))).toBe(true);
		expect(desiredState(byId['aliexpress-anniversary'], new Date('2026-03-20T12:00:00Z'))).toBe(true);
		expect(desiredState(byId['aliexpress-1111'], new Date('2026-03-20T12:00:00Z'))).toBe(false);
		expect(desiredState(byId['aliexpress-summer'], new Date('2026-06-05T12:00:00Z'))).toBe(true);
		expect(desiredState(byId['aliexpress-1111'], new Date('2026-11-11T00:00:00Z'))).toBe(true);
		expect(desiredState(byId['aliexpress-1111'], new Date('2026-11-20T00:00:00Z'))).toBe(false);
		expect(desiredState(byId['aliexpress-sale'], new Date('2026-12-10T12:00:00Z'))).toBe(true);
	});

	test('stale live sources are off until the feed works again', () => {
		const entry = {
			id: 'tower-bridge',
			schedule: {
				kind: 'observe',
				source: 'tower-bridge',
				state: true,
				observedAt: '2026-09-15T00:00:00Z',
				staleAfterHours: 2
			}
		};
		expect(observationIsStale(entry.schedule, new Date('2026-09-15T01:59:00Z'))).toBe(false);
		expect(desiredState(entry, new Date('2026-09-15T01:59:00Z'))).toBe(true);
		expect(observationIsStale(entry.schedule, new Date('2026-09-15T02:01:00Z'))).toBe(true);
		expect(desiredState(entry, new Date('2026-09-15T02:01:00Z'))).toBe(false);
	});
});

describe('catalogue CLI helpers', () => {
	test('parseArgs reads apply flags', () => {
		const args = parseArgs(['node', 'cli.js', 'apply', '--dry-run', '--only', 'yom-kippur,diwali', '--skip-images']);
		expect(args.command).toBe('apply');
		expect(args.dryRun).toBe(true);
		expect(args.skipImages).toBe(true);
		expect(args.only).toEqual(['yom-kippur', 'diwali']);
		const empty = parseArgs(['node', 'cli.js', 'apply']);
		expect(empty.only).toEqual([]);
	});

	test('loadDotEnv skips comments and strips quotes', () => {
		const tmp = path.join(__dirname, '..', '..', '..', 'catalogue', '.env.test-parse');
		fs.writeFileSync(tmp, '# hi\nFOO=bar\nBAZ="quoted"\n');
		try {
			expect(loadDotEnv(tmp)).toEqual({ FOO: 'bar', BAZ: 'quoted' });
		} finally {
			fs.unlinkSync(tmp);
		}
	});

	test('metadataDiffers ignores matching public fields', () => {
		const entry = loadEntries()[0];
		const wanted = publicMeta(entry);
		expect(metadataDiffers({ ...wanted, publicize: true, state: false }, wanted)).toBe(false);
		expect(metadataDiffers({ ...wanted, name: 'other' }, wanted)).toBe(true);
	});

	test('parseArgs reads observe flags', () => {
		const args = parseArgs(['node', 'cli.js', 'observe', '--dry-run', '--only', 'tower-bridge']);
		expect(args.command).toBe('observe');
		expect(args.dryRun).toBe(true);
		expect(args.only).toEqual(['tower-bridge']);
	});

	test('live observe path is outside the git tree when the live file exists', () => {
		const live = `${DEFAULT_LIVE_DIR}/switches.json`;
		expect(resolveCataloguePath({}, (filePath) => filePath === live)).toBe(live);
		expect(resolveCataloguePath({}, () => false)).toBe(repoCataloguePath());
		expect(repoCataloguePath()).toBe(CATALOGUE_PATH);
	});
});

const {
	towerBridgeOpen,
	storebaeltClosedNow,
	oresundClosedNow,
	parseCommonsDayType,
	commonsDivisionInProgress,
	parseHouseSchedule,
	geomagneticFromScales,
	significantQuakes,
	disruptedTubeLines,
	dutchSpanOpenToShips,
	launchLive,
	elevatedVolcanoes,
	gdacsRedEvents,
	pickOfficeClaim,
	isWikidataItemId,
	englishEntityLabel,
	SOURCE_IDS
} = require('../../../catalogue/lib/sources');
const { observeCatalogue, isFastObserveSource } = require('../../../catalogue/lib/observe');
const { isTestDebris } = require('../../../catalogue/lib/apply');

describe('catalogue observers', () => {
	test('Tower Bridge is on only inside the 15-minute lift window', () => {
		const start = Date.parse('2026-09-15T10:45:00Z');
		const html = `<time datetime="${Math.floor(start / 1000)}">12:45</time>`;
		expect(towerBridgeOpen(html, new Date(start + 60 * 1000))).toBe(true);
		expect(towerBridgeOpen(html, new Date(start + 16 * 60 * 1000))).toBe(false);
		expect(towerBridgeOpen(html, new Date(start - 60 * 1000))).toBe(false);
	});

	test('Storebælt and Øresund parse traffic copy', () => {
		expect(storebaeltClosedNow('Broen er &#xE5;ben for biltrafik')).toBe(false);
		expect(storebaeltClosedNow('Broen er lukket for biltrafik')).toBe(true);
		expect(storebaeltClosedNow('TRAFIKSTATUS: P&#xE5; Storeb&#xE6;lt advares der imod bl&#xE6;st')).toBe(false);
		const openHtml = 'The Øresund Bridge is open 24 hours a day. Closed to motorway traffic in both directions on October 1, 2026 from 20:00 to 23:15.';
		expect(oresundClosedNow(openHtml, new Date('2026-09-15T10:00:00Z'))).toBe(false);
		expect(oresundClosedNow(openHtml, new Date('2026-10-01T18:30:00Z'))).toBe(true);
		expect(oresundClosedNow(openHtml, new Date('2026-10-01T22:00:00Z'))).toBe(false);
	});

	test('Commons sitting day and House schedule windows', () => {
		const csv = '14,Monday,Non-sitting day\n15,Tuesday,Sitting day\n16,Wednesday,Sitting day\n';
		expect(parseCommonsDayType(csv, new Date('2026-09-15T10:00:00Z'))).toBe('Sitting day');
		const sitting = parseHouseSchedule(
			'<meta property="og:description" content="TUESDAY, SEPTEMBER 15, 2026 - The House will meet at 12 p.m.">',
			new Date('2026-09-15T16:00:00Z')
		);
		expect(sitting).toBe(true);
		expect(geomagneticFromScales({ 0: { G: { Scale: '4' } } })).toBe(4);
		expect(geomagneticFromScales({ 0: { G: { Scale: '0' } } })).toBe(0);
		expect(significantQuakes({ features: [] })).toEqual({ count: 0, mag: 0, place: '' });
		expect(significantQuakes({
			features: [
				{ properties: { mag: 5.1, place: 'Crete' } },
				{ properties: { mag: 6.2, place: 'Papua New Guinea' } }
			]
		})).toEqual({ count: 2, mag: 6.2, place: 'Papua New Guinea' });
		expect(disruptedTubeLines([
			{ name: 'Central', lineStatuses: [{ statusSeverity: 10 }] },
			{ name: 'Northern', lineStatuses: [{ statusSeverity: 6 }] }
		])).toEqual(['Northern']);
	});

	test('Commons division follows the annunciator bell and Division slide', () => {
		expect(commonsDivisionInProgress({
			showCommonsBell: false,
			slides: [{ type: 'BlankSlide' }]
		}).on).toBe(false);
		expect(commonsDivisionInProgress({
			showCommonsBell: true,
			slides: [{ type: 'Debate' }],
			publishTime: '2026-09-17T14:00:00'
		})).toEqual({
			on: true,
			params: { source: 'now-api.parliament.uk', reason: 'bell', publishTime: '2026-09-17T14:00:00' }
		});
		expect(commonsDivisionInProgress({
			showCommonsBell: false,
			slides: [{ type: 'Division', soundToPlay: 'DivisionBell' }]
		}).on).toBe(true);
		expect(commonsDivisionInProgress({
			showCommonsBell: false,
			slides: [{ type: 'Debate', lines: [{ style: 'Division', content: 'Division' }] }]
		}).on).toBe(true);
		expect(commonsDivisionInProgress(null).on).toBe(false);
	});

	test('Wikidata preferred office claim wins', () => {
		const claims = [
			{ rank: 'normal', mainsnak: { datavalue: { value: { id: 'Q1' } } }, qualifiers: { P580: [{ datavalue: { value: { time: '+2024-07-05T00:00:00Z' } } }] } },
			{ rank: 'preferred', mainsnak: { datavalue: { value: { id: 'Q2' } } }, qualifiers: { P580: [{ datavalue: { value: { time: '+2026-09-01T00:00:00Z' } } }] } }
		];
		expect(pickOfficeClaim(claims).mainsnak.datavalue.value.id).toBe('Q2');
	});

	test('Wikidata office labels must be English names, not Q-ids', () => {
		expect(isWikidataItemId('Q22686')).toBe(true);
		expect(isWikidataItemId('Donald Trump')).toBe(false);
		expect(englishEntityLabel({ Q22686: { labels: { en: { value: 'Donald Trump' } } } }, 'Q22686')).toBe('Donald Trump');
		expect(() => englishEntityLabel({ Q22686: { labels: {} } }, 'Q22686')).toThrow(/English label/);
		expect(() => englishEntityLabel({ Q22686: { labels: { en: { value: 'Q22686' } } } }, 'Q22686')).toThrow(/English label/);
	});

	test('observeCatalogue keeps last office name when Wikidata omits the English label', async () => {
		const fetchImpl = async (url) => {
			if (String(url).includes('props=claims')) {
				return {
					ok: true,
					status: 200,
					json: async () => ({
						entities: {
							Q11696: {
								claims: {
									P1308: [{
										rank: 'preferred',
										mainsnak: { datavalue: { value: { id: 'Q22686' } } }
									}]
								}
							}
						}
					})
				};
			}
			if (String(url).includes('props=labels')) {
				return {
					ok: true,
					status: 200,
					json: async () => ({ entities: { Q22686: { labels: {} } } })
				};
			}
			return { ok: false, status: 503, text: async () => 'down' };
		};
		const entries = [{
			id: 'us-government',
			index: 5,
			name: 'US President: Donald Trump',
			description: 'ON while Donald Trump is President of the United States.',
			location: 'United States',
			category: 'Community',
			link: 'https://www.whitehouse.gov/',
			art: 'us-president',
			onMeans: 'Donald Trump currently holds the office.',
			offMeans: 'Someone else is President, or the office is vacant.',
			schedule: {
				kind: 'observe',
				source: 'us-president',
				state: true,
				params: { office: 'president', holder: 'Donald Trump' }
			}
		}];
		const { results, entries: next } = await observeCatalogue({
			entries,
			fetchImpl,
			now: new Date('2026-09-16T08:00:00Z')
		});
		expect(results[0].ok).toBe(false);
		expect(results[0].error).toMatch(/English label/);
		expect(next[0].name).toBe('US President: Donald Trump');
		expect(next[0].schedule.params.holder).toBe('Donald Trump');
	});

	test('observeCatalogue writes ON/OFF and keeps last state on fetch failure', async () => {
		const lift = Date.parse('2026-09-15T11:00:00Z');
		const fetchImpl = async (url) => {
			if (url.includes('towerbridge')) {
				return {
					ok: true,
					status: 200,
					text: async () => `<time datetime="${Math.floor(lift / 1000)}"></time>`
				};
			}
			return { ok: false, status: 503, text: async () => 'down' };
		};
		const entries = [
			{
				id: 'tower-bridge',
				index: 0,
				name: 'Tower Bridge open',
				description: 'ON while up.',
				location: 'London',
				category: 'Event',
				link: 'https://www.towerbridge.org.uk/lift-times',
				art: 'tower-bridge',
				onMeans: 'up',
				offMeans: 'down',
				schedule: { kind: 'observe', source: 'tower-bridge', state: false, params: { stale: true, lastError: 'down' } }
			},
			{
				id: 'erasmusbrug',
				index: 1,
				name: 'Erasmusbrug open',
				description: 'ON while up.',
				location: 'Rotterdam',
				category: 'Event',
				link: 'https://www.portofrotterdam.com/',
				art: 'erasmusbrug',
				onMeans: 'up',
				offMeans: 'down',
				schedule: { kind: 'observe', source: 'erasmusbrug', state: true }
			}
		];
		const { results, entries: next } = await observeCatalogue({
			entries,
			fetchImpl,
			now: new Date('2026-09-15T11:05:00Z')
		});
		expect(results[0].ok).toBe(true);
		expect(results[0].on).toBe(true);
		expect(next[0].schedule.state).toBe(true);
		expect(next[0].schedule.params.stale).toBeUndefined();
		expect(next[0].schedule.params.lastError).toBeUndefined();
		expect(results[1].ok).toBe(false);
		expect(next[1].schedule.state).toBe(true);
	});

	test('observeCatalogue forces OFF when the last success is older than staleAfterHours', async () => {
		const fetchImpl = async () => ({ ok: false, status: 503, text: async () => 'down' });
		const entries = [{
			id: 'erasmusbrug',
			index: 1,
			name: 'Erasmusbrug open',
			description: 'ON while up.',
			location: 'Rotterdam',
			category: 'Transport',
			link: 'https://www.portofrotterdam.com/',
			art: 'erasmusbrug',
			onMeans: 'up',
			offMeans: 'down',
			schedule: {
				kind: 'observe',
				source: 'erasmusbrug',
				state: true,
				staleAfterHours: 2,
				observedAt: '2026-09-15T08:00:00Z',
				params: { source: 'isdetunnelopen.nl' }
			}
		}];
		const { results, entries: next } = await observeCatalogue({
			entries,
			fetchImpl,
			now: new Date('2026-09-15T11:05:00Z')
		});
		expect(results[0].ok).toBe(false);
		expect(results[0].staleOff).toBe(true);
		expect(results[0].on).toBe(false);
		expect(next[0].schedule.state).toBe(false);
		expect(next[0].schedule.params.stale).toBe(true);
		expect(next[0].schedule.observedAt).toBe('2026-09-15T08:00:00Z');
	});

	test('every observer id is wired', () => {
		expect(SOURCE_IDS).toEqual(expect.arrayContaining([
			'tower-bridge', 'erasmusbrug', 'oresund', 'storebaelt',
			'uk-commons', 'uk-commons-division', 'us-congress', 'uk-pm', 'us-president',
			'pope', 'conclave', 'uk-election', 'geomagnetic', 'sweden-election',
			'earthquake', 'london-underground',
			'french-president', 'brienenoordbrug', 'launch', 'volcano', 'gdacs-red'
		]));
	});

	test('batch observe skips Commons division so the one-minute timer owns it', async () => {
		const division = {
			id: 'uk-commons-division',
			schedule: {
				kind: 'observe',
				source: 'uk-commons-division',
				state: true,
				observeEveryMinutes: 1
			}
		};
		expect(isFastObserveSource(division)).toBe(true);
		const fetchImpl = async () => {
			throw new Error('batch observe must not fetch the division source');
		};
		const skipped = await observeCatalogue({
			entries: [division],
			fetchImpl,
			now: new Date('2026-09-17T12:00:00Z')
		});
		expect(skipped.results[0]).toMatchObject({
			id: 'uk-commons-division',
			ok: true,
			deferred: true,
			fetched: false,
			on: true
		});
		const fetchImplBell = async () => ({
			ok: true,
			status: 200,
			json: async () => ({
				showCommonsBell: true,
				slides: [],
				publishTime: '2026-09-17T12:00:00'
			})
		});
		const forced = await observeCatalogue({
			entries: [division],
			onlyIds: ['uk-commons-division'],
			fetchImpl: fetchImplBell,
			now: new Date('2026-09-17T12:00:00Z')
		});
		expect(forced.results[0]).toMatchObject({
			deferred: false,
			fetched: true,
			on: true
		});
		expect(forced.entries[0].schedule.params.reason).toBe('bell');
	});

	test('Dutch span, launch, volcano and GDACS parsers', () => {
		expect(dutchSpanOpenToShips({ isOpen: true, hasBridgeEvent: false })).toBe(false);
		expect(dutchSpanOpenToShips({ isOpen: false, hasBridgeEvent: false })).toBe(true);
		expect(dutchSpanOpenToShips({ isOpen: true, hasBridgeEvent: true })).toBe(true);
		expect(() => dutchSpanOpenToShips({})).toThrow(/Dutch span/);
		const inFlight = launchLive({
			results: [{ name: 'Falcon 9', status: { abbrev: 'In Flight' }, net: '2026-09-16T12:00:00Z' }]
		}, new Date('2026-09-16T10:00:00Z'));
		expect(inFlight.on).toBe(true);
		const goNow = launchLive({
			results: [{
				name: 'Ariane 6',
				status: { abbrev: 'Go' },
				window_start: '2026-09-16T12:00:00Z',
				window_end: '2026-09-16T12:30:00Z',
				net: '2026-09-16T12:10:00Z'
			}]
		}, new Date('2026-09-16T12:05:00Z'));
		expect(goNow.on).toBe(true);
		const goLater = launchLive({
			results: [{
				name: 'Ariane 6',
				status: { abbrev: 'Go' },
				window_start: '2026-09-16T12:00:00Z',
				window_end: '2026-09-16T12:30:00Z',
				net: '2026-09-16T12:10:00Z'
			}]
		}, new Date('2026-09-16T10:00:00Z'));
		expect(goLater.on).toBe(false);
		expect(elevatedVolcanoes([
			{ volcano_name: 'Kilauea', color_code: 'ORANGE' },
			{ volcano_name: 'Quiet', color_code: 'YELLOW', alert_level: 'ADVISORY' }
		]).map((row) => row.volcano_name)).toEqual(['Kilauea']);
		expect(gdacsRedEvents({
			features: [
				{ properties: { alertlevel: 'Red', name: 'Cyclone' } },
				{ properties: { alertlevel: 'Orange', name: 'Flood' } }
			]
		}).length).toBe(1);
	});
});

describe('catalogue debris filter', () => {
	test('keeps real private listings and drops CI leftovers', () => {
		expect(isTestDebris({ uid: 'vs_keep', name: 'GamlaBio' })).toBe(false);
		expect(isTestDebris({ uid: 'vs_cat', name: '' }, new Set(['vs_cat']))).toBe(false);
		expect(isTestDebris({ uid: 'vs_x', name: '', description: 'Public Test Switch' })).toBe(true);
		expect(isTestDebris({ uid: 'vs_y', name: 'claude-e2e-test-1' })).toBe(true);
		expect(isTestDebris({ uid: 'vs_z', name: 'E2E WebSocket Test' })).toBe(true);
	});
});

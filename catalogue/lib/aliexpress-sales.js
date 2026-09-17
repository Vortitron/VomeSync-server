/**
 * AliExpress tentpole sales as UTC windows.
 *
 * Their storefront bot-walls anonymous fetches (x5 punish page), so these
 * listings are not `observe`. Dates follow AliExpress press releases where
 * we have them; 11.11 / 12.12 use the named festival week. Extend the
 * windows when they publish the next year.
 */
function aliexpressWindows(which) {
	const anniversary = [
		{ start: '2026-03-16T00:00:00Z', end: '2026-03-26T00:00:00Z' }
	];
	const summer = [
		{ start: '2026-06-01T00:00:00Z', end: '2026-06-11T00:00:00Z' }
	];
	const festival = [
		{ start: '2026-11-11T00:00:00Z', end: '2026-11-20T00:00:00Z' },
		{ start: '2027-11-11T00:00:00Z', end: '2027-11-20T00:00:00Z' }
	];
	const yearEnd = [
		{ start: '2026-12-07T00:00:00Z', end: '2026-12-13T00:00:00Z' },
		{ start: '2027-12-07T00:00:00Z', end: '2027-12-13T00:00:00Z' }
	];
	switch (which) {
		case 'anniversary':
			return anniversary.slice();
		case 'summer':
			return summer.slice();
		case '1111':
			return festival.slice();
		case 'any':
			return anniversary.concat(summer, festival, yearEnd);
		default:
			throw new Error(`unknown AliExpress window set ${which}`);
	}
}

function saleListing(spec) {
	const { windows, ...rest } = spec;
	return {
		location: 'Worldwide',
		category: 'Event',
		link: 'https://www.aliexpress.com/',
		art: 'parcel',
		...rest,
		schedule: {
			kind: 'windows',
			windows
		}
	};
}

function extraAliExpressSaleSpecs() {
	return [
		saleListing({
			id: 'aliexpress-sale',
			name: 'AliExpress sale',
			description: 'ON during a listed AliExpress tentpole (Anniversary, Summer, 11.11, or 12.12). A shopping lamp or a pause on the checkout. UTC windows from AliExpress announcements — their site blocks bots, so this is not a live scrape.',
			onMeans: 'A listed AliExpress tentpole sale is under way.',
			offMeans: 'It is outside the listed sale windows.',
			windows: aliexpressWindows('any')
		}),
		saleListing({
			id: 'aliexpress-1111',
			name: 'AliExpress 11.11',
			description: 'ON during the AliExpress Global Shopping Festival. A reminder to order, or to hide the basket. 2026 is 11–19 November UTC.',
			onMeans: 'The listed 11.11 window is under way.',
			offMeans: 'It is outside the listed 11.11 windows.',
			windows: aliexpressWindows('1111')
		}),
		saleListing({
			id: 'aliexpress-summer',
			name: 'AliExpress Summer sale',
			description: 'ON during the AliExpress Summer / 6.18 sale. A mid-year shopping lamp. 2026 is 1–10 June UTC, from the AliExpress press release.',
			onMeans: 'The listed Summer sale window is under way.',
			offMeans: 'It is outside the listed Summer sale windows.',
			windows: aliexpressWindows('summer')
		}),
		saleListing({
			id: 'aliexpress-anniversary',
			name: 'AliExpress Anniversary sale',
			description: 'ON during the AliExpress Anniversary sale. A spring shopping lamp. 2026 is 16–25 March UTC, from the AliExpress press release.',
			onMeans: 'The listed Anniversary sale window is under way.',
			offMeans: 'It is outside the listed Anniversary sale windows.',
			windows: aliexpressWindows('anniversary')
		})
	];
}

module.exports = {
	aliexpressWindows,
	extraAliExpressSaleSpecs
};

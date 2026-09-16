/**
 * Extra public listings that are live civic feeds, not calendars and not
 * things Home Assistant already covers (weather, sun, Tube duplicates, quakes).
 */
const { extraOfficeSwitchSpecs } = require('./offices');
const { extraDutchBridgeSpecs } = require('./dutch-bridges');

function extraEventSpecs() {
	return [
		{
			id: 'orbital-launch',
			name: 'Orbital launch window',
			description: 'ON while an orbital launch is in flight, or Go/Hold inside the launch window. Light a shed or hush the house for a countdown. Source: Launch Library 2.',
			location: 'Worldwide',
			category: 'Event',
			link: 'https://ll.thespacedevs.com/',
			art: 'rocket',
			onMeans: 'A listed launch is in flight, or Go/Hold inside the window.',
			offMeans: 'No launch is in flight or inside the live window.',
			schedule: {
				kind: 'observe',
				source: 'launch',
				state: false,
				staleAfterHours: 2
			}
		},
		{
			id: 'us-volcano-alert',
			name: 'US volcano watch or warning',
			description: 'ON while a US volcano is at orange/red, or aviation watch/warning. A rare hazard lamp. Source: USGS volcano elevations.',
			location: 'United States',
			category: 'Weather',
			link: 'https://volcanoes.usgs.gov/hans-public/',
			art: 'volcano',
			onMeans: 'At least one US volcano is orange, red, watch, or warning.',
			offMeans: 'No listed volcano is at those levels.',
			schedule: {
				kind: 'observe',
				source: 'volcano',
				state: false,
				staleAfterHours: 6
			}
		},
		{
			id: 'gdacs-red',
			name: 'GDACS red alert',
			description: 'ON while GDACS lists a red alert (quake, cyclone, flood, volcano, drought, or wildfire). A global disaster lamp. Source: GDACS.',
			location: 'Worldwide',
			category: 'Weather',
			link: 'https://www.gdacs.org/',
			art: 'disaster',
			onMeans: 'At least one GDACS event is at red alert.',
			offMeans: 'No listed event is at red alert.',
			schedule: {
				kind: 'observe',
				source: 'gdacs-red',
				state: false,
				staleAfterHours: 6
			}
		}
	];
}

function extraLiveListings() {
	const listings = extraDutchBridgeSpecs().concat(extraOfficeSwitchSpecs(), extraEventSpecs());
	if (listings.length !== 56) {
		throw new Error(`expected 56 extra listings, got ${listings.length}`);
	}
	return listings;
}

module.exports = {
	extraEventSpecs,
	extraLiveListings
};

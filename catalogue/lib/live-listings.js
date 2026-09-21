/**
 * Extra public listings: live civic feeds, named AliExpress tentpoles,
 * and IsUp status lamps. Not HA weather/sun/Tube duplicates.
 */
const { extraOfficeSwitchSpecs } = require('./offices');
const { extraDutchBridgeSpecs } = require('./dutch-bridges');
const { extraAliExpressSaleSpecs } = require('./aliexpress-sales');
const { extraUptimeSpecs } = require('./uptime');

function extraEventSpecs() {
	return [
		{
			id: 'uk-commons-division',
			name: 'UK Commons division',
			description: 'ON while a Commons division is in progress — MPs have a few minutes to reach the lobbies. Useful as a remote switch if you are away from the estate. Source: UK Parliament annunciator.',
			location: 'Westminster',
			category: 'Government',
			link: 'https://now.parliament.uk/',
			art: 'commons-bell',
			onMeans: 'A Commons division is under way; the lobbies are open.',
			offMeans: 'No Commons division is in progress.',
			schedule: {
				kind: 'observe',
				source: 'uk-commons-division',
				state: false,
				staleAfterHours: 1,
				observeEveryMinutes: 1
			}
		},
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
				staleAfterHours: 2,
				observeEveryMinutes: 30
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
			description: 'ON while a GDACS episode is still at red. The event record stays red after it ends, so a finished flood does not keep this on. Source: GDACS.',
			location: 'Worldwide',
			category: 'Weather',
			link: 'https://www.gdacs.org/',
			art: 'disaster',
			onMeans: 'A GDACS episode is at red and has not finished.',
			offMeans: 'No GDACS episode is currently at red.',
			schedule: {
				kind: 'observe',
				source: 'gdacs-red',
				state: false,
				staleAfterHours: 6
			}
		},
		{
			id: 'atlantic-pacific-hurricane',
			name: 'Atlantic or Pacific hurricane',
			description: 'ON while the National Hurricane Center lists a hurricane in the Atlantic or the eastern or central Pacific. A storm lamp; a tropical storm does not count. Source: nhc.noaa.gov.',
			location: 'Atlantic and Pacific',
			category: 'Weather',
			link: 'https://www.nhc.noaa.gov/',
			art: 'hurricane',
			onMeans: 'At least one storm in those basins is classified as a hurricane.',
			offMeans: 'No listed storm in those basins is a hurricane.',
			schedule: {
				kind: 'observe',
				source: 'nhc-hurricane',
				state: false,
				staleAfterHours: 6
			}
		},
		{
			id: 'england-severe-flood',
			name: 'England severe flood warning',
			description: 'ON while the Environment Agency has a severe flood warning in force in England. Danger to life; a flood alert or flood warning does not count. Source: flood-monitoring.',
			location: 'England',
			category: 'Weather',
			link: 'https://check-for-flooding.service.gov.uk/',
			art: 'flood',
			onMeans: 'At least one severe flood warning is in force.',
			offMeans: 'No severe flood warning is in force.',
			schedule: {
				kind: 'observe',
				source: 'england-severe-flood',
				state: false,
				staleAfterHours: 6
			}
		}
	];
}

function extraLiveListings() {
	const listings = extraDutchBridgeSpecs().concat(
		extraOfficeSwitchSpecs(),
		extraEventSpecs(),
		extraAliExpressSaleSpecs(),
		extraUptimeSpecs()
	);
	if (listings.length !== 84) {
		throw new Error(`expected 84 extra listings, got ${listings.length}`);
	}
	return listings;
}

module.exports = {
	extraEventSpecs,
	extraLiveListings
};

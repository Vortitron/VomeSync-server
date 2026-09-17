/**
 * Wikidata office-holders (P1308) for catalogue government switches.
 * Keep English labels only — observe.js already refuses a Q-id fallback.
 */
function officeCopy(title, roleNoun, link) {
	return {
		name: (holder) => `${title}: ${holder}`,
		description: (holder) => `ON while ${holder} is ${roleNoun}. It turns off when the office-holder changes, then the listing is renamed. Source: Wikidata.`,
		onMeans: (holder) => `${holder} currently holds the office.`,
		offMeans: `Someone else is ${roleNoun}, or the office is vacant.`,
		link
	};
}

function extraOffice(officeId, title, roleNoun, link, location, art) {
	return {
		officeId,
		...officeCopy(title, roleNoun, link),
		location,
		art
	};
}

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
	},
	'french-president': extraOffice('Q191954', 'French President', 'President of France', 'https://en.wikipedia.org/wiki/President_of_France', 'France', 'capitol'),
	'german-chancellor': extraOffice('Q4970706', 'German Chancellor', 'Chancellor of Germany', 'https://en.wikipedia.org/wiki/Chancellor_of_Germany', 'Germany', 'uk-pm'),
	'german-president': extraOffice('Q25223', 'German President', 'President of Germany', 'https://en.wikipedia.org/wiki/President_of_Germany', 'Germany', 'capitol'),
	taoiseach: extraOffice('Q191827', 'Taoiseach', 'Taoiseach', 'https://en.wikipedia.org/wiki/Taoiseach', 'Ireland', 'uk-pm'),
	'irish-president': extraOffice('Q213702', 'Irish President', 'President of Ireland', 'https://en.wikipedia.org/wiki/President_of_Ireland', 'Ireland', 'capitol'),
	'canadian-pm': extraOffice('Q839078', 'Canadian Prime Minister', 'Prime Minister of Canada', 'https://en.wikipedia.org/wiki/Prime_Minister_of_Canada', 'Canada', 'uk-pm'),
	'australian-pm': extraOffice('Q319145', 'Australian Prime Minister', 'Prime Minister of Australia', 'https://en.wikipedia.org/wiki/Prime_Minister_of_Australia', 'Australia', 'uk-pm'),
	'nz-pm': extraOffice('Q1071117', 'New Zealand Prime Minister', 'Prime Minister of New Zealand', 'https://en.wikipedia.org/wiki/Prime_Minister_of_New_Zealand', 'New Zealand', 'uk-pm'),
	'italian-pm': extraOffice('Q796897', 'Italian Prime Minister', 'Prime Minister of Italy', 'https://en.wikipedia.org/wiki/Prime_Minister_of_Italy', 'Italy', 'uk-pm'),
	'spanish-pm': extraOffice('Q844587', 'Spanish Prime Minister', 'Prime Minister of Spain', 'https://en.wikipedia.org/wiki/Prime_Minister_of_Spain', 'Spain', 'uk-pm'),
	'dutch-pm': extraOffice('Q3058109', 'Dutch Prime Minister', 'Prime Minister of the Netherlands', 'https://en.wikipedia.org/wiki/Prime_Minister_of_the_Netherlands', 'Netherlands', 'uk-pm'),
	'japanese-pm': extraOffice('Q274948', 'Japanese Prime Minister', 'Prime Minister of Japan', 'https://en.wikipedia.org/wiki/Prime_Minister_of_Japan', 'Japan', 'uk-pm'),
	'indian-pm': extraOffice('Q192711', 'Indian Prime Minister', 'Prime Minister of India', 'https://en.wikipedia.org/wiki/Prime_Minister_of_India', 'India', 'uk-pm'),
	'brazilian-president': extraOffice('Q5176750', 'Brazilian President', 'President of Brazil', 'https://en.wikipedia.org/wiki/President_of_Brazil', 'Brazil', 'capitol'),
	'mexican-president': extraOffice('Q628004', 'Mexican President', 'President of Mexico', 'https://en.wikipedia.org/wiki/President_of_Mexico', 'Mexico', 'capitol'),
	'eu-commission': extraOffice('Q8882', 'European Commission President', 'President of the European Commission', 'https://en.wikipedia.org/wiki/President_of_the_European_Commission', 'Brussels', 'capitol'),
	'un-sg': extraOffice('Q81066', 'UN Secretary-General', 'Secretary-General of the United Nations', 'https://en.wikipedia.org/wiki/Secretary-General_of_the_United_Nations', 'New York', 'capitol'),
	'nato-sg': extraOffice('Q167662', 'NATO Secretary General', 'Secretary General of NATO', 'https://en.wikipedia.org/wiki/Secretary_General_of_NATO', 'Brussels', 'capitol'),
	'mayor-london': extraOffice('Q38931', 'Mayor of London', 'Mayor of London', 'https://en.wikipedia.org/wiki/Mayor_of_London', 'London', 'commons'),
	'mayor-nyc': extraOffice('Q785304', 'Mayor of New York City', 'Mayor of New York City', 'https://en.wikipedia.org/wiki/Mayor_of_New_York_City', 'New York', 'capitol'),
	'finnish-president': extraOffice('Q29558', 'Finnish President', 'President of Finland', 'https://en.wikipedia.org/wiki/President_of_Finland', 'Finland', 'capitol'),
	'finnish-pm': extraOffice('Q738695', 'Finnish Prime Minister', 'Prime Minister of Finland', 'https://en.wikipedia.org/wiki/Prime_Minister_of_Finland', 'Finland', 'uk-pm'),
	'norwegian-pm': extraOffice('Q2334076', 'Norwegian Prime Minister', 'Prime Minister of Norway', 'https://en.wikipedia.org/wiki/Prime_Minister_of_Norway', 'Norway', 'uk-pm'),
	'danish-pm': extraOffice('Q795477', 'Danish Prime Minister', 'Prime Minister of Denmark', 'https://en.wikipedia.org/wiki/Prime_Minister_of_Denmark', 'Denmark', 'uk-pm'),
	'swedish-pm': extraOffice('Q687075', 'Swedish Prime Minister', 'Prime Minister of Sweden', 'https://en.wikipedia.org/wiki/Prime_Minister_of_Sweden', 'Sweden', 'uk-pm'),
	'swedish-monarch': extraOffice('Q1268572', 'Swedish monarch', 'Monarch of Sweden', 'https://en.wikipedia.org/wiki/Monarchy_of_Sweden', 'Sweden', 'crown'),
	'uk-monarch': extraOffice('Q9134365', 'British monarch', 'Monarch of the United Kingdom', 'https://en.wikipedia.org/wiki/Monarchy_of_the_United_Kingdom', 'United Kingdom', 'crown'),
	'scotland-fm': extraOffice('Q1362216', 'First Minister of Scotland', 'First Minister of Scotland', 'https://en.wikipedia.org/wiki/First_Minister_of_Scotland', 'Scotland', 'uk-pm'),
	'wales-fm': extraOffice('Q18996', 'First Minister of Wales', 'First Minister of Wales', 'https://en.wikipedia.org/wiki/First_Minister_of_Wales', 'Wales', 'uk-pm'),
	'south-africa-president': extraOffice('Q273884', 'South African President', 'President of South Africa', 'https://en.wikipedia.org/wiki/President_of_South_Africa', 'South Africa', 'capitol'),
	'argentina-president': extraOffice('Q12969145', 'Argentine President', 'President of Argentina', 'https://en.wikipedia.org/wiki/President_of_Argentina', 'Argentina', 'capitol'),
	'south-korea-president': extraOffice('Q6296418', 'South Korean President', 'President of South Korea', 'https://en.wikipedia.org/wiki/President_of_South_Korea', 'South Korea', 'capitol'),
	'portugal-pm': extraOffice('Q1723031', 'Portuguese Prime Minister', 'Prime Minister of Portugal', 'https://en.wikipedia.org/wiki/Prime_Minister_of_Portugal', 'Portugal', 'uk-pm'),
	'poland-pm': extraOffice('Q3259469', 'Polish Prime Minister', 'Prime Minister of Poland', 'https://en.wikipedia.org/wiki/Prime_Minister_of_Poland', 'Poland', 'uk-pm'),
	'greece-pm': extraOffice('Q4377230', 'Greek Prime Minister', 'Prime Minister of Greece', 'https://en.wikipedia.org/wiki/Prime_Minister_of_Greece', 'Greece', 'uk-pm'),
	'austria-chancellor': extraOffice('Q1006398', 'Austrian Chancellor', 'Chancellor of Austria', 'https://en.wikipedia.org/wiki/Chancellor_of_Austria', 'Austria', 'uk-pm'),
	'israel-pm': extraOffice('Q208487', 'Israeli Prime Minister', 'Prime Minister of Israel', 'https://en.wikipedia.org/wiki/Prime_Minister_of_Israel', 'Israel', 'uk-pm'),
	'singapore-pm': extraOffice('Q866756', 'Singapore Prime Minister', 'Prime Minister of Singapore', 'https://en.wikipedia.org/wiki/Prime_Minister_of_Singapore', 'Singapore', 'uk-pm'),
	'california-governor': extraOffice('Q887010', 'Governor of California', 'Governor of California', 'https://en.wikipedia.org/wiki/Governor_of_California', 'California', 'capitol'),
	'swiss-president': extraOffice('Q688230', 'Swiss President', 'President of the Swiss Confederation', 'https://en.wikipedia.org/wiki/President_of_the_Swiss_Confederation', 'Switzerland', 'capitol')
});

function extraOfficeIds() {
	return Object.keys(OFFICES).filter((id) => id !== 'uk-pm' && id !== 'us-president' && id !== 'pope');
}

function extraOfficeSwitchSpecs() {
	return extraOfficeIds().map((id) => {
		const spec = OFFICES[id];
		if (!spec.location || !spec.art || !spec.link) {
			throw new Error(`${id}: extra office needs location, art and link`);
		}
		const holder = 'the current holder';
		return {
			id,
			name: spec.name(holder),
			description: spec.description(holder),
			location: spec.location,
			category: 'Government',
			link: spec.link,
			art: spec.art,
			onMeans: spec.onMeans(holder),
			offMeans: spec.offMeans,
			schedule: {
				kind: 'observe',
				source: id,
				state: false,
				staleAfterHours: 72
			}
		};
	});
}

module.exports = {
	OFFICES,
	extraOfficeIds,
	extraOfficeSwitchSpecs,
	officeCopy
};

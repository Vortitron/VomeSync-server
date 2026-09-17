/**
 * Merge extraLiveListings() into switches.json. Idempotent.
 * Run: node catalogue/append-live-listings.js
 */
const path = require('path');
const { addEntry, validateCatalogue } = require('./lib/validate');
const { artIds } = require('./lib/artwork');
const { extraLiveListings } = require('./lib/live-listings');
const { saveJsonFile, loadJsonFile } = require('./lib/apply');

const CATALOGUE_PATH = path.join(__dirname, 'switches.json');

function main() {
	const doc = loadJsonFile(CATALOGUE_PATH);
	let entries = doc.switches;
	const have = new Set(entries.map((entry) => entry.id));
	let added = 0;
	for (const spec of extraLiveListings()) {
		if (have.has(spec.id)) {
			continue;
		}
		entries = addEntry(entries, spec);
		have.add(spec.id);
		added += 1;
	}
	validateCatalogue(entries, artIds());
	doc.switches = entries;
	saveJsonFile(CATALOGUE_PATH, doc);
	process.stderr.write(`catalogue now ${entries.length} listings (${added} added)\n`);
}

main();

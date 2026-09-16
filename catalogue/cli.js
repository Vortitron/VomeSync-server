#!/usr/bin/env node
/**
 * Publish and refresh the VomeSync public-directory catalogue.
 *
 *   node catalogue/cli.js uids
 *   node catalogue/cli.js apply [--dry-run] [--only id]
 *   node catalogue/cli.js refresh [--dry-run] [--only id]
 *   node catalogue/cli.js observe [--dry-run] [--only id]
 *   node catalogue/cli.js add --json '{"id":"…", …}'
 *   node catalogue/cli.js delist-tests [--dry-run]
 *   node catalogue/cli.js purge-debris [--dry-run]
 *
 * Seed: VOMESYNC_CATALOGUE_SEED or catalogue/.seed (created on first apply).
 * Never commit the seed. UIDs are derived from it.
 */
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { generateMasterSeedB64Url, ownerId, switchUid } = require('./lib/crypto');
const { validateCatalogue, addEntry } = require('./lib/validate');
const { artIds } = require('./lib/artwork');
const {
	loadJsonFile,
	saveJsonFile,
	applyCatalogue,
	refreshStates,
	delistTestSwitches,
	purgeTestDebris,
	grantPremium
} = require('./lib/apply');
const { observeCatalogue } = require('./lib/observe');

const ROOT = __dirname;
const DEFAULT_API = 'https://sync.vome.io/api';
const CATALOGUE_PATH = path.join(ROOT, 'switches.json');
const SEED_PATH = path.join(ROOT, '.seed');
const STATE_PATH = path.join(ROOT, '.local-state.json');
const DOCKER_ENV_PATH = path.join(ROOT, '..', 'docker', '.env');

function usage() {
	return `VomeSync public catalogue

Usage:
  node catalogue/cli.js uids
  node catalogue/cli.js apply [--dry-run] [--only id] [--skip-images]
  node catalogue/cli.js refresh [--dry-run] [--only id]
  node catalogue/cli.js observe [--dry-run] [--only id]
  node catalogue/cli.js add --json '{...}' [--apply]
  node catalogue/cli.js delist-tests [--dry-run]
  node catalogue/cli.js purge-debris [--dry-run]
  node catalogue/cli.js grant-premium

Environment:
  VOMESYNC_API_BASE          default ${DEFAULT_API}
  VOMESYNC_CATALOGUE_SEED    32-byte master seed (base64url)
  VOMESYNC_CATALOGUE_SEED_FILE
  ADMIN_API_KEY              for premium grant and delist
  HCAPTCHA_BYPASS_TOKEN      if live captcha is enabled
`;
}

function parseArgs(argv) {
	const args = {
		command: '',
		dryRun: false,
		skipImages: false,
		applyAfterAdd: false,
		only: [],
		json: '',
		apiBase: process.env.VOMESYNC_API_BASE || DEFAULT_API
	};
	const rest = argv.slice(2);
	if (rest.length === 0) {
		return args;
	}
	args.command = rest[0];
	for (let i = 1; i < rest.length; i += 1) {
		const token = rest[i];
		if (token === '--dry-run') {
			args.dryRun = true;
		} else if (token === '--skip-images') {
			args.skipImages = true;
		} else if (token === '--apply') {
			args.applyAfterAdd = true;
		} else if (token === '--only') {
			i += 1;
			if (!rest[i]) {
				throw new Error('--only needs an id');
			}
			args.only.push(...rest[i].split(',').map((id) => id.trim()).filter(Boolean));
		} else if (token === '--json') {
			i += 1;
			args.json = rest[i] || '';
		} else if (token === '--api') {
			i += 1;
			args.apiBase = rest[i] || args.apiBase;
		} else if (token === '--help' || token === '-h') {
			args.command = 'help';
		} else {
			throw new Error(`unknown argument: ${token}`);
		}
	}
	return args;
}

function loadDotEnv(filePath) {
	if (!fs.existsSync(filePath)) {
		return {};
	}
	const env = {};
	const text = fs.readFileSync(filePath, 'utf8');
	for (const rawLine of text.split('\n')) {
		const line = rawLine.trim();
		if (!line || line.startsWith('#')) {
			continue;
		}
		const eq = line.indexOf('=');
		if (eq <= 0) {
			continue;
		}
		const key = line.slice(0, eq).trim();
		let value = line.slice(eq + 1).trim();
		if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
			value = value.slice(1, -1);
		}
		env[key] = value;
	}
	return env;
}

function resolveAdminKey() {
	if (process.env.ADMIN_API_KEY) {
		return process.env.ADMIN_API_KEY;
	}
	const dockerEnv = loadDotEnv(DOCKER_ENV_PATH);
	return dockerEnv.ADMIN_API_KEY || '';
}

function resolveCaptchaToken() {
	return process.env.HCAPTCHA_BYPASS_TOKEN || loadDotEnv(DOCKER_ENV_PATH).HCAPTCHA_BYPASS_TOKEN || '';
}

function resolveSeedPath() {
	return process.env.VOMESYNC_CATALOGUE_SEED_FILE || SEED_PATH;
}

function loadOrCreateSeed(allowCreate) {
	if (process.env.VOMESYNC_CATALOGUE_SEED) {
		return process.env.VOMESYNC_CATALOGUE_SEED.trim();
	}
	const seedPath = resolveSeedPath();
	if (fs.existsSync(seedPath)) {
		return fs.readFileSync(seedPath, 'utf8').trim();
	}
	if (!allowCreate) {
		throw new Error(`No catalogue seed. Set VOMESYNC_CATALOGUE_SEED or create ${seedPath}`);
	}
	const seed = generateMasterSeedB64Url();
	fs.writeFileSync(seedPath, `${seed}\n`, { encoding: 'utf8', mode: 0o600 });
	console.error(`Wrote new catalogue seed to ${seedPath} (keep this file private)`);
	return seed;
}

function loadCatalogue() {
	const doc = JSON.parse(fs.readFileSync(CATALOGUE_PATH, 'utf8'));
	const switches = Array.isArray(doc) ? doc : doc.switches;
	return validateCatalogue(switches, artIds());
}

function resolveSharp() {
	const sharpPath = path.join(ROOT, '..', 'webserver', 'node_modules', 'sharp');
	return require(sharpPath);
}

function log(message) {
	console.error(message);
}

async function commandUids(seed, entries) {
	const rows = entries.map((entry) => ({
		id: entry.id,
		index: entry.index,
		uid: switchUid(seed, entry.index),
		name: entry.name
	}));
	console.log(JSON.stringify({ ownerId: ownerId(seed), switches: rows }, null, '\t'));
}

async function commandApply(args, seed, entries) {
	const result = await applyCatalogue({
		apiBase: args.apiBase,
		seed,
		entries,
		onlyIds: args.only,
		dryRun: args.dryRun,
		skipImages: args.skipImages,
		adminKey: resolveAdminKey(),
		captchaToken: resolveCaptchaToken(),
		state: loadJsonFile(STATE_PATH, { switches: {} }),
		sharp: args.skipImages || args.dryRun ? null : resolveSharp(),
		log
	});
	if (!args.dryRun) {
		saveJsonFile(STATE_PATH, result.state);
	}
	console.log(JSON.stringify({ ownerId: result.ownerId, results: result.results }, null, '\t'));
}

async function commandRefresh(args, seed, entries) {
	const results = await refreshStates({
		apiBase: args.apiBase,
		seed,
		entries,
		onlyIds: args.only,
		dryRun: args.dryRun,
		log
	});
	console.log(JSON.stringify(results, null, '\t'));
}

function loadCatalogueDocument() {
	return JSON.parse(fs.readFileSync(CATALOGUE_PATH, 'utf8'));
}

async function commandObserve(args, seed, entries) {
	const observed = await observeCatalogue({
		entries,
		onlyIds: args.only,
		fetchImpl: fetch,
		now: new Date(),
		log
	});
	validateCatalogue(observed.entries, artIds());
	if (!args.dryRun) {
		const doc = loadCatalogueDocument();
		doc.switches = observed.entries;
		saveJsonFile(CATALOGUE_PATH, doc);
		const metaIds = observed.results
			.filter((row) => row.ok && row.metaChanged)
			.map((row) => row.id);
		if (metaIds.length) {
			await commandApply({
				...args,
				only: metaIds,
				skipImages: true,
				dryRun: false
			}, seed, observed.entries);
		}
		await refreshStates({
			apiBase: args.apiBase,
			seed,
			entries: observed.entries,
			onlyIds: args.only,
			dryRun: false,
			log
		});
	}
	const failed = observed.results.filter((row) => !row.ok);
	console.log(JSON.stringify({
		observedAt: observed.now.toISOString(),
		dryRun: Boolean(args.dryRun),
		failed: failed.length,
		results: observed.results
	}, null, '\t'));
	if (failed.length && !args.dryRun) {
		log(`${failed.length} source(s) kept last state`);
	}
}

async function commandAdd(args, seed, entries) {
	if (!args.json) {
		throw new Error('add needs --json \'{"id":"…","name":"…",…}\'');
	}
	const spec = JSON.parse(args.json);
	if (!spec.art) {
		spec.art = 'full-moon';
	}
	if (!spec.schedule) {
		spec.schedule = { kind: 'manual', state: false };
	}
	const doc = JSON.parse(fs.readFileSync(CATALOGUE_PATH, 'utf8'));
	const next = addEntry(entries, spec);
	validateCatalogue(next, artIds());
	doc.switches = next;
	saveJsonFile(CATALOGUE_PATH, doc);
	const added = next[next.length - 1];
	console.error(`Added ${added.id} at index ${added.index}`);
	if (args.applyAfterAdd) {
		await commandApply({ ...args, only: [added.id] }, seed, next);
	} else {
		console.log(JSON.stringify({
			id: added.id,
			index: added.index,
			uid: switchUid(seed, added.index)
		}, null, '\t'));
	}
}

async function commandDelistTests(args) {
	const removed = await delistTestSwitches({
		apiBase: args.apiBase,
		adminKey: resolveAdminKey(),
		dryRun: args.dryRun
	});
	console.log(JSON.stringify({ delisted: removed }, null, '\t'));
}

async function commandPurgeDebris(args, seed, entries) {
	const keepUids = new Set(entries.map((entry) => switchUid(seed, entry.index)));
	const options = {
		apiBase: args.apiBase,
		adminKey: resolveAdminKey(),
		dryRun: args.dryRun,
		keepUids
	};
	try {
		const removed = await purgeTestDebris(options);
		console.log(JSON.stringify({ purged: removed, keptCatalogue: keepUids.size }, null, '\t'));
		return;
	} catch (error) {
		if (error.status !== 404) {
			throw error;
		}
		log('Admin inventory not deployed yet; reading UIDs from local Redis');
	}
	options.fallbackUids = listUidsFromDockerRedis();
	const removed = await purgeTestDebris(options);
	console.log(JSON.stringify({ purged: removed, keptCatalogue: keepUids.size, via: 'redis' }, null, '\t'));
}

function listUidsFromDockerRedis() {
	const password = loadDotEnv(DOCKER_ENV_PATH).REDIS_PASSWORD || process.env.REDIS_PASSWORD || '';
	const inner = ['redis-cli', '--no-auth-warning'];
	if (password) {
		inner.push('-a', password);
	}
	inner.push('ZRANGE', 'all_switches', '0', '-1');
	const output = execFileSync('sudo', ['-n', 'docker', 'exec', 'vomesync-redis', ...inner], {
		encoding: 'utf8'
	});
	return output.split(/\r?\n/).map((line) => line.trim()).filter((line) => /^vs_/.test(line));
}

async function commandGrantPremium(args, seed) {
	const owner = ownerId(seed);
	await grantPremium(args.apiBase, resolveAdminKey(), owner, fetch, log);
	console.log(JSON.stringify({ ownerId: owner, tier: 'premium' }, null, '\t'));
}

async function main(argv) {
	const args = parseArgs(argv);
	if (!args.command || args.command === 'help') {
		console.log(usage());
		return 0;
	}
	const allowCreateSeed = args.command === 'apply' || args.command === 'add';
	const seed = ['uids', 'apply', 'refresh', 'observe', 'add', 'grant-premium', 'purge-debris'].includes(args.command)
		? loadOrCreateSeed(allowCreateSeed)
		: '';
	const entries = ['delist-tests', 'grant-premium', 'help'].includes(args.command)
		? []
		: loadCatalogue();

	switch (args.command) {
		case 'uids':
			await commandUids(seed, entries);
			return 0;
		case 'apply':
			await commandApply(args, seed, entries);
			return 0;
		case 'refresh':
			await commandRefresh(args, seed, entries);
			return 0;
		case 'observe':
			await commandObserve(args, seed, entries);
			return 0;
		case 'add':
			await commandAdd(args, seed, entries);
			return 0;
		case 'delist-tests':
			await commandDelistTests(args);
			return 0;
		case 'purge-debris':
			await commandPurgeDebris(args, seed, entries);
			return 0;
		case 'grant-premium':
			await commandGrantPremium(args, seed);
			return 0;
		default:
			throw new Error(`unknown command: ${args.command}`);
	}
}

if (require.main === module) {
	main(process.argv).then((code) => {
		process.exitCode = code;
	}).catch((error) => {
		console.error(error.message || error);
		process.exitCode = 1;
	});
}

module.exports = {
	parseArgs,
	loadDotEnv,
	usage,
	main
};

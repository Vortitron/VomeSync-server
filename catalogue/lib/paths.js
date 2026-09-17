/**
 * Where the catalogue JSON lives.
 *
 * Git `catalogue/switches.json` is the committed definition (ids, copy, tests).
 * Observe and apply must not write that file — they use the live copy under
 * /var/lib/vomesync-catalogue so Develop does not pick up ON/OFF every five minutes.
 */
const fs = require('fs');
const path = require('path');

const REPO_DIR = path.join(__dirname, '..');
const DEFAULT_LIVE_DIR = '/var/lib/vomesync-catalogue';

function repoCataloguePath() {
	return path.join(REPO_DIR, 'switches.json');
}

function repoStatePath() {
	return path.join(REPO_DIR, '.local-state.json');
}

function liveDir(env = process.env) {
	return env.VOMESYNC_CATALOGUE_DIR || DEFAULT_LIVE_DIR;
}

function liveCataloguePath(env = process.env) {
	return env.VOMESYNC_CATALOGUE_PATH || path.join(liveDir(env), 'switches.json');
}

function liveStatePath(env = process.env) {
	return env.VOMESYNC_CATALOGUE_STATE || path.join(liveDir(env), '.local-state.json');
}

function resolveCataloguePath(env = process.env, existsSync = fs.existsSync) {
	if (env.VOMESYNC_CATALOGUE_PATH) {
		return env.VOMESYNC_CATALOGUE_PATH;
	}
	const live = liveCataloguePath(env);
	if (existsSync(live)) {
		return live;
	}
	return repoCataloguePath();
}

function resolveStatePath(env = process.env, existsSync = fs.existsSync) {
	if (env.VOMESYNC_CATALOGUE_STATE) {
		return env.VOMESYNC_CATALOGUE_STATE;
	}
	const cataloguePath = resolveCataloguePath(env, existsSync);
	if (cataloguePath === liveCataloguePath(env)) {
		return liveStatePath(env);
	}
	return repoStatePath();
}

function installLiveCatalogue(options = {}) {
	const env = options.env || process.env;
	const existsSync = options.existsSync || fs.existsSync;
	const mkdirSync = options.mkdirSync || fs.mkdirSync;
	const copyFileSync = options.copyFileSync || fs.copyFileSync;
	const dir = liveDir(env);
	if (!existsSync(dir)) {
		mkdirSync(dir, { recursive: true, mode: 0o755 });
	}
	const liveJson = liveCataloguePath(env);
	const copied = [];
	if (!existsSync(liveJson)) {
		copyFileSync(repoCataloguePath(), liveJson);
		copied.push(liveJson);
	}
	const liveState = liveStatePath(env);
	const repoState = repoStatePath();
	if (!existsSync(liveState) && existsSync(repoState)) {
		copyFileSync(repoState, liveState);
		copied.push(liveState);
	}
	return { dir, cataloguePath: liveJson, statePath: liveState, copied };
}

function syncRepoIntoLive(options = {}) {
	const env = options.env || process.env;
	const loadJson = options.loadJson;
	const saveJson = options.saveJson;
	if (typeof loadJson !== 'function' || typeof saveJson !== 'function') {
		throw new Error('syncRepoIntoLive needs loadJson and saveJson');
	}
	const livePath = liveCataloguePath(env);
	const existsSync = options.existsSync || fs.existsSync;
	if (!existsSync(livePath)) {
		return installLiveCatalogue(options);
	}
	const repoDoc = loadJson(repoCataloguePath());
	const liveDoc = loadJson(livePath);
	const repoSwitches = Array.isArray(repoDoc.switches) ? repoDoc.switches : repoDoc;
	const liveSwitches = Array.isArray(liveDoc.switches) ? liveDoc.switches : liveDoc;
	const have = new Set(liveSwitches.map((entry) => entry.id));
	let added = 0;
	for (const entry of repoSwitches) {
		if (!have.has(entry.id)) {
			liveSwitches.push(entry);
			have.add(entry.id);
			added += 1;
		}
	}
	const next = Array.isArray(liveDoc.switches)
		? { ...liveDoc, switches: liveSwitches }
		: liveSwitches;
	saveJson(livePath, next);
	return { cataloguePath: livePath, added, total: liveSwitches.length };
}

module.exports = {
	DEFAULT_LIVE_DIR,
	repoCataloguePath,
	repoStatePath,
	liveDir,
	liveCataloguePath,
	liveStatePath,
	resolveCataloguePath,
	resolveStatePath,
	installLiveCatalogue,
	syncRepoIntoLive
};

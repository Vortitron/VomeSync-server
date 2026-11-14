const fs = require('fs');
const path = require('path');
const semver = require('semver');

// The Docker image pins a Node major; npm ci installs whatever the lockfile
// says. Nothing tied the two together, so on 20 Oct 2026 a sharp bump
// (0.35, Node >= 20.9) shipped onto node:18-alpine and the dev backend
// crash-looped at require('sharp'). Live only escaped because it had not
// been redeployed yet.

const root = path.join(__dirname, '..', '..');

function imageNodeMajor() {
	const dockerfile = fs.readFileSync(path.join(root, 'Dockerfile'), 'utf8');
	const match = dockerfile.match(/^FROM node:(\d+)(?:[.-]|$)/m);
	if (!match) throw new Error('Dockerfile does not start FROM node:<major>');
	return Number(match[1]);
}

describe('Node runtime in the Docker image', () => {
	// node:<major>-alpine floats to that major's newest release, so the image
	// is "the latest <major>.x", never an early minor.
	const imageNode = `${imageNodeMajor()}.9999.0`;

	test('satisfies our own engines field', () => {
		const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
		expect(semver.satisfies(imageNode, pkg.engines.node)).toBe(true);
	});

	test('satisfies every production dependency that declares engines.node', () => {
		const lock = JSON.parse(fs.readFileSync(path.join(root, 'package-lock.json'), 'utf8'));
		const refused = Object.entries(lock.packages)
			.filter(([name, meta]) => name && !meta.dev && meta.engines && meta.engines.node)
			// Prebuilt binaries for other platforms (sharp's win32 one) never install here.
			.filter(([, meta]) => !meta.os || meta.os.includes('linux'))
			.filter(([, meta]) => {
				const range = meta.engines.node;
				return semver.validRange(range) && !semver.satisfies(imageNode, range);
			})
			.map(([name, meta]) => `${name.replace(/^node_modules\//, '')} needs node ${meta.engines.node}`);
		expect(refused).toEqual([]);
	});
});

/**
 * Crawlable pages for the public directory.
 *
 * The site is one HTML shell. Switch URLs were the same title, and
 * robots.txt pointed at a sitemap that did not exist, so Google had
 * nothing distinct to index. This writes sitemap.xml and a copy of the
 * shell per switch, with that switch's title, description, and canonical URL.
 */
const fs = require('fs');
const path = require('path');

const SITE_ORIGIN = 'https://sync.vome.io';
const UID_PATTERN = /^vs_[0-9a-hjkmnpqrstvwxyz]{26}$/i;
const META_DESCRIPTION_LENGTH = 160;

function escapeHtml(value) {
	return String(value || '')
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;');
}

function escapeXml(value) {
	return escapeHtml(value);
}

function publicSwitches(payload) {
	const data = payload && payload.data;
	const switches = data && Array.isArray(data.switches) ? data.switches : null;
	if (!switches) {
		throw new Error('public switches payload has no data.switches list');
	}
	return switches.filter((entry) => entry && UID_PATTERN.test(String(entry.uid || '')));
}

function switchPageTitle(entry) {
	const name = String((entry && entry.name) || 'Public switch').trim() || 'Public switch';
	return `${name} — VomeSync`;
}

function switchMetaDescription(entry) {
	const description = String((entry && entry.description) || '').replace(/\s+/g, ' ').trim();
	const name = String((entry && entry.name) || 'This switch').trim();
	const location = String((entry && entry.location) || '').trim();
	const text = description || `${name} is a public on/off switch for Home Assistant${location ? ` (${location})` : ''}.`;
	if (text.length <= META_DESCRIPTION_LENGTH) {
		return text;
	}
	return `${text.slice(0, META_DESCRIPTION_LENGTH - 1).replace(/\s+\S*$/, '')}…`;
}

function switchUrl(entry) {
	return `${SITE_ORIGIN}/switch/${entry.uid}`;
}

function sitemapXml(switches) {
	const urls = [`\t<url><loc>${escapeXml(`${SITE_ORIGIN}/`)}</loc><changefreq>hourly</changefreq></url>`];
	for (const entry of switches) {
		urls.push(`\t<url><loc>${escapeXml(switchUrl(entry))}</loc><changefreq>hourly</changefreq></url>`);
	}
	return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.join('\n')}\n</urlset>\n`;
}

function jsonLd(entry) {
	const payload = {
		'@context': 'https://schema.org',
		'@type': 'WebPage',
		name: String(entry.name || 'Public switch'),
		description: switchMetaDescription(entry),
		url: switchUrl(entry),
		isPartOf: {
			'@type': 'WebSite',
			name: 'VomeSync',
			url: `${SITE_ORIGIN}/`
		}
	};
	return JSON.stringify(payload).replace(/</g, '\\u003c');
}

function headExtras(entry) {
	const title = switchPageTitle(entry);
	const description = switchMetaDescription(entry);
	const url = switchUrl(entry);
	return [
		`<link rel="canonical" href="${escapeHtml(url)}">`,
		`<meta property="og:title" content="${escapeHtml(title)}">`,
		`<meta property="og:description" content="${escapeHtml(description)}">`,
		`<meta property="og:url" content="${escapeHtml(url)}">`,
		'<meta property="og:type" content="website">',
		`<script type="application/ld+json">${jsonLd(entry)}</script>`
	].join('\n\t');
}

function renderSwitchHtml(templateHtml, entry) {
	if (!UID_PATTERN.test(String(entry.uid || ''))) {
		throw new Error('switch page needs a v2 uid');
	}
	const title = switchPageTitle(entry);
	const description = switchMetaDescription(entry);
	let html = String(templateHtml || '');
	if (!/<title>[^<]*<\/title>/.test(html) || !html.includes('</head>')) {
		throw new Error('switch page template is missing title or head');
	}
	html = html.replace(/<title>[^<]*<\/title>/, `<title>${escapeHtml(title)}</title>`);
	html = html.replace(
		/<meta name="description" content="[^"]*">/,
		`<meta name="description" content="${escapeHtml(description)}">`
	);
	return html.replace('</head>', `\t${headExtras(entry)}\n</head>`);
}

function writeSeoSite(options) {
	const switches = options.switches || [];
	const websiteDir = options.websiteDir;
	const templateHtml = options.templateHtml;
	const mkdirSync = options.mkdirSync || fs.mkdirSync;
	const writeFileSync = options.writeFileSync || fs.writeFileSync;
	const readdirSync = options.readdirSync || fs.readdirSync;
	const rmSync = options.rmSync || fs.rmSync;
	if (!websiteDir || !templateHtml) {
		throw new Error('writeSeoSite needs websiteDir and templateHtml');
	}
	const switchDir = path.join(websiteDir, 'switch');
	mkdirSync(switchDir, { recursive: true });
	const keep = new Set();
	for (const entry of switches) {
		const uid = String(entry.uid);
		keep.add(uid);
		const dir = path.join(switchDir, uid);
		mkdirSync(dir, { recursive: true });
		writeFileSync(path.join(dir, 'index.html'), renderSwitchHtml(templateHtml, entry));
	}
	let removed = 0;
	if (typeof readdirSync === 'function') {
		for (const name of readdirSync(switchDir)) {
			if (keep.has(name) || !UID_PATTERN.test(name)) {
				continue;
			}
			rmSync(path.join(switchDir, name), { recursive: true, force: true });
			removed += 1;
		}
	}
	writeFileSync(path.join(websiteDir, 'sitemap.xml'), sitemapXml(switches));
	return { pages: switches.length, removed };
}

module.exports = {
	SITE_ORIGIN,
	publicSwitches,
	switchPageTitle,
	switchMetaDescription,
	sitemapXml,
	renderSwitchHtml,
	writeSeoSite
};

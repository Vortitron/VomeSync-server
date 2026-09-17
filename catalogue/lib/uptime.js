/**
 * Public IsUp lamps. ON while the official status feed says operational,
 * OFF for any incident (minor, major, or critical) or a stale fetch.
 *
 * Statuspage JSON only — hitting the product homepage false-positives on
 * bot walls and partial outages. xAI (status.x.ai), Groq, Mistral and
 * Perplexity are omitted: they 403 or return HTML to anonymous clients.
 */
const { fetchJson } = require('./http');

const WORKSPACE_INCIDENTS_URL = 'https://www.google.com/appsstatus/dashboard/incidents.json';
const CLOUD_INCIDENTS_URL = 'https://status.cloud.google.com/incidents.json';
const SLACK_STATUS_URL = 'https://status.slack.com/api/v2.0.0/current';
const GEMINI_NAME = /gemini/i;
const STALE_AFTER_HOURS = 2;

function uptimeObserveSpecs() {
	return [
		{
			id: 'github-up',
			name: 'GitHub is up',
			description: 'ON while GitHub reports all systems operational. Pause HACS, ESPHome, or git pulls when it drops. Source: githubstatus.com.',
			onMeans: 'GitHub reports all systems operational.',
			offMeans: 'GitHub reports an incident, or the status feed is stale.',
			link: 'https://www.githubstatus.com/',
			art: 'uptime',
			kind: 'statuspage',
			statusUrl: 'https://www.githubstatus.com/api/v2/status.json'
		},
		{
			id: 'openai-up',
			name: 'OpenAI is up',
			description: 'ON while OpenAI reports all systems operational. Skip conversation agents or image jobs that need their API. Source: status.openai.com.',
			onMeans: 'OpenAI reports all systems operational.',
			offMeans: 'OpenAI reports an incident, or the status feed is stale.',
			link: 'https://status.openai.com/',
			art: 'uptime-ai',
			kind: 'statuspage',
			statusUrl: 'https://status.openai.com/api/v2/status.json'
		},
		{
			id: 'anthropic-up',
			name: 'Claude is up',
			description: 'ON while Anthropic reports Claude as operational. Skip HA conversation that talks to Claude. Source: status.claude.com.',
			onMeans: 'Anthropic reports all systems operational.',
			offMeans: 'Anthropic reports an incident, or the status feed is stale.',
			link: 'https://status.claude.com/',
			art: 'uptime-ai',
			kind: 'statuspage',
			statusUrl: 'https://status.claude.com/api/v2/status.json'
		},
		{
			id: 'gemini-up',
			name: 'Google Gemini is up',
			description: 'ON while Google lists no open Gemini incident (Workspace Gemini and Cloud/Vertex Gemini). Skip HA conversation that uses Gemini. Sources: Google Workspace and Cloud status.',
			onMeans: 'No open Gemini incident on Google Workspace or Cloud status.',
			offMeans: 'An open Gemini incident is listed, or the status feed is stale.',
			link: 'https://aistudio.google.com/status',
			art: 'uptime-ai',
			kind: 'google-gemini'
		},
		{
			id: 'home-assistant-up',
			name: 'Home Assistant is up',
			description: 'ON while Home Assistant\'s official status page reports all systems operational (alerts, version, analytics — not your own box). Source: status.home-assistant.io.',
			onMeans: 'Home Assistant reports all systems operational.',
			offMeans: 'Home Assistant reports an incident, or the status feed is stale.',
			link: 'https://status.home-assistant.io/',
			art: 'uptime',
			kind: 'statuspage',
			statusUrl: 'https://status.home-assistant.io/api/v2/status.json'
		},
		{
			id: 'nabucasa-up',
			name: 'Home Assistant Cloud is up',
			description: 'ON while Nabu Casa reports Home Assistant Cloud as operational. Pause remote UI or cloud TTS when it drops. Source: status.nabucasa.com.',
			onMeans: 'Nabu Casa reports all systems operational.',
			offMeans: 'Nabu Casa reports an incident, or the status feed is stale.',
			link: 'https://status.nabucasa.com/',
			art: 'uptime',
			kind: 'statuspage',
			statusUrl: 'https://status.nabucasa.com/api/v2/status.json'
		},
		{
			id: 'cloudflare-up',
			name: 'Cloudflare is up',
			description: 'ON while Cloudflare reports all systems operational. Tunnels, DNS, and a lot of the public web sit behind this. Source: cloudflarestatus.com.',
			onMeans: 'Cloudflare reports all systems operational.',
			offMeans: 'Cloudflare reports an incident, or the status feed is stale.',
			link: 'https://www.cloudflarestatus.com/',
			art: 'uptime',
			kind: 'statuspage',
			statusUrl: 'https://www.cloudflarestatus.com/api/v2/status.json'
		},
		{
			id: 'discord-up',
			name: 'Discord is up',
			description: 'ON while Discord reports all systems operational. Pause notify.discord automations when it drops. Source: discordstatus.com.',
			onMeans: 'Discord reports all systems operational.',
			offMeans: 'Discord reports an incident, or the status feed is stale.',
			link: 'https://discordstatus.com/',
			art: 'uptime',
			kind: 'statuspage',
			statusUrl: 'https://discordstatus.com/api/v2/status.json'
		},
		{
			id: 'slack-up',
			name: 'Slack is up',
			description: 'ON while Slack reports status ok with no active incidents. Pause notify.slack when it drops. Source: status.slack.com.',
			onMeans: 'Slack reports status ok and no active incidents.',
			offMeans: 'Slack reports an incident, or the status feed is stale.',
			link: 'https://status.slack.com/',
			art: 'uptime',
			kind: 'slack',
			statusUrl: SLACK_STATUS_URL
		},
		{
			id: 'twilio-up',
			name: 'Twilio is up',
			description: 'ON while Twilio reports all systems operational. Pause SMS and voice notify when it drops. Source: status.twilio.com.',
			onMeans: 'Twilio reports all systems operational.',
			offMeans: 'Twilio reports an incident, or the status feed is stale.',
			link: 'https://status.twilio.com/',
			art: 'uptime',
			kind: 'statuspage',
			statusUrl: 'https://status.twilio.com/api/v2/status.json'
		},
		{
			id: 'reddit-up',
			name: 'Reddit is up',
			description: 'ON while Reddit reports all systems operational. A community lamp for when the front page is actually down. Source: redditstatus.com.',
			onMeans: 'Reddit reports all systems operational.',
			offMeans: 'Reddit reports an incident, or the status feed is stale.',
			link: 'https://www.redditstatus.com/',
			art: 'uptime',
			kind: 'statuspage',
			statusUrl: 'https://www.redditstatus.com/api/v2/status.json'
		},
		{
			id: 'wikipedia-up',
			name: 'Wikipedia is up',
			description: 'ON while Wikimedia reports all systems operational. Pause automations that fetch Wikipedia. Source: wikimediastatus.net.',
			onMeans: 'Wikimedia reports all systems operational.',
			offMeans: 'Wikimedia reports an incident, or the status feed is stale.',
			link: 'https://www.wikimediastatus.net/',
			art: 'uptime',
			kind: 'statuspage',
			statusUrl: 'https://www.wikimediastatus.net/api/v2/status.json'
		},
		{
			id: 'npm-up',
			name: 'npm is up',
			description: 'ON while npm reports all systems operational. Pause HACS or frontend builds that pull packages. Source: status.npmjs.org.',
			onMeans: 'npm reports all systems operational.',
			offMeans: 'npm reports an incident, or the status feed is stale.',
			link: 'https://status.npmjs.org/',
			art: 'uptime',
			kind: 'statuspage',
			statusUrl: 'https://status.npmjs.org/api/v2/status.json'
		},
		{
			id: 'pypi-up',
			name: 'PyPI is up',
			description: 'ON while the Python package index reports all systems operational. Pause custom-component installs that hit PyPI. Source: status.python.org.',
			onMeans: 'PyPI reports all systems operational.',
			offMeans: 'PyPI reports an incident, or the status feed is stale.',
			link: 'https://status.python.org/',
			art: 'uptime',
			kind: 'statuspage',
			statusUrl: 'https://status.python.org/api/v2/status.json'
		},
		{
			id: 'google-up',
			name: 'Google Workspace is up',
			description: 'ON while Google Workspace lists no open incident (Gmail, Drive, Meet, Gemini in Workspace). Search and YouTube are not this feed. Source: Google Workspace Status Dashboard.',
			onMeans: 'Google Workspace lists no open incident.',
			offMeans: 'An open Workspace incident is listed, or the status feed is stale.',
			link: 'https://www.google.com/appsstatus/dashboard/',
			art: 'uptime',
			kind: 'google-workspace'
		}
	];
}

function uptimeListing(spec) {
	return {
		id: spec.id,
		name: spec.name,
		description: spec.description,
		location: 'Worldwide',
		category: 'IsUp',
		link: spec.link,
		art: spec.art,
		onMeans: spec.onMeans,
		offMeans: spec.offMeans,
		schedule: {
			kind: 'observe',
			source: spec.id,
			state: false,
			staleAfterHours: STALE_AFTER_HOURS
		}
	};
}

function extraUptimeSpecs() {
	return uptimeObserveSpecs().map((spec) => uptimeListing(spec));
}

function statuspageIndicator(payload) {
	const indicator = payload && payload.status && payload.status.indicator;
	if (typeof indicator !== 'string' || !indicator.trim()) {
		throw new Error('statuspage indicator missing');
	}
	return indicator.trim().toLowerCase();
}

function statuspageIsUp(payload) {
	return statuspageIndicator(payload) === 'none';
}

function slackIsUp(payload) {
	if (!payload || typeof payload.status !== 'string' || !payload.status.trim()) {
		throw new Error('slack status missing');
	}
	const incidents = Array.isArray(payload.active_incidents) ? payload.active_incidents : [];
	return payload.status.trim().toLowerCase() === 'ok' && incidents.length === 0;
}

function googleIncidentMatches(row, servicePattern) {
	const parts = [row.service_name];
	for (const product of Array.isArray(row.affected_products) ? row.affected_products : []) {
		parts.push(product && product.title, product && product.current_title);
	}
	return servicePattern.test(parts.filter(Boolean).join(' '));
}

function googleOpenIncidents(payload, servicePattern) {
	if (!Array.isArray(payload)) {
		throw new Error('google incidents payload is not a list');
	}
	const open = [];
	for (const row of payload) {
		if (!row || row.end) {
			continue;
		}
		if (servicePattern && !googleIncidentMatches(row, servicePattern)) {
			continue;
		}
		open.push(row);
	}
	return open;
}

function statuspageResult(spec, payload) {
	const indicator = statuspageIndicator(payload);
	const description = String(((payload.status) || {}).description || '');
	return {
		on: indicator === 'none',
		params: {
			source: spec.statusUrl,
			indicator,
			description
		}
	};
}

function googleResult(source, openRows) {
	const names = openRows
		.slice(0, 4)
		.map((row) => String(row.service_name || row.external_desc || row.id || ''))
		.filter(Boolean);
	return {
		on: openRows.length === 0,
		params: {
			source,
			open: openRows.length,
			names: names.join(', ')
		}
	};
}

async function observeUptime(sourceId, options) {
	const spec = uptimeObserveSpecs().find((row) => row.id === sourceId);
	if (!spec) {
		throw new Error(`unknown uptime source ${sourceId}`);
	}
	if (spec.kind === 'statuspage') {
		const payload = await fetchJson(spec.statusUrl, options);
		return statuspageResult(spec, payload);
	}
	if (spec.kind === 'slack') {
		const payload = await fetchJson(spec.statusUrl, options);
		const incidents = Array.isArray(payload.active_incidents) ? payload.active_incidents : [];
		return {
			on: slackIsUp(payload),
			params: {
				source: spec.statusUrl,
				status: String(payload.status || ''),
				incidents: incidents.length
			}
		};
	}
	if (spec.kind === 'google-workspace') {
		const payload = await fetchJson(WORKSPACE_INCIDENTS_URL, options);
		return googleResult(WORKSPACE_INCIDENTS_URL, googleOpenIncidents(payload));
	}
	if (spec.kind === 'google-gemini') {
		const [workspace, cloud] = await Promise.all([
			fetchJson(WORKSPACE_INCIDENTS_URL, options),
			fetchJson(CLOUD_INCIDENTS_URL, options)
		]);
		const openWorkspace = googleOpenIncidents(workspace, GEMINI_NAME);
		const openCloud = googleOpenIncidents(cloud, GEMINI_NAME);
		const openRows = openWorkspace.concat(openCloud);
		return {
			on: openRows.length === 0,
			params: {
				source: 'google-gemini',
				workspace: openWorkspace.length,
				cloud: openCloud.length
			}
		};
	}
	throw new Error(`unknown uptime kind ${spec.kind}`);
}

module.exports = {
	extraUptimeSpecs,
	observeUptime,
	statuspageIsUp,
	slackIsUp,
	googleOpenIncidents
};

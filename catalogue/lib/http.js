/**
 * Small fetch helper for catalogue observers. Always send a contactable
 * User-Agent: a few of the sources (Parliament, NOAA) 403 anonymous clients.
 */
const DEFAULT_TIMEOUT_MS = 15000;
const USER_AGENT = 'VomeSync-catalogue/1.0 (+https://sync.vome.io)';

async function fetchResponse(url, options = {}) {
	const fetchImpl = options.fetchImpl || fetch;
	const timeoutMs = Number.isFinite(options.timeoutMs) ? options.timeoutMs : DEFAULT_TIMEOUT_MS;
	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), timeoutMs);
	let response;
	try {
		response = await fetchImpl(url, {
			method: options.method || 'GET',
			headers: {
				'User-Agent': USER_AGENT,
				Accept: options.accept || '*/*',
				...(options.headers || {})
			},
			signal: controller.signal
		});
	} finally {
		clearTimeout(timer);
	}
	if (options.ok === false) {
		return response;
	}
	if (!response.ok) {
		throw new Error(`${url} → HTTP ${response.status}`);
	}
	return response;
}

async function fetchText(url, options = {}) {
	const response = await fetchResponse(url, options);
	return response.text();
}

async function fetchJson(url, options = {}) {
	const response = await fetchResponse(url, {
		...options,
		accept: options.accept || 'application/json'
	});
	return response.json();
}

module.exports = {
	DEFAULT_TIMEOUT_MS,
	USER_AGENT,
	fetchResponse,
	fetchText,
	fetchJson
};

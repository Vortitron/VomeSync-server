const crypto = require('crypto');
const DEFAULT_TIMEOUT_MS = 20000;

function joinUrl(apiBase, path) {
	const base = String(apiBase || '').replace(/\/+$/, '');
	const suffix = path.startsWith('/') ? path : `/${path}`;
	return `${base}${suffix}`;
}

async function parseJson(response) {
	const text = await response.text();
	if (!text) {
		return {};
	}
	try {
		return JSON.parse(text);
	} catch {
		throw new Error(`Non-JSON response (${response.status}): ${text.slice(0, 180)}`);
	}
}

async function requestJson(fetchImpl, apiBase, path, options = {}) {
	const fetchFn = fetchImpl || fetch;
	const headers = { ...(options.headers || {}) };
	if (options.body !== undefined && !headers['Content-Type'] && !(options.body instanceof FormData)) {
		headers['Content-Type'] = 'application/json';
	}
	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), options.timeoutMs || DEFAULT_TIMEOUT_MS);
	let response;
	try {
		response = await fetchFn(joinUrl(apiBase, path), {
			method: options.method || 'GET',
			headers,
			body: options.body instanceof FormData
				? options.body
				: (options.body !== undefined ? JSON.stringify(options.body) : undefined),
			signal: controller.signal
		});
	} finally {
		clearTimeout(timer);
	}
	const payload = await parseJson(response);
	if (!response.ok || payload.success === false) {
		const message = payload.error || `HTTP ${response.status}`;
		const error = new Error(message);
		error.status = response.status;
		error.payload = payload;
		throw error;
	}
	return payload;
}

function sha256Hex(buffer) {
	return crypto.createHash('sha256').update(buffer).digest('hex');
}

module.exports = {
	DEFAULT_TIMEOUT_MS,
	joinUrl,
	requestJson,
	sha256Hex
};

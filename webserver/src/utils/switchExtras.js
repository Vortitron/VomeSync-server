/**
 * Switch extras: fixed properties, per-change note/params, commerce settings
 * and reward offers. Pure validation and shaping; no Redis, no Stripe.
 *
 * The contract is docs/SWITCH_EXTRAS.md. Every function here either returns
 * a cleaned value or throws an ExtrasError whose message is safe to show.
 */

const MAX_PROPERTIES = 12;
const PROPERTY_KEY = /^[a-z][a-z0-9_]{0,31}$/;
const MAX_PROPERTY_VALUE = 200;

const MAX_NOTE = 280;
const MAX_VISITOR_MESSAGE = 140;
const MAX_PARAMS_KEYS = 16;
const PARAM_KEY = /^[A-Za-z][A-Za-z0-9_]{0,31}$/;
const MAX_PARAM_STRING = 200;
const MAX_PARAM_ARRAY = 8;
const MAX_PARAMS_JSON = 2048;

const TOGGLE_MODES = ['owner', 'public', 'paid'];
const ACTIONS = ['toggle', 'on', 'off'];
const REWARD_ON = ['on', 'off', 'any'];
const MAX_SECONDS = 3600;
const PUBLIC_MIN_COOLDOWN_SECONDS = 5;
const MAX_COMMERCE_NOTE = 200;
const MAX_URL = 500;

// Minor units. SEK has a higher floor because 1 kr does not cover the card fee.
const CURRENCIES = {
	eur: { min: 100, max: 50000 },
	gbp: { min: 100, max: 50000 },
	usd: { min: 100, max: 50000 },
	sek: { min: 1000, max: 500000 }
};

const COMMERCE_DEFAULTS = Object.freeze({
	toggleMode: 'owner',
	action: 'toggle',
	holdSeconds: 0,
	cooldownSeconds: 10,
	price: null,
	tips: false,
	allowMessage: false,
	note: '',
	payLink: '',
	webhookUrl: ''
});

class ExtrasError extends Error {
	constructor(message) {
		super(message);
		this.name = 'ExtrasError';
		this.expose = true;
	}
}

const isPlainObject = (value) => Boolean(value)
	&& typeof value === 'object'
	&& !Array.isArray(value)
	&& Object.getPrototypeOf(value) === Object.prototype;

// Multipart bodies carry objects as JSON strings.
function parseMaybeJson(value, field) {
	if (typeof value !== 'string') {
		return value;
	}
	const trimmed = value.trim();
	if (trimmed === '' || trimmed === 'null') {
		return null;
	}
	try {
		return JSON.parse(trimmed);
	} catch {
		throw new ExtrasError(`${field} must be a JSON object`);
	}
}

// Strip control characters and collapse runs of whitespace.
function cleanText(value) {
	return String(value)
		// eslint-disable-next-line no-control-regex
		.replace(/[\u0000-\u001f\u007f-\u009f​-‏‪-‮⁦-⁩]/g, ' ')
		.replace(/\s+/g, ' ')
		.trim();
}

function cleanPropertyValue(key, value) {
	if (typeof value === 'boolean') {
		return value;
	}
	if (typeof value === 'number') {
		if (!Number.isFinite(value)) {
			throw new ExtrasError(`Property ${key} must be a finite number`);
		}
		return value;
	}
	if (typeof value === 'string') {
		const text = cleanText(value);
		if (text.length > MAX_PROPERTY_VALUE) {
			throw new ExtrasError(`Property ${key} is longer than ${MAX_PROPERTY_VALUE} characters`);
		}
		return text;
	}
	throw new ExtrasError(`Property ${key} must be text, a number or true/false`);
}

/**
 * Validate a properties map. With `allowNullDeletes`, a null value means
 * "remove this key" and is kept as null for mergeProperties to act on.
 */
function cleanProperties(raw, { allowNullDeletes = false } = {}) {
	const value = parseMaybeJson(raw, 'properties');
	if (value === null || value === undefined) {
		return {};
	}
	if (!isPlainObject(value)) {
		throw new ExtrasError('properties must be an object');
	}
	const entries = Object.entries(value);
	const out = {};
	for (const [key, val] of entries) {
		if (!PROPERTY_KEY.test(key)) {
			throw new ExtrasError(`Property name "${String(key).slice(0, 40)}" must be lower case letters, digits or _ (max 32, starting with a letter)`);
		}
		if (val === null && allowNullDeletes) {
			out[key] = null;
			continue;
		}
		out[key] = cleanPropertyValue(key, val);
	}
	const kept = Object.values(out).filter((v) => v !== null).length;
	if (kept > MAX_PROPERTIES) {
		throw new ExtrasError(`At most ${MAX_PROPERTIES} properties`);
	}
	return out;
}

function mergeProperties(existing, patch) {
	const base = isPlainObject(existing) ? { ...existing } : {};
	for (const [key, val] of Object.entries(patch || {})) {
		if (val === null) {
			delete base[key];
		} else {
			base[key] = val;
		}
	}
	if (Object.keys(base).length > MAX_PROPERTIES) {
		throw new ExtrasError(`At most ${MAX_PROPERTIES} properties`);
	}
	return base;
}

function cleanNote(raw, max = MAX_NOTE) {
	if (raw === undefined || raw === null) {
		return '';
	}
	if (typeof raw !== 'string') {
		throw new ExtrasError('note must be text');
	}
	const text = cleanText(raw);
	if (text.length > max) {
		throw new ExtrasError(`note is longer than ${max} characters`);
	}
	return text;
}

// A visitor's message is shown on a public page: short, and no links.
function cleanVisitorMessage(raw) {
	const text = cleanNote(raw, MAX_VISITOR_MESSAGE);
	if (/https?:|www\.|\.[a-z]{2,}\//i.test(text)) {
		throw new ExtrasError('Messages cannot contain links');
	}
	return text;
}

function cleanParamValue(key, value) {
	if (value === null || typeof value === 'boolean') {
		return value;
	}
	if (typeof value === 'number') {
		if (!Number.isFinite(value)) {
			throw new ExtrasError(`params.${key} must be a finite number`);
		}
		return value;
	}
	if (typeof value === 'string') {
		if (value.length > MAX_PARAM_STRING) {
			throw new ExtrasError(`params.${key} is longer than ${MAX_PARAM_STRING} characters`);
		}
		return value;
	}
	if (Array.isArray(value)) {
		if (value.length > MAX_PARAM_ARRAY) {
			throw new ExtrasError(`params.${key} has more than ${MAX_PARAM_ARRAY} items`);
		}
		for (const item of value) {
			const okNumber = typeof item === 'number' && Number.isFinite(item);
			const okString = typeof item === 'string' && item.length <= MAX_PARAM_STRING;
			if (!okNumber && !okString) {
				throw new ExtrasError(`params.${key} may only hold numbers and short text`);
			}
		}
		return value;
	}
	throw new ExtrasError(`params.${key} cannot be a nested object`);
}

/**
 * Validate per-change params. Values are kept exactly as sent (no trimming)
 * because the signed set_state canonical JSON includes them.
 */
function cleanParams(raw) {
	if (raw === undefined || raw === null) {
		return {};
	}
	if (!isPlainObject(raw)) {
		throw new ExtrasError('params must be an object');
	}
	const entries = Object.entries(raw);
	if (entries.length > MAX_PARAMS_KEYS) {
		throw new ExtrasError(`params has more than ${MAX_PARAMS_KEYS} keys`);
	}
	const out = {};
	for (const [key, val] of entries) {
		if (!PARAM_KEY.test(key)) {
			throw new ExtrasError(`params key "${String(key).slice(0, 40)}" is not allowed`);
		}
		out[key] = cleanParamValue(key, val);
	}
	if (JSON.stringify(out).length > MAX_PARAMS_JSON) {
		throw new ExtrasError(`params is larger than ${MAX_PARAMS_JSON} bytes`);
	}
	return out;
}

function cleanSeconds(value, field) {
	const n = Number(value);
	if (!Number.isInteger(n) || n < 0 || n > MAX_SECONDS) {
		throw new ExtrasError(`${field} must be a whole number of seconds from 0 to ${MAX_SECONDS}`);
	}
	return n;
}

function cleanCurrency(value) {
	const currency = String(value || '').toLowerCase();
	if (!CURRENCIES[currency]) {
		throw new ExtrasError(`Currency must be one of ${Object.keys(CURRENCIES).join(', ')}`);
	}
	return currency;
}

function cleanAmount(amount, currency, field = 'amount') {
	const n = Number(amount);
	const limits = CURRENCIES[currency];
	if (!Number.isInteger(n) || n < limits.min || n > limits.max) {
		throw new ExtrasError(`${field} must be between ${limits.min} and ${limits.max} (minor units of ${currency.toUpperCase()})`);
	}
	return n;
}

function cleanMoney(raw, field) {
	if (raw === null || raw === undefined) {
		return null;
	}
	if (!isPlainObject(raw)) {
		throw new ExtrasError(`${field} must be { amount, currency }`);
	}
	const currency = cleanCurrency(raw.currency);
	return { amount: cleanAmount(raw.amount, currency, `${field}.amount`), currency };
}

function cleanUrl(value, field) {
	if (value === undefined || value === null || value === '') {
		return '';
	}
	if (typeof value !== 'string' || value.length > MAX_URL) {
		throw new ExtrasError(`${field} must be a URL of at most ${MAX_URL} characters`);
	}
	let parsed;
	try {
		parsed = new URL(value.trim());
	} catch {
		throw new ExtrasError(`${field} must be a valid URL`);
	}
	if (parsed.protocol !== 'https:' && !(field === 'payLink' && parsed.protocol === 'http:')) {
		throw new ExtrasError(`${field} must use https`);
	}
	if (parsed.username || parsed.password) {
		throw new ExtrasError(`${field} cannot contain a user name or password`);
	}
	return parsed.toString();
}

const COMMERCE_CLEANERS = {
	toggleMode: (v) => {
		if (!TOGGLE_MODES.includes(v)) {
			throw new ExtrasError(`toggleMode must be one of ${TOGGLE_MODES.join(', ')}`);
		}
		return v;
	},
	action: (v) => {
		if (!ACTIONS.includes(v)) {
			throw new ExtrasError(`action must be one of ${ACTIONS.join(', ')}`);
		}
		return v;
	},
	holdSeconds: (v) => cleanSeconds(v, 'holdSeconds'),
	cooldownSeconds: (v) => cleanSeconds(v, 'cooldownSeconds'),
	price: (v) => cleanMoney(v, 'price'),
	tips: (v) => Boolean(v),
	allowMessage: (v) => Boolean(v),
	note: (v) => cleanNote(v, MAX_COMMERCE_NOTE),
	payLink: (v) => cleanUrl(v, 'payLink'),
	webhookUrl: (v) => cleanUrl(v, 'webhookUrl')
};

/**
 * Validate commerce settings. `partial` keeps only the fields sent (for an
 * access-key merge); otherwise missing fields take their defaults.
 */
function cleanCommerce(raw, { partial = false } = {}) {
	const value = parseMaybeJson(raw, 'commerce');
	if (value === null || value === undefined) {
		return partial ? {} : { ...COMMERCE_DEFAULTS };
	}
	if (!isPlainObject(value)) {
		throw new ExtrasError('commerce must be an object');
	}
	const out = partial ? {} : { ...COMMERCE_DEFAULTS };
	for (const [key, val] of Object.entries(value)) {
		const clean = COMMERCE_CLEANERS[key];
		if (!clean) {
			throw new ExtrasError(`Unknown commerce field ${String(key).slice(0, 40)}`);
		}
		out[key] = clean(val);
	}
	return out;
}

/** Merge, then check the rules that span fields. */
function finaliseCommerce(existing, patch) {
	const merged = { ...COMMERCE_DEFAULTS, ...(isPlainObject(existing) ? existing : {}), ...(patch || {}) };
	if (merged.toggleMode === 'paid' && !merged.price) {
		throw new ExtrasError('Paid mode needs a price');
	}
	if (merged.toggleMode === 'public' && merged.cooldownSeconds < PUBLIC_MIN_COOLDOWN_SECONDS) {
		merged.cooldownSeconds = PUBLIC_MIN_COOLDOWN_SECONDS;
	}
	return merged;
}

function cleanReward(raw) {
	const value = parseMaybeJson(raw, 'reward');
	if (value === null || value === undefined) {
		return null;
	}
	if (!isPlainObject(value)) {
		throw new ExtrasError('reward must be an object');
	}
	const allowed = new Set(['amount', 'currency', 'on', 'windowSeconds', 'maxPerDay', 'note']);
	for (const key of Object.keys(value)) {
		if (!allowed.has(key)) {
			throw new ExtrasError(`Unknown reward field ${String(key).slice(0, 40)}`);
		}
	}
	const currency = cleanCurrency(value.currency);
	// Rewards are per action, so they may be smaller than a card payment.
	const amount = Number(value.amount);
	if (!Number.isInteger(amount) || amount < 1 || amount > CURRENCIES[currency].max) {
		throw new ExtrasError(`reward.amount must be between 1 and ${CURRENCIES[currency].max} (minor units)`);
	}
	const on = value.on === undefined ? 'on' : value.on;
	if (!REWARD_ON.includes(on)) {
		throw new ExtrasError(`reward.on must be one of ${REWARD_ON.join(', ')}`);
	}
	const windowSeconds = value.windowSeconds === undefined ? 900 : Number(value.windowSeconds);
	if (!Number.isInteger(windowSeconds) || windowSeconds < 60 || windowSeconds > 86400) {
		throw new ExtrasError('reward.windowSeconds must be from 60 to 86400');
	}
	const maxPerDay = value.maxPerDay === undefined ? 5 : Number(value.maxPerDay);
	if (!Number.isInteger(maxPerDay) || maxPerDay < 1 || maxPerDay > 100) {
		throw new ExtrasError('reward.maxPerDay must be from 1 to 100');
	}
	return {
		amount,
		currency,
		on,
		windowSeconds,
		maxPerDay,
		note: cleanNote(value.note, MAX_COMMERCE_NOTE)
	};
}

/** What the public may see of the commerce settings. */
function publicCommerce(commerce, { canTakePayments = false } = {}) {
	if (!isPlainObject(commerce)) {
		return null;
	}
	const c = { ...COMMERCE_DEFAULTS, ...commerce };
	const anything = c.toggleMode !== 'owner' || c.tips || c.payLink || c.note;
	if (!anything) {
		return null;
	}
	return {
		toggleMode: c.toggleMode,
		action: c.action,
		holdSeconds: c.holdSeconds,
		cooldownSeconds: c.cooldownSeconds,
		price: c.price || null,
		tips: Boolean(c.tips),
		allowMessage: Boolean(c.allowMessage),
		note: c.note || '',
		payLink: c.payLink || '',
		canTakePayments: Boolean(canTakePayments)
	};
}

/** What the owner sees: everything except the webhook secret. */
function ownerCommerce(commerce) {
	if (!isPlainObject(commerce)) {
		return null;
	}
	return { ...COMMERCE_DEFAULTS, ...commerce };
}

/** The state a public/paid change should produce. */
function targetStateFor(action, currentState) {
	if (action === 'on') {
		return true;
	}
	if (action === 'off') {
		return false;
	}
	return !currentState;
}

function rewardQualifies(reward, state) {
	if (!reward) {
		return false;
	}
	if (reward.on === 'any') {
		return true;
	}
	return reward.on === (state ? 'on' : 'off');
}

/**
 * Application fee for a destination charge, in minor units. The platform
 * pays Stripe's processing fee on destination charges, so the fixed part
 * is what keeps small payments from costing us money.
 */
function applicationFee(amount, { percent = 10, fixed = 30 } = {}) {
	const pct = Number.isFinite(Number(percent)) ? Number(percent) : 10;
	const fix = Number.isFinite(Number(fixed)) ? Number(fixed) : 30;
	const fee = Math.round((amount * pct) / 100) + fix;
	return Math.max(0, Math.min(amount, fee));
}

module.exports = {
	ExtrasError,
	MAX_PROPERTIES,
	MAX_NOTE,
	MAX_VISITOR_MESSAGE,
	CURRENCIES,
	COMMERCE_DEFAULTS,
	TOGGLE_MODES,
	PUBLIC_MIN_COOLDOWN_SECONDS,
	isPlainObject,
	cleanText,
	cleanProperties,
	mergeProperties,
	cleanNote,
	cleanVisitorMessage,
	cleanParams,
	cleanCurrency,
	cleanAmount,
	cleanCommerce,
	finaliseCommerce,
	cleanReward,
	publicCommerce,
	ownerCommerce,
	targetStateFor,
	rewardQualifies,
	applicationFee
};

// VomeSync Website JavaScript (static SPA)

const SWITCH_UID_V2_REGEX = /^vs_[0-9a-hjkmnpqrstvwxyz]{26}$/i;

function normaliseApiBaseUrl(url) {
	if (!url) return '';
	return String(url).trim().replace(/\/+$/, '');
}

function getApiBaseUrlOverride() {
	const params = new URLSearchParams(window.location.search);
	const override = params.get('api');
	return override ? normaliseApiBaseUrl(override) : '';
}

function resolveApiBaseUrl() {
	const override = getApiBaseUrlOverride();
	if (override) return override;
	
	const port = window.location.port;
	const hostname = window.location.hostname;
	
	// When served via the combined proxy (sync.vome.io), the API is available at same-origin /api.
	if (!port || port === '80' || port === '443' || port === '8080' || port === '8443') {
		return `${window.location.origin}/api`;
	}
	
	// Direct website ports (docker-compose defaults)
	if (port === '8112') {
		return `http://${hostname}:3091/api`; // dev webserver port
	}
	if (port === '8111') {
		return `http://${hostname}:3090/api`; // live webserver port
	}
	
	// Fallback to same-origin /api
	return `${window.location.origin}/api`;
}

function resolveEnvBadge(apiBaseUrl) {
	const host = window.location.hostname;
	const port = window.location.port;
	
	if (host === 'sync.vome.io') {
		return { label: 'LIVE', className: 'env-live', api: apiBaseUrl };
	}
	if (port === '8112' || apiBaseUrl.includes(':3091')) {
		return { label: 'DEV', className: 'env-dev', api: apiBaseUrl };
	}
	return { label: 'CUSTOM', className: 'env-custom', api: apiBaseUrl };
}

// API base URL (resolved once at startup)
const API_BASE_URL = resolveApiBaseUrl();
const HACS_REPO_URL = 'https://github.com/Vortitron/VomeSync';
const HACS_ADD_URL = 'https://my.home-assistant.io/redirect/hacs_repository/?owner=Vortitron&repository=VomeSync&category=integration';

let allSwitches = [];
let filteredSwitches = [];
let categories = {};
let currentSwitchId = null;
let currentSwitchDetail = null;
let heroBannerUrl = '';

// DOM elements
const heroSection = document.querySelector('.hero');
const heroTitleEl = document.getElementById('heroTitle');
const heroSubtitleEl = document.getElementById('heroSubtitle');
const heroButtonsDefault = document.getElementById('heroButtonsDefault');
const heroButtonsSwitch = document.getElementById('heroButtonsSwitch');
const heroStatusButton = document.getElementById('heroStatusButton');
const heroHaLink = document.getElementById('heroHaLink');
const navSwitchStatus = document.getElementById('navSwitchStatus');
const hacsBtn = document.getElementById('hacsBtn');
const homeBrand = document.getElementById('homeBrand');
const loadingMessage = document.getElementById('loadingMessage');
const errorMessage = document.getElementById('errorMessage');
const emptySwitches = document.getElementById('emptySwitches');
const switchesGrid = document.getElementById('switchesGrid');
const searchBox = document.getElementById('searchBox');
const userCountFilter = document.getElementById('userCountFilter');
let selectedCategory = '';
const refreshBtn = document.getElementById('refreshBtn');
const totalSwitches = document.getElementById('totalSwitches');
const activeSwitches = document.getElementById('activeSwitches');
const lastUpdate = document.getElementById('lastUpdate');
const categoryList = document.getElementById('categoryList');
const detailSection = document.getElementById('switchDetail');
const detailTitle = document.getElementById('detailTitle');
const detailDescription = document.getElementById('detailDescription');
const detailIcon = document.getElementById('detailIcon');
const detailLocation = document.getElementById('detailLocation');
const redirectNotice = document.getElementById('redirectNotice');
const redirectNoticeText = document.getElementById('redirectNoticeText');
const redirectNoticeLink = document.getElementById('redirectNoticeLink');
const detailCategory = document.getElementById('detailCategory');
const detailUsers = document.getElementById('detailUsers');
const detailToggles = document.getElementById('detailToggles');
const detailLastChange = document.getElementById('detailLastChange');
const detailUid = document.getElementById('detailUid');
const detailEvents = document.getElementById('detailEvents');
const backToList = document.getElementById('backToList');
const copySwitchLinkBtn = document.getElementById('copySwitchLink');
const switchWebLink = document.getElementById('switchWebLink');
const ownerWebLink = document.getElementById('ownerWebLink');
const authPanel = document.getElementById('authPanel');
const authLoggedOut = document.getElementById('authLoggedOut');
const authLoggedIn = document.getElementById('authLoggedIn');
const authStatusText = document.getElementById('authStatusText');
const authStatus = document.getElementById('authStatus');
const authLoginBtn = document.getElementById('authLoginBtn');
const authChangeBtn = document.getElementById('authChangeBtn');
const authLogoutBtn = document.getElementById('authLogoutBtn');
const commentSection = document.getElementById('commentSection');
const commentForm = document.getElementById('commentForm');
const commentTextInput = document.getElementById('commentText');
const commentStateLabel = document.getElementById('commentStateLabel');
const commentStateSelect = document.getElementById('commentState');
const commentKeyNote = document.getElementById('commentKeyNote');
const commentStatus = document.getElementById('commentStatus');

// Owner tools (appearance)
const managePanel = document.getElementById('managePanel');
const manageForm = document.getElementById('manageForm');
const manageLinkInput = document.getElementById('manageLink');
const manageIconFileInput = document.getElementById('manageIconFile');
const manageIconUrlInput = document.getElementById('manageIconUrl');
const manageBannerFileInput = document.getElementById('manageBannerFile');
const manageBannerUrlInput = document.getElementById('manageBannerUrl');
const manageStatus = document.getElementById('manageStatus');
const promotePanel = document.getElementById('promotePanel');
const promoteBtn = document.getElementById('promoteBtn');
const promoteStatus = document.getElementById('promoteStatus');
const promoteCopy = document.getElementById('promoteCopy');
const premiumPanel = document.getElementById('premiumPanel');
const premiumBtn = document.getElementById('premiumBtn');
const billingPortalBtn = document.getElementById('billingPortalBtn');
const premiumStatus = document.getElementById('premiumStatus');
const premiumCopy = document.getElementById('premiumCopy');
const detailPromoted = document.getElementById('detailPromoted');
let billing = {
	promoteEnabled: false,
	promoteDurationDays: 7,
	premiumEnabled: false,
	premiumAmount: 900,
	premiumCurrency: 'eur',
	maxPrivate: 5,
	maxPublic: 10,
	premiumMaxPublic: 25,
	premiumMaxSwitches: 50,
	taxEnabled: true
};

// Manage media pickers (previews + replace UX)
const manageIconPreview = document.getElementById('manageIconPreview');
const manageIconPlaceholder = document.getElementById('manageIconPlaceholder');
const manageIconEdit = document.getElementById('manageIconEdit');
const manageIconReplaceBtn = document.getElementById('manageIconReplaceBtn');
const manageIconRemoveBtn = document.getElementById('manageIconRemoveBtn');
const manageIconCancelBtn = document.getElementById('manageIconCancelBtn');

const manageBannerPreview = document.getElementById('manageBannerPreview');
const manageBannerPlaceholder = document.getElementById('manageBannerPlaceholder');
const manageBannerEdit = document.getElementById('manageBannerEdit');
const manageBannerReplaceBtn = document.getElementById('manageBannerReplaceBtn');
const manageBannerRemoveBtn = document.getElementById('manageBannerRemoveBtn');
const manageBannerCancelBtn = document.getElementById('manageBannerCancelBtn');

// Admin tools
const adminPanel = document.getElementById('adminPanel');
const adminKeyInput = document.getElementById('adminKeyInput');
const adminKeySaveBtn = document.getElementById('adminKeySaveBtn');
const adminKeyForgetBtn = document.getElementById('adminKeyForgetBtn');
const adminTools = document.getElementById('adminTools');
const adminStatus = document.getElementById('adminStatus');
const adminDelistForm = document.getElementById('adminDelistForm');
const adminDelistUid = document.getElementById('adminDelistUid');
const adminDeleteForm = document.getElementById('adminDeleteForm');
const adminDeleteUid = document.getElementById('adminDeleteUid');
const adminBlockForm = document.getElementById('adminBlockForm');
const adminBlockType = document.getElementById('adminBlockType');
const adminBlockValue = document.getElementById('adminBlockValue');
const adminBlockAction = document.getElementById('adminBlockAction');
const adminRedirectForm = document.getElementById('adminRedirectForm');
const adminRedirectFrom = document.getElementById('adminRedirectFrom');
const adminRedirectTo = document.getElementById('adminRedirectTo');
const adminRedirectReason = document.getElementById('adminRedirectReason');
const adminRedirectClearForm = document.getElementById('adminRedirectClearForm');
const adminRedirectClearUid = document.getElementById('adminRedirectClearUid');
const adminOverrideForm = document.getElementById('adminOverrideForm');
const adminOverrideUid = document.getElementById('adminOverrideUid');
const adminOverrideName = document.getElementById('adminOverrideName');
const adminOverrideDescription = document.getElementById('adminOverrideDescription');
const adminOverrideLocation = document.getElementById('adminOverrideLocation');
const adminOverrideCategory = document.getElementById('adminOverrideCategory');
const adminOverrideLink = document.getElementById('adminOverrideLink');
const adminOverrideIconUrl = document.getElementById('adminOverrideIconUrl');
const adminOverrideBannerUrl = document.getElementById('adminOverrideBannerUrl');
const adminOverrideClearForm = document.getElementById('adminOverrideClearForm');
const adminOverrideClearUid = document.getElementById('adminOverrideClearUid');

// Quick view modal
const quickView = document.getElementById('quickView');
const quickViewBackdrop = document.getElementById('quickViewBackdrop');
const quickViewCloseBtn = document.getElementById('quickViewClose');
const quickViewIcon = document.getElementById('quickViewIcon');
const quickViewTitle = document.getElementById('quickViewTitle');
const quickViewDescription = document.getElementById('quickViewDescription');
const quickViewSubtitle = document.getElementById('quickViewSubtitle');
const quickViewMeta = document.getElementById('quickViewMeta');
const quickViewCopyUidBtn = document.getElementById('quickViewCopyUid');
const quickViewCopyHaBtn = document.getElementById('quickViewCopyHa');
const quickViewAddHacsBtn = document.getElementById('quickViewAddHacs');
const quickViewOpenDetailsBtn = document.getElementById('quickViewOpenDetails');

const haDialog = document.getElementById('haDialog');
const haDialogBackdrop = document.getElementById('haDialogBackdrop');
const haDialogCloseBtn = document.getElementById('haDialogClose');
const haDialogCode = document.getElementById('haDialogCode');
const haDialogCopyBtn = document.getElementById('haDialogCopyBtn');
const haDialogCopyOpenBtn = document.getElementById('haDialogCopyOpenBtn');
const haDialogOpenLink = document.getElementById('haDialogOpenLink');
const haDialogBadgeLink = document.getElementById('haDialogBadgeLink');

const hacsDialog = document.getElementById('hacsDialog');
const hacsDialogBackdrop = document.getElementById('hacsDialogBackdrop');
const hacsDialogCloseBtn = document.getElementById('hacsDialogClose');
const hacsDialogRepo = document.getElementById('hacsDialogRepo');
const hacsDialogCopyBtn = document.getElementById('hacsDialogCopyBtn');
const hacsDialogOpenLink = document.getElementById('hacsDialogOpenLink');
const hacsDialogBadgeLink = document.getElementById('hacsDialogBadgeLink');

const toggleDialog = document.getElementById('toggleDialog');
const toggleDialogBackdrop = document.getElementById('toggleDialogBackdrop');
const toggleDialogCloseBtn = document.getElementById('toggleDialogClose');
const toggleDialogSwitch = document.getElementById('toggleDialogSwitch');
const toggleDialogState = document.getElementById('toggleDialogState');
const toggleDialogStatus = document.getElementById('toggleDialogStatus');
const toggleDialogEvents = document.getElementById('toggleDialogEvents');

const authDialog = document.getElementById('authDialog');
const authDialogBackdrop = document.getElementById('authDialogBackdrop');
const authDialogCloseBtn = document.getElementById('authDialogClose');
const authDialogKeyInput = document.getElementById('authDialogKey');
const authDialogLoginBtn = document.getElementById('authDialogLoginBtn');
const authDialogStatus = document.getElementById('authDialogStatus');

// Switch stats dialog
const allSwitchesStatBox = document.getElementById('allSwitchesStatBox');
const allSwitchesCountEl = document.getElementById('allSwitchesCount');
const switchStatsDialog = document.getElementById('switchStatsDialog');
const switchStatsBackdrop = document.getElementById('switchStatsBackdrop');
const switchStatsCloseBtn = document.getElementById('switchStatsClose');
const statsTotalAllEl = document.getElementById('statsTotalAll');
const statsTotalPublicEl = document.getElementById('statsTotalPublic');
const statsAddedTodayEl = document.getElementById('statsAddedToday');
const statsWsClientsEl = document.getElementById('statsWsClients');
const switchStatsCanvas = document.getElementById('switchStatsCanvas');

const DEFAULT_HERO_TITLE_HTML = heroTitleEl ? heroTitleEl.innerHTML : '';
const DEFAULT_HERO_SUBTITLE_TEXT = heroSubtitleEl ? heroSubtitleEl.textContent : '';

let manageIconAction = 'keep';
let manageBannerAction = 'keep';
let manageCurrentIconUrl = '';
let manageCurrentBannerUrl = '';
let manageIconObjectUrl = null;
let manageBannerObjectUrl = null;
let heroToggleInFlight = false;
let pendingAuthToggle = false;
const togglePermissionDeniedByUid = {};
let heroInView = true;

let quickViewUid = null;
let quickViewDetail = null;

// Smarter refresh / update UI
const AUTO_REFRESH_MS = 60_000;
const LAST_UPDATE_TICK_MS = 1_000;

const HOME_ASSISTANT_CONFIG_FLOW_URL = 'https://my.home-assistant.io/redirect/config_flow_start/?domain=vomesync';

let lastSwitchFetchAt = 0;
let autoRefreshTimer = null;
let lastUpdateTimer = null;
let autoRefreshInFlight = false;

// Best-effort realtime updates (state + last toggled) via WebSocket
let wsClient = null;
let wsReconnectTimer = null;
let wsReconnectAttempts = 0;
const wsSubscribedUids = new Set();

let detailRefreshTimer = null;

document.addEventListener('DOMContentLoaded', () => {
	init();
});

function isValidSwitchUid(uid) {
	if (typeof uid !== 'string') return false;
	const trimmed = uid.trim();
	return Boolean(trimmed && SWITCH_UID_V2_REGEX.test(trimmed));
}

function extractSwitchUidFromPathname(pathname) {
	const raw = String(pathname || '');
	const match = raw.match(/^\/(switch|s)\/([^/]+)\/?$/i);
	if (!match) {
		return null;
	}
	try {
		const candidate = decodeURIComponent(match[2]);
		return isValidSwitchUid(candidate) ? candidate : null;
	} catch {
		return null;
	}
}

function cssEscapeUrl(url) {
	return String(url).replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

function updatePageBannerBackground() {
	if (!document?.body) return;
	if (!heroBannerUrl) {
		document.body.classList.remove('page-banner-active', 'page-banner-out');
		document.body.style.removeProperty('--page-banner-image');
		return;
	}
	document.body.style.setProperty('--page-banner-image', `url("${cssEscapeUrl(heroBannerUrl)}")`);
	document.body.classList.add('page-banner-active');
	document.body.classList.toggle('page-banner-out', !heroInView);
}

function setHeroBanner(bannerUrl) {
	if (!heroSection) return;
	const url = String(bannerUrl || '').trim();
	if (!url) {
		clearHeroBanner();
		return;
	}
	heroBannerUrl = url;
	heroSection.classList.add('hero-banner-active');
	heroSection.style.setProperty('--hero-banner-image', `url("${cssEscapeUrl(url)}")`);
	updatePageBannerBackground();
}

function clearHeroBanner() {
	if (!heroSection) return;
	heroBannerUrl = '';
	heroSection.classList.remove('hero-banner-active');
	heroSection.style.removeProperty('--hero-banner-image');
	updatePageBannerBackground();
}

function setHeroText(title, subtitle) {
	if (heroTitleEl) heroTitleEl.textContent = title || '';
	if (heroSubtitleEl) heroSubtitleEl.textContent = subtitle || '';
}

function setDocumentMeta(title, description, canonicalPath) {
	document.title = title || 'VomeSync — public switches for Home Assistant';
	const meta = document.querySelector('meta[name="description"]');
	if (meta && description) {
		meta.setAttribute('content', description);
	}
	let canonical = document.querySelector('link[rel="canonical"]');
	if (!canonical) {
		canonical = document.createElement('link');
		canonical.rel = 'canonical';
		document.head.appendChild(canonical);
	}
	canonical.href = `${window.location.origin}${canonicalPath || '/'}`;
}

function updateHeroStatusButton(detail) {
	if (!heroStatusButton) return;
	const stateKnown = typeof detail?.state === 'boolean';
	const isOn = stateKnown ? Boolean(detail.state) : false;
	const statusLabel = stateKnown ? `Status: ${isOn ? 'ON' : 'OFF'}` : 'Status: Unknown';

	heroStatusButton.textContent = statusLabel;
	heroStatusButton.classList.toggle('status-on', stateKnown && isOn);
	heroStatusButton.classList.toggle('status-off', stateKnown && !isOn);
	const uid = detail?.uid || currentSwitchId;
	const authed = Boolean(uid && hasAccessKey(uid));
	heroStatusButton.classList.toggle('is-interactive', authed);

	const ts = detail?.lastToggled ? Number(detail.lastToggled) : 0;
	let title = '';
	if (ts) {
		const absolute = formatDateTimeYmd(new Date(ts));
		const relative = formatTimeAgo(new Date(ts));
		title = `Last changed: ${absolute} (${relative})`;
	} else if (stateKnown) {
		title = 'No activity yet';
	} else {
		title = 'Status unknown';
	}
	if (authed) {
		title = `${title} — click to toggle`;
	} else if (uid) {
		title = `${title} — authenticate to toggle`;
	}
	heroStatusButton.title = title;

	updateNavSwitchStatus(detail);
}

function updateNavSwitchStatus(detail) {
	if (!navSwitchStatus) return;
	const uid = currentSwitchId;
	if (!uid || heroInView) {
		navSwitchStatus.classList.add('hidden');
		navSwitchStatus.classList.remove('on', 'off');
		return;
	}
	const info = detail || currentSwitchDetail || {};
	const name = getSwitchDisplayName(info);
	const stateKnown = typeof info.state === 'boolean';
	const isOn = stateKnown ? Boolean(info.state) : false;
	const stateLabel = stateKnown ? (isOn ? 'ON' : 'OFF') : 'Unknown';
	const authLabel = hasAccessKey(uid) ? 'Authenticated' : 'Not authenticated';
	navSwitchStatus.textContent = `${name} · ${stateLabel} · ${authLabel}`;
	navSwitchStatus.classList.toggle('on', stateKnown && isOn);
	navSwitchStatus.classList.toggle('off', stateKnown && !isOn);
	navSwitchStatus.classList.remove('hidden');
}

function initHeroObserver() {
	if (!heroSection || !navSwitchStatus) return;
	if (typeof window.IntersectionObserver === 'function') {
		const observer = new IntersectionObserver((entries) => {
			const entry = entries && entries[0];
			heroInView = entry ? entry.isIntersecting : true;
			updateNavSwitchStatus(currentSwitchDetail || {});
			updatePageBannerBackground();
		}, { rootMargin: '-64px 0px 0px 0px', threshold: 0.1 });
		observer.observe(heroSection);
		return;
	}
	const onScroll = () => {
		const rect = heroSection.getBoundingClientRect();
		heroInView = rect.bottom > 64;
		updateNavSwitchStatus(currentSwitchDetail || {});
		updatePageBannerBackground();
	};
	window.addEventListener('scroll', onScroll, { passive: true });
	onScroll();
}

function handleStatusAction() {
	if (!currentSwitchId) return;
	if (!hasAccessKey(currentSwitchId)) {
		openAuthDialog(true, 'Authentication required to toggle.');
		return;
	}
	if (!hasTogglePermission(currentSwitchId)) {
		openAuthDialog(true, 'Key lacks toggle permission. Enter a new key.');
		return;
	}
	openToggleDialogForDetail(currentSwitchDetail || { uid: currentSwitchId });
}

function restoreHeroText() {
	if (!heroTitleEl || !heroSubtitleEl) return;
	heroTitleEl.innerHTML = DEFAULT_HERO_TITLE_HTML;
	heroSubtitleEl.textContent = DEFAULT_HERO_SUBTITLE_TEXT;
	setDocumentMeta('VomeSync — public switches for Home Assistant', 'Public on/off switches for Home Assistant. Tower Bridge, GitHub, hurricanes, flood warnings, and other shared signals you can automate.', '/');
	updateHeroStatusButton(null);
	if (heroHaLink) {
		heroHaLink.href = HOME_ASSISTANT_CONFIG_FLOW_URL;
	}
}

function setHeroForSwitch(detail) {
	if (!detail) return;
	if (!heroTitleEl || !heroSubtitleEl) return;

	const title = getSwitchDisplayName(detail);
	const subtitleBits = [];
	const description = getSwitchDescription(detail);
	if (description) {
		subtitleBits.push(description);
	} else {
		const location = String(detail.location || '').trim();
		if (location) subtitleBits.push(`📍 ${location}`);
		const category = String(detail.category || '').trim();
		if (category) subtitleBits.push(`🏷️ ${category}`);
		const users = (typeof detail.userCount === 'number') ? detail.userCount : null;
		if (users != null) {
			subtitleBits.push(`👥 ${users} user${users === 1 ? '' : 's'}`);
		}
	}

	setHeroText(title, subtitleBits.join('  ·  ') || DEFAULT_HERO_SUBTITLE_TEXT);
	const metaDescription = description
		? description.replace(/\s+/g, ' ').trim().slice(0, 160)
		: `${title} is a public on/off switch for Home Assistant.`;
	setDocumentMeta(`${title} — VomeSync`, metaDescription, `/switch/${encodeURIComponent(detail.uid || '')}`);
	updateHeroStatusButton(detail);
	if (heroHaLink) {
		heroHaLink.href = HOME_ASSISTANT_CONFIG_FLOW_URL;
	}
}

function init() {
	applyEnvBadge();
	applyDynamicLinks();
	setupEventListeners();
	initHeroObserver();
	importManagementKeyFromHash();
	updateAdminPanelVisibility();
	loadAllData();
	restoreSwitchFromQuery();
}

const MANAGEMENT_KEY_STORAGE_PREFIX = 'vomesync_manage_key:';
const MANAGEMENT_KEY_PERSIST_PREFIX = 'vomesync_manage_key_persist:';
const API_KEY_STORAGE_PREFIX = 'vomesync_api_key:';
const API_KEY_PERSIST_PREFIX = 'vomesync_api_key_persist:';
const ADMIN_KEY_STORAGE = 'vomesync_admin_key';
let managementAutoscrollUid = null;
let redirectNoticeTargetUid = '';

function readPersistentKey(prefix, uid) {
	if (!uid) return '';
	try {
		const raw = localStorage.getItem(`${prefix}${uid}`);
		if (!raw) return '';
		const data = JSON.parse(raw);
		if (!data || typeof data !== 'object') return '';
		if (data.expiresAt && Date.now() > data.expiresAt) {
			localStorage.removeItem(`${prefix}${uid}`);
			return '';
		}
		return String(data.key || '');
	} catch {
		return '';
	}
}

function writePersistentKey(prefix, uid, key, expiresAt) {
	if (!uid || !key) return;
	try {
		localStorage.setItem(`${prefix}${uid}`, JSON.stringify({
			key,
			expiresAt: Number.isFinite(expiresAt) ? expiresAt : 0
		}));
	} catch {
		// ignore
	}
}

function clearPersistentKey(prefix, uid) {
	if (!uid) return;
	try {
		localStorage.removeItem(`${prefix}${uid}`);
	} catch {
		// ignore
	}
}

function getStoredManagementKey(uid) {
	if (!uid) return '';
	try {
		const sessionKey = sessionStorage.getItem(`${MANAGEMENT_KEY_STORAGE_PREFIX}${uid}`) || '';
		if (sessionKey) return sessionKey;
		return readPersistentKey(MANAGEMENT_KEY_PERSIST_PREFIX, uid) || '';
	} catch {
		return '';
	}
}

function setStoredManagementKey(uid, apiKey, options = {}) {
	if (!uid) return;
	try {
		if (!apiKey) {
			sessionStorage.removeItem(`${MANAGEMENT_KEY_STORAGE_PREFIX}${uid}`);
			clearPersistentKey(MANAGEMENT_KEY_PERSIST_PREFIX, uid);
		} else {
			sessionStorage.setItem(`${MANAGEMENT_KEY_STORAGE_PREFIX}${uid}`, apiKey);
			if (options && options.persist) {
				writePersistentKey(MANAGEMENT_KEY_PERSIST_PREFIX, uid, apiKey, options.expiresAt);
			} else {
				clearPersistentKey(MANAGEMENT_KEY_PERSIST_PREFIX, uid);
			}
		}
	} catch {
		// ignore (private mode, etc)
	}
}

function getStoredApiKey(uid) {
	if (!uid) return '';
	try {
		const sessionKey = sessionStorage.getItem(`${API_KEY_STORAGE_PREFIX}${uid}`) || '';
		if (sessionKey) return sessionKey;
		return readPersistentKey(API_KEY_PERSIST_PREFIX, uid) || '';
	} catch {
		return '';
	}
}

function setStoredApiKey(uid, apiKey, options = {}) {
	if (!uid) return;
	try {
		if (!apiKey) {
			sessionStorage.removeItem(`${API_KEY_STORAGE_PREFIX}${uid}`);
			clearPersistentKey(API_KEY_PERSIST_PREFIX, uid);
		} else {
			sessionStorage.setItem(`${API_KEY_STORAGE_PREFIX}${uid}`, apiKey);
			if (options && options.persist) {
				writePersistentKey(API_KEY_PERSIST_PREFIX, uid, apiKey, options.expiresAt);
			} else {
				clearPersistentKey(API_KEY_PERSIST_PREFIX, uid);
			}
		}
	} catch {
		// ignore
	}
}

function getStoredAdminKey() {
	try {
		return sessionStorage.getItem(ADMIN_KEY_STORAGE) || '';
	} catch {
		return '';
	}
}

function setStoredAdminKey(value) {
	try {
		if (!value) {
			sessionStorage.removeItem(ADMIN_KEY_STORAGE);
		} else {
			sessionStorage.setItem(ADMIN_KEY_STORAGE, value);
		}
	} catch {
		// ignore
	}
}

function shouldShowAdminPanel() {
	const params = new URLSearchParams(window.location.search || '');
	return params.get('admin') === '1' || Boolean(getStoredAdminKey());
}

function updateAdminPanelVisibility() {
	if (!adminPanel) return;
	const hasKey = Boolean(getStoredAdminKey());
	const shouldShow = shouldShowAdminPanel();
	adminPanel.classList.toggle('hidden', !shouldShow);
	if (adminTools) adminTools.classList.toggle('hidden', !hasKey);
	if (adminKeyInput && hasKey) adminKeyInput.value = '';
}

function setAdminStatus(message, isError = false) {
	if (!adminStatus) return;
	adminStatus.textContent = message || '';
	adminStatus.classList.toggle('hidden', !message);
	adminStatus.classList.toggle('success', Boolean(message) && !isError);
	adminStatus.classList.toggle('error', Boolean(message) && isError);
}

async function adminRequest(path, options = {}) {
	const adminKey = getStoredAdminKey();
	if (!adminKey) {
		throw new Error('Admin key required');
	}

	const response = await fetch(`${API_BASE_URL}${path}`, {
		method: options.method || 'POST',
		headers: {
			'Content-Type': 'application/json',
			'X-Admin-Key': adminKey
		},
		body: options.body ? JSON.stringify(options.body) : undefined
	});

	let data = {};
	try {
		data = await response.json();
	} catch {
		data = {};
	}

	if (!response.ok || !data.success) {
		throw new Error(data.error || `HTTP ${response.status}`);
	}
	return data.data || {};
}

function getActiveManagementKey(uid) {
	return getStoredManagementKey(uid);
}

function getActiveApiKey(uid) {
	return getStoredApiKey(uid);
}

function resolveCommentAccessKey(uid) {
	return getActiveApiKey(uid) || getActiveManagementKey(uid);
}

function hasAccessKey(uid) {
	return Boolean(getActiveApiKey(uid) || getActiveManagementKey(uid));
}

function getActiveToggleKey(uid) {
	return getActiveApiKey(uid) || getActiveManagementKey(uid);
}

function hasTogglePermission(uid) {
	if (!uid) return false;
	if (!hasAccessKey(uid)) return false;
	return togglePermissionDeniedByUid[uid] !== true;
}

function updateCommentStateVisibility() {
	if (!commentStateSelect || !commentStateLabel) return;
	const uid = currentSwitchId;
	const allowed = Boolean(uid && hasTogglePermission(uid));
	if (allowed) {
		commentStateLabel.classList.remove('hidden');
		commentStateSelect.classList.remove('hidden');
		if (commentKeyNote) {
			commentKeyNote.textContent = 'State changes use your authenticated key.';
		}
	} else {
		commentStateLabel.classList.add('hidden');
		commentStateSelect.classList.add('hidden');
		commentStateSelect.value = '';
		if (commentKeyNote) {
			commentKeyNote.textContent = 'Authenticate to enable state changes.';
		}
	}
}

function showRedirectNotice(fromUid, toUid, reason) {
	if (!redirectNotice || !redirectNoticeText || !redirectNoticeLink) return;
	const safeFrom = fromUid ? String(fromUid) : '';
	const safeTo = toUid ? String(toUid) : '';
	const reasonText = reason ? ` (${String(reason)})` : '';
	redirectNoticeText.textContent = safeTo
		? `This switch moved to ${safeTo}.${reasonText}`
		: `This switch has been redirected.${reasonText}`;
	redirectNoticeTargetUid = safeTo;
	if (safeTo) {
		redirectNoticeLink.href = buildSwitchPath(safeTo);
		redirectNoticeLink.classList.remove('hidden');
	} else {
		redirectNoticeLink.href = '#';
		redirectNoticeLink.classList.add('hidden');
	}
	redirectNotice.classList.remove('hidden');
}

function hideRedirectNotice() {
	if (!redirectNotice) return;
	redirectNotice.classList.add('hidden');
	redirectNoticeTargetUid = '';
	if (redirectNoticeLink) {
		redirectNoticeLink.href = '#';
	}
	if (redirectNoticeText) {
		redirectNoticeText.textContent = '';
	}
}

async function detectManagementPermission(uid, key) {
	if (!uid || !key) return { valid: false, error: 'Access key required.' };
	try {
		const response = await fetch(`${API_BASE_URL}/v2/switch/${uid}/metadata`, {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
				'X-Api-Key': key
			},
			body: JSON.stringify({})
		});
		let data = {};
		try {
			data = await response.json();
		} catch {
			data = {};
		}

		if (response.status === 401) {
			return { valid: false, error: data.error || 'Invalid access key.' };
		}
		if (response.status === 403) {
			return { valid: true, isManagement: false };
		}
		if (response.status === 404) {
			return { valid: false, error: 'Switch not found.' };
		}
		if (response.status === 400) {
			return { valid: true, isManagement: true };
		}
		if (response.ok) {
			return { valid: true, isManagement: true };
		}
		return { valid: true, isManagement: false };
	} catch (error) {
		return { valid: false, error: 'Network error while checking key.' };
	}
}

function importManagementKeyFromHash() {
	const hash = String(window.location.hash || '');
	if (!hash || hash.length < 2) return;
	const params = new URLSearchParams(hash.slice(1));
	const apiKey = String(params.get('accessKey') || '').trim();
	const remember = String(params.get('remember') || '') === '1';
	const ttlSecondsRaw = Number.parseInt(params.get('ttlSeconds') || '', 10);
	const ttlSeconds = Number.isFinite(ttlSecondsRaw) && ttlSecondsRaw > 0 ? ttlSecondsRaw : 0;
	if (!apiKey) return;

	const uid = extractSwitchUidFromPathname(window.location.pathname);
	if (!uid) return;

	managementAutoscrollUid = uid;
	detectManagementPermission(uid, apiKey).then((result) => {
		if (!result.valid) {
			setStoredManagementKey(uid, '');
			setStoredApiKey(uid, '');
			setAuthStatus(result.error || 'Access key invalid or expired.', true);
			updateAuthPanel({ uid });
			updateAuthGates({ uid });
			updateCommentStateVisibility();
			return;
		}
		const expiresAt = remember && ttlSeconds ? Date.now() + (ttlSeconds * 1000) : 0;
		if (result.isManagement) {
			setStoredManagementKey(uid, apiKey, { persist: remember, expiresAt });
		} else {
			setStoredApiKey(uid, apiKey, { persist: remember, expiresAt });
		}
		togglePermissionDeniedByUid[uid] = false;
		setAuthStatus('Authenticated via website link.', false);
		updateAuthPanel({ uid });
		updateAuthGates({ uid });
		updateCommentStateVisibility();
		updateManagePanel({ uid });
	});

	// Clear the fragment to avoid leaving the key in the address bar/history.
	try {
		window.history.replaceState({}, '', window.location.pathname + window.location.search);
	} catch {
		// ignore
	}
}

function applyEnvBadge() {
	const badge = document.getElementById('envBadge');
	if (!badge) return;
	
	const info = resolveEnvBadge(API_BASE_URL);
	badge.textContent = info.label;
	badge.className = `env-badge ${info.className}`;
	badge.title = `API: ${info.api}`;
	badge.style.display = 'inline-flex';
}

function applyDynamicLinks() {
	
	const serverStatusLink = document.getElementById('serverStatusLink');
	if (serverStatusLink) {
		serverStatusLink.href = `${API_BASE_URL}/health`;
	}
}

function setupEventListeners() {
	searchBox.addEventListener('input', () => applyFilters());
	userCountFilter.addEventListener('change', () => applyFilters());
	refreshBtn.addEventListener('click', loadAllData);
	setupSwitchExtrasListeners();

	if (homeBrand) {
		homeBrand.addEventListener('click', (e) => {
			e.preventDefault();
			closeQuickView();
			closeDetail();
			try {
				window.scrollTo({ top: 0, behavior: 'smooth' });
			} catch {
				// ignore
			}
		});
	}

	if (redirectNoticeLink) {
		redirectNoticeLink.addEventListener('click', (e) => {
			if (!redirectNoticeTargetUid) return;
			e.preventDefault();
			openSwitchDetails(redirectNoticeTargetUid);
		});
	}

	if (heroHaLink) {
		heroHaLink.addEventListener('click', (e) => {
			if (!currentSwitchId) return;
			e.preventDefault();
			openHaDialogForUid(currentSwitchId);
		});
	}

	if (hacsBtn) {
		hacsBtn.addEventListener('click', () => {
			openHacsDialog();
		});
	}

	if (heroStatusButton) {
		heroStatusButton.addEventListener('click', async () => {
			handleStatusAction();
		});
	}

	if (navSwitchStatus) {
		navSwitchStatus.addEventListener('click', () => {
			handleStatusAction();
		});
		navSwitchStatus.addEventListener('keydown', (event) => {
			if (event.key === 'Enter' || event.key === ' ') {
				event.preventDefault();
				handleStatusAction();
			}
		});
	}

	backToList.addEventListener('click', () => {
		closeDetail();
		scrollToSwitches();
	});

	copySwitchLinkBtn.addEventListener('click', () => {
		if (!currentSwitchId) return;
		const link = `${window.location.origin}${buildSwitchPath(currentSwitchId)}`;
		copyText(link, copySwitchLinkBtn, '🔗 Copy link');
	});

	commentForm.addEventListener('submit', async (e) => {
		e.preventDefault();
		await submitComment();
	});

	if (manageForm) {
		manageForm.addEventListener('submit', async (e) => {
			e.preventDefault();
			await submitManageAppearance();
		});
	}

	if (promoteBtn) {
		promoteBtn.addEventListener('click', async () => {
			await startPromoteCheckout();
		});
	}

	if (premiumBtn) {
		premiumBtn.addEventListener('click', async () => {
			await startPremiumCheckout();
		});
	}

	if (billingPortalBtn) {
		billingPortalBtn.addEventListener('click', async () => {
			await startBillingPortal();
		});
	}

	if (adminKeySaveBtn) {
		adminKeySaveBtn.addEventListener('click', () => {
			const key = adminKeyInput ? String(adminKeyInput.value || '').trim() : '';
			if (!key) {
				setAdminStatus('Admin key required.', true);
				return;
			}
			setStoredAdminKey(key);
			if (adminKeyInput) adminKeyInput.value = '';
			setAdminStatus('Admin key saved.', false);
			updateAdminPanelVisibility();
		});
	}

	if (adminKeyForgetBtn) {
		adminKeyForgetBtn.addEventListener('click', () => {
			setStoredAdminKey('');
			setAdminStatus('Admin key cleared.', false);
			updateAdminPanelVisibility();
		});
	}

	if (adminDelistForm) {
		adminDelistForm.addEventListener('submit', async (e) => {
			e.preventDefault();
			const uid = adminDelistUid ? String(adminDelistUid.value || '').trim() : '';
			if (!uid) {
				setAdminStatus('Switch UID required.', true);
				return;
			}
			try {
				await adminRequest(`/admin/switch/${encodeURIComponent(uid)}/delist`);
				setAdminStatus(`Delisted ${uid}.`, false);
			} catch (error) {
				setAdminStatus(error.message || 'Failed to delist.', true);
			}
		});
	}

	if (adminDeleteForm) {
		adminDeleteForm.addEventListener('submit', async (e) => {
			e.preventDefault();
			const uid = adminDeleteUid ? String(adminDeleteUid.value || '').trim() : '';
			if (!uid) {
				setAdminStatus('Switch UID required.', true);
				return;
			}
			if (!confirm(`Delete switch ${uid}? This cannot be undone.`)) {
				return;
			}
			try {
				await adminRequest(`/admin/switch/${encodeURIComponent(uid)}/delete`);
				setAdminStatus(`Deleted ${uid}.`, false);
			} catch (error) {
				setAdminStatus(error.message || 'Failed to delete.', true);
			}
		});
	}

	if (adminBlockForm) {
		adminBlockForm.addEventListener('submit', async (e) => {
			e.preventDefault();
			const type = adminBlockType ? String(adminBlockType.value || '').trim() : '';
			const value = adminBlockValue ? String(adminBlockValue.value || '').trim() : '';
			const action = adminBlockAction ? String(adminBlockAction.value || '').trim() : 'block';
			if (!type || !value) {
				setAdminStatus('Block type and value required.', true);
				return;
			}
			try {
				await adminRequest('/admin/blocks', {
					body: {
						action,
						type,
						value
					}
				});
				setAdminStatus(`${action === 'block' ? 'Blocked' : 'Unblocked'} ${type}.`, false);
			} catch (error) {
				setAdminStatus(error.message || 'Block update failed.', true);
			}
		});
	}

	if (adminRedirectForm) {
		adminRedirectForm.addEventListener('submit', async (e) => {
			e.preventDefault();
			const fromUid = adminRedirectFrom ? String(adminRedirectFrom.value || '').trim() : '';
			const toUid = adminRedirectTo ? String(adminRedirectTo.value || '').trim() : '';
			const reason = adminRedirectReason ? String(adminRedirectReason.value || '').trim() : '';
			if (!fromUid || !toUid) {
				setAdminStatus('Both UIDs are required for redirects.', true);
				return;
			}
			try {
				await adminRequest('/admin/redirects', {
					body: { fromUid, toUid, reason }
				});
				setAdminStatus(`Redirected ${fromUid} → ${toUid}.`, false);
			} catch (error) {
				setAdminStatus(error.message || 'Redirect failed.', true);
			}
		});
	}

	if (adminRedirectClearForm) {
		adminRedirectClearForm.addEventListener('submit', async (e) => {
			e.preventDefault();
			const uid = adminRedirectClearUid ? String(adminRedirectClearUid.value || '').trim() : '';
			if (!uid) {
				setAdminStatus('Redirect UID required.', true);
				return;
			}
			try {
				await adminRequest(`/admin/redirects/${encodeURIComponent(uid)}`, { method: 'DELETE' });
				setAdminStatus(`Cleared redirect for ${uid}.`, false);
			} catch (error) {
				setAdminStatus(error.message || 'Clear redirect failed.', true);
			}
		});
	}

	if (adminOverrideForm) {
		adminOverrideForm.addEventListener('submit', async (e) => {
			e.preventDefault();
			const uid = adminOverrideUid ? String(adminOverrideUid.value || '').trim() : '';
			if (!uid) {
				setAdminStatus('Switch UID required for override.', true);
				return;
			}
			const payload = {};
			const name = adminOverrideName ? String(adminOverrideName.value || '').trim() : '';
			const description = adminOverrideDescription ? String(adminOverrideDescription.value || '').trim() : '';
			const location = adminOverrideLocation ? String(adminOverrideLocation.value || '').trim() : '';
			const category = adminOverrideCategory ? String(adminOverrideCategory.value || '').trim() : '';
			const link = adminOverrideLink ? String(adminOverrideLink.value || '').trim() : '';
			const iconUrl = adminOverrideIconUrl ? String(adminOverrideIconUrl.value || '').trim() : '';
			const bannerUrl = adminOverrideBannerUrl ? String(adminOverrideBannerUrl.value || '').trim() : '';

			if (name) payload.name = name;
			if (description) payload.description = description;
			if (location) payload.location = location;
			if (category) payload.category = category;
			if (link) payload.link = link;
			if (iconUrl) payload.iconUrl = iconUrl;
			if (bannerUrl) payload.bannerUrl = bannerUrl;

			if (Object.keys(payload).length === 0) {
				setAdminStatus('Provide at least one override field.', true);
				return;
			}

			try {
				await adminRequest(`/admin/switch/${encodeURIComponent(uid)}/override`, { body: payload });
				setAdminStatus(`Listing override saved for ${uid}.`, false);
			} catch (error) {
				setAdminStatus(error.message || 'Failed to save override.', true);
			}
		});
	}

	if (adminOverrideClearForm) {
		adminOverrideClearForm.addEventListener('submit', async (e) => {
			e.preventDefault();
			const uid = adminOverrideClearUid ? String(adminOverrideClearUid.value || '').trim() : '';
			if (!uid) {
				setAdminStatus('Switch UID required to clear override.', true);
				return;
			}
			try {
				await adminRequest(`/admin/switch/${encodeURIComponent(uid)}/override`, { method: 'DELETE' });
				setAdminStatus(`Listing override cleared for ${uid}.`, false);
			} catch (error) {
				setAdminStatus(error.message || 'Failed to clear override.', true);
			}
		});
	}

	if (authLoginBtn) {
		authLoginBtn.addEventListener('click', () => openAuthDialog(false));
	}

	if (authChangeBtn) {
		authChangeBtn.addEventListener('click', () => openAuthDialog(false));
	}

	if (authLogoutBtn) {
		authLogoutBtn.addEventListener('click', () => {
			if (!currentSwitchId) return;
			setStoredManagementKey(currentSwitchId, '');
			setStoredApiKey(currentSwitchId, '');
			togglePermissionDeniedByUid[currentSwitchId] = false;
			setAuthStatus('Logged out.', false);
			updateAuthPanel(currentSwitchDetail || {});
			updateAuthGates(currentSwitchDetail || {});
			updateCommentStateVisibility();
			updateHeroStatusButton(currentSwitchDetail || {});
			updateManagePanel(currentSwitchDetail || {});
		});
	}

	// Manage icon picker actions
	if (manageIconReplaceBtn) {
		manageIconReplaceBtn.addEventListener('click', () => {
			manageIconAction = 'replace';
			setManageIconEditVisible(true);
			if (manageIconUrlInput) manageIconUrlInput.focus();
		});
	}
	if (manageIconCancelBtn) {
		manageIconCancelBtn.addEventListener('click', () => {
			manageIconAction = 'keep';
			revokeObjectUrl(manageIconObjectUrl);
			manageIconObjectUrl = null;
			if (manageIconFileInput) manageIconFileInput.value = '';
			if (manageIconUrlInput) manageIconUrlInput.value = '';
			setManageIconEditVisible(false);
			setMediaPreviewImage(manageIconPreview, manageIconPlaceholder, manageCurrentIconUrl);
		});
	}
	if (manageIconRemoveBtn) {
		manageIconRemoveBtn.addEventListener('click', () => {
			manageIconAction = 'remove';
			revokeObjectUrl(manageIconObjectUrl);
			manageIconObjectUrl = null;
			if (manageIconFileInput) manageIconFileInput.value = '';
			if (manageIconUrlInput) manageIconUrlInput.value = '';
			setManageIconEditVisible(false);
			setMediaPreviewImage(manageIconPreview, manageIconPlaceholder, '');
		});
	}
	if (manageIconFileInput) {
		manageIconFileInput.addEventListener('change', () => {
			const file = manageIconFileInput.files?.[0] || null;
			if (!file) return;
			manageIconAction = 'replace';
			setManageIconEditVisible(true);
			if (manageIconUrlInput) manageIconUrlInput.value = '';
			revokeObjectUrl(manageIconObjectUrl);
			try {
				manageIconObjectUrl = URL.createObjectURL(file);
			} catch {
				manageIconObjectUrl = null;
			}
			setMediaPreviewImage(manageIconPreview, manageIconPlaceholder, manageIconObjectUrl);
		});
	}
	if (manageIconUrlInput) {
		manageIconUrlInput.addEventListener('input', () => {
			const url = String(manageIconUrlInput.value || '').trim();
			if (!url) return;
			manageIconAction = 'replace';
			setManageIconEditVisible(true);
			revokeObjectUrl(manageIconObjectUrl);
			manageIconObjectUrl = null;
			if (manageIconFileInput) manageIconFileInput.value = '';
			setMediaPreviewImage(manageIconPreview, manageIconPlaceholder, url);
		});
	}

	// Manage banner picker actions
	if (manageBannerReplaceBtn) {
		manageBannerReplaceBtn.addEventListener('click', () => {
			manageBannerAction = 'replace';
			setManageBannerEditVisible(true);
			if (manageBannerUrlInput) manageBannerUrlInput.focus();
		});
	}
	if (manageBannerCancelBtn) {
		manageBannerCancelBtn.addEventListener('click', () => {
			manageBannerAction = 'keep';
			revokeObjectUrl(manageBannerObjectUrl);
			manageBannerObjectUrl = null;
			if (manageBannerFileInput) manageBannerFileInput.value = '';
			if (manageBannerUrlInput) manageBannerUrlInput.value = '';
			setManageBannerEditVisible(false);
			setMediaPreviewImage(manageBannerPreview, manageBannerPlaceholder, manageCurrentBannerUrl);
		});
	}
	if (manageBannerRemoveBtn) {
		manageBannerRemoveBtn.addEventListener('click', () => {
			manageBannerAction = 'remove';
			revokeObjectUrl(manageBannerObjectUrl);
			manageBannerObjectUrl = null;
			if (manageBannerFileInput) manageBannerFileInput.value = '';
			if (manageBannerUrlInput) manageBannerUrlInput.value = '';
			setManageBannerEditVisible(false);
			setMediaPreviewImage(manageBannerPreview, manageBannerPlaceholder, '');
		});
	}
	if (manageBannerFileInput) {
		manageBannerFileInput.addEventListener('change', () => {
			const file = manageBannerFileInput.files?.[0] || null;
			if (!file) return;
			manageBannerAction = 'replace';
			setManageBannerEditVisible(true);
			if (manageBannerUrlInput) manageBannerUrlInput.value = '';
			revokeObjectUrl(manageBannerObjectUrl);
			try {
				manageBannerObjectUrl = URL.createObjectURL(file);
			} catch {
				manageBannerObjectUrl = null;
			}
			setMediaPreviewImage(manageBannerPreview, manageBannerPlaceholder, manageBannerObjectUrl);
		});
	}
	if (manageBannerUrlInput) {
		manageBannerUrlInput.addEventListener('input', () => {
			const url = String(manageBannerUrlInput.value || '').trim();
			if (!url) return;
			manageBannerAction = 'replace';
			setManageBannerEditVisible(true);
			revokeObjectUrl(manageBannerObjectUrl);
			manageBannerObjectUrl = null;
			if (manageBannerFileInput) manageBannerFileInput.value = '';
			setMediaPreviewImage(manageBannerPreview, manageBannerPlaceholder, url);
		});
	}

	// Quick view modal handlers
	if (quickViewCloseBtn) quickViewCloseBtn.addEventListener('click', closeQuickView);
	if (quickViewBackdrop) quickViewBackdrop.addEventListener('click', closeQuickView);
	if (quickViewCopyUidBtn) {
		quickViewCopyUidBtn.addEventListener('click', () => {
			if (!quickViewUid) return;
			copyText(quickViewUid, quickViewCopyUidBtn, '📋 Copy UID');
		});
	}
	if (quickViewOpenDetailsBtn) {
		quickViewOpenDetailsBtn.addEventListener('click', () => {
			if (!quickViewUid) return;
			const uid = quickViewUid;
			closeQuickView();
			openSwitchDetails(uid, false);
		});
	}
	if (quickViewCopyHaBtn) {
		quickViewCopyHaBtn.addEventListener('click', () => {
			if (!quickViewUid) return;
			copyAndOpenHomeAssistant(quickViewUid, quickViewCopyHaBtn, '🏠 Copy UID + Add to HA');
		});
	}
	if (quickViewAddHacsBtn) {
		quickViewAddHacsBtn.addEventListener('click', () => {
			closeQuickView();
			openHacsDialog();
		});
	}
	if (haDialogCloseBtn) haDialogCloseBtn.addEventListener('click', closeHaDialog);
	if (haDialogBackdrop) haDialogBackdrop.addEventListener('click', closeHaDialog);
	if (haDialogCopyBtn) {
		haDialogCopyBtn.addEventListener('click', () => {
			const uid = haDialogCode?.value || '';
			if (!uid) return;
			copyText(uid, haDialogCopyBtn, 'Copy');
		});
	}
	if (hacsDialogCloseBtn) hacsDialogCloseBtn.addEventListener('click', closeHacsDialog);
	if (hacsDialogBackdrop) hacsDialogBackdrop.addEventListener('click', closeHacsDialog);
	if (hacsDialogCopyBtn) {
		hacsDialogCopyBtn.addEventListener('click', () => {
			const repo = hacsDialogRepo?.value || HACS_REPO_URL;
			copyText(repo, hacsDialogCopyBtn, 'Copy repo URL');
		});
	}

	if (toggleDialogCloseBtn) toggleDialogCloseBtn.addEventListener('click', closeToggleDialog);
	if (toggleDialogBackdrop) toggleDialogBackdrop.addEventListener('click', closeToggleDialog);
	if (toggleDialogSwitch) {
		toggleDialogSwitch.addEventListener('change', () => {
			updateToggleDialogStateLabel(toggleDialogSwitch.checked);
			applyToggleDialog();
		});
	}

	if (authDialogCloseBtn) authDialogCloseBtn.addEventListener('click', closeAuthDialog);
	if (authDialogBackdrop) authDialogBackdrop.addEventListener('click', closeAuthDialog);
	if (authDialogLoginBtn) {
		authDialogLoginBtn.addEventListener('click', () => {
			applyAuthDialog();
		});
	}
	if (haDialogCopyOpenBtn) {
		haDialogCopyOpenBtn.addEventListener('click', () => {
			const uid = haDialogCode?.value || '';
			if (!uid) return;
			copyAndOpenHomeAssistant(uid, haDialogCopyOpenBtn, 'Copy and Open');
			closeHaDialog();
		});
	}

	// Switch stats dialog handlers
	if (allSwitchesStatBox) {
		allSwitchesStatBox.addEventListener('click', () => openSwitchStatsDialog());
		allSwitchesStatBox.addEventListener('keydown', (e) => {
			if (e.key === 'Enter' || e.key === ' ') {
				e.preventDefault();
				openSwitchStatsDialog();
			}
		});
	}
	if (switchStatsCloseBtn) switchStatsCloseBtn.addEventListener('click', closeSwitchStatsDialog);
	if (switchStatsBackdrop) switchStatsBackdrop.addEventListener('click', closeSwitchStatsDialog);

	window.addEventListener('keydown', (e) => {
		if (e.key === 'Escape') {
			closeQuickView();
			closeHaDialog();
			closeHacsDialog();
			closeToggleDialog();
			closeAuthDialog();
			closeSwitchStatsDialog();
		}
	});

	window.addEventListener('popstate', () => {
		restoreSwitchFromQuery();
	});

	document.addEventListener('visibilitychange', () => {
		// Kick a refresh when the user returns to the tab
		if (document.visibilityState === 'visible') {
			autoRefreshTick();
		}
	});

	startLastUpdateTicker();
	startAutoRefresh();
}

async function loadAllData() {
	showLoading();
	try {
		await Promise.all([refreshSwitches({ silent: false }), loadCategories(), loadBilling()]);
		hideMessages();
		if (allSwitches.length === 0) {
			showEmptyMessage();
		}
	} catch (error) {
		console.error('Error loading data:', error);
		showError();
	}
}

async function loadBilling() {
	try {
		const response = await fetch(`${API_BASE_URL}/billing`);
		if (!response.ok) {
			return;
		}
		const data = await response.json();
		if (data && data.success && data.data) {
			billing = {
				promoteEnabled: Boolean(data.data.promoteEnabled),
				promoteDurationDays: Number(data.data.promoteDurationDays) || 7,
				premiumEnabled: Boolean(data.data.premiumEnabled),
				premiumAmount: Number(data.data.premiumAmount) || 900,
				premiumCurrency: String(data.data.premiumCurrency || 'eur').toLowerCase(),
				maxPrivate: Number(data.data.maxPrivate) || 5,
				maxPublic: Number(data.data.maxPublic) || 10,
				premiumMaxPublic: Number(data.data.premiumMaxPublic) || 25,
				premiumMaxSwitches: Number(data.data.premiumMaxSwitches) || 50,
				taxEnabled: data.data.taxEnabled !== false
			};
		}
	} catch {
		// Directory still works without billing flags.
	}
}

async function loadSwitches() {
	// Backwards-compatible entry point (used by the "Try Again" button)
	try {
		await loadAllData();
	} catch (_err) {
		// loadAllData already shows error UI
	}
}

function startAutoRefresh() {
	if (autoRefreshTimer) return;
	autoRefreshTimer = setInterval(autoRefreshTick, AUTO_REFRESH_MS);
}

async function autoRefreshTick() {
	if (autoRefreshInFlight) return;
	if (document.visibilityState && document.visibilityState !== 'visible') return;

	autoRefreshInFlight = true;
	try {
		await refreshSwitches({ silent: true });
	} catch (error) {
		// Don't flash error UI for background refreshes
		console.warn('Background refresh failed:', error);
	} finally {
		autoRefreshInFlight = false;
	}
}

function startLastUpdateTicker() {
	if (lastUpdateTimer) return;
	lastUpdateTimer = setInterval(updateLastUpdateDisplay, LAST_UPDATE_TICK_MS);
	updateLastUpdateDisplay();
}

function updateLastUpdateDisplay() {
	if (!lastUpdate) return;
	if (!lastSwitchFetchAt) {
		lastUpdate.textContent = '-';
		return;
	}
	lastUpdate.textContent = formatTimeAgo(new Date(lastSwitchFetchAt));
	updateRelativeTimeStamps();
}

function updateRelativeTimeStamps() {
	// Update "Last Changed" timestamps on cards without doing any network requests.
	const stampEls = document.querySelectorAll('[data-field="lastChanged"][data-ts]');
	stampEls.forEach((el) => {
		const tsRaw = el.dataset.ts || '';
		const ts = tsRaw ? Number(tsRaw) : 0;
		if (!ts) {
			el.textContent = 'Never';
			return;
		}
		el.textContent = formatTimeAgo(new Date(ts));
	});
}

function getRenderedSwitchUids() {
	if (!switchesGrid) return [];
	return Array.from(switchesGrid.querySelectorAll('.switch-card[data-uid]'))
		.map((el) => String(el.dataset.uid || '').trim())
		.filter(Boolean);
}

function areUidListsEqual(a, b) {
	if (a === b) return true;
	if (!Array.isArray(a) || !Array.isArray(b)) return false;
	if (a.length !== b.length) return false;
	for (let i = 0; i < a.length; i += 1) {
		if (a[i] !== b[i]) return false;
	}
	return true;
}

function updateSwitchCardElement(card, switchData) {
	if (!card || !switchData) return;
	const uid = String(switchData.uid || '').trim();
	if (!uid) return;

	const stateClass = switchData.state ? 'state-on' : 'state-off';
	card.classList.remove('state-on', 'state-off');
	card.classList.add(stateClass);

	card.dataset.bannerUrl = String(switchData.bannerUrl || '');

	const iconEl = card.querySelector('[data-field="icon"]');
	if (iconEl) {
		const iconUrl = String(switchData.iconUrl || '').trim();
		if (iconUrl) {
			iconEl.src = iconUrl;
			iconEl.classList.remove('hidden');
		} else {
			iconEl.removeAttribute('src');
			iconEl.classList.add('hidden');
		}
	}

	const cardBanner = card.querySelector('[data-field="cardBanner"]');
	if (cardBanner) {
		const bannerUrl = String(switchData.bannerUrl || '').trim();
		if (bannerUrl) {
			cardBanner.style.backgroundImage = `url('${bannerUrl}')`;
			cardBanner.classList.remove('hidden');
		} else {
			cardBanner.style.backgroundImage = '';
			cardBanner.classList.add('hidden');
		}
	}

	const nameEl = card.querySelector('[data-field="name"]');
	if (nameEl) {
		nameEl.textContent = getSwitchDisplayName(switchData);
	}

	const promotedEl = card.querySelector('[data-field="promotedBadge"]');
	if (promotedEl) {
		promotedEl.classList.toggle('hidden', !isListingPromoted(switchData));
	}

	const extrasBadgesEl = card.querySelector('[data-field="extrasBadges"]');
	if (extrasBadgesEl) {
		extrasBadgesEl.innerHTML = renderExtrasBadgesHtml(switchData);
	}

	const descEl = card.querySelector('[data-field="description"]');
	if (descEl) {
		const description = getSwitchDescription(switchData);
		descEl.textContent = description;
		descEl.classList.toggle('hidden', !description);
	}

	const stateEl = card.querySelector('[data-field="stateBadge"]');
	if (stateEl) {
		const on = Boolean(switchData.state);
		stateEl.classList.remove('on', 'off');
		stateEl.classList.add(on ? 'on' : 'off');
		stateEl.textContent = on ? 'ON' : 'OFF';
	}

	const usersEl = card.querySelector('[data-field="users"]');
	if (usersEl) {
		const userCount = (typeof switchData.userCount === 'number') ? switchData.userCount : 0;
		usersEl.textContent = `${userCount} user${userCount === 1 ? '' : 's'}`;
	}

	const togglesEl = card.querySelector('[data-field="toggles"]');
	if (togglesEl) {
		const toggleCount = (typeof switchData.toggleCount === 'number') ? switchData.toggleCount : 0;
		togglesEl.textContent = `${toggleCount} toggles`;
	}

	const lastEl = card.querySelector('[data-field="lastChanged"]');
	if (lastEl) {
		const ts = switchData.lastToggled ? Number(switchData.lastToggled) : 0;
		lastEl.dataset.ts = ts ? String(ts) : '';
		lastEl.textContent = ts ? formatTimeAgo(new Date(ts)) : 'Never';
	}
}

function updateRenderedSwitchCards() {
	const uids = getRenderedSwitchUids();
	if (!uids.length) return;

	const byUid = new Map(allSwitches.map((sw) => [sw.uid, sw]));
	uids.forEach((uid) => {
		const sw = byUid.get(uid);
		if (!sw) return;
		const card = switchesGrid.querySelector(`.switch-card[data-uid="${uid}"]`);
		updateSwitchCardElement(card, sw);
	});
}

function computeFilteredSwitches() {
	const searchQuery = searchBox.value.toLowerCase().trim();
	const category = selectedCategory;
	const minUsers = userCountFilter.value ? parseInt(userCountFilter.value, 10) : null;

	return allSwitches.filter((switchData) => {
	const name = getDisplaySwitchName(switchData.name || '').toLowerCase();
	const description = String(switchData.description || '').toLowerCase();
		const location = (switchData.location || '').toLowerCase();
		const categoryValue = (switchData.category || '').toLowerCase();

	const matchesSearch = !searchQuery
		|| name.includes(searchQuery)
		|| description.includes(searchQuery)
		|| location.includes(searchQuery)
		|| categoryValue.includes(searchQuery);
		const matchesCategory = !category || switchData.category === category;
		const matchesUserCount = !minUsers || (switchData.userCount || 0) >= minUsers;

		return matchesSearch && matchesCategory && matchesUserCount;
	});
}

function applyFilters(options = {}) {
	const shouldRender = options.render !== false;
	filteredSwitches = computeFilteredSwitches();
	if (shouldRender) {
		renderSwitches();
	}
}

async function refreshSwitches(options = {}) {
	const silent = options.silent === true;

	const renderedBefore = getRenderedSwitchUids();

	const response = await fetch(`${API_BASE_URL}/public-switches`);
	if (!response.ok) {
		throw new Error(`HTTP ${response.status}: ${response.statusText}`);
	}

	const data = await response.json();
	if (!data.success) {
		throw new Error(data.error || 'Failed to load switches');
	}

	allSwitches = data.data.switches || [];
	lastSwitchFetchAt = Date.now();
	updateStats();
	updateLastUpdateDisplay();

	// Preserve current filters (don't reset on refresh)
	applyFilters({ render: false });

	// If we're in "quiet" mode and the visible set hasn't changed, update cards in-place (no flicker).
	const renderedAfter = filteredSwitches.map((sw) => sw.uid);
	const canPatchInPlace = silent
		&& switchesGrid
		&& switchesGrid.querySelectorAll('.switch-card[data-uid]').length > 0
		&& areUidListsEqual(renderedBefore, renderedAfter);

	if (canPatchInPlace) {
		updateRenderedSwitchCards();
		wireSwitchCardClicks();
	} else {
		renderSwitches();
	}

	ensureRealtimeSubscriptions();
}

function resolveWebSocketBaseUrl() {
	let api;
	try {
		api = new URL(API_BASE_URL);
	} catch {
		return '';
	}

	const wsProtocol = api.protocol === 'https:' ? 'wss:' : 'ws:';
	let port = api.port || '';

	// When pointing directly at the webserver ports, use the configured WS ports.
	if (port === '3090') port = '3001';
	if (port === '3091') port = '3002';

	const host = api.hostname + (port ? `:${port}` : '');
	return `${wsProtocol}//${host}/ws`;
}

function clearWsReconnectTimer() {
	if (!wsReconnectTimer) return;
	try {
		clearTimeout(wsReconnectTimer);
	} catch {
		// ignore
	}
	wsReconnectTimer = null;
}

function disconnectRealtime() {
	clearWsReconnectTimer();
	wsReconnectAttempts = 0;
	wsSubscribedUids.clear();

	try {
		if (wsClient) {
			wsClient.onopen = null;
			wsClient.onmessage = null;
			wsClient.onclose = null;
			wsClient.onerror = null;
			wsClient.close();
		}
	} catch {
		// ignore
	}
	wsClient = null;
}

function scheduleWsReconnect(desiredUid) {
	clearWsReconnectTimer();
	wsReconnectAttempts = Math.min(wsReconnectAttempts + 1, 8);
	const delayMs = Math.min(30_000, 500 * (2 ** wsReconnectAttempts));
	wsReconnectTimer = setTimeout(() => {
		connectRealtime(desiredUid);
	}, delayMs);
}

function wsSendJson(value) {
	try {
		if (!wsClient || wsClient.readyState !== 1) return false; // 1 = OPEN
		wsClient.send(JSON.stringify(value));
		return true;
	} catch {
		return false;
	}
}

/**
 * Note/source/params of a live change. A `state_update` without `source` is a
 * snapshot (sent on subscribe) or from an older server: it leaves them alone.
 */
function applyLiveChangeExtras(target, extras) {
	if (!target || !extras || typeof extras.source !== 'string' || !extras.source) return target;
	return {
		...target,
		note: typeof extras.note === 'string' ? extras.note : '',
		lastSource: extras.source,
		lastParams: extras.params && typeof extras.params === 'object' ? extras.params : {},
		lastPaid: extras.paid && typeof extras.paid === 'object' ? extras.paid : null
	};
}

function handleStateUpdate(uid, state, timestamp, extras = null) {
	const targetUid = String(uid || '').trim();
	if (!targetUid) return;

	const idx = allSwitches.findIndex((sw) => sw && sw.uid === targetUid);
	if (idx >= 0) {
		allSwitches[idx] = applyLiveChangeExtras({
			...allSwitches[idx],
			state: Boolean(state),
			lastToggled: timestamp ? Number(timestamp) : allSwitches[idx].lastToggled
		}, extras);
	}

	// Patch visible card if present
	const card = switchesGrid ? switchesGrid.querySelector(`.switch-card[data-uid="${targetUid}"]`) : null;
	if (card && idx >= 0) {
		updateSwitchCardElement(card, allSwitches[idx]);
		updateStats();
	}

	if (currentSwitchId && currentSwitchId === targetUid) {
		currentSwitchDetail = applyLiveChangeExtras({
			...(currentSwitchDetail || {}),
			uid: targetUid,
			state: Boolean(state),
			lastToggled: timestamp ? Number(timestamp) : (currentSwitchDetail?.lastToggled || null)
		}, extras);
		updateHeroStatusButton(currentSwitchDetail);
		renderLastNote(currentSwitchDetail);
		updateSwitchExtrasVisibility();
		if (toggleDialog && !toggleDialog.classList.contains('hidden')) {
			if (toggleDialogSwitch) {
				toggleDialogSwitch.checked = Boolean(state);
			}
			updateToggleDialogStateLabel(Boolean(state));
			renderToggleDialogActivity(currentSwitchDetail || {});
		}
		scheduleDetailRefresh(targetUid);
	}
}

function scheduleDetailRefresh(uid) {
	if (!uid || uid !== currentSwitchId) return;
	if (detailRefreshTimer) return;
	detailRefreshTimer = setTimeout(() => {
		detailRefreshTimer = null;
		refreshSwitchDetail(uid);
	}, 800);
}

async function refreshSwitchDetail(uid, allowRedirect = true) {
	if (!uid || uid !== currentSwitchId) return;
	try {
		const response = await fetch(`${API_BASE_URL}/switch/${uid}`);
		if (!response.ok) {
			throw new Error(`HTTP ${response.status}: ${response.statusText}`);
		}
		const data = await response.json();
		if (!data.success || !data.data) {
			throw new Error(data.error || 'Failed to load switch detail');
		}

		const detail = data.data;
		if (detail && detail.redirect) {
			if (allowRedirect && detail.redirectTo) {
				await openSwitchDetails(detail.redirectTo, true, {
					allowRedirect: false,
					redirectFrom: uid,
					redirectReason: detail.redirectReason
				});
				return;
			}
			showRedirectNotice(uid, detail.redirectTo, detail.redirectReason);
			return;
		}

		currentSwitchDetail = detail;
		hideRedirectNotice();
		
		// Re-render full detail view to update name, description, and all metadata
		renderSwitchDetail(detail);
		setHeroForSwitch(detail);
		updateHeroStatusButton(detail);

		// Update activity + counts without resetting the manage panel inputs.
		updateDetailActivity(detail);
		syncSwitchDetailToIndex(detail);
	} catch (error) {
		console.warn('Failed to refresh switch detail:', error);
	}
}

async function ensureCurrentSwitchDetail(uid) {
	if (!uid || uid !== currentSwitchId) return currentSwitchDetail;
	if (currentSwitchDetail && currentSwitchDetail.uid === uid && typeof currentSwitchDetail.state === 'boolean') {
		return currentSwitchDetail;
	}
	await refreshSwitchDetail(uid);
	return currentSwitchDetail;
}

async function toggleSwitchWithAccessKey(uid, apiKey) {
	if (!uid || !apiKey) {
		throw new Error('Access key required');
	}
	const response = await fetch(`${API_BASE_URL}/v2/switch/${uid}/toggle`, {
		method: 'POST',
		headers: {
			'Content-Type': 'application/json',
			'X-Api-Key': apiKey
		},
		body: JSON.stringify({})
	});
	const data = await response.json();
	if (!response.ok || !data.success) {
		throw new Error(data.error || 'Failed to toggle switch');
	}
	if (data.data) {
		handleStateUpdate(uid, data.data.state, data.data.timestamp);
		if (currentSwitchDetail && currentSwitchDetail.uid === uid && typeof data.data.toggleCount === 'number') {
			currentSwitchDetail.toggleCount = data.data.toggleCount;
			if (detailToggles) detailToggles.textContent = `${data.data.toggleCount} toggles`;
		}
	}
	return data.data;
}

function updateDetailActivity(detail) {
	if (!detail) return;

	if (detailUsers) detailUsers.textContent = `${detail.userCount || 0} user${(detail.userCount || 0) === 1 ? '' : 's'}`;
	if (detailToggles) detailToggles.textContent = `${detail.toggleCount || 0} toggles`;
	if (detailLastChange) detailLastChange.textContent = detail.lastToggled ? formatTimeAgo(new Date(detail.lastToggled)) : 'Never';

	// If the icon/banner/name/description changes, update visible pieces too
	if (detailTitle) detailTitle.textContent = getSwitchDisplayName(detail);
	setDetailPromotedBadge(detail);
	if (detailDescription) {
		const description = getSwitchDescription(detail);
		detailDescription.textContent = description;
		detailDescription.classList.toggle('hidden', !description);
	}
	if (detailIcon) {
		const icon = String(detail.iconUrl || '').trim();
		if (icon) {
			detailIcon.src = icon;
			detailIcon.classList.remove('hidden');
		} else {
			detailIcon.removeAttribute('src');
			detailIcon.classList.add('hidden');
		}
	}

	renderEvents(detail.events || []);
	if (toggleDialog && !toggleDialog.classList.contains('hidden')) {
		renderToggleDialogActivity(detail);
	}
	updateCommentStateVisibility();
}

function syncSwitchDetailToIndex(detail) {
	if (!detail || !detail.uid) return;
	const idx = allSwitches.findIndex((sw) => sw && sw.uid === detail.uid);
	if (idx >= 0) {
		allSwitches[idx] = {
			...allSwitches[idx],
			state: detail.state,
			lastToggled: detail.lastToggled,
			toggleCount: detail.toggleCount,
			userCount: detail.userCount,
			iconUrl: detail.iconUrl || allSwitches[idx].iconUrl,
			bannerUrl: detail.bannerUrl || allSwitches[idx].bannerUrl,
			name: detail.name || allSwitches[idx].name,
			description: detail.description || allSwitches[idx].description,
			location: detail.location || allSwitches[idx].location,
			category: detail.category || allSwitches[idx].category,
			commerce: detail.commerce !== undefined ? detail.commerce : allSwitches[idx].commerce,
			reward: detail.reward !== undefined ? detail.reward : allSwitches[idx].reward,
			properties: detail.properties !== undefined ? detail.properties : allSwitches[idx].properties
		};
		updateRenderedSwitchCards();
		updateStats();
	}
}

function connectRealtime(initialUid) {
	if (typeof window.WebSocket !== 'function') return;

	const uid = String(initialUid || '').trim();
	if (!uid) return;

	const base = resolveWebSocketBaseUrl();
	if (!base) return;

	// If already connected, keep it.
	if (wsClient && (wsClient.readyState === 0 || wsClient.readyState === 1)) {
		return;
	}

	const wsUrl = `${base}?uid=${encodeURIComponent(uid)}`;
	try {
		wsClient = new window.WebSocket(wsUrl);
	} catch (err) {
		console.warn('Failed to create WebSocket:', err);
		wsClient = null;
		return;
	}

	wsClient.onopen = () => {
		wsReconnectAttempts = 0;
		clearWsReconnectTimer();
		// We'll subscribe after open via ensureRealtimeSubscriptions()
		ensureRealtimeSubscriptions();
	};

	wsClient.onmessage = (event) => {
		try {
			const raw = event && event.data ? String(event.data) : '';
			if (!raw) return;
			const msg = JSON.parse(raw);
			if (msg && msg.type === 'state_update') {
				handleStateUpdate(msg.uid, msg.state, msg.timestamp, msg);
			}
		} catch (err) {
			console.warn('Bad WS message:', err);
		}
	};

	wsClient.onclose = () => {
		wsClient = null;
		scheduleWsReconnect(uid);
	};

	wsClient.onerror = () => {
		// Let onclose handle reconnect
	};
}

function ensureRealtimeSubscriptions() {
	// Subscribe to the switches that are currently visible (plus current detail).
	const desired = new Set(getRenderedSwitchUids());
	if (currentSwitchId) desired.add(currentSwitchId);

	const desiredList = Array.from(desired).filter(Boolean);
	if (desiredList.length === 0) {
		disconnectRealtime();
		return;
	}

	// Ensure connection (server requires a uid query param)
	connectRealtime(desiredList[0]);

	// If WS not ready yet, we'll subscribe on open.
	if (!wsClient || wsClient.readyState !== 1) return;

	// Subscribe new
	desiredList.forEach((uid) => {
		if (wsSubscribedUids.has(uid)) return;
		if (wsSendJson({ type: 'subscribe', uid })) {
			wsSubscribedUids.add(uid);
		}
	});

	// Unsubscribe old
	Array.from(wsSubscribedUids).forEach((uid) => {
		if (desired.has(uid)) return;
		wsSendJson({ type: 'unsubscribe', uid });
		wsSubscribedUids.delete(uid);
	});
}

async function loadCategories() {
	try {
		const response = await fetch(`${API_BASE_URL}/categories`);
		if (!response.ok) {
			throw new Error(`HTTP ${response.status}: ${response.statusText}`);
		}
		const data = await response.json();
		if (!data.success) {
			throw new Error(data.error || 'Failed to load categories');
		}
		categories = data.data || {};
		renderCategories();
	} catch (error) {
		console.warn('Categories unavailable:', error);
		categoryList.innerHTML = '<p class="text-muted">Categories unavailable.</p>';
	}
}

function renderCategories() {
	if (!categories || Object.keys(categories).length === 0) {
		categoryList.innerHTML = '<p class="text-muted">No categories yet.</p>';
		return;
	}

	const totalCount = allSwitches.length;
	const allChip = `<button class="category-chip${selectedCategory === '' ? ' active' : ''}" onclick="filterByCategory('')">
		<span>All</span><span class="chip-count">${totalCount}</span>
	</button>`;

	const chips = Object.entries(categories)
		.sort((a, b) => b[1] - a[1])
		.map(([name, count]) => `
			<button class="category-chip${selectedCategory === name ? ' active' : ''}" onclick="filterByCategory('${encodeURIComponent(name)}')">
				<span>${escapeHtml(name)}</span>
				<span class="chip-count">${count}</span>
			</button>
		`).join('');

	categoryList.innerHTML = allChip + chips;
}

function showLoading() {
	hideMessages();
	loadingMessage.style.display = 'block';
}

function showError() {
	hideMessages();
	errorMessage.style.display = 'block';
}

function showEmptyMessage() {
	hideMessages();
	emptySwitches.style.display = 'block';
}

function hideMessages() {
	loadingMessage.style.display = 'none';
	errorMessage.style.display = 'none';
	emptySwitches.style.display = 'none';
}

function updateStats() {
	const publicCount = allSwitches.length;
	const active = allSwitches.filter(sw => sw.state).length;
	if (totalSwitches) totalSwitches.textContent = publicCount;
	if (activeSwitches) activeSwitches.textContent = active;
	refreshTotalSwitchCount();
}

async function refreshTotalSwitchCount() {
	try {
		const response = await fetch(`${API_BASE_URL}/stats`);
		if (!response.ok) return;
		const json = await response.json();
		if (!json.success) return;
		const count = json.data.totalSwitchCount;
		if (allSwitchesCountEl && typeof count === 'number') {
			allSwitchesCountEl.textContent = count;
		}
	} catch {
		// Silently ignore – the stat box keeps its last value or "-"
	}
}

function applyFilters(options = {}) {
	const shouldRender = options.render !== false;
	filteredSwitches = computeFilteredSwitches();
	if (shouldRender) {
		renderSwitches();
	}
}

function renderSwitches() {
	if (filteredSwitches.length === 0 && allSwitches.length > 0) {
		switchesGrid.innerHTML = `
			<div class="empty-message" style="grid-column: 1 / -1;">
				<h3>🔍 No Matching Switches</h3>
				<p>No switches match your search criteria. Try adjusting your filters.</p>
			</div>
		`;
		return;
	}

	switchesGrid.innerHTML = filteredSwitches.map(createSwitchCard).join('');
	wireSwitchCardClicks();
}

function setQuickViewBanner(bannerUrl) {
	if (!quickView) return;
	const url = String(bannerUrl || '').trim();
	if (!url) {
		quickView.style.removeProperty('--quickview-banner-image');
		return;
	}
	quickView.style.setProperty('--quickview-banner-image', `url("${cssEscapeUrl(url)}")`);
}

function showQuickView() {
	if (!quickView) return;
	quickView.classList.remove('hidden');
	document.body.classList.add('modal-open');
	quickView.setAttribute('aria-hidden', 'false');
}

function closeQuickView() {
	if (!quickView) return;
	quickView.classList.add('hidden');
	document.body.classList.remove('modal-open');
	quickView.setAttribute('aria-hidden', 'true');

	setQuickViewBanner('');
	quickViewUid = null;
	quickViewDetail = null;

	if (quickViewIcon) {
		quickViewIcon.removeAttribute('src');
		quickViewIcon.classList.add('hidden');
	}
	if (quickViewTitle) quickViewTitle.textContent = 'Switch details';
	if (quickViewSubtitle) quickViewSubtitle.textContent = '';
	if (quickViewMeta) quickViewMeta.innerHTML = '';
}

function showHaDialog() {
	if (!haDialog) return;
	haDialog.classList.remove('hidden');
	document.body.classList.add('modal-open');
	haDialog.setAttribute('aria-hidden', 'false');
}

function closeHaDialog() {
	if (!haDialog) return;
	haDialog.classList.add('hidden');
	document.body.classList.remove('modal-open');
	haDialog.setAttribute('aria-hidden', 'true');
	if (haDialogCode) haDialogCode.value = '';
}

function openHaDialogForUid(uid) {
	const trimmed = String(uid || '').trim();
	if (!trimmed) return;
	if (haDialogCode) haDialogCode.value = trimmed;
	if (haDialogOpenLink) haDialogOpenLink.href = HOME_ASSISTANT_CONFIG_FLOW_URL;
	if (haDialogBadgeLink) haDialogBadgeLink.href = HOME_ASSISTANT_CONFIG_FLOW_URL;
	showHaDialog();
}

function showHacsDialog() {
	if (!hacsDialog) return;
	hacsDialog.classList.remove('hidden');
	document.body.classList.add('modal-open');
	hacsDialog.setAttribute('aria-hidden', 'false');
}

function closeHacsDialog() {
	if (!hacsDialog) return;
	hacsDialog.classList.add('hidden');
	document.body.classList.remove('modal-open');
	hacsDialog.setAttribute('aria-hidden', 'true');
}

function openHacsDialog() {
	if (hacsDialogRepo) hacsDialogRepo.value = HACS_REPO_URL;
	if (hacsDialogOpenLink) hacsDialogOpenLink.href = HACS_ADD_URL;
	if (hacsDialogBadgeLink) hacsDialogBadgeLink.href = HACS_ADD_URL;
	showHacsDialog();
}

function showAuthDialog() {
	if (!authDialog) return;
	authDialog.classList.remove('hidden');
	document.body.classList.add('modal-open');
	authDialog.setAttribute('aria-hidden', 'false');
}

function closeAuthDialog() {
	if (!authDialog) return;
	authDialog.classList.add('hidden');
	document.body.classList.remove('modal-open');
	authDialog.setAttribute('aria-hidden', 'true');
	if (authDialogStatus) {
		authDialogStatus.textContent = '';
		authDialogStatus.className = 'comment-status';
	}
	if (authDialogKeyInput) authDialogKeyInput.value = '';
	pendingAuthToggle = false;
}

// ── Switch Stats Dialog ─────────────────────────────────────────────────

function showSwitchStatsDialog() {
	if (!switchStatsDialog) return;
	switchStatsDialog.classList.remove('hidden');
	document.body.classList.add('modal-open');
	switchStatsDialog.setAttribute('aria-hidden', 'false');
}

function closeSwitchStatsDialog() {
	if (!switchStatsDialog) return;
	switchStatsDialog.classList.add('hidden');
	document.body.classList.remove('modal-open');
	switchStatsDialog.setAttribute('aria-hidden', 'true');
}

async function openSwitchStatsDialog() {
	showSwitchStatsDialog();
	try {
		const response = await fetch(`${API_BASE_URL}/stats`);
		if (!response.ok) throw new Error(`HTTP ${response.status}`);
		const json = await response.json();
		if (!json.success) throw new Error(json.error || 'Failed to load stats');

		const data = json.data;
		const totalAll = typeof data.totalSwitchCount === 'number' ? data.totalSwitchCount : '-';
		const totalPublic = typeof data.publicSwitchCount === 'number' ? data.publicSwitchCount : '-';
		const wsClients = data.websocket && typeof data.websocket.clients === 'number'
			? data.websocket.clients
			: '-';

		const dailyStats = Array.isArray(data.dailyStats) ? data.dailyStats : [];
		const todayStr = new Date().toISOString().split('T')[0];
		const todayEntry = dailyStats.find(d => d.date === todayStr);
		const addedToday = todayEntry ? todayEntry.added : 0;

		if (statsTotalAllEl) statsTotalAllEl.textContent = totalAll;
		if (statsTotalPublicEl) statsTotalPublicEl.textContent = totalPublic;
		if (statsAddedTodayEl) statsAddedTodayEl.textContent = addedToday;
		if (statsWsClientsEl) statsWsClientsEl.textContent = wsClients;

		renderSwitchStatsChart(dailyStats);
	} catch (err) {
		console.error('Failed to load switch stats:', err);
		if (statsTotalAllEl) statsTotalAllEl.textContent = '?';
		if (statsTotalPublicEl) statsTotalPublicEl.textContent = '?';
		if (statsAddedTodayEl) statsAddedTodayEl.textContent = '?';
		if (statsWsClientsEl) statsWsClientsEl.textContent = '?';
	}
}

function renderSwitchStatsChart(dailyStats) {
	if (!switchStatsCanvas) return;
	const ctx = switchStatsCanvas.getContext('2d');
	if (!ctx) return;

	const dpr = window.devicePixelRatio || 1;
	const cssW = switchStatsCanvas.parentElement.clientWidth || 660;
	const cssH = 220;
	switchStatsCanvas.width = cssW * dpr;
	switchStatsCanvas.height = cssH * dpr;
	switchStatsCanvas.style.width = `${cssW}px`;
	switchStatsCanvas.style.height = `${cssH}px`;
	ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

	ctx.clearRect(0, 0, cssW, cssH);

	const days = Array.isArray(dailyStats) ? dailyStats : [];
	if (days.length === 0) {
		ctx.fillStyle = getComputedStyle(document.documentElement).getPropertyValue('--text-muted').trim() || '#888';
		ctx.font = '13px sans-serif';
		ctx.textAlign = 'center';
		ctx.fillText('No data available', cssW / 2, cssH / 2);
		return;
	}

	// Use the pre-computed totals from the API
	const addedPerDay = days.map(d => d.added || 0);
	const totalPerDay = days.map(d => d.total || 0);

	const PADDING_LEFT = 45;
	const PADDING_RIGHT = 15;
	const PADDING_TOP = 15;
	const PADDING_BOTTOM = 40;
	const chartW = cssW - PADDING_LEFT - PADDING_RIGHT;
	const chartH = cssH - PADDING_TOP - PADDING_BOTTOM;

	const maxTotal = Math.max(...totalPerDay, 1);
	const maxAdded = Math.max(...addedPerDay, 1);

	const styles = getComputedStyle(document.documentElement);
	const primaryColour = styles.getPropertyValue('--primary').trim() || '#FF9800';
	const addedColour = '#22c55e';
	const gridColour = styles.getPropertyValue('--border-light').trim() || 'rgba(255,255,255,0.08)';
	const textColour = styles.getPropertyValue('--text-muted').trim() || '#888';

	const n = days.length;
	const barWidth = Math.max(chartW / n * 0.5, 2);

	// Y-axis scale for total (left axis)
	const ySteps = 4;
	ctx.font = '10px sans-serif';
	ctx.textAlign = 'right';
	ctx.textBaseline = 'middle';
	for (let i = 0; i <= ySteps; i++) {
		const val = Math.round(maxTotal * i / ySteps);
		const y = PADDING_TOP + chartH - (chartH * i / ySteps);
		ctx.fillStyle = textColour;
		ctx.fillText(String(val), PADDING_LEFT - 6, y);
		ctx.strokeStyle = gridColour;
		ctx.lineWidth = 1;
		ctx.beginPath();
		ctx.moveTo(PADDING_LEFT, y);
		ctx.lineTo(cssW - PADDING_RIGHT, y);
		ctx.stroke();
	}

	// Draw bars (added per day)
	for (let i = 0; i < n; i++) {
		const x = PADDING_LEFT + (i + 0.5) * (chartW / n);
		const barH = (addedPerDay[i] / maxAdded) * chartH * 0.35;
		ctx.fillStyle = addedColour;
		ctx.globalAlpha = 0.6;
		ctx.fillRect(x - barWidth / 2, PADDING_TOP + chartH - barH, barWidth, barH);
		ctx.globalAlpha = 1.0;
	}

	// Draw line (total switches)
	ctx.beginPath();
	ctx.strokeStyle = primaryColour;
	ctx.lineWidth = 2;
	ctx.lineJoin = 'round';
	for (let i = 0; i < n; i++) {
		const x = PADDING_LEFT + (i + 0.5) * (chartW / n);
		const y = PADDING_TOP + chartH - (totalPerDay[i] / maxTotal) * chartH;
		if (i === 0) {
			ctx.moveTo(x, y);
		} else {
			ctx.lineTo(x, y);
		}
	}
	ctx.stroke();

	// Dots on line
	for (let i = 0; i < n; i++) {
		const x = PADDING_LEFT + (i + 0.5) * (chartW / n);
		const y = PADDING_TOP + chartH - (totalPerDay[i] / maxTotal) * chartH;
		ctx.beginPath();
		ctx.arc(x, y, 3, 0, Math.PI * 2);
		ctx.fillStyle = primaryColour;
		ctx.fill();
	}

	// X-axis labels (show every ~5th day to avoid overlap)
	ctx.fillStyle = textColour;
	ctx.font = '10px sans-serif';
	ctx.textAlign = 'center';
	ctx.textBaseline = 'top';
	const labelStep = n <= 10 ? 1 : n <= 20 ? 3 : 5;
	for (let i = 0; i < n; i += labelStep) {
		const x = PADDING_LEFT + (i + 0.5) * (chartW / n);
		const label = days[i].date.slice(5); // MM-DD
		ctx.fillText(label, x, PADDING_TOP + chartH + 6);
	}
	// Always label the last day
	if ((n - 1) % labelStep !== 0) {
		const x = PADDING_LEFT + (n - 0.5) * (chartW / n);
		const label = days[n - 1].date.slice(5);
		ctx.fillText(label, x, PADDING_TOP + chartH + 6);
	}
}

function openAuthDialog(shouldToggleAfter = false, message = '') {
	if (!currentSwitchId) return;
	pendingAuthToggle = Boolean(shouldToggleAfter);
	if (authDialogStatus) {
		authDialogStatus.textContent = message || '';
		authDialogStatus.className = message ? 'comment-status error' : 'comment-status';
	}
	showAuthDialog();
}

function applyAuthDialog() {
	if (!currentSwitchId) return;
	const key = authDialogKeyInput ? String(authDialogKeyInput.value || '').trim() : '';
	if (!key) {
		if (authDialogStatus) {
			authDialogStatus.textContent = 'Access key required.';
			authDialogStatus.className = 'comment-status error';
		}
		return;
	}
	authDialogStatus.textContent = 'Checking key...';
	authDialogStatus.className = 'comment-status';
	(async () => {
		const result = await detectManagementPermission(currentSwitchId, key);
		if (!result.valid) {
			authDialogStatus.textContent = result.error || 'Invalid access key.';
			authDialogStatus.className = 'comment-status error';
			return;
		}
		setStoredManagementKey(currentSwitchId, '');
		setStoredApiKey(currentSwitchId, '');
		if (result.isManagement) {
			setStoredManagementKey(currentSwitchId, key);
		} else {
			setStoredApiKey(currentSwitchId, key);
		}
		togglePermissionDeniedByUid[currentSwitchId] = false;
		updateAuthPanel(currentSwitchDetail || { uid: currentSwitchId });
		updateAuthGates(currentSwitchDetail || { uid: currentSwitchId });
		updateHeroStatusButton(currentSwitchDetail || {});
		updateCommentStateVisibility();
		updateManagePanel(currentSwitchDetail || { uid: currentSwitchId });
		setAuthStatus('Authenticated.', false);
		const shouldToggle = pendingAuthToggle;
		closeAuthDialog();

		if (shouldToggle) {
			openToggleDialogForDetail(currentSwitchDetail || { uid: currentSwitchId });
		}
	})();
}

function showToggleDialog() {
	if (!toggleDialog) return;
	toggleDialog.classList.remove('hidden');
	document.body.classList.add('modal-open');
	toggleDialog.setAttribute('aria-hidden', 'false');
}

function closeToggleDialog() {
	if (!toggleDialog) return;
	toggleDialog.classList.add('hidden');
	document.body.classList.remove('modal-open');
	toggleDialog.setAttribute('aria-hidden', 'true');
	if (toggleDialogStatus) {
		toggleDialogStatus.textContent = '';
		toggleDialogStatus.className = 'comment-status';
	}
}

function updateToggleDialogStateLabel(state) {
	if (!toggleDialogState) return;
	if (typeof state !== 'boolean') {
		toggleDialogState.textContent = 'Status: Unknown';
		return;
	}
	toggleDialogState.textContent = `Status: ${state ? 'ON' : 'OFF'}`;
}

function openToggleDialogForDetail(detail) {
	if (!toggleDialog) return;
	const stateKnown = typeof detail?.state === 'boolean';
	if (toggleDialogSwitch) {
		toggleDialogSwitch.checked = stateKnown ? detail.state : false;
	}
	updateToggleDialogStateLabel(stateKnown ? detail.state : null);
	renderToggleDialogActivity(detail);
	if (toggleDialogStatus) {
		if (!hasAccessKey(detail?.uid)) {
			toggleDialogStatus.textContent = 'Authenticate to toggle.';
			toggleDialogStatus.className = 'comment-status error';
		} else {
			toggleDialogStatus.textContent = '';
			toggleDialogStatus.className = 'comment-status';
		}
	}
	showToggleDialog();
}

async function applyToggleDialog() {
	if (!currentSwitchId || heroToggleInFlight) return;
	if (!toggleDialogSwitch) return;

	const uid = currentSwitchId;
	const desiredState = Boolean(toggleDialogSwitch.checked);
	const detail = await ensureCurrentSwitchDetail(uid);
	const currentState = (detail && typeof detail.state === 'boolean') ? detail.state : null;
	if (currentState == null) {
		if (toggleDialogStatus) {
			toggleDialogStatus.textContent = 'Current state unavailable.';
			toggleDialogStatus.className = 'comment-status error';
		}
		return;
	}
	const previousState = currentState;
	const apiKey = getActiveApiKey(uid);
	const managementKey = getActiveManagementKey(uid);
	const primaryKey = apiKey || managementKey;
	const fallbackKey = (primaryKey === apiKey) ? managementKey : apiKey;
	if (!primaryKey) {
		if (toggleDialogStatus) {
			toggleDialogStatus.textContent = 'Access key required.';
			toggleDialogStatus.className = 'comment-status error';
		}
		return;
	}

	if (currentState === desiredState) {
		if (toggleDialogStatus) {
			toggleDialogStatus.textContent = 'Already in the requested state.';
			toggleDialogStatus.className = 'comment-status';
		}
		return;
	}

	heroToggleInFlight = true;
	if (toggleDialogStatus) {
		toggleDialogStatus.textContent = 'Toggling...';
		toggleDialogStatus.className = 'comment-status';
	}
	try {
		await toggleSwitchWithAccessKey(uid, primaryKey);
		togglePermissionDeniedByUid[uid] = false;
		updateToggleDialogStateLabel(desiredState);
		updateAuthPanel(detail);
		updateAuthGates(detail);
		updateHeroStatusButton(currentSwitchDetail || {});
		updateCommentStateVisibility();
		if (toggleDialogStatus) {
			toggleDialogStatus.textContent = 'Updated.';
			toggleDialogStatus.className = 'comment-status success';
		}
	} catch (error) {
		if (toggleDialogSwitch) {
			toggleDialogSwitch.checked = previousState;
		}
		updateToggleDialogStateLabel(previousState);
		let message = error && error.message ? error.message : 'Failed to toggle.';
		if (/insufficient permissions/i.test(message) && fallbackKey) {
			try {
				await toggleSwitchWithAccessKey(uid, fallbackKey);
				togglePermissionDeniedByUid[uid] = false;
				if (toggleDialogSwitch) {
					toggleDialogSwitch.checked = desiredState;
				}
				updateToggleDialogStateLabel(desiredState);
				updateAuthPanel(detail);
				updateAuthGates(detail);
				updateHeroStatusButton(currentSwitchDetail || {});
				updateCommentStateVisibility();
				if (toggleDialogStatus) {
					toggleDialogStatus.textContent = 'Updated.';
					toggleDialogStatus.className = 'comment-status success';
				}
				return;
			} catch (fallbackError) {
				message = fallbackError && fallbackError.message ? fallbackError.message : message;
			}
		}
		if (/insufficient permissions/i.test(message)) {
			togglePermissionDeniedByUid[uid] = true;
			message = 'Key missing toggle permission. Generate a new management/API key with toggle access.';
		}
		if (toggleDialogStatus) {
			toggleDialogStatus.textContent = message;
			toggleDialogStatus.className = 'comment-status error';
		}
	} finally {
		heroToggleInFlight = false;
	}
}

async function copyAndOpenHomeAssistant(uid, button, defaultLabel) {
	const trimmed = String(uid || '').trim();
	if (!trimmed) return;
	if (button) {
		copyText(trimmed, button, defaultLabel || button.textContent || 'Copy and Open');
	} else {
		try {
			await navigator.clipboard.writeText(trimmed);
		} catch {
			// ignore
		}
	}
	try {
		window.open(HOME_ASSISTANT_CONFIG_FLOW_URL, '_blank', 'noopener');
	} catch {
		// ignore
	}
}

function renderQuickView(detail) {
	if (!detail) return;
	if (quickViewTitle) quickViewTitle.textContent = getSwitchDisplayName(detail);
	if (quickViewDescription) {
		const description = getSwitchDescription(detail);
		quickViewDescription.textContent = description;
		quickViewDescription.classList.toggle('hidden', !description);
	}
	if (quickViewSubtitle) {
		quickViewSubtitle.textContent = detail.location ? `📍 ${detail.location}` : '';
	}
	if (quickViewIcon) {
		const icon = String(detail.iconUrl || '').trim();
		if (icon) {
			quickViewIcon.src = icon;
			quickViewIcon.classList.remove('hidden');
		} else {
			quickViewIcon.removeAttribute('src');
			quickViewIcon.classList.add('hidden');
		}
	}
	setQuickViewBanner(detail.bannerUrl);

	if (quickViewMeta) {
		const category = escapeHtml(detail.category || 'Other');
		const users = typeof detail.userCount === 'number' ? detail.userCount : (detail.userCount || 0);
		const toggles = typeof detail.toggleCount === 'number' ? detail.toggleCount : (detail.toggleCount || 0);
		const last = detail.lastToggled ? formatTimeAgo(new Date(detail.lastToggled)) : 'Never';

		quickViewMeta.innerHTML = `
			<div class="meta-item">
				<span class="meta-label">Category</span>
				<span class="meta-value">${category}</span>
			</div>
			<div class="meta-item">
				<span class="meta-label">Users</span>
				<span class="meta-value">${users} user${users === 1 ? '' : 's'}</span>
			</div>
			<div class="meta-item">
				<span class="meta-label">Toggle count</span>
				<span class="meta-value">${toggles} toggles</span>
			</div>
			<div class="meta-item">
				<span class="meta-label">Last change</span>
				<span class="meta-value">${escapeHtml(last)}</span>
			</div>
			<div class="meta-item">
				<span class="meta-label">UID</span>
				<span class="meta-value mono">${escapeHtml(detail.uid)}</span>
			</div>
		`;
	}
}

async function openQuickView(uid, previewBannerUrl = '') {
	if (!uid) return;
	if (!quickView) {
		await openSwitchDetails(uid, false);
		return;
	}

	quickViewUid = uid;
	quickViewDetail = null;
	if (quickViewTitle) quickViewTitle.textContent = 'Loading…';
	if (quickViewSubtitle) quickViewSubtitle.textContent = '';
	if (quickViewMeta) quickViewMeta.innerHTML = '';
	if (quickViewIcon) {
		quickViewIcon.removeAttribute('src');
		quickViewIcon.classList.add('hidden');
	}
	setQuickViewBanner(previewBannerUrl);
	showQuickView();

	try {
		const response = await fetch(`${API_BASE_URL}/switch/${uid}`);
		if (!response.ok) {
			throw new Error(`HTTP ${response.status}: ${response.statusText}`);
		}
		const data = await response.json();
		if (!data.success) {
			throw new Error(data.error || 'Failed to load switch detail');
		}

		quickViewDetail = data.data;
		renderQuickView(data.data);
	} catch (error) {
		console.error('Error loading quick view:', error);
		if (quickViewTitle) quickViewTitle.textContent = 'Unable to load switch';
		if (quickViewSubtitle) quickViewSubtitle.textContent = 'Please try again.';
	}
}

function wireSwitchCardClicks() {
	if (!switchesGrid) return;
	const cards = Array.from(switchesGrid.querySelectorAll('.switch-card[data-uid]'));
	cards.forEach((card) => {
		if (!card || card.dataset.wired === '1') return;
		card.dataset.wired = '1';
		card.addEventListener('click', (event) => {
			const interactive = event.target && event.target.closest
				? event.target.closest('button, a, input, select, textarea, label')
				: null;
			if (interactive) return;

			const uid = String(card.dataset.uid || '').trim();
			if (!uid) return;
			const bannerUrl = String(card.dataset.bannerUrl || '').trim();
			openQuickView(uid, bannerUrl);
		});
	});
}

function createSwitchCard(switchData) {
	const {
		uid,
		name,
		description,
		location,
		category,
		state,
		lastToggled,
		userCount,
		toggleCount,
		link,
		iconUrl,
		bannerUrl
	} = switchData;

	const stateClass = state ? 'state-on' : 'state-off';
	const stateText = state ? 'on' : 'off';
	const stateLabel = state ? 'ON' : 'OFF';
	const lastToggledText = lastToggled ? formatTimeAgo(new Date(lastToggled)) : 'Never';
	const safeCategory = escapeHtml(category || 'Other');
	const usersLabel = typeof userCount === 'number' ? `${userCount} user${userCount === 1 ? '' : 's'}` : '0 users';
	const togglesLabel = typeof toggleCount === 'number' ? `${toggleCount} toggles` : '0 toggles';
	const webLink = link ? `<a class="inline-link" href="${escapeAttr(link)}" target="_blank" rel="noopener">🌐 Link</a>` : '';
	const iconSrc = String(iconUrl || '').trim();
	const bannerSrc = String(bannerUrl || '').trim();
	const iconHtml = `<img class="switch-icon ${iconSrc ? '' : 'hidden'}" data-field="icon" ${iconSrc ? `src="${escapeAttr(iconSrc)}"` : ''} alt="" loading="lazy" referrerpolicy="no-referrer">`;
	const bannerHtml = `<div class="switch-card-banner ${bannerSrc ? '' : 'hidden'}" data-field="cardBanner" ${bannerSrc ? `style="background-image:url('${escapeAttr(bannerSrc)}')"` : ''}></div>`;
	const displayName = getSwitchDisplayName({ name });
	const displayDescription = getSwitchDescription({ name, description });

	return `
		<div class="switch-card ${stateClass}" data-uid="${escapeAttr(uid)}" data-banner-url="${escapeAttr(bannerUrl || '')}">
			${bannerHtml}
			<div class="switch-card-body">
			<div class="switch-header">
				<div class="switch-title">
					${iconHtml}
					<div class="switch-title-text">
						<div class="switch-name-row">
							<a class="switch-name" data-field="name" href="${escapeAttr(buildSwitchPath(uid))}">${escapeHtml(displayName)}</a>
							<span class="promoted-badge ${isListingPromoted(switchData) ? '' : 'hidden'}" data-field="promotedBadge">Promoted</span>
							<span class="extras-badges" data-field="extrasBadges">${renderExtrasBadgesHtml(switchData)}</span>
						</div>
						<div class="switch-description ${displayDescription ? '' : 'hidden'}" data-field="description">${escapeHtml(displayDescription)}</div>
					</div>
				</div>
				<div class="switch-state ${stateText}" data-field="stateBadge">${stateLabel}</div>
			</div>

			<div class="switch-details">
				${location ? `
					<div class="switch-detail">
						<span class="switch-detail-label">📍 Location:</span>
						<span class="switch-detail-value">${escapeHtml(location)}</span>
					</div>
				` : ''}

				<div class="switch-detail">
					<span class="switch-detail-label">🏷️ Category:</span>
					<button class="chip-link" onclick="filterByCategory('${encodeURIComponent(category || 'Other')}')">${safeCategory}</button>
				</div>

				<div class="switch-detail">
					<span class="switch-detail-label">👥 Users:</span>
					<span class="switch-detail-value" data-field="users">${usersLabel}</span>
				</div>

				<div class="switch-detail">
					<span class="switch-detail-label">🔢 Toggles:</span>
					<span class="switch-detail-value" data-field="toggles">${togglesLabel}</span>
				</div>

				<div class="switch-detail">
					<span class="switch-detail-label">🕒 Last Changed:</span>
					<span class="switch-detail-value" data-field="lastChanged" data-ts="${lastToggled ? String(lastToggled) : ''}">${lastToggledText}</span>
				</div>

				<div class="switch-detail">
					<span class="switch-detail-label">🆔 UID:</span>
					<span class="switch-detail-value mono small">${uid.substring(0, 8)}...</span>
				</div>

				${webLink ? `
				<div class="switch-detail">
					<span class="switch-detail-label">🔗 Website:</span>
					<span class="switch-detail-value">${webLink}</span>
				</div>` : ''}
			</div>

			<div class="switch-actions">
				<button class="copy-uid-btn" onclick="copyUID('${uid}', this)">
					📋 Copy UID
				</button>
				<button class="view-details-btn" onclick="openSwitchDetails('${uid}')">
					👁️ Details
				</button>
			</div>
			</div>
		</div>
	`;
}

function copyUID(uid, button) {
	copyText(uid, button, '📋 Copy UID');
}

function copyText(value, button, defaultLabel) {
	navigator.clipboard.writeText(value).then(() => {
		const originalText = button.textContent;
		button.textContent = '✅ Copied!';
		button.classList.add('copied');

		setTimeout(() => {
			button.textContent = originalText || defaultLabel;
			button.classList.remove('copied');
		}, 2000);
	}).catch((err) => {
		console.error('Failed to copy text:', err);

		const textArea = document.createElement('textarea');
		textArea.value = value;
		document.body.appendChild(textArea);
		textArea.select();

		try {
			document.execCommand('copy');
			button.textContent = '✅ Copied!';
			button.classList.add('copied');

			setTimeout(() => {
				button.textContent = defaultLabel;
				button.classList.remove('copied');
			}, 2000);
		} catch (error) {
			alert('Failed to copy. Please copy manually.');
		}

		document.body.removeChild(textArea);
	});
}

async function openSwitchDetails(uid, fromPopState = false, options = {}) {
	try {
		const allowRedirect = options.allowRedirect !== false;
		const redirectFrom = options.redirectFrom || '';
		const redirectReason = options.redirectReason || '';

		if (document?.body) {
			document.body.classList.add('view-switch');
		}

		// Apply banner ASAP (from list data) to make expansion feel instant
		const preview = allSwitches.find(sw => sw.uid === uid);
		if (preview && preview.bannerUrl) {
			setHeroBanner(preview.bannerUrl);
		}

		currentSwitchId = uid;
		const response = await fetch(`${API_BASE_URL}/switch/${uid}`);
		if (!response.ok) {
			throw new Error(`HTTP ${response.status}: ${response.statusText}`);
		}
		const data = await response.json();
		if (!data.success) {
			throw new Error(data.error || 'Failed to load switch detail');
		}

		const detail = data.data || {};
		if (detail.redirect) {
			if (allowRedirect && detail.redirectTo) {
				await openSwitchDetails(detail.redirectTo, fromPopState, {
					allowRedirect: false,
					redirectFrom: uid,
					redirectReason: detail.redirectReason
				});
				return;
			}
			detailSection.classList.remove('hidden');
			showRedirectNotice(uid, detail.redirectTo, detail.redirectReason);
			if (!fromPopState) {
				pushSwitchQuery(uid);
			}
			return;
		}

		if (redirectFrom) {
			detail.redirectFrom = redirectFrom;
			detail.redirectReason = redirectReason;
		}

		detailSection.classList.remove('hidden');
		renderSwitchDetail(detail);
		ensureRealtimeSubscriptions();
		if (!fromPopState) {
			pushSwitchQuery(uid);
		}
	} catch (error) {
		console.error('Error loading switch detail:', error);
		if (options && options.redirectFrom) {
			detailSection.classList.remove('hidden');
			showRedirectNotice(options.redirectFrom, uid, options.redirectReason);
			return;
		}
		alert('Unable to load switch details. Please try again.');
		closeDetail();
	}
}

function renderSwitchDetail(detail) {
	currentSwitchDetail = detail;
	updateAdminPanelVisibility();
	if (detail && detail.redirectFrom) {
		showRedirectNotice(detail.redirectFrom, detail.uid, detail.redirectReason);
	} else {
		hideRedirectNotice();
	}
	detailTitle.textContent = getSwitchDisplayName(detail);
	setDetailPromotedBadge(detail);
	if (detailDescription) {
		const description = getSwitchDescription(detail);
		detailDescription.textContent = description;
		detailDescription.classList.toggle('hidden', !description);
	}
	if (detailIcon) {
		const icon = String(detail.iconUrl || '').trim();
		if (icon) {
			detailIcon.src = icon;
			detailIcon.classList.remove('hidden');
		} else {
			detailIcon.removeAttribute('src');
			detailIcon.classList.add('hidden');
		}
	}
	setHeroBanner(detail.bannerUrl);
	setHeroForSwitch(detail);
	detailLocation.textContent = detail.location ? `📍 ${detail.location}` : '📍 Not specified';
	detailCategory.textContent = detail.category || 'Other';
	detailUsers.textContent = `${detail.userCount || 0} user${(detail.userCount || 0) === 1 ? '' : 's'}`;
	detailToggles.textContent = `${detail.toggleCount || 0} toggles`;
	detailLastChange.textContent = detail.lastToggled ? formatTimeAgo(new Date(detail.lastToggled)) : 'Never';
	detailUid.textContent = detail.uid;

	updateAuthPanel(detail);
	updateAuthGates(detail);
	updateManagePanel(detail);

	if (detail.link) {
		switchWebLink.href = detail.link;
		switchWebLink.classList.remove('hidden');
	} else {
		switchWebLink.href = '#';
		switchWebLink.classList.add('hidden');
	}

	if (detail.ownerProfileUrl) {
		ownerWebLink.href = detail.ownerProfileUrl;
		ownerWebLink.classList.remove('hidden');
	} else {
		ownerWebLink.href = '#';
		ownerWebLink.classList.add('hidden');
	}

	renderEvents(detail.events || []);
	renderSwitchExtras(detail);
	if (toggleDialog && !toggleDialog.classList.contains('hidden')) {
		renderToggleDialogActivity(detail);
	}
}

function revokeObjectUrl(value) {
	if (!value) return;
	try {
		if (typeof URL !== 'undefined' && typeof URL.revokeObjectURL === 'function') {
			URL.revokeObjectURL(value);
		}
	} catch {
		// ignore
	}
}

function setMediaPreviewImage(imgEl, placeholderEl, url) {
	if (!imgEl) return;
	const value = String(url || '').trim();
	if (value) {
		imgEl.src = value;
		imgEl.classList.remove('hidden');
		if (placeholderEl) placeholderEl.classList.add('hidden');
		return;
	}
	imgEl.removeAttribute('src');
	imgEl.classList.add('hidden');
	if (placeholderEl) placeholderEl.classList.remove('hidden');
}

function setManageIconEditVisible(visible) {
	if (!manageIconEdit) return;
	if (visible) manageIconEdit.classList.remove('hidden');
	else manageIconEdit.classList.add('hidden');
}

function setManageBannerEditVisible(visible) {
	if (!manageBannerEdit) return;
	if (visible) manageBannerEdit.classList.remove('hidden');
	else manageBannerEdit.classList.add('hidden');
}

function resetManageMediaPickers(detail) {
	manageIconAction = 'keep';
	manageBannerAction = 'keep';

	manageCurrentIconUrl = detail && detail.iconUrl ? String(detail.iconUrl) : '';
	manageCurrentBannerUrl = detail && detail.bannerUrl ? String(detail.bannerUrl) : '';

	revokeObjectUrl(manageIconObjectUrl);
	revokeObjectUrl(manageBannerObjectUrl);
	manageIconObjectUrl = null;
	manageBannerObjectUrl = null;

	if (manageIconUrlInput) manageIconUrlInput.value = '';
	if (manageBannerUrlInput) manageBannerUrlInput.value = '';
	if (manageIconFileInput) manageIconFileInput.value = '';
	if (manageBannerFileInput) manageBannerFileInput.value = '';

	setManageIconEditVisible(false);
	setManageBannerEditVisible(false);

	setMediaPreviewImage(manageIconPreview, manageIconPlaceholder, manageCurrentIconUrl);
	setMediaPreviewImage(manageBannerPreview, manageBannerPlaceholder, manageCurrentBannerUrl);
}

function updateAuthPanel(detail) {
	if (!authPanel || !detail) return;
	const uid = detail.uid;
	const hasManagement = Boolean(getActiveManagementKey(uid));
	const hasApi = Boolean(getActiveApiKey(uid));
	const authed = hasManagement || hasApi;

	if (authLoggedOut) authLoggedOut.classList.toggle('hidden', authed);
	if (authLoggedIn) authLoggedIn.classList.toggle('hidden', !authed);

	if (authStatusText) {
		if (!authed) {
			authStatusText.textContent = '';
		} else if (hasManagement && hasApi) {
			authStatusText.textContent = 'Authenticated with management + API keys (session only).';
		} else if (hasManagement) {
			authStatusText.textContent = 'Authenticated with management key (session only).';
		} else {
			authStatusText.textContent = 'Authenticated with API key (session only).';
		}
	}

	if (authStatus) {
		authStatus.textContent = '';
		authStatus.className = 'comment-status hidden';
	}

	updateNavSwitchStatus(detail);
}

function setAuthStatus(message, isError = false) {
	if (!authStatus) return;
	if (!message || !isError) {
		authStatus.textContent = '';
		authStatus.className = 'comment-status hidden';
		return;
	}
	authStatus.textContent = message;
	authStatus.className = 'comment-status error';
}

function updateAuthGates(detail) {
	if (!detail) return;
	const hasAny = hasAccessKey(detail.uid);
	const hasManagement = Boolean(getActiveManagementKey(detail.uid));
	if (commentSection) commentSection.classList.toggle('hidden', !hasAny);
	if (commentForm) commentForm.classList.toggle('hidden', !hasAny);
	if (managePanel) managePanel.classList.toggle('hidden', !hasManagement);
}

function updateManagePanel(detail) {
	if (!managePanel) return;
	if (!detail || !detail.uid) return;
	const hasManagement = Boolean(getActiveManagementKey(detail.uid));
	managePanel.classList.toggle('hidden', !hasManagement);
	updatePromotePanel(detail);
	updatePremiumPanel(detail);
	if (!hasManagement) {
		resetManageExtras();
		return;
	}

	if (manageLinkInput) manageLinkInput.value = detail.link || '';
	resetManageMediaPickers(detail);
	updateManageExtras(detail);

	// If a management key was supplied via #accessKey=..., scroll to this panel once
	const wantScroll = Boolean(
		managementAutoscrollUid
		&& String(managementAutoscrollUid).toLowerCase() === String(detail.uid || '').toLowerCase()
	);
	if (wantScroll) {
		managementAutoscrollUid = null;
		if (manageStatus) {
			manageStatus.textContent = 'Management key loaded — edit fields below and click “Save appearance”.';
			manageStatus.className = 'comment-status success';
		}
		// Give the browser a chance to lay out the newly-shown detail section before scrolling.
		const doScroll = () => {
			try {
				managePanel.scrollIntoView({ behavior: 'smooth', block: 'start' });
			} catch {
				// ignore
			}
		};
		if (typeof window.requestAnimationFrame === 'function') {
			window.requestAnimationFrame(() => window.requestAnimationFrame(doScroll));
		} else {
			setTimeout(doScroll, 50);
		}
	}

	updateHeroStatusButton(detail);
}

async function submitManageAppearance() {
	if (!currentSwitchId) return;
	if (!manageStatus) return;

	const apiKey = getActiveManagementKey(currentSwitchId) || getStoredManagementKey(currentSwitchId);
	if (!apiKey) {
		manageStatus.textContent = 'Access key required.';
		manageStatus.className = 'comment-status error';
		return;
	}

	const updates = {};
	const detail = currentSwitchDetail || {};

	const link = String(manageLinkInput?.value || '').trim();
	if (link !== String(detail.link || '')) {
		updates.link = link;
	}

	const iconFile = manageIconFileInput?.files?.[0] || null;
	const iconUrl = String(manageIconUrlInput?.value || '').trim();
	let iconMode = manageIconAction;
	if (iconMode === 'keep' && (iconFile || iconUrl)) {
		iconMode = 'replace';
	}
	if (iconMode === 'remove') {
		updates.iconUrl = '';
	} else if (iconMode === 'replace') {
		if (!iconFile && !iconUrl) {
			manageStatus.textContent = 'Icon: please choose a file or enter a URL (or click Cancel).';
			manageStatus.className = 'comment-status error';
			return;
		}
		if (!iconFile) {
			updates.iconUrl = iconUrl;
		}
	}

	const bannerFile = manageBannerFileInput?.files?.[0] || null;
	const bannerUrl = String(manageBannerUrlInput?.value || '').trim();
	let bannerMode = manageBannerAction;
	if (bannerMode === 'keep' && (bannerFile || bannerUrl)) {
		bannerMode = 'replace';
	}
	if (bannerMode === 'remove') {
		updates.bannerUrl = '';
	} else if (bannerMode === 'replace') {
		if (!bannerFile && !bannerUrl) {
			manageStatus.textContent = 'Banner: please choose a file or enter a URL (or click Cancel).';
			manageStatus.className = 'comment-status error';
			return;
		}
		if (!bannerFile) {
			updates.bannerUrl = bannerUrl;
		}
	}

	const hasFileUpload = Boolean(iconFile || bannerFile);
	if (Object.keys(updates).length === 0 && !hasFileUpload) {
		manageStatus.textContent = 'No changes to save.';
		manageStatus.className = 'comment-status';
		return;
	}

	manageStatus.textContent = 'Saving...';
	manageStatus.className = 'comment-status';

	try {
		const form = new FormData();
		Object.entries(updates).forEach(([k, v]) => {
			form.append(k, v == null ? '' : String(v));
		});
		if (iconFile) {
			form.append('iconFile', iconFile, iconFile.name || 'icon');
		}
		if (bannerFile) {
			form.append('bannerFile', bannerFile, bannerFile.name || 'banner');
		}

		const response = await fetch(`${API_BASE_URL}/v2/switch/${currentSwitchId}/metadata`, {
			method: 'POST',
			headers: {
				'X-Api-Key': apiKey
			},
			body: form
		});

		const data = await response.json();
		if (!response.ok || !data.success) {
			throw new Error((data && data.error) ? data.error : `HTTP ${response.status}`);
		}

		setStoredManagementKey(currentSwitchId, apiKey);

		if (data.data) {
			renderSwitchDetail(data.data);
		}

		resetManageMediaPickers(currentSwitchDetail || {});
		updateAuthPanel(currentSwitchDetail || detail);
		updateAuthGates(currentSwitchDetail || detail);

		manageStatus.textContent = 'Saved.';
		manageStatus.className = 'comment-status success';
	} catch (error) {
		console.error('Error saving appearance:', error);
		manageStatus.textContent = `Failed: ${error.message || 'Unknown error'}`;
		manageStatus.className = 'comment-status error';
	}
}

function renderEvents(events) {
	if (!events.length) {
		detailEvents.innerHTML = '<li class="timeline-empty">No history yet.</li>';
		return;
	}

	detailEvents.innerHTML = events.map((event) => {
		const timeText = event.timestamp ? formatDateTimeYmd(new Date(event.timestamp)) : 'Unknown time';
		if (event.type === 'comment') {
			return `
				<li class="timeline-item">
					<div class="timeline-dot comment"></div>
					<div class="timeline-content">
						<div class="timeline-head">
							<span class="timeline-type type-comment">Comment</span>
							<span class="timeline-actor">${escapeHtml(event.actor || 'user')}</span>
							<span class="timeline-time">${timeText}</span>
						</div>
						<p>${escapeHtml(event.comment || '')}</p>
					</div>
				</li>
			`;
		}

		if (event.type === 'tip') {
			const tipAmount = Number(event.amount) > 0 ? formatMoney(event.amount, event.currency) : '';
			return `
				<li class="timeline-item">
					<div class="timeline-dot comment"></div>
					<div class="timeline-content">
						<div class="timeline-head">
							<span class="timeline-type type-tip">Tip</span>
							<span class="timeline-actor">${escapeHtml(tipAmount)}</span>
							<span class="timeline-time">${timeText}</span>
						</div>
						${event.note ? `<p>${escapeHtml(event.note)}</p>` : ''}
					</div>
				</li>
			`;
		}

		const stateLabel = event.state ? 'ON' : 'OFF';
		const actor = event.actor || 'user';
		const via = event.viaApiKey ? 'API' : 'key';
		const typeCls = event.state ? 'type-state-on' : 'type-state-off';
		const sourceKey = String(event.source || '');
		const sourceHtml = EXTRAS_SOURCE_LABELS[sourceKey]
			? `<span class="source-badge source-${sourceKey}" title="${escapeAttr(EXTRAS_SOURCE_TITLES[sourceKey])}">${EXTRAS_SOURCE_LABELS[sourceKey]}</span>`
			: '';
		const paidHtml = Number(event.amount) > 0
			? `<span class="last-note-paid">${escapeHtml(formatMoney(event.amount, event.currency))}</span>`
			: '';
		const actorHtml = sourceKey && sourceKey !== 'owner' && sourceKey !== 'key'
			? ''
			: `<span class="timeline-actor">${escapeHtml(actor)} (${via})</span>`;

		return `
			<li class="timeline-item">
				<div class="timeline-dot state ${event.state ? 'on' : 'off'}"></div>
				<div class="timeline-content">
					<div class="timeline-head">
						<span class="timeline-type ${typeCls}">${stateLabel}</span>
						${sourceHtml}${paidHtml}
						${actorHtml}
						<span class="timeline-time">${timeText}</span>
					</div>
					${event.note ? `<p>${escapeHtml(event.note)}</p>` : ''}
				</div>
			</li>
		`;
	}).join('');
}

function renderToggleDialogActivity(detail) {
	if (!toggleDialogEvents) return;
	const events = (detail && Array.isArray(detail.events)) ? detail.events : [];
	if (!events.length) {
		toggleDialogEvents.innerHTML = '<li class="timeline-empty">No recent activity.</li>';
		return;
	}
	const latest = events.slice(0, 4);
	toggleDialogEvents.innerHTML = latest.map((event) => {
		const timeText = event.timestamp ? formatTimeAgo(new Date(event.timestamp)) : 'Unknown time';
		if (event.type === 'comment') {
			return `
				<li class="timeline-item">
					<div class="timeline-dot comment"></div>
					<div class="timeline-content">
						<div class="timeline-head">
							<span class="timeline-type type-comment">Comment</span>
							<span class="timeline-actor">${escapeHtml(event.actor || 'user')}</span>
							<span class="timeline-time">${timeText}</span>
						</div>
						<p>${escapeHtml(event.comment || '')}</p>
					</div>
				</li>
			`;
		}
		if (event.type === 'tip') {
			return `
				<li class="timeline-item">
					<div class="timeline-dot comment"></div>
					<div class="timeline-content">
						<div class="timeline-head">
							<span class="timeline-type type-tip">Tip</span>
							<span class="timeline-actor">${escapeHtml(Number(event.amount) > 0 ? formatMoney(event.amount, event.currency) : '')}</span>
							<span class="timeline-time">${timeText}</span>
						</div>
					</div>
				</li>
			`;
		}

		const stateLabel = event.state ? 'ON' : 'OFF';
		const actor = event.actor || 'user';
		const via = event.viaApiKey ? 'API' : 'key';
		const typeCls = event.state ? 'type-state-on' : 'type-state-off';
		return `
			<li class="timeline-item">
				<div class="timeline-dot state ${event.state ? 'on' : 'off'}"></div>
				<div class="timeline-content">
					<div class="timeline-head">
						<span class="timeline-type ${typeCls}">${stateLabel}</span>
						<span class="timeline-actor">${escapeHtml(actor)} (${via})</span>
						<span class="timeline-time">${timeText}</span>
					</div>
				</div>
			</li>
		`;
	}).join('');
}

async function submitComment() {
	if (!currentSwitchId) {
		return;
	}
	if (!hasAccessKey(currentSwitchId)) {
		openAuthDialog(false);
		return;
	}
	const comment = (commentTextInput.value || '').trim();
	if (!comment) {
		commentStatus.textContent = 'Comment is required.';
		return;
	}

	const commentKey = resolveCommentAccessKey(currentSwitchId);
	if (!commentKey) {
		commentStatus.textContent = 'Access key is required.';
		return;
	}

	const requestedState = commentStateSelect ? String(commentStateSelect.value || '').trim() : '';
	const wantsStateChange = requestedState === 'on' || requestedState === 'off';
	if (wantsStateChange) {
		const commentKeyValue = getActiveApiKey(currentSwitchId);
		const managementKey = getActiveManagementKey(currentSwitchId);
		const toggleKey = managementKey || commentKeyValue;
		if (!toggleKey) {
			commentStatus.textContent = 'Access key required to toggle.';
			return;
		}
		commentStatus.textContent = 'Applying state change...';
		commentStatus.className = 'comment-status';

		const detail = await ensureCurrentSwitchDetail(currentSwitchId);
		const currentState = (detail && typeof detail.state === 'boolean') ? detail.state : null;
		if (currentState == null) {
			commentStatus.textContent = 'Current state unavailable.';
			commentStatus.className = 'comment-status error';
			return;
		}
		const targetState = requestedState === 'on';
		if (currentState !== targetState) {
			try {
				await toggleSwitchWithAccessKey(currentSwitchId, toggleKey);
			} catch (error) {
				if (managementKey && commentKeyValue && managementKey !== commentKeyValue) {
					try {
						await toggleSwitchWithAccessKey(currentSwitchId, commentKeyValue);
					} catch (fallbackError) {
						console.error('Failed to toggle during comment:', fallbackError);
						let message = fallbackError.message || 'Failed to toggle.';
						if (/insufficient permissions/i.test(message)) {
							message = 'Key missing toggle permission. Use a key with toggle access.';
						}
						commentStatus.textContent = message;
						commentStatus.className = 'comment-status error';
						return;
					}
				} else {
					console.error('Failed to toggle during comment:', error);
					let message = error.message || 'Failed to toggle.';
					if (/insufficient permissions/i.test(message)) {
						message = 'Key missing toggle permission. Use a key with toggle access.';
					}
					commentStatus.textContent = message;
					commentStatus.className = 'comment-status error';
					return;
				}
			}
		}
	}

	commentStatus.textContent = 'Posting...';
	commentStatus.className = 'comment-status';
	try {
		const response = await fetch(`${API_BASE_URL}/v2/switch/${currentSwitchId}/comment`, {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
				'X-Api-Key': commentKey
			},
			body: JSON.stringify({ comment })
		});

		const data = await response.json();
		if (!response.ok || !data.success) {
			throw new Error(data.error || 'Failed to post comment');
		}

		commentStatus.textContent = 'Posted.';
		commentStatus.className = 'comment-status success';
		commentTextInput.value = '';
		if (commentStateSelect) commentStateSelect.value = '';
		await openSwitchDetails(currentSwitchId, true);
	} catch (error) {
		console.error('Failed to post comment:', error);
		let message = 'Failed to post comment.';
		if (error && error.message) {
			message = error.message;
		}
		if (/insufficient permissions/i.test(message)) {
			message = 'Key missing comment permission. Use a key with comment access.';
		}
		commentStatus.textContent = message;
		commentStatus.className = 'comment-status error';
	}
}

function closeDetail() {
	detailSection.classList.add('hidden');
	currentSwitchId = null;
	currentSwitchDetail = null;
	resetManageExtras();
	extrasCommerceRenderKey = '';
	hideRedirectNotice();
	clearHeroBanner();
	restoreHeroText();
	if (document?.body) {
		document.body.classList.remove('view-switch');
	}
	updateNavSwitchStatus(null);
	clearSwitchQuery();
	ensureRealtimeSubscriptions();
	updateCommentStateVisibility();
	closeToggleDialog();
	closeAuthDialog();
}

function filterByCategory(encodedCategory) {
	const category = decodeURIComponent(encodedCategory);
	selectedCategory = category;
	applyFilters();
	renderCategories();
}

function restoreSwitchFromQuery() {
	const pathSwitchId = extractSwitchUidFromPathname(window.location.pathname);
	const params = new URLSearchParams(window.location.search);
	const querySwitchId = params.get('switch');
	const switchId = pathSwitchId || (querySwitchId && isValidSwitchUid(querySwitchId) ? querySwitchId : null);
	if (switchId) {
		Promise.resolve(openSwitchDetails(switchId, true)).finally(() => {
			consumePromotedQuery();
			consumePremiumQuery();
			consumeBillingQuery();
			consumePaidQuery();
			consumeConnectQuery();
		});
	} else {
		closeDetail();
		consumePromotedQuery();
		consumePremiumQuery();
		consumeBillingQuery();
		consumePaidQuery();
		consumeConnectQuery();
	}
}

function buildSwitchPath(uid) {
	const params = new URLSearchParams(window.location.search);
	params.delete('switch');
	const suffix = params.toString();
	return `/switch/${encodeURIComponent(uid)}${suffix ? `?${suffix}` : ''}`;
}

function buildHomePath() {
	const params = new URLSearchParams(window.location.search);
	params.delete('switch');
	const suffix = params.toString();
	return `/${suffix ? `?${suffix}` : ''}`;
}

function pushSwitchQuery(uid) {
	const newUrl = buildSwitchPath(uid);
	window.history.pushState({}, '', newUrl);
}

function clearSwitchQuery() {
	const currentPathSwitchId = extractSwitchUidFromPathname(window.location.pathname);
	const params = new URLSearchParams(window.location.search);
	const hasQuerySwitch = params.has('switch');
	if (!currentPathSwitchId && !hasQuerySwitch) {
		return;
	}
	const newUrl = buildHomePath();
	window.history.pushState({}, '', newUrl);
}

function scrollToSwitches() {
	const section = document.querySelector('.switches');
	if (section) {
		section.scrollIntoView({ behavior: 'smooth' });
	}
}

function formatTimeAgo(date) {
	const now = new Date();
	const diffMs = now - date;
	const diffMins = Math.floor(diffMs / 60000);
	const diffHours = Math.floor(diffMins / 60);
	const diffDays = Math.floor(diffHours / 24);

	if (diffMins < 1) return 'Just now';
	if (diffMins < 60) return `${diffMins}m ago`;
	if (diffHours < 24) return `${diffHours}h ago`;
	if (diffDays < 7) return `${diffDays}d ago`;

	return formatDateYmd(date);
}

function formatDateYmd(date) {
	const year = date.getFullYear();
	const month = String(date.getMonth() + 1).padStart(2, '0');
	const day = String(date.getDate()).padStart(2, '0');
	return `${year}-${month}-${day}`;
}

function formatDateTimeYmd(date) {
	const hours = String(date.getHours()).padStart(2, '0');
	const minutes = String(date.getMinutes()).padStart(2, '0');
	return `${formatDateYmd(date)} ${hours}:${minutes}`;
}

function getSwitchDisplayName(detail) {
	const name = getDisplaySwitchName(detail && detail.name);
	return name || 'Untitled switch';
}

function getSwitchDescription(detail) {
	const raw = String(detail && detail.description ? detail.description : '').trim();
	if (!raw) return '';
	return raw.replace(/\s+/g, ' ').trim();
}

function getDisplaySwitchName(rawName) {
	const text = String(rawName || '').trim();
	if (!text) return '';
	let cleaned = text.replace(/^VomeSync(?:\s+Switch)?\s*[-:–—]\s*/i, '').trim();
	if (cleaned && cleaned !== text) {
		return cleaned;
	}
	if (/^VomeSync\s+/i.test(text)) {
		cleaned = text.replace(/^VomeSync\s+/i, '').trim();
		if (cleaned) return cleaned;
	}
	return text;
}

function isListingPromoted(switchData) {
	if (!switchData) return false;
	if (switchData.promoted === true) return true;
	const until = Number(switchData.promotedUntil) || 0;
	return until > Date.now();
}

function setDetailPromotedBadge(detail) {
	if (!detailPromoted) return;
	detailPromoted.classList.toggle('hidden', !isListingPromoted(detail));
}

function setPromoteStatus(message, isError = false) {
	if (!promoteStatus) return;
	if (!message) {
		promoteStatus.textContent = '';
		promoteStatus.className = 'comment-status';
		return;
	}
	promoteStatus.textContent = message;
	promoteStatus.className = isError ? 'comment-status error' : 'comment-status success';
}

function updatePromotePanel(detail) {
	if (!promotePanel) return;
	const hasManagement = Boolean(detail && detail.uid && getActiveManagementKey(detail.uid));
	const show = Boolean(billing.promoteEnabled && hasManagement);
	promotePanel.classList.toggle('hidden', !show);
	if (!show) {
		return;
	}
	const days = Number(billing.promoteDurationDays) || 7;
	if (promoteCopy) {
		promoteCopy.textContent = `Paid placement pins this card to the top of the directory for ${days} day${days === 1 ? '' : 's'} with a Promoted badge. You pay Vome; everyone can still watch the switch for free.${billing.taxEnabled !== false ? ' The listed price includes VAT.' : ''}`;
	}
	if (promoteBtn) {
		promoteBtn.disabled = false;
		promoteBtn.textContent = isListingPromoted(detail) ? 'Extend promotion' : 'Promote this listing';
	}
}

function consumePromotedQuery() {
	const params = new URLSearchParams(window.location.search);
	const result = params.get('promoted');
	if (!result) return;
	params.delete('promoted');
	const suffix = params.toString();
	const next = `${window.location.pathname}${suffix ? `?${suffix}` : ''}${window.location.hash || ''}`;
	try {
		window.history.replaceState({}, '', next);
	} catch {
		// ignore
	}
	if (result === 'success') {
		setPromoteStatus('Payment received. The listing moves to the top once Stripe confirms — usually within a minute.', false);
	} else if (result === 'cancel') {
		setPromoteStatus('Checkout cancelled. Nothing was charged.', true);
	}
}

function formatPremiumPrice() {
	const amount = Number(billing.premiumAmount) || 900;
	const currency = String(billing.premiumCurrency || 'eur').toUpperCase();
	const value = (amount / 100).toFixed(amount % 100 === 0 ? 0 : 2);
	if (currency === 'EUR') {
		return `€${value}`;
	}
	return `${value} ${currency}`;
}

function setPremiumStatus(message, isError = false) {
	if (!premiumStatus) return;
	if (!message) {
		premiumStatus.textContent = '';
		premiumStatus.className = 'comment-status';
		return;
	}
	premiumStatus.textContent = message;
	premiumStatus.className = isError ? 'comment-status error' : 'comment-status success';
}

function updatePremiumPanel(detail) {
	if (!premiumPanel) return;
	const hasManagement = Boolean(detail && detail.uid && getActiveManagementKey(detail.uid));
	const show = Boolean(billing.premiumEnabled && hasManagement);
	premiumPanel.classList.toggle('hidden', !show);
	if (!show) {
		return;
	}
	const maxPublic = Number(billing.maxPublic) || 10;
	const maxPrivate = Number(billing.maxPrivate) || 5;
	const premiumMaxPublic = Number(billing.premiumMaxPublic) || 25;
	const premiumMaxSwitches = Number(billing.premiumMaxSwitches) || 50;
	if (premiumCopy) {
		premiumCopy.textContent = `Free accounts can create ${maxPublic} public and ${maxPrivate} private switches. Premium is ${formatPremiumPrice()} a month${billing.taxEnabled !== false ? ' including VAT' : ''} and lifts the cap to ${premiumMaxSwitches} switches (${premiumMaxPublic} public). Catalogue watches stay free.`;
	}
	if (premiumBtn) {
		premiumBtn.disabled = false;
		premiumBtn.textContent = 'Upgrade to premium';
	}
}

function consumePremiumQuery() {
	const params = new URLSearchParams(window.location.search);
	const result = params.get('premium');
	if (!result) return;
	params.delete('premium');
	const suffix = params.toString();
	const next = `${window.location.pathname}${suffix ? `?${suffix}` : ''}${window.location.hash || ''}`;
	try {
		window.history.replaceState({}, '', next);
	} catch {
		// ignore
	}
	if (result === 'success') {
		setPremiumStatus('Payment received. Premium is applied once Stripe confirms — usually within a minute.', false);
	} else if (result === 'cancel') {
		setPremiumStatus('Checkout cancelled. Nothing was charged.', true);
	}
}

async function startPremiumCheckout() {
	if (!currentSwitchId) return;
	const apiKey = getActiveManagementKey(currentSwitchId) || getStoredManagementKey(currentSwitchId);
	if (!apiKey) {
		setPremiumStatus('Access key required.', true);
		return;
	}
	if (premiumBtn) premiumBtn.disabled = true;
	setPremiumStatus('Opening Stripe Checkout…', false);
	try {
		const response = await fetch(`${API_BASE_URL}/v2/switch/${encodeURIComponent(currentSwitchId)}/premium`, {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
				'X-Api-Key': apiKey
			}
		});
		const data = await response.json();
		if (response.status === 409) {
			setPremiumStatus((data && data.error) || 'Already on premium.', false);
			if (premiumBtn) premiumBtn.disabled = false;
			return;
		}
		if (!response.ok || !data.success || !data.data || !data.data.url) {
			setPremiumStatus((data && data.error) || 'Could not start checkout.', true);
			if (premiumBtn) premiumBtn.disabled = false;
			return;
		}
		window.location.assign(data.data.url);
	} catch (error) {
		console.error('Premium checkout failed:', error);
		setPremiumStatus('Could not start checkout.', true);
		if (premiumBtn) premiumBtn.disabled = false;
	}
}

function consumeBillingQuery() {
	const params = new URLSearchParams(window.location.search);
	const result = params.get('billing');
	if (!result) return;
	params.delete('billing');
	const suffix = params.toString();
	const next = `${window.location.pathname}${suffix ? `?${suffix}` : ''}${window.location.hash || ''}`;
	try {
		window.history.replaceState({}, '', next);
	} catch {
		// ignore
	}
	if (result === 'return') {
		setPremiumStatus('Back from Stripe billing. Changes can take a minute to apply.', false);
	}
}

async function startBillingPortal() {
	if (!currentSwitchId) return;
	const apiKey = getActiveManagementKey(currentSwitchId) || getStoredManagementKey(currentSwitchId);
	if (!apiKey) {
		setPremiumStatus('Access key required.', true);
		return;
	}
	if (billingPortalBtn) billingPortalBtn.disabled = true;
	setPremiumStatus('Opening Stripe billing…', false);
	try {
		const response = await fetch(`${API_BASE_URL}/v2/switch/${encodeURIComponent(currentSwitchId)}/billing-portal`, {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
				'X-Api-Key': apiKey
			}
		});
		const data = await response.json();
		if (!response.ok || !data.success || !data.data || !data.data.url) {
			setPremiumStatus((data && data.error) || 'Could not open billing.', true);
			if (billingPortalBtn) billingPortalBtn.disabled = false;
			return;
		}
		window.location.assign(data.data.url);
	} catch (error) {
		console.error('Billing portal failed:', error);
		setPremiumStatus('Could not open billing.', true);
		if (billingPortalBtn) billingPortalBtn.disabled = false;
	}
}

async function startPromoteCheckout() {
	if (!currentSwitchId) return;
	const apiKey = getActiveManagementKey(currentSwitchId) || getStoredManagementKey(currentSwitchId);
	if (!apiKey) {
		setPromoteStatus('Access key required.', true);
		return;
	}
	if (promoteBtn) promoteBtn.disabled = true;
	setPromoteStatus('Opening Stripe Checkout…', false);
	try {
		const response = await fetch(`${API_BASE_URL}/v2/switch/${encodeURIComponent(currentSwitchId)}/promote`, {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
				'X-Api-Key': apiKey
			}
		});
		const data = await response.json();
		if (!response.ok || !data.success || !data.data || !data.data.url) {
			setPromoteStatus((data && data.error) || 'Could not start checkout.', true);
			if (promoteBtn) promoteBtn.disabled = false;
			return;
		}
		window.location.assign(data.data.url);
	} catch (error) {
		console.error('Promote checkout failed:', error);
		setPromoteStatus('Could not start checkout.', true);
		if (promoteBtn) promoteBtn.disabled = false;
	}
}

function escapeHtml(text) {
	const div = document.createElement('div');
	div.textContent = text;
	return div.innerHTML;
}

function escapeAttr(text) {
	// textContent→innerHTML escapes &, < and > but not quotes, which matter in attributes.
	return String(text ?? '')
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;')
		.replace(/'/g, '&#39;');
}

// ── Switch extras: properties, notes, paying to switch, rewards ───────────────
// Contract: docs/SWITCH_EXTRAS.md. Everything shown here is owner- or
// visitor-supplied, so it is built with textContent / createElement only.

const EXTRAS_MAX_PROPERTIES = 12;
const EXTRAS_PROPERTY_KEY = /^[a-z][a-z0-9_]{0,31}$/;
const EXTRAS_MAX_PROPERTY_VALUE = 200;
const EXTRAS_MAX_VISITOR_MESSAGE = 140;
const EXTRAS_CURRENCIES = {
	eur: { min: 100, max: 50000 },
	gbp: { min: 100, max: 50000 },
	usd: { min: 100, max: 50000 },
	sek: { min: 1000, max: 500000 }
};
const EXTRAS_SOURCE_LABELS = {
	owner: 'Owner',
	key: 'Key holder',
	public: 'Visitor',
	paid: 'Paid',
	auto: 'Auto'
};
const EXTRAS_SOURCE_TITLES = {
	owner: 'Changed by the owner',
	key: 'Changed by someone with an access key',
	public: 'Changed by a visitor on this page',
	paid: 'Changed by a visitor who paid',
	auto: 'Put back automatically when the hold time ran out'
};

let extrasCommerceRenderKey = '';
let publicToggleCooldownUntil = 0;
let publicToggleCooldownTimer = null;
let manageExtrasUid = '';
let manageCommerceWebhookUrl;
let rewardClaimsCache = [];

function extrasEl(tag, attrs, ...children) {
	const node = document.createElement(tag);
	if (attrs) {
		Object.entries(attrs).forEach(([key, value]) => {
			if (value === undefined || value === null || value === false) return;
			if (key === 'className') node.className = value;
			else if (key === 'text') node.textContent = String(value);
			else if (key === 'dataset') Object.assign(node.dataset, value);
			else if (key.startsWith('on') && typeof value === 'function') node.addEventListener(key.slice(2).toLowerCase(), value);
			else node.setAttribute(key, value === true ? '' : String(value));
		});
	}
	children.flat().forEach((child) => {
		if (child === null || child === undefined || child === false || child === '') return;
		node.appendChild(typeof child === 'string' ? document.createTextNode(child) : child);
	});
	return node;
}

function getMoneyLocale() {
	try {
		return (navigator.languages && navigator.languages[0]) || navigator.language || 'en-GB';
	} catch {
		return 'en-GB';
	}
}

/** Money from minor units, e.g. formatMoney(200, 'sek') → "2,00 kr" in Swedish. */
function formatMoney(amountMinor, currency) {
	const code = String(currency || 'eur').toUpperCase();
	const value = (Number(amountMinor) || 0) / 100;
	try {
		return new Intl.NumberFormat(getMoneyLocale(), { style: 'currency', currency: code }).format(value);
	} catch {
		return `${value.toFixed(2)} ${code}`;
	}
}

/** "1.50" / "1,50" → 150. Returns NaN for anything that is not a plain amount. */
function parseMoneyInput(text) {
	const raw = String(text || '').trim().replace(/\s/g, '').replace(',', '.');
	if (!/^\d+(\.\d{1,2})?$/.test(raw)) return NaN;
	return Math.round(Number(raw) * 100);
}

function minorToInput(amountMinor) {
	const n = Number(amountMinor);
	if (!Number.isFinite(n)) return '';
	return (n / 100).toFixed(2);
}

function formatDurationSeconds(seconds) {
	const s = Math.max(0, Math.round(Number(seconds) || 0));
	if (s < 120) return `${s} s`;
	if (s < 7200) {
		const m = Math.floor(s / 60);
		const rest = s % 60;
		return rest ? `${m} min ${rest} s` : `${m} min`;
	}
	const hours = Math.floor(s / 3600);
	const mins = Math.round((s % 3600) / 60);
	return mins ? `${hours} h ${mins} min` : `${hours} h`;
}

/** Only http(s) links are ever put in an href. */
function safeExternalUrl(value) {
	const raw = String(value || '').trim();
	if (!raw) return '';
	try {
		const parsed = new URL(raw);
		if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return '';
		return parsed.href;
	} catch {
		return '';
	}
}

function humanisePropertyKey(key) {
	const text = String(key || '').replace(/_/g, ' ').trim();
	return text ? text.charAt(0).toUpperCase() + text.slice(1) : '';
}

function formatPropertyValue(value) {
	if (value === true) return 'yes';
	if (value === false) return 'no';
	if (value === null || value === undefined) return '';
	return String(value);
}

function sourceBadge(source) {
	const key = String(source || '');
	if (!EXTRAS_SOURCE_LABELS[key]) return null;
	return extrasEl('span', {
		className: `source-badge source-${key}`,
		title: EXTRAS_SOURCE_TITLES[key],
		text: EXTRAS_SOURCE_LABELS[key]
	});
}

function getCommerce(detail) {
	const c = detail && detail.commerce;
	return c && typeof c === 'object' && !Array.isArray(c) ? c : null;
}

function getReward(detail) {
	const r = detail && detail.reward;
	return r && typeof r === 'object' && !Array.isArray(r) && Number(r.amount) > 0 ? r : null;
}

function commerceCanTakePayments(commerce) {
	return Boolean(commerce && commerce.canTakePayments !== false);
}

function getTipCurrency(commerce) {
	const currency = String((commerce && commerce.price && commerce.price.currency) || 'eur').toLowerCase();
	return EXTRAS_CURRENCIES[currency] ? currency : 'eur';
}

/** Small badges for directory cards. Static strings only, so safe as HTML. */
function renderExtrasBadgesHtml(switchData) {
	const commerce = getCommerce(switchData);
	const badges = [];
	if (commerce && commerce.toggleMode === 'public') {
		badges.push('<span class="extras-badge badge-public" title="Anyone can switch it from its page">Public</span>');
	}
	if (commerce && commerce.toggleMode === 'paid') {
		badges.push('<span class="extras-badge badge-paid" title="Pay to switch it">Paid</span>');
	}
	if (commerce && commerce.tips && commerceCanTakePayments(commerce)) {
		badges.push('<span class="extras-badge badge-tips" title="The owner takes tips">Tips</span>');
	}
	if (getReward(switchData)) {
		badges.push('<span class="extras-badge badge-reward" title="The owner pays a reward for acting on it from Home Assistant">Reward</span>');
	}
	return badges.join('');
}

// ── Switch page (public) ──────────────────────────────────────────────────────

function renderSwitchExtras(detail) {
	const wrap = document.getElementById('switchExtras');
	if (!wrap || !detail) return;
	renderLastNote(detail);
	renderPropertiesTable(detail.properties);
	renderCommercePanel(detail);
	renderRewardOffer(getReward(detail));
	updateSwitchExtrasVisibility();
}

function updateSwitchExtrasVisibility() {
	const wrap = document.getElementById('switchExtras');
	if (!wrap) return;
	const anyVisible = Array.from(wrap.children).some((child) => !child.classList.contains('hidden'));
	wrap.classList.toggle('hidden', !anyVisible);
}

function renderLastNote(detail) {
	const box = document.getElementById('detailNote');
	if (!box) return;
	box.textContent = '';
	const note = String((detail && (detail.note ?? detail.lastNote)) || '').trim();
	const source = detail ? String(detail.lastSource || '') : '';
	const badge = sourceBadge(source);
	const paid = detail && detail.lastPaid && Number(detail.lastPaid.amount) > 0 ? detail.lastPaid : null;
	if (!note && !badge) {
		box.classList.add('hidden');
		return;
	}
	box.appendChild(extrasEl('span', { className: 'last-note-label', text: 'Last change' }));
	if (badge) box.appendChild(badge);
	if (paid) {
		box.appendChild(extrasEl('span', { className: 'last-note-paid', text: formatMoney(paid.amount, paid.currency) }));
	}
	if (note) {
		box.appendChild(extrasEl('span', { className: 'last-note-text', text: note }));
	}
	box.classList.remove('hidden');
}

function renderPropertiesTable(properties) {
	const wrap = document.getElementById('detailPropertiesWrap');
	const table = document.getElementById('detailProperties');
	if (!wrap || !table) return;
	table.textContent = '';
	const entries = properties && typeof properties === 'object' && !Array.isArray(properties)
		? Object.entries(properties).filter(([, v]) => v !== null && v !== undefined)
		: [];
	if (!entries.length) {
		wrap.classList.add('hidden');
		return;
	}
	const body = extrasEl('tbody');
	entries.forEach(([key, value]) => {
		body.appendChild(extrasEl('tr', null,
			extrasEl('th', { scope: 'row', title: key, text: humanisePropertyKey(key) }),
			extrasEl('td', { text: formatPropertyValue(value) })
		));
	});
	table.appendChild(body);
	wrap.classList.remove('hidden');
}

function describeVisitorAction(action) {
	if (action === 'on') return 'Turn it on';
	if (action === 'off') return 'Turn it off';
	return 'Flip it';
}

function describePaidAction(action) {
	if (action === 'on') return 'to turn it on';
	if (action === 'off') return 'to turn it off';
	return 'to switch';
}

function renderCommercePanel(detail) {
	const panel = document.getElementById('commercePanel');
	if (!panel) return;
	const commerce = getCommerce(detail);
	// Re-render only when the settings change, so a visitor's half-typed
	// message survives the live refreshes.
	const renderKey = JSON.stringify([detail && detail.uid, commerce]);
	if (renderKey === extrasCommerceRenderKey && panel.childNodes.length) return;
	extrasCommerceRenderKey = renderKey;
	panel.textContent = '';

	const mode = commerce ? commerce.toggleMode : 'owner';
	const canPay = commerceCanTakePayments(commerce);
	const showToggle = mode === 'public' || mode === 'paid';
	const showTips = Boolean(commerce && commerce.tips && canPay);
	const payLink = commerce ? safeExternalUrl(commerce.payLink) : '';
	const ownerNote = commerce ? String(commerce.note || '').trim() : '';

	if (!commerce || (!showToggle && !showTips && !payLink && !ownerNote)) {
		panel.classList.add('hidden');
		return;
	}

	panel.appendChild(extrasEl('h3', { text: showToggle ? 'Switch it yourself' : 'Support this switch' }));

	if (ownerNote) {
		panel.appendChild(extrasEl('p', { className: 'commerce-owner-note' },
			extrasEl('span', { className: 'muted small', text: 'From the owner: ' }),
			extrasEl('span', { text: ownerNote })
		));
	}

	const hold = Number(commerce.holdSeconds) || 0;
	const cooldown = Number(commerce.cooldownSeconds) || 0;
	const action = commerce.action || 'toggle';

	if (showToggle && commerce.allowMessage) {
		panel.appendChild(extrasEl('label', { for: 'commerceMessage', text: 'Message (optional)' }));
		panel.appendChild(extrasEl('input', {
			id: 'commerceMessage',
			type: 'text',
			maxlength: String(EXTRAS_MAX_VISITOR_MESSAGE),
			autocomplete: 'off',
			placeholder: 'Shown with your change'
		}));
		panel.appendChild(extrasEl('p', { className: 'muted small', text: 'Up to 140 characters, no links. Everyone can see it.' }));
	}

	const actions = extrasEl('div', { className: 'comment-actions commerce-actions' });

	if (mode === 'public') {
		actions.appendChild(extrasEl('button', {
			id: 'publicToggleBtn',
			type: 'button',
			className: 'refresh-btn',
			dataset: { label: describeVisitorAction(action) },
			text: describeVisitorAction(action)
		}));
	}

	if (mode === 'paid') {
		if (canPay && commerce.price && Number(commerce.price.amount) > 0) {
			actions.appendChild(extrasEl('button', {
				id: 'paidToggleBtn',
				type: 'button',
				className: 'refresh-btn',
				text: `Pay ${formatMoney(commerce.price.amount, commerce.price.currency)} ${describePaidAction(action)}`
			}));
		}
	}

	if (actions.childNodes.length) panel.appendChild(actions);

	const facts = [];
	if (mode === 'public') {
		facts.push('Free. Anyone on this page can do it.');
		if (cooldown > 0) facts.push(`One change every ${formatDurationSeconds(Math.max(cooldown, 5))} for everyone.`);
	}
	if (mode === 'paid') {
		if (canPay) {
			facts.push('Card payment through Stripe Checkout. The switch changes once Stripe confirms the payment.');
		} else {
			facts.push('Paying to switch is turned on, but the owner cannot take payments yet.');
		}
	}
	if (showToggle && hold > 0) {
		facts.push(`It goes back after ${formatDurationSeconds(hold)}.`);
	}
	if (facts.length) {
		panel.appendChild(extrasEl('p', { className: 'muted small commerce-facts', text: facts.join(' ') }));
	}

	if (showTips) {
		const currency = getTipCurrency(commerce);
		const floor = EXTRAS_CURRENCIES[currency].min;
		const tipRow = extrasEl('div', { className: 'tip-row' },
			extrasEl('label', { for: 'tipAmount', text: `Tip (${currency.toUpperCase()})` }),
			extrasEl('div', { className: 'tip-inputs' },
				extrasEl('input', {
					id: 'tipAmount',
					type: 'text',
					inputmode: 'decimal',
					autocomplete: 'off',
					value: minorToInput(Math.max(floor, Number(commerce.price && commerce.price.currency === currency ? commerce.price.amount : floor) || floor))
				}),
				extrasEl('button', { id: 'tipBtn', type: 'button', className: 'ghost-btn', text: 'Tip' })
			),
			extrasEl('p', { className: 'muted small', text: `Card payment through Stripe Checkout. At least ${formatMoney(floor, currency)}.` })
		);
		panel.appendChild(tipRow);
	}

	if (payLink) {
		panel.appendChild(extrasEl('div', { className: 'paylink-row' },
			extrasEl('a', {
				id: 'ownerPayLink',
				className: 'ghost-btn',
				href: payLink,
				target: '_blank',
				rel: 'noopener nofollow',
				text: 'Owner\'s own payment page ↗'
			}),
			extrasEl('p', { className: 'muted small', text: 'This link goes to a payment page the owner set up themselves. Vome does not handle that payment and cannot see, confirm or refund it.' })
		));
	}

	panel.appendChild(extrasEl('span', { id: 'commerceStatus', className: 'comment-status hidden', role: 'status' }));
	panel.classList.remove('hidden');
	updatePublicToggleButton();
}

function renderRewardOffer(reward) {
	const box = document.getElementById('rewardOffer');
	if (!box) return;
	box.textContent = '';
	if (!reward) {
		box.classList.add('hidden');
		return;
	}
	const money = formatMoney(reward.amount, reward.currency);
	let when = 'each time you act on this switch from Home Assistant';
	if (reward.on === 'on') when += ' when it turns on';
	else if (reward.on === 'off') when += ' when it turns off';
	box.appendChild(extrasEl('h3', { text: 'Reward for acting on it' }));
	box.appendChild(extrasEl('p', { text: `The owner pays ${money} ${when}.` }));
	const note = String(reward.note || '').trim();
	if (note) {
		box.appendChild(extrasEl('p', { className: 'commerce-owner-note' },
			extrasEl('span', { className: 'muted small', text: 'From the owner: ' }),
			extrasEl('span', { text: note })
		));
	}
	const rules = [];
	if (Number(reward.windowSeconds) > 0) {
		rules.push(`Your Home Assistant has to act within ${formatDurationSeconds(reward.windowSeconds)} of the change.`);
	}
	if (Number(reward.maxPerDay) > 0) {
		rules.push(`At most ${Number(reward.maxPerDay)} a day per person.`);
	}
	if (rules.length) box.appendChild(extrasEl('p', { className: 'muted small', text: rules.join(' ') }));
	box.appendChild(extrasEl('p', { className: 'small' },
		'To take part, subscribe to this switch in Home Assistant and turn on ',
		extrasEl('strong', { text: 'Claim rewards' }),
		' in the VomeSync integration options (Settings → Devices & services → VomeSync → Configure). After it has switched the entities you linked to this switch, it sends a claim.'
	));
	box.appendChild(extrasEl('p', { className: 'muted small', text: 'The owner pays claims themselves. Vome keeps the list of claims but does not pay them out.' }));
	box.classList.remove('hidden');
}

function setCommerceStatus(message, kind = '') {
	const el = document.getElementById('commerceStatus');
	if (!el) return;
	if (!message) {
		el.textContent = '';
		el.className = 'comment-status hidden';
		return;
	}
	el.textContent = message;
	el.className = `comment-status${kind ? ` ${kind}` : ''}`;
}

/** Returns the message to send, '' for none, or null when it is not allowed. */
function readVisitorMessage() {
	const input = document.getElementById('commerceMessage');
	if (!input) return '';
	const text = String(input.value || '').replace(/\s+/g, ' ').trim();
	if (!text) return '';
	if (text.length > EXTRAS_MAX_VISITOR_MESSAGE) {
		setCommerceStatus('Your message is longer than 140 characters.', 'error');
		return null;
	}
	if (/https?:|www\.|\.[a-z]{2,}\//i.test(text)) {
		setCommerceStatus('Messages cannot contain links.', 'error');
		return null;
	}
	return text;
}

function updatePublicToggleButton() {
	const btn = document.getElementById('publicToggleBtn');
	if (!btn) return;
	const remaining = publicToggleCooldownUntil - Date.now();
	if (remaining > 0) {
		btn.disabled = true;
		btn.textContent = `Wait ${Math.ceil(remaining / 1000)} s`;
	} else {
		btn.disabled = false;
		btn.textContent = btn.dataset.label || 'Flip it';
	}
}

function startPublicToggleCooldown(ms) {
	const wait = Math.max(0, Number(ms) || 0);
	publicToggleCooldownUntil = Date.now() + wait;
	if (publicToggleCooldownTimer) {
		clearTimeout(publicToggleCooldownTimer);
		publicToggleCooldownTimer = null;
	}
	const tick = () => {
		publicToggleCooldownTimer = null;
		updatePublicToggleButton();
		if (publicToggleCooldownUntil > Date.now()) {
			publicToggleCooldownTimer = setTimeout(tick, 1000);
		}
	};
	tick();
}

async function readJsonSafe(response) {
	try {
		return (await response.json()) || {};
	} catch {
		return {};
	}
}

async function publicToggleCurrentSwitch() {
	const uid = currentSwitchId;
	if (!uid) return;
	if (publicToggleCooldownUntil > Date.now()) {
		updatePublicToggleButton();
		return;
	}
	const message = readVisitorMessage();
	if (message === null) return;
	const commerce = getCommerce(currentSwitchDetail) || {};
	const btn = document.getElementById('publicToggleBtn');
	if (btn) btn.disabled = true;
	setCommerceStatus('Switching…');
	try {
		const body = message ? { message } : {};
		const response = await fetch(`${API_BASE_URL}/v2/switch/${encodeURIComponent(uid)}/public-toggle`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify(body)
		});
		const data = await readJsonSafe(response);
		if (response.status === 429) {
			const retryMs = Number(data.retryAfterMs ?? (data.data && data.data.retryAfterMs)) || 5000;
			startPublicToggleCooldown(retryMs);
			setCommerceStatus(`Someone changed it moments ago. You can try again in ${formatDurationSeconds(Math.ceil(retryMs / 1000))}.`, 'error');
			return;
		}
		if (!response.ok || !data.success) {
			setCommerceStatus(data.error || 'Could not change the switch.', 'error');
			updatePublicToggleButton();
			return;
		}
		const result = data.data || {};
		if (typeof result.state === 'boolean') {
			handleStateUpdate(uid, result.state, result.timestamp || Date.now(), {
				source: 'public',
				note: typeof result.note === 'string' ? result.note : message
			});
		}
		const input = document.getElementById('commerceMessage');
		if (input) input.value = '';
		const hold = Number(commerce.holdSeconds) || 0;
		const stateText = typeof result.state === 'boolean' ? ` It is now ${result.state ? 'on' : 'off'}.` : '';
		setCommerceStatus(`Done.${stateText}${hold > 0 ? ` It goes back after ${formatDurationSeconds(hold)}.` : ''}`, 'success');
		const cooldown = Math.max(Number(commerce.cooldownSeconds) || 0, 5);
		startPublicToggleCooldown(cooldown * 1000);
	} catch (error) {
		console.error('Public toggle failed:', error);
		setCommerceStatus('Could not reach the server. Try again.', 'error');
		updatePublicToggleButton();
	}
}

async function startVisitorCheckout(kind) {
	const uid = currentSwitchId;
	if (!uid) return;
	const commerce = getCommerce(currentSwitchDetail) || {};
	const body = { kind };
	if (kind === 'tip') {
		const currency = getTipCurrency(commerce);
		const limits = EXTRAS_CURRENCIES[currency];
		const amount = parseMoneyInput(document.getElementById('tipAmount')?.value);
		if (!Number.isFinite(amount) || amount < limits.min || amount > limits.max) {
			setCommerceStatus(`Enter a tip from ${formatMoney(limits.min, currency)} to ${formatMoney(limits.max, currency)}.`, 'error');
			return;
		}
		body.amount = amount;
	}
	if (commerce.allowMessage) {
		const message = readVisitorMessage();
		if (message === null) return;
		if (message) body.message = message;
	}
	const btn = document.getElementById(kind === 'tip' ? 'tipBtn' : 'paidToggleBtn');
	if (btn) btn.disabled = true;
	setCommerceStatus('Opening Stripe Checkout…');
	try {
		const response = await fetch(`${API_BASE_URL}/v2/switch/${encodeURIComponent(uid)}/pay`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify(body)
		});
		const data = await readJsonSafe(response);
		if (response.status === 409) {
			setCommerceStatus('The owner cannot take payments yet.', 'error');
			if (btn) btn.disabled = false;
			return;
		}
		if (!response.ok || !data.success || !data.data || !data.data.url) {
			setCommerceStatus(data.error || 'Could not start checkout.', 'error');
			if (btn) btn.disabled = false;
			return;
		}
		window.location.assign(data.data.url);
	} catch (error) {
		console.error('Checkout failed:', error);
		setCommerceStatus('Could not start checkout.', 'error');
		if (btn) btn.disabled = false;
	}
}

function setSiteNotice(message, kind = '') {
	const el = document.getElementById('siteNotice');
	if (!el) return;
	if (!message) {
		el.textContent = '';
		el.className = 'comment-status site-notice hidden';
		return;
	}
	el.textContent = message;
	el.className = `comment-status site-notice${kind ? ` ${kind}` : ''}`;
}

function takeQueryParam(name) {
	const params = new URLSearchParams(window.location.search);
	const value = params.get(name);
	if (!value) return '';
	params.delete(name);
	const suffix = params.toString();
	const next = `${window.location.pathname}${suffix ? `?${suffix}` : ''}${window.location.hash || ''}`;
	try {
		window.history.replaceState({}, '', next);
	} catch {
		// ignore
	}
	return value;
}

function consumePaidQuery() {
	const result = takeQueryParam('paid');
	if (result === 'success') {
		setSiteNotice('Thank you. Stripe Checkout is complete. If you paid to switch, it changes as soon as Stripe confirms the payment, usually within a few seconds.', 'success');
	} else if (result === 'cancel') {
		setSiteNotice('Checkout cancelled. Nothing was charged.', 'error');
	}
}

function consumeConnectQuery() {
	const result = takeQueryParam('connect');
	if (!result) return;
	const hasKey = Boolean(currentSwitchId && getActiveManagementKey(currentSwitchId));
	if (result === 'return') {
		setSiteNotice(hasKey
			? 'Back from Stripe. Checking your payout status…'
			: 'Back from Stripe. Open the owner tools for this switch to see your payout status.', 'success');
		if (hasKey) {
			loadConnectStatus().then((status) => {
				if (!status) return;
				setSiteNotice(status.ready
					? 'Back from Stripe. Payouts are set up and you can take payments.'
					: 'Back from Stripe. Stripe still needs some details before you can take payments.', status.ready ? 'success' : 'error');
			});
		}
	} else if (result === 'refresh') {
		setSiteNotice('That Stripe setup link has expired. Use “Continue Stripe setup” in the owner tools to get a new one.', 'error');
	}
}

// ── Owner tools (access key with `metadata`) ──────────────────────────────────

function getManageKeyForCurrent() {
	if (!currentSwitchId) return '';
	return getActiveManagementKey(currentSwitchId) || getStoredManagementKey(currentSwitchId);
}

async function manageExtrasRequest(path, body) {
	const uid = currentSwitchId;
	const apiKey = getManageKeyForCurrent();
	if (!uid || !apiKey) {
		throw new Error('Access key required.');
	}
	const response = await fetch(`${API_BASE_URL}/v2/switch/${encodeURIComponent(uid)}${path}`, {
		method: 'POST',
		headers: {
			'Content-Type': 'application/json',
			'X-Api-Key': apiKey
		},
		body: JSON.stringify(body || {})
	});
	const data = await readJsonSafe(response);
	if (!response.ok || data.success === false) {
		const err = new Error(data.error || `HTTP ${response.status}`);
		err.status = response.status;
		throw err;
	}
	return data;
}

function setManageExtrasStatus(id, message, kind = '') {
	const el = document.getElementById(id);
	if (!el) return;
	if (!message) {
		el.textContent = '';
		el.className = 'comment-status hidden';
		return;
	}
	el.textContent = message;
	el.className = `comment-status${kind ? ` ${kind}` : ''}`;
}

/** Called from updateManagePanel when a management key is present. */
function updateManageExtras(detail) {
	const uid = detail && detail.uid;
	if (!uid) return;
	// Fill the editors once per switch (from the loaded detail), so live
	// refreshes never wipe what the owner is typing.
	if (manageExtrasUid === uid) return;
	if (!currentSwitchDetail || currentSwitchDetail.uid !== uid) return;
	manageExtrasUid = uid;
	const source = currentSwitchDetail;
	fillManagePropertiesForm(source.properties);
	fillManageCommerceForm(source.commerce);
	fillManageRewardForm(source.reward);
	hideWebhookSecret();
	loadOwnerView(uid);
	loadConnectStatus();
	loadRewardClaims();
}

// The public detail leaves out private settings (the webhook URL, a private
// switch's extras). The key holder reads them here and the forms refill.
async function loadOwnerView(uid) {
	try {
		const result = await manageExtrasRequest('/owner-view', {});
		const data = result && result.data;
		if (!data || manageExtrasUid !== uid) return;
		fillManagePropertiesForm(data.properties);
		fillManageCommerceForm(data.commerce || {});
		fillManageRewardForm(data.reward);
	} catch (_err) {
		// Older servers have no owner view; the public detail is still shown.
	}
}

function resetManageExtras() {
	manageExtrasUid = '';
	manageCommerceWebhookUrl = undefined;
	rewardClaimsCache = [];
}

function addPropertyRow(key = '', value = '') {
	const rows = document.getElementById('managePropsRows');
	if (!rows) return;
	if (rows.querySelectorAll('.prop-row').length >= EXTRAS_MAX_PROPERTIES) {
		setManageExtrasStatus('managePropsStatus', `At most ${EXTRAS_MAX_PROPERTIES} properties.`, 'error');
		return;
	}
	const valueType = typeof value === 'number' ? 'number' : (typeof value === 'boolean' ? 'boolean' : 'string');
	const row = extrasEl('div', { className: 'prop-row', dataset: { type: valueType, original: formatPropertyValue(value) } },
		extrasEl('input', { type: 'text', className: 'prop-key', 'aria-label': 'Property name', placeholder: 'name', maxlength: '32', autocomplete: 'off', value: key }),
		extrasEl('input', { type: 'text', className: 'prop-value', 'aria-label': 'Property value', placeholder: 'value', maxlength: String(EXTRAS_MAX_PROPERTY_VALUE), autocomplete: 'off', value: formatPropertyValue(value) }),
		extrasEl('button', { type: 'button', className: 'ghost-btn prop-remove', 'aria-label': 'Remove property', title: 'Remove', text: '✕' })
	);
	rows.appendChild(row);
	updatePropertyAddButton();
}

function updatePropertyAddButton() {
	const rows = document.getElementById('managePropsRows');
	const add = document.getElementById('managePropsAdd');
	if (!rows || !add) return;
	add.disabled = rows.querySelectorAll('.prop-row').length >= EXTRAS_MAX_PROPERTIES;
}

function fillManagePropertiesForm(properties) {
	const rows = document.getElementById('managePropsRows');
	if (!rows) return;
	rows.textContent = '';
	const entries = properties && typeof properties === 'object' && !Array.isArray(properties)
		? Object.entries(properties).filter(([, v]) => v !== null && v !== undefined)
		: [];
	entries.slice(0, EXTRAS_MAX_PROPERTIES).forEach(([k, v]) => addPropertyRow(k, v));
	if (!entries.length) addPropertyRow();
	updatePropertyAddButton();
}

/** Reads the property rows. Returns { properties } or { error }. */
function collectPropertiesFromForm() {
	const rows = Array.from(document.querySelectorAll('#managePropsRows .prop-row'));
	const properties = {};
	for (const row of rows) {
		const keyInput = row.querySelector('.prop-key');
		const valueInput = row.querySelector('.prop-value');
		const key = String(keyInput?.value || '').trim().toLowerCase().replace(/[\s-]+/g, '_');
		const text = String(valueInput?.value || '').trim();
		if (!key && !text) continue;
		if (!EXTRAS_PROPERTY_KEY.test(key)) {
			return { error: `“${key || '(blank)'}” is not a valid name. Use lower-case letters, digits and _, starting with a letter (up to 32).` };
		}
		if (Object.prototype.hasOwnProperty.call(properties, key)) {
			return { error: `“${key}” is used twice.` };
		}
		if (text.length > EXTRAS_MAX_PROPERTY_VALUE) {
			return { error: `The value for “${key}” is longer than ${EXTRAS_MAX_PROPERTY_VALUE} characters.` };
		}
		// Keep numbers and true/false as they were when the owner left them alone.
		const type = row.dataset.type;
		if (type === 'number' && text !== '' && Number.isFinite(Number(text))) {
			properties[key] = Number(text);
		} else if (type === 'boolean' && (text === 'yes' || text === 'no' || text === 'true' || text === 'false')) {
			properties[key] = text === 'yes' || text === 'true';
		} else {
			properties[key] = text;
		}
		if (keyInput) keyInput.value = key;
	}
	if (Object.keys(properties).length > EXTRAS_MAX_PROPERTIES) {
		return { error: `At most ${EXTRAS_MAX_PROPERTIES} properties.` };
	}
	return { properties };
}

function mergeSavedDetail(saved) {
	if (!saved || typeof saved !== 'object' || !currentSwitchDetail) return;
	['properties', 'reward'].forEach((field) => {
		if (Object.prototype.hasOwnProperty.call(saved, field)) {
			currentSwitchDetail[field] = saved[field];
		}
	});
}

async function submitManageProperties() {
	const result = collectPropertiesFromForm();
	if (result.error) {
		setManageExtrasStatus('managePropsStatus', result.error, 'error');
		return;
	}
	setManageExtrasStatus('managePropsStatus', 'Saving…');
	try {
		const data = await manageExtrasRequest('/metadata', { properties: result.properties, propertiesReplace: true });
		const saved = data.data || {};
		mergeSavedDetail(saved);
		fillManagePropertiesForm(saved.properties !== undefined ? saved.properties : result.properties);
		if (currentSwitchDetail) renderSwitchExtras(currentSwitchDetail);
		setManageExtrasStatus('managePropsStatus', 'Saved.', 'success');
		if (currentSwitchId) refreshSwitchDetail(currentSwitchId);
	} catch (error) {
		setManageExtrasStatus('managePropsStatus', `Failed: ${error.message || 'Unknown error'}`, 'error');
	}
}

function setInputValue(id, value) {
	const el = document.getElementById(id);
	if (!el) return;
	if (el.type === 'checkbox') el.checked = Boolean(value);
	else el.value = value === undefined || value === null ? '' : String(value);
}

function fillManageCommerceForm(commerce) {
	const c = commerce && typeof commerce === 'object' ? commerce : {};
	setInputValue('commerceToggleMode', c.toggleMode || 'owner');
	setInputValue('commerceAction', c.action || 'toggle');
	const wholeOr = (v, fallback) => (v === undefined || v === null || !Number.isFinite(Number(v)) ? fallback : Number(v));
	setInputValue('commerceHoldSeconds', wholeOr(c.holdSeconds, 0));
	setInputValue('commerceCooldownSeconds', wholeOr(c.cooldownSeconds, 10));
	const price = c.price && typeof c.price === 'object' ? c.price : null;
	setInputValue('commercePriceAmount', price ? minorToInput(price.amount) : '');
	setInputValue('commercePriceCurrency', price && EXTRAS_CURRENCIES[String(price.currency).toLowerCase()] ? String(price.currency).toLowerCase() : 'eur');
	setInputValue('commerceTips', c.tips);
	setInputValue('commerceAllowMessage', c.allowMessage);
	setInputValue('commerceNote', c.note || '');
	setInputValue('commercePayLink', c.payLink || '');
	// The public summary never carries webhookUrl; the owner's save response may.
	if (Object.prototype.hasOwnProperty.call(c, 'webhookUrl')) {
		manageCommerceWebhookUrl = String(c.webhookUrl || '');
	}
	setInputValue('commerceWebhookUrl', manageCommerceWebhookUrl || '');
	setInputValue('commerceWebhookRemove', false);
	setInputValue('commerceWebhookRotate', false);
	const hint = document.getElementById('commerceWebhookHint');
	if (hint) {
		const base = 'We send a signed POST here for every visitor, paid and automatic change, every tip and every reward claim. Must use https.';
		hint.textContent = manageCommerceWebhookUrl === undefined
			? `${base} For privacy this page cannot show a webhook you set earlier: leave it blank to keep it.`
			: base;
	}
}

/** Reads the commerce form. Returns { body } or { error }. */
function collectCommerceFromForm() {
	const value = (id) => String(document.getElementById(id)?.value || '').trim();
	const checked = (id) => Boolean(document.getElementById(id)?.checked);
	const toggleMode = value('commerceToggleMode') || 'owner';
	const action = value('commerceAction') || 'toggle';
	const holdSeconds = Number(value('commerceHoldSeconds') || 0);
	const cooldownSeconds = Number(value('commerceCooldownSeconds') || 0);
	if (!Number.isInteger(holdSeconds) || holdSeconds < 0 || holdSeconds > 3600) {
		return { error: '“Put it back after” must be a whole number of seconds from 0 to 3600.' };
	}
	if (!Number.isInteger(cooldownSeconds) || cooldownSeconds < 0 || cooldownSeconds > 3600) {
		return { error: 'The minimum gap must be a whole number of seconds from 0 to 3600.' };
	}
	const currency = value('commercePriceCurrency') || 'eur';
	const priceText = value('commercePriceAmount');
	let price = null;
	if (priceText) {
		const amount = parseMoneyInput(priceText);
		const limits = EXTRAS_CURRENCIES[currency];
		if (!limits || !Number.isFinite(amount) || amount < limits.min || amount > limits.max) {
			const cur = limits ? currency : 'eur';
			return { error: `The price must be from ${formatMoney(EXTRAS_CURRENCIES[cur].min, cur)} to ${formatMoney(EXTRAS_CURRENCIES[cur].max, cur)}.` };
		}
		price = { amount, currency };
	}
	if (toggleMode === 'paid' && !price) {
		return { error: 'Paid switching needs a price.' };
	}
	const payLink = value('commercePayLink');
	if (payLink && !safeExternalUrl(payLink)) {
		return { error: 'Your payment link must be a full web address starting with https://.' };
	}
	const commerce = {
		toggleMode,
		action,
		holdSeconds,
		cooldownSeconds: toggleMode === 'public' ? Math.max(cooldownSeconds, 5) : cooldownSeconds,
		price,
		tips: checked('commerceTips'),
		allowMessage: checked('commerceAllowMessage'),
		note: value('commerceNote'),
		payLink
	};
	const webhookInput = value('commerceWebhookUrl');
	if (checked('commerceWebhookRemove')) {
		commerce.webhookUrl = '';
	} else if (webhookInput) {
		if (!/^https:\/\//i.test(webhookInput) || !safeExternalUrl(webhookInput)) {
			return { error: 'The webhook URL must start with https://.' };
		}
		if (webhookInput !== manageCommerceWebhookUrl) commerce.webhookUrl = webhookInput;
	} else if (manageCommerceWebhookUrl) {
		// It was known and the owner cleared the box.
		commerce.webhookUrl = '';
	}
	const body = { commerce };
	if (checked('commerceWebhookRotate')) body.rotateWebhookSecret = true;
	return { body };
}

function showWebhookSecret(secret) {
	const box = document.getElementById('webhookSecretBox');
	const valueEl = document.getElementById('webhookSecretValue');
	if (!box || !valueEl) return;
	valueEl.textContent = String(secret);
	box.classList.remove('hidden');
}

function hideWebhookSecret() {
	const box = document.getElementById('webhookSecretBox');
	const valueEl = document.getElementById('webhookSecretValue');
	if (valueEl) valueEl.textContent = '';
	if (box) box.classList.add('hidden');
}

async function submitManageCommerce() {
	const result = collectCommerceFromForm();
	if (result.error) {
		setManageExtrasStatus('manageCommerceStatus', result.error, 'error');
		return;
	}
	hideWebhookSecret();
	setManageExtrasStatus('manageCommerceStatus', 'Saving…');
	try {
		const data = await manageExtrasRequest('/metadata', result.body);
		const saved = data.data || {};
		const secret = saved.webhookSecret || data.webhookSecret;
		if (Object.prototype.hasOwnProperty.call(result.body.commerce, 'webhookUrl')) {
			manageCommerceWebhookUrl = result.body.commerce.webhookUrl;
		}
		fillManageCommerceForm(saved.commerce && typeof saved.commerce === 'object' ? saved.commerce : result.body.commerce);
		if (secret) showWebhookSecret(secret);
		setManageExtrasStatus('manageCommerceStatus', 'Saved.', 'success');
		// The public summary (canTakePayments etc.) comes from the public detail.
		if (currentSwitchId) refreshSwitchDetail(currentSwitchId);
	} catch (error) {
		setManageExtrasStatus('manageCommerceStatus', `Failed: ${error.message || 'Unknown error'}`, 'error');
	}
}

function fillManageRewardForm(reward) {
	const r = reward && typeof reward === 'object' ? reward : null;
	const currency = r && EXTRAS_CURRENCIES[String(r.currency).toLowerCase()] ? String(r.currency).toLowerCase() : 'sek';
	setInputValue('rewardAmount', r ? minorToInput(r.amount) : '');
	setInputValue('rewardCurrency', currency);
	setInputValue('rewardOn', (r && r.on) || 'on');
	setInputValue('rewardWindowMinutes', r && Number(r.windowSeconds) ? Math.max(1, Math.round(Number(r.windowSeconds) / 60)) : 15);
	setInputValue('rewardMaxPerDay', r && Number(r.maxPerDay) ? Number(r.maxPerDay) : 5);
	setInputValue('rewardNote', (r && r.note) || '');
	const remove = document.getElementById('rewardRemoveBtn');
	if (remove) remove.classList.toggle('hidden', !r);
}

function collectRewardFromForm() {
	const value = (id) => String(document.getElementById(id)?.value || '').trim();
	const currency = value('rewardCurrency') || 'sek';
	const limits = EXTRAS_CURRENCIES[currency];
	const amount = parseMoneyInput(value('rewardAmount'));
	if (!limits || !Number.isFinite(amount) || amount < 1 || amount > limits.max) {
		return { error: `Enter an amount from ${formatMoney(1, limits ? currency : 'sek')} to ${formatMoney((limits || EXTRAS_CURRENCIES.sek).max, limits ? currency : 'sek')}.` };
	}
	const minutes = Number(value('rewardWindowMinutes') || 15);
	if (!Number.isInteger(minutes) || minutes < 1 || minutes > 1440) {
		return { error: '“Claim within” must be from 1 to 1440 minutes.' };
	}
	const maxPerDay = Number(value('rewardMaxPerDay') || 5);
	if (!Number.isInteger(maxPerDay) || maxPerDay < 1 || maxPerDay > 100) {
		return { error: '“Most per person per day” must be from 1 to 100.' };
	}
	return {
		reward: {
			amount,
			currency,
			on: value('rewardOn') || 'on',
			windowSeconds: minutes * 60,
			maxPerDay,
			note: value('rewardNote')
		}
	};
}

async function saveManageReward(reward) {
	setManageExtrasStatus('manageRewardStatus', 'Saving…');
	try {
		const data = await manageExtrasRequest('/metadata', { reward });
		const saved = data.data || {};
		const next = Object.prototype.hasOwnProperty.call(saved, 'reward') ? saved.reward : reward;
		if (currentSwitchDetail) currentSwitchDetail.reward = next;
		fillManageRewardForm(next);
		if (currentSwitchDetail) renderSwitchExtras(currentSwitchDetail);
		setManageExtrasStatus('manageRewardStatus', reward ? 'Saved.' : 'Reward offer removed.', 'success');
		if (currentSwitchId) refreshSwitchDetail(currentSwitchId);
	} catch (error) {
		setManageExtrasStatus('manageRewardStatus', `Failed: ${error.message || 'Unknown error'}`, 'error');
	}
}

async function submitManageReward() {
	const result = collectRewardFromForm();
	if (result.error) {
		setManageExtrasStatus('manageRewardStatus', result.error, 'error');
		return;
	}
	await saveManageReward(result.reward);
}

function renderConnectStatus(status) {
	const text = document.getElementById('connectStatusText');
	const reqList = document.getElementById('connectRequirements');
	const startBtn = document.getElementById('connectStartBtn');
	const dash = document.getElementById('connectDashboardLink');
	if (!text) return;
	const s = status || {};
	if (reqList) {
		reqList.textContent = '';
		reqList.classList.add('hidden');
	}
	if (!s.connected) {
		text.textContent = 'Payouts are not set up.';
		if (startBtn) startBtn.textContent = 'Set up payouts with Stripe';
	} else if (!s.ready) {
		text.textContent = 'Stripe still needs some details before you can take payments.';
		if (startBtn) startBtn.textContent = 'Continue Stripe setup';
		const due = Array.isArray(s.requirementsDue) ? s.requirementsDue : [];
		if (reqList && due.length) {
			due.slice(0, 10).forEach((item) => reqList.appendChild(extrasEl('li', { text: String(item).replace(/[._]/g, ' ') })));
			if (due.length > 10) reqList.appendChild(extrasEl('li', { text: `and ${due.length - 10} more` }));
			reqList.classList.remove('hidden');
		} else if (Number(s.requirementsDue) > 0) {
			text.textContent = `Stripe still needs ${Number(s.requirementsDue)} detail${Number(s.requirementsDue) === 1 ? '' : 's'} before you can take payments.`;
		}
	} else {
		text.textContent = 'Payouts are set up. You can take payments.';
		if (startBtn) startBtn.textContent = 'Review Stripe details';
	}
	if (dash) {
		const url = safeExternalUrl(s.dashboardUrl);
		dash.classList.toggle('hidden', !url);
		dash.href = url || '#';
	}
}

async function loadConnectStatus() {
	if (!getManageKeyForCurrent()) return null;
	const text = document.getElementById('connectStatusText');
	if (text) text.textContent = 'Checking…';
	try {
		const data = await manageExtrasRequest('/connect/status', {});
		const status = data.data || {};
		renderConnectStatus(status);
		setManageExtrasStatus('connectStatus', '');
		return status;
	} catch (error) {
		if (text) text.textContent = 'Could not check payout status.';
		setManageExtrasStatus('connectStatus', error.message || 'Could not check payout status.', 'error');
		return null;
	}
}

async function startConnectOnboarding() {
	const btn = document.getElementById('connectStartBtn');
	if (btn) btn.disabled = true;
	setManageExtrasStatus('connectStatus', 'Opening Stripe…');
	try {
		const data = await manageExtrasRequest('/connect', {});
		const url = data.data && safeExternalUrl(data.data.url);
		if (!url) throw new Error('Stripe did not return a link.');
		window.location.assign(url);
	} catch (error) {
		setManageExtrasStatus('connectStatus', `Could not open Stripe: ${error.message || 'Unknown error'}`, 'error');
		if (btn) btn.disabled = false;
	}
}

function shortClaimant(id) {
	const text = String(id || '');
	return text.length > 12 ? `${text.slice(0, 10)}…` : text;
}

/** Totals owed per claimant and currency, from the claims themselves. */
function computeRewardTotals(claims) {
	const byKey = new Map();
	(claims || []).forEach((claim) => {
		if (!claim || claim.status !== 'owed') return;
		const currency = String(claim.currency || '').toLowerCase();
		const key = `${claim.claimant}|${currency}`;
		const entry = byKey.get(key) || { claimant: claim.claimant, currency, amount: 0, count: 0, ids: [] };
		entry.amount += Number(claim.amount) || 0;
		entry.count += 1;
		entry.ids.push(claim.id);
		byKey.set(key, entry);
	});
	return Array.from(byKey.values()).sort((a, b) => b.amount - a.amount);
}

function renderRewardClaims(claims) {
	const totalsWrap = document.getElementById('rewardTotals');
	const claimsWrap = document.getElementById('rewardClaims');
	if (!totalsWrap || !claimsWrap) return;
	totalsWrap.textContent = '';
	claimsWrap.textContent = '';
	const list = Array.isArray(claims) ? claims : [];
	if (!list.length) {
		claimsWrap.appendChild(extrasEl('p', { className: 'muted small', text: 'No claims yet.' }));
		updateMarkSelectedButton();
		return;
	}

	const totals = computeRewardTotals(list);
	if (totals.length) {
		const body = extrasEl('tbody');
		totals.forEach((t) => {
			body.appendChild(extrasEl('tr', null,
				extrasEl('td', { className: 'mono', title: t.claimant, text: shortClaimant(t.claimant) }),
				extrasEl('td', { text: formatMoney(t.amount, t.currency) }),
				extrasEl('td', { text: String(t.count) }),
				extrasEl('td', null, extrasEl('button', {
					type: 'button',
					className: 'ghost-btn reward-mark-claimant',
					dataset: { ids: JSON.stringify(t.ids) },
					text: 'Mark paid'
				}))
			));
		});
		totalsWrap.appendChild(extrasEl('h4', { text: 'Owed' }));
		totalsWrap.appendChild(extrasEl('table', { className: 'claims-table' },
			extrasEl('thead', null, extrasEl('tr', null,
				extrasEl('th', { text: 'Claimant' }),
				extrasEl('th', { text: 'Owed' }),
				extrasEl('th', { text: 'Claims' }),
				extrasEl('th', { text: '' })
			)),
			body
		));
	} else {
		totalsWrap.appendChild(extrasEl('p', { className: 'muted small', text: 'Nothing owed. Every claim is marked paid.' }));
	}

	const body = extrasEl('tbody');
	list.forEach((claim) => {
		const owed = claim.status === 'owed';
		body.appendChild(extrasEl('tr', null,
			extrasEl('td', null, owed
				? extrasEl('input', { type: 'checkbox', className: 'reward-claim-select', 'aria-label': 'Select claim', dataset: { id: String(claim.id) } })
				: ''),
			extrasEl('td', { className: 'mono', title: String(claim.claimant || ''), text: shortClaimant(claim.claimant) }),
			extrasEl('td', { text: claim.changeAt ? formatDateTimeYmd(new Date(Number(claim.changeAt))) : '' }),
			extrasEl('td', { text: String(Number(claim.entities) || 0) }),
			extrasEl('td', { text: formatMoney(claim.amount, claim.currency) }),
			extrasEl('td', null, extrasEl('span', { className: `claim-status claim-${owed ? 'owed' : 'paid'}`, text: owed ? 'Owed' : 'Paid' }))
		));
	});
	claimsWrap.appendChild(extrasEl('h4', { text: 'All claims' }));
	claimsWrap.appendChild(extrasEl('table', { className: 'claims-table' },
		extrasEl('thead', null, extrasEl('tr', null,
			extrasEl('th', { text: '' }),
			extrasEl('th', { text: 'Claimant' }),
			extrasEl('th', { text: 'Change' }),
			extrasEl('th', { text: 'Entities' }),
			extrasEl('th', { text: 'Amount' }),
			extrasEl('th', { text: 'Status' })
		)),
		body
	));
	updateMarkSelectedButton();
}

function updateMarkSelectedButton() {
	const btn = document.getElementById('rewardClaimsMarkSelected');
	if (!btn) return;
	btn.disabled = document.querySelectorAll('#rewardClaims .reward-claim-select:checked').length === 0;
}

async function loadRewardClaims() {
	if (!getManageKeyForCurrent()) return;
	setManageExtrasStatus('rewardClaimsStatus', 'Loading…');
	try {
		const data = await manageExtrasRequest('/reward-claims/list', {});
		const payload = data.data;
		const claims = Array.isArray(payload) ? payload : (payload && Array.isArray(payload.claims) ? payload.claims : []);
		rewardClaimsCache = claims;
		renderRewardClaims(claims);
		setManageExtrasStatus('rewardClaimsStatus', '');
	} catch (error) {
		setManageExtrasStatus('rewardClaimsStatus', `Could not load claims: ${error.message || 'Unknown error'}`, 'error');
	}
}

async function markRewardClaimsPaid(ids) {
	const list = (ids || []).map(String).filter(Boolean);
	if (!list.length) return;
	setManageExtrasStatus('rewardClaimsStatus', 'Saving…');
	try {
		await manageExtrasRequest('/reward-claims/mark-paid', { ids: list });
		await loadRewardClaims();
		setManageExtrasStatus('rewardClaimsStatus', `Marked ${list.length} claim${list.length === 1 ? '' : 's'} as paid.`, 'success');
	} catch (error) {
		setManageExtrasStatus('rewardClaimsStatus', `Failed: ${error.message || 'Unknown error'}`, 'error');
	}
}

function setupSwitchExtrasListeners() {
	const commercePanel = document.getElementById('commercePanel');
	if (commercePanel) {
		commercePanel.addEventListener('click', (e) => {
			const target = e.target && e.target.closest ? e.target.closest('button') : null;
			if (!target) return;
			if (target.id === 'publicToggleBtn') publicToggleCurrentSwitch();
			else if (target.id === 'paidToggleBtn') startVisitorCheckout('switch');
			else if (target.id === 'tipBtn') startVisitorCheckout('tip');
		});
	}

	const propsForm = document.getElementById('managePropsForm');
	if (propsForm) {
		propsForm.addEventListener('submit', (e) => {
			e.preventDefault();
			submitManageProperties();
		});
		propsForm.addEventListener('click', (e) => {
			const target = e.target && e.target.closest ? e.target.closest('button') : null;
			if (!target) return;
			if (target.id === 'managePropsAdd') {
				addPropertyRow();
			} else if (target.classList.contains('prop-remove')) {
				const row = target.closest('.prop-row');
				if (row) row.remove();
				updatePropertyAddButton();
			}
		});
	}

	const commerceForm = document.getElementById('manageCommerceForm');
	if (commerceForm) {
		commerceForm.addEventListener('submit', (e) => {
			e.preventDefault();
			submitManageCommerce();
		});
	}

	const secretCopy = document.getElementById('webhookSecretCopy');
	if (secretCopy) {
		secretCopy.addEventListener('click', () => {
			const value = document.getElementById('webhookSecretValue')?.textContent || '';
			if (value) copyText(value, secretCopy, 'Copy secret');
		});
	}

	const rewardForm = document.getElementById('manageRewardForm');
	if (rewardForm) {
		rewardForm.addEventListener('submit', (e) => {
			e.preventDefault();
			submitManageReward();
		});
	}
	const rewardRemove = document.getElementById('rewardRemoveBtn');
	if (rewardRemove) {
		rewardRemove.addEventListener('click', () => saveManageReward(null));
	}

	const connectStart = document.getElementById('connectStartBtn');
	if (connectStart) connectStart.addEventListener('click', () => startConnectOnboarding());
	const connectRefresh = document.getElementById('connectRefreshBtn');
	if (connectRefresh) connectRefresh.addEventListener('click', () => loadConnectStatus());

	const claimsRefresh = document.getElementById('rewardClaimsRefresh');
	if (claimsRefresh) claimsRefresh.addEventListener('click', () => loadRewardClaims());
	const markSelected = document.getElementById('rewardClaimsMarkSelected');
	if (markSelected) {
		markSelected.addEventListener('click', () => {
			const ids = Array.from(document.querySelectorAll('#rewardClaims .reward-claim-select:checked'))
				.map((box) => box.dataset.id);
			markRewardClaimsPaid(ids);
		});
	}
	const claimsWrap = document.getElementById('rewardClaims');
	if (claimsWrap) {
		claimsWrap.addEventListener('change', (e) => {
			if (e.target && e.target.classList && e.target.classList.contains('reward-claim-select')) {
				updateMarkSelectedButton();
			}
		});
	}
	const totalsWrap = document.getElementById('rewardTotals');
	if (totalsWrap) {
		totalsWrap.addEventListener('click', (e) => {
			const target = e.target && e.target.closest ? e.target.closest('.reward-mark-claimant') : null;
			if (!target) return;
			let ids = [];
			try {
				ids = JSON.parse(target.dataset.ids || '[]');
			} catch {
				ids = [];
			}
			markRewardClaimsPaid(ids);
		});
	}
}

// Expose functions for inline handlers
window.openSwitchDetails = openSwitchDetails;
window.filterByCategory = filterByCategory;
window.copyUID = copyUID;
window.startPromoteCheckout = startPromoteCheckout;
window.startPremiumCheckout = startPremiumCheckout;
window.startBillingPortal = startBillingPortal;
window.formatMoney = formatMoney;
window.publicToggleCurrentSwitch = publicToggleCurrentSwitch;
window.startVisitorCheckout = startVisitorCheckout;
window.handleStateUpdate = handleStateUpdate;
window.submitManageProperties = submitManageProperties;
window.submitManageCommerce = submitManageCommerce;
window.submitManageReward = submitManageReward;
window.loadConnectStatus = loadConnectStatus;
window.loadRewardClaims = loadRewardClaims;
window.markRewardClaimsPaid = markRewardClaimsPaid;

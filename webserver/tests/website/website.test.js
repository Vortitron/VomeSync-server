/**
 * @jest-environment jsdom
 *
 * Website smoke tests (static SPA).
 *
 * These tests verify the key user-visible v2-only behaviours:
 * - Switch cards can render an icon
 * - Opening a switch sets the banner background (hero)
 * - Deep links use /switch/<uid>
 * - Comment posting uses the v2 access-key endpoint + X-Api-Key header
 */
const fs = require('fs');
const path = require('path');

function createMockResponse(jsonBody, ok = true, status = 200) {
	return {
		ok,
		status,
		async json() {
			return jsonBody;
		}
	};
}

describe('Website chrome bloom', () => {
	const websiteRoot = path.resolve(__dirname, '../../../website');

	test('navbar uses a teal dual-band bloom and a click-wait sweep', () => {
		const html = fs.readFileSync(path.join(websiteRoot, 'index.html'), 'utf8');
		expect(html).toContain('data-vome-bloom');
		expect(html).toContain('vome-bloom');
		expect(html).toContain('vome-nav-wait.js');
		const css = fs.readFileSync(path.join(websiteRoot, 'styles.css'), 'utf8');
		expect(css).toContain('#042f2e');
		expect(css).toContain('#0f766e');
		expect(css).toContain('vome-nav-sweep');
		expect(css).not.toContain('vome-nav-heartbeat');
		expect(css).not.toContain('scaleY');
		expect(css).toMatch(/\.navbar \{[^}]*overflow:\s*visible/s);
		const js = fs.readFileSync(path.join(websiteRoot, 'vome-nav-wait.js'), 'utf8');
		expect(js).toContain('[data-vome-bloom]');
		expect(js).toContain('vome-bloom--waiting');
		expect(js).toContain('gesturePending');
	});
});

describe('Website SPA (v2 directory)', () => {
	test('supports icon+banner, /switch/<uid> deep links, and v2 access-key comments', async () => {
		// Arrange DOM
		const websiteRoot = path.resolve(__dirname, '../../../website');
		const html = fs.readFileSync(path.join(websiteRoot, 'index.html'), 'utf8');
		document.documentElement.innerHTML = html;

		// Prevent timers / UI popups from interfering with Jest
		window.setInterval = jest.fn();
		window.alert = jest.fn();
		if (!navigator.clipboard) {
			// eslint-disable-next-line no-global-assign
			navigator.clipboard = {};
		}
		navigator.clipboard.writeText = jest.fn().mockResolvedValue(undefined);

		// Start at home
		window.history.pushState({}, '', '/');

		const uid = 'vs_75bz1byjrbv0jfmxv8dq27rp2w';
		const iconUrl = 'https://example.com/icon.png';
		const bannerUrl = 'https://example.com/banner.jpg';
		const accessKey = '00000000-0000-4000-8000-000000000000';

		const publicSwitchList = {
			success: true,
			data: {
				switches: [{
					uid,
					name: 'Pretty Switch',
					description: 'Pretty description',
					location: 'Test City',
					category: 'Community',
					state: false,
					lastToggled: 0,
					toggleCount: 0,
					userCount: 0,
					link: '',
					iconUrl,
					bannerUrl,
					ownerProfileUrl: ''
				}],
				count: 1,
				timestamp: Date.now()
			}
		};

		const publicSwitchDetail = {
			success: true,
			data: {
				uid,
				name: 'Pretty Switch',
				description: 'Pretty description',
				location: 'Test City',
				category: 'Community',
				state: false,
				lastToggled: 0,
				toggleCount: 0,
				userCount: 0,
				link: '',
				iconUrl,
				bannerUrl,
				ownerProfileUrl: '',
				events: []
			}
		};

		const commentOk = {
			success: true,
			data: {
				uid,
				comment: 'Hello',
				actor: 'test',
				viaApiKey: true,
				timestamp: Date.now()
			}
		};

		global.fetch = jest.fn(async (url, options) => {
			const u = String(url);
			if (u.endsWith('/public-switches')) {
				return createMockResponse(publicSwitchList);
			}
			if (u.endsWith(`/switch/${uid}`)) {
				return createMockResponse(publicSwitchDetail);
			}
			if (u.endsWith('/billing')) {
				return createMockResponse({ success: true, data: { promoteEnabled: false, promoteDurationDays: 7 } });
			}
			if (u.endsWith('/categories')) {
				return createMockResponse({ success: true, data: {} });
			}
			if (u.endsWith(`/v2/switch/${uid}/comment`)) {
				return createMockResponse(commentOk);
			}
			return createMockResponse({ success: false, error: `Unhandled fetch in test: ${u}` }, false, 404);
		});

		// Load website script
		const script = fs.readFileSync(path.join(websiteRoot, 'script.js'), 'utf8');
		window.eval(script);
		window.setupEventListeners();

		// Act: load list, open detail, post a comment
		// Note: functions are global in this static site (inline handlers depend on them).
		window.sessionStorage.setItem(`vomesync_api_key:${uid}`, accessKey);
		await window.loadSwitches();

		const grid = document.getElementById('switchesGrid');
		expect(grid.innerHTML).toContain('switch-icon');
		expect(grid.innerHTML).toContain('switch-card-banner');
		expect(grid.innerHTML).toContain(uid);

		// Quick view: clicking the card (not the "Details" button) should open a modal without navigating
		const card = grid.querySelector('.switch-card');
		expect(card).toBeTruthy();
		card.dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true }));
		await new Promise((resolve) => setTimeout(resolve, 0));
		await new Promise((resolve) => setTimeout(resolve, 0));

		expect(window.location.pathname).toBe('/');
		const quickView = document.getElementById('quickView');
		expect(quickView.classList.contains('hidden')).toBe(false);
		expect(document.getElementById('quickViewTitle').textContent).toBe('Pretty Switch');
		expect(document.getElementById('quickViewDescription').textContent).toBe('Pretty description');

		const quickViewAddHacsBtn = document.getElementById('quickViewAddHacs');
		quickViewAddHacsBtn.dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true }));
		const hacsDialog = document.getElementById('hacsDialog');
		expect(hacsDialog.classList.contains('hidden')).toBe(false);
		window.closeHacsDialog();
		expect(quickView.classList.contains('hidden')).toBe(true);

		window.closeQuickView();
		expect(quickView.classList.contains('hidden')).toBe(true);

		await window.openSwitchDetails(uid, false);

		// Deep link: should use /switch/<uid>
		expect(window.location.pathname).toBe(`/switch/${uid}`);
		expect(document.body.classList.contains('view-switch')).toBe(true);

		// Banner: hero background should be set
		const hero = document.querySelector('.hero');
		expect(hero.classList.contains('hero-banner-active')).toBe(true);
		expect(hero.style.getPropertyValue('--hero-banner-image')).toContain(bannerUrl);

		// Hero text should reflect the switch (not the marketing headline)
		expect(document.getElementById('heroTitle').textContent).toBe('Pretty Switch');
		expect(document.getElementById('heroSubtitle').textContent).toBe('Pretty description');

		// Home Assistant deep link should target config flow
		const heroHaLink = document.getElementById('heroHaLink');
		expect(heroHaLink.getAttribute('href')).toContain('my.home-assistant.io/redirect/config_flow_start/?domain=vomesync');

		// Icon: should be visible in detail header
		const detailIcon = document.getElementById('detailIcon');
		expect(detailIcon.classList.contains('hidden')).toBe(false);
		expect(detailIcon.getAttribute('src')).toBe(iconUrl);

		// Post comment using v2 access key
		document.getElementById('commentText').value = 'Hello';

		if (typeof window.submitComment === 'function') {
			await window.submitComment();
		} else {
			// Fallback: submit through the form handler
			document.getElementById('commentForm').dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }));
			await new Promise((resolve) => setTimeout(resolve, 0));
		}

		const commentCalls = global.fetch.mock.calls.filter(([u]) => String(u).endsWith(`/v2/switch/${uid}/comment`));
		expect(commentCalls.length).toBeGreaterThanOrEqual(1);
		const [_commentUrl, commentOptions] = commentCalls[0];
		expect(commentOptions.method).toBe('POST');
		expect(commentOptions.headers['X-Api-Key']).toBe(accessKey);
		expect(String(commentOptions.body)).toContain('Hello');

		// Closing detail should restore directory view
		window.closeDetail();
		expect(document.body.classList.contains('view-switch')).toBe(false);
	});

	test('management key enables hero status toggle', async () => {
		// Arrange DOM
		const websiteRoot = path.resolve(__dirname, '../../../website');
		const html = fs.readFileSync(path.join(websiteRoot, 'index.html'), 'utf8');
		document.documentElement.innerHTML = html;

		window.setInterval = jest.fn();
		window.alert = jest.fn();

		const uid = 'vs_toggle_test';
		const accessKey = '00000000-0000-4000-8000-111111111111';
		const toggleOk = {
			success: true,
			data: {
				uid,
				state: true,
				timestamp: Date.now(),
				toggleCount: 1
			}
		};

		const publicSwitchList = {
			success: true,
			data: {
				switches: [{
					uid,
					name: 'Toggle Switch',
					description: 'Toggle description',
					location: 'Test City',
					category: 'Community',
					state: false,
					lastToggled: 0,
					toggleCount: 0,
					userCount: 0,
					link: '',
					iconUrl: '',
					bannerUrl: '',
					ownerProfileUrl: ''
				}],
				count: 1,
				timestamp: Date.now()
			}
		};

		const publicSwitchDetail = {
			success: true,
			data: {
				uid,
				name: 'Toggle Switch',
				description: 'Toggle description',
				location: 'Test City',
				category: 'Community',
				state: false,
				lastToggled: 0,
				toggleCount: 0,
				userCount: 0,
				link: '',
				iconUrl: '',
				bannerUrl: '',
				ownerProfileUrl: '',
				events: []
			}
		};

		global.fetch = jest.fn(async (url, options) => {
			const u = String(url);
			if (u.endsWith('/public-switches')) {
				return createMockResponse(publicSwitchList);
			}
			if (u.endsWith(`/switch/${uid}`)) {
				return createMockResponse(publicSwitchDetail);
			}
			if (u.endsWith('/billing')) {
				return createMockResponse({ success: true, data: { promoteEnabled: false, promoteDurationDays: 7 } });
			}
			if (u.endsWith('/categories')) {
				return createMockResponse({ success: true, data: {} });
			}
			if (u.endsWith(`/v2/switch/${uid}/toggle`)) {
				return createMockResponse(toggleOk);
			}
			return createMockResponse({ success: false, error: `Unhandled fetch in test: ${u}` }, false, 404);
		});

		const script = fs.readFileSync(path.join(websiteRoot, 'script.js'), 'utf8');
		window.eval(script);
		window.setupEventListeners();

		window.sessionStorage.setItem(`vomesync_manage_key:${uid}`, accessKey);
		await window.loadSwitches();
		await window.openSwitchDetails(uid, false);

		const heroStatusButton = document.getElementById('heroStatusButton');
		heroStatusButton.dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true }));
		const toggleDialogSwitch = document.getElementById('toggleDialogSwitch');
		toggleDialogSwitch.checked = true;
		toggleDialogSwitch.dispatchEvent(new window.Event('change', { bubbles: true }));
		await new Promise((resolve) => setTimeout(resolve, 0));

		const toggleCalls = global.fetch.mock.calls.filter(([u]) => String(u).endsWith(`/v2/switch/${uid}/toggle`));
		expect(toggleCalls.length).toBeGreaterThanOrEqual(1);
		const [_toggleUrl, toggleOptions] = toggleCalls[0];
		expect(toggleOptions.method).toBe('POST');
		expect(toggleOptions.headers['X-Api-Key']).toBe(accessKey);
	});

	test('nav status shows auth state and opens the toggle dialog', async () => {
		const websiteRoot = path.resolve(__dirname, '../../../website');
		const html = fs.readFileSync(path.join(websiteRoot, 'index.html'), 'utf8');
		document.documentElement.innerHTML = html;

		window.setInterval = jest.fn();
		window.alert = jest.fn();

		const uid = 'vs_nav_test';
		const accessKey = '00000000-0000-4000-8000-222222222222';
		const toggleOk = {
			success: true,
			data: {
				uid,
				state: true,
				timestamp: Date.now(),
				toggleCount: 1
			}
		};

		const publicSwitchList = {
			success: true,
			data: {
				switches: [{
					uid,
					name: 'Nav Switch',
					description: 'Nav description',
					location: 'Test City',
					category: 'Community',
					state: true,
					lastToggled: 0,
					toggleCount: 0,
					userCount: 0,
					link: '',
					iconUrl: '',
					bannerUrl: '',
					ownerProfileUrl: ''
				}],
				count: 1,
				timestamp: Date.now()
			}
		};

		const publicSwitchDetail = {
			success: true,
			data: {
				uid,
				name: 'Nav Switch',
				description: 'Nav description',
				location: 'Test City',
				category: 'Community',
				state: true,
				lastToggled: 0,
				toggleCount: 0,
				userCount: 0,
				link: '',
				iconUrl: '',
				bannerUrl: '',
				ownerProfileUrl: '',
				events: []
			}
		};

		global.fetch = jest.fn(async (url) => {
			const u = String(url);
			if (u.endsWith('/public-switches')) {
				return createMockResponse(publicSwitchList);
			}
			if (u.endsWith(`/switch/${uid}`)) {
				return createMockResponse(publicSwitchDetail);
			}
			if (u.endsWith('/billing')) {
				return createMockResponse({ success: true, data: { promoteEnabled: false, promoteDurationDays: 7 } });
			}
			if (u.endsWith('/categories')) {
				return createMockResponse({ success: true, data: {} });
			}
			if (u.endsWith(`/v2/switch/${uid}/toggle`)) {
				return createMockResponse(toggleOk);
			}
			return createMockResponse({ success: false, error: `Unhandled fetch in test: ${u}` }, false, 404);
		});

		const script = fs.readFileSync(path.join(websiteRoot, 'script.js'), 'utf8');
		window.eval(script);
		window.setupEventListeners();

		window.sessionStorage.setItem(`vomesync_manage_key:${uid}`, accessKey);
		await window.loadSwitches();
		await window.openSwitchDetails(uid, false);

		if (typeof window.initHeroObserver === 'function') {
			window.initHeroObserver();
		}

		const navStatus = document.getElementById('navSwitchStatus');
		expect(navStatus.classList.contains('hidden')).toBe(false);
		expect(navStatus.textContent).toContain('Nav Switch');
		expect(navStatus.textContent).toContain('Authenticated');

		navStatus.dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true }));
		const toggleDialog = document.getElementById('toggleDialog');
		expect(toggleDialog.classList.contains('hidden')).toBe(false);
	});

	test('Add to HACS button opens the HACS dialog', async () => {
		const websiteRoot = path.resolve(__dirname, '../../../website');
		const html = fs.readFileSync(path.join(websiteRoot, 'index.html'), 'utf8');
		document.documentElement.innerHTML = html;

		window.setInterval = jest.fn();
		window.alert = jest.fn();

		const script = fs.readFileSync(path.join(websiteRoot, 'script.js'), 'utf8');
		window.eval(script);
		window.setupEventListeners();

		const hacsBtn = document.getElementById('hacsBtn');
		if (hacsBtn && typeof hacsBtn.click === 'function') {
			hacsBtn.click();
		} else if (typeof window.openHacsDialog === 'function') {
			window.openHacsDialog();
		}

		const hacsDialog = document.getElementById('hacsDialog');
		expect(hacsDialog.classList.contains('hidden')).toBe(false);
		expect(document.getElementById('hacsDialogRepo').value).toBe('https://github.com/Vortitron/VomeSync');
		expect(document.getElementById('hacsDialogOpenLink').getAttribute('href')).toContain('my.home-assistant.io/redirect/hacs_repository/');
	});

	test('manage-on-website deep link (#accessKey=...) loads the key and triggers autoscroll', async () => {
		// Arrange DOM
		const websiteRoot = path.resolve(__dirname, '../../../website');
		const html = fs.readFileSync(path.join(websiteRoot, 'index.html'), 'utf8');
		document.documentElement.innerHTML = html;

		// Prevent timers / UI popups from interfering with Jest
		window.setInterval = jest.fn();
		window.alert = jest.fn();
		window.requestAnimationFrame = (cb) => cb();

		const uid = 'vs_75bz1byjrbv0jfmxv8dq27rp2w';
		const accessKey = '896a0f98-fde4-409a-b81a-74cae381969b';

		// Start at the deep link with fragment
		window.history.pushState({}, '', `/switch/${uid}#accessKey=${accessKey}`);

		// Spy on history.replaceState (JSDOM doesn't reliably update window.location.hash)
		const originalReplaceState = window.history.replaceState.bind(window.history);
		window.history.replaceState = jest.fn((...args) => originalReplaceState(...args));

		const publicSwitchDetail = {
			success: true,
			data: {
				uid,
				name: 'Pretty Switch',
				description: 'Pretty description',
				location: 'Test City',
				category: 'Community',
				state: false,
				lastToggled: 0,
				toggleCount: 0,
				userCount: 0,
				link: '',
				iconUrl: '',
				bannerUrl: '',
				ownerProfileUrl: '',
				events: []
			}
		};

		global.fetch = jest.fn(async (url) => {
			const u = String(url);
			if (u.endsWith('/public-switches')) {
				return createMockResponse({ success: true, data: { switches: [], count: 0, timestamp: Date.now() } });
			}
			if (u.endsWith(`/switch/${uid}`)) {
				return createMockResponse(publicSwitchDetail);
			}
			if (u.endsWith('/billing')) {
				return createMockResponse({ success: true, data: { promoteEnabled: false, promoteDurationDays: 7 } });
			}
			if (u.endsWith('/categories')) {
				return createMockResponse({ success: true, data: {} });
			}
			if (u.endsWith(`/v2/switch/${uid}/metadata`)) {
				return createMockResponse({ success: false, error: 'No metadata updates provided' }, false, 400);
			}
			return createMockResponse({ success: false, error: `Unhandled fetch in test: ${u}` }, false, 404);
		});

		// Spy on scroll
		const managePanel = document.getElementById('managePanel');
		managePanel.scrollIntoView = jest.fn();

		// Load website script and run init manually (JSDOM won't re-fire DOMContentLoaded after eval)
		const script = fs.readFileSync(path.join(websiteRoot, 'script.js'), 'utf8');
		window.eval(script);
		window.init();
		await new Promise((resolve) => setTimeout(resolve, 0));
		await new Promise((resolve) => setTimeout(resolve, 0));

		// Assert: fragment is cleared (key should not remain in the URL)
		expect(window.history.replaceState).toHaveBeenCalled();
		const replaceCalls = window.history.replaceState.mock.calls;
		const lastReplace = replaceCalls[replaceCalls.length - 1] || [];
		const urlArg = String(lastReplace[2] || '');
		expect(urlArg).not.toContain('#accessKey=');

		// Assert: key stored for session
		const storedKey = window.sessionStorage.getItem(`vomesync_manage_key:${uid}`);
		expect(storedKey).toBe(accessKey);

		// Assert: autoscroll attempted
		expect(managePanel.scrollIntoView).toHaveBeenCalled();
	});

	test('redirected switch detail follows redirect and shows notice', async () => {
		const websiteRoot = path.resolve(__dirname, '../../../website');
		const html = fs.readFileSync(path.join(websiteRoot, 'index.html'), 'utf8');
		document.documentElement.innerHTML = html;

		window.setInterval = jest.fn();
		window.alert = jest.fn();

		const oldUid = 'vs_75bz1byjrbv0jfmxv8dq27rp2w';
		const newUid = 'vs_75bz1byjrbv0jfmxv8dq27rp2x';

		const redirectResponse = {
			success: true,
			data: {
				uid: oldUid,
				redirect: true,
				redirectTo: newUid,
				redirectReason: 'Compromised key'
			}
		};

		const newDetail = {
			success: true,
			data: {
				uid: newUid,
				name: 'New Switch',
				description: 'New description',
				location: 'Test City',
				category: 'Community',
				state: false,
				lastToggled: 0,
				toggleCount: 0,
				userCount: 0,
				link: '',
				iconUrl: '',
				bannerUrl: '',
				ownerProfileUrl: '',
				events: []
			}
		};

		global.fetch = jest.fn(async (url) => {
			const u = String(url);
			if (u.endsWith('/public-switches')) {
				return createMockResponse({ success: true, data: { switches: [], count: 0, timestamp: Date.now() } });
			}
			if (u.endsWith(`/switch/${oldUid}`)) {
				return createMockResponse(redirectResponse);
			}
			if (u.endsWith(`/switch/${newUid}`)) {
				return createMockResponse(newDetail);
			}
			if (u.endsWith('/billing')) {
				return createMockResponse({ success: true, data: { promoteEnabled: false, promoteDurationDays: 7 } });
			}
			if (u.endsWith('/categories')) {
				return createMockResponse({ success: true, data: {} });
			}
			return createMockResponse({ success: false, error: `Unhandled fetch in test: ${u}` }, false, 404);
		});

		const script = fs.readFileSync(path.join(websiteRoot, 'script.js'), 'utf8');
		window.eval(script);
		window.history.pushState({}, '', `/switch/${oldUid}`);
		window.init();
		await new Promise((resolve) => setTimeout(resolve, 0));
		await new Promise((resolve) => setTimeout(resolve, 0));
		await window.openSwitchDetails(oldUid, false);
		await new Promise((resolve) => setTimeout(resolve, 0));
		await window.openSwitchDetails(newUid, false, {
			allowRedirect: false,
			redirectFrom: oldUid,
			redirectReason: 'Compromised key'
		});

		const fetchCalls = global.fetch.mock.calls.map((call) => String(call[0]));
		expect(fetchCalls.some((url) => url.includes(`/switch/${oldUid}`))).toBe(true);
		const redirectText = document.getElementById('redirectNoticeText');
		expect(redirectText.textContent).toContain(newUid);
		expect(redirectText.textContent).toContain('Compromised key');
	});

	test('shows a Promoted badge on featured cards', async () => {
		const websiteRoot = path.resolve(__dirname, '../../../website');
		const html = fs.readFileSync(path.join(websiteRoot, 'index.html'), 'utf8');
		document.documentElement.innerHTML = html;
		window.setInterval = jest.fn();

		const uid = 'vs_promoted_card';
		global.fetch = jest.fn(async (url) => {
			const u = String(url);
			if (u.endsWith('/public-switches')) {
				return createMockResponse({
					success: true,
					data: {
						switches: [{
							uid,
							name: 'Featured Lamp',
							description: 'Paid placement',
							location: 'Test City',
							category: 'Community',
							state: true,
							lastToggled: 0,
							toggleCount: 0,
							userCount: 0,
							link: '',
							iconUrl: '',
							bannerUrl: '',
							ownerProfileUrl: '',
							promoted: true,
							promotedUntil: Date.now() + 86400000
						}],
						count: 1,
						timestamp: Date.now()
					}
				});
			}
			if (u.endsWith('/billing')) {
				return createMockResponse({ success: true, data: { promoteEnabled: false, promoteDurationDays: 7 } });
			}
			if (u.endsWith('/categories')) {
				return createMockResponse({ success: true, data: {} });
			}
			return createMockResponse({ success: false, error: `Unhandled fetch in test: ${u}` }, false, 404);
		});

		const script = fs.readFileSync(path.join(websiteRoot, 'script.js'), 'utf8');
		window.eval(script);
		window.setupEventListeners();
		await window.loadSwitches();

		const badge = document.querySelector('[data-field="promotedBadge"]');
		expect(badge).toBeTruthy();
		expect(badge.classList.contains('hidden')).toBe(false);
		expect(badge.textContent).toBe('Promoted');
	});

	test('owner can start Stripe Checkout from the manage panel', async () => {
		const websiteRoot = path.resolve(__dirname, '../../../website');
		const html = fs.readFileSync(path.join(websiteRoot, 'index.html'), 'utf8');
		document.documentElement.innerHTML = html;
		window.setInterval = jest.fn();
		window.alert = jest.fn();

		const uid = 'vs_promote_owner';
		const accessKey = '00000000-0000-4000-8000-333333333333';
		const checkoutUrl = 'https://checkout.stripe.com/c/pay/cs_test_dir';

		global.fetch = jest.fn(async (url) => {
			const u = String(url);
			if (u.endsWith('/public-switches')) {
				return createMockResponse({
					success: true,
					data: {
						switches: [{
							uid,
							name: 'Shop window',
							description: 'Owner listing',
							location: 'Test City',
							category: 'Community',
							state: false,
							lastToggled: 0,
							toggleCount: 0,
							userCount: 0,
							link: '',
							iconUrl: '',
							bannerUrl: '',
							ownerProfileUrl: '',
							promoted: false,
							promotedUntil: 0
						}],
						count: 1,
						timestamp: Date.now()
					}
				});
			}
			if (u.endsWith(`/switch/${uid}`)) {
				return createMockResponse({
					success: true,
					data: {
						uid,
						name: 'Shop window',
						description: 'Owner listing',
						location: 'Test City',
						category: 'Community',
						state: false,
						lastToggled: 0,
						toggleCount: 0,
						userCount: 0,
						link: '',
						iconUrl: '',
						bannerUrl: '',
						ownerProfileUrl: '',
						events: [],
						promoted: false,
						promotedUntil: 0
					}
				});
			}
			if (u.endsWith('/billing')) {
				return createMockResponse({
					success: true,
					data: { promoteEnabled: true, promoteDurationDays: 7 }
				});
			}
			if (u.endsWith('/categories')) {
				return createMockResponse({ success: true, data: {} });
			}
			if (u.endsWith(`/v2/switch/${uid}/promote`)) {
				return createMockResponse({
					success: true,
					data: { url: checkoutUrl, id: 'cs_test_dir', durationDays: 7, alreadyPromoted: false }
				});
			}
			return createMockResponse({ success: false, error: `Unhandled fetch in test: ${u}` }, false, 404);
		});

		const script = fs.readFileSync(path.join(websiteRoot, 'script.js'), 'utf8');
		window.eval(script);
		window.setupEventListeners();
		window.sessionStorage.setItem(`vomesync_manage_key:${uid}`, accessKey);
		await window.loadSwitches();
		await window.openSwitchDetails(uid, true);

		const panel = document.getElementById('promotePanel');
		expect(panel.classList.contains('hidden')).toBe(false);
		await window.startPromoteCheckout();

		const promoteCall = global.fetch.mock.calls.find((call) => String(call[0]).includes('/promote'));
		expect(promoteCall).toBeTruthy();
		expect(promoteCall[1].method).toBe('POST');
		expect(promoteCall[1].headers['X-Api-Key']).toBe(accessKey);
		expect(document.getElementById('promoteStatus').classList.contains('error')).toBe(false);
	});

	test('owner can start premium Checkout from the manage panel', async () => {
		const websiteRoot = path.resolve(__dirname, '../../../website');
		const html = fs.readFileSync(path.join(websiteRoot, 'index.html'), 'utf8');
		document.documentElement.innerHTML = html;
		window.setInterval = jest.fn();
		window.alert = jest.fn();

		const uid = 'vs_premium_owner';
		const accessKey = '00000000-0000-4000-8000-444444444444';
		const checkoutUrl = 'https://checkout.stripe.com/c/pay/cs_test_prem';

		global.fetch = jest.fn(async (url) => {
			const u = String(url);
			if (u.endsWith('/public-switches')) {
				return createMockResponse({
					success: true,
					data: {
						switches: [{
							uid,
							name: 'Shop window',
							description: 'Owner listing',
							location: 'Test City',
							category: 'Community',
							state: false,
							lastToggled: 0,
							toggleCount: 0,
							userCount: 0,
							link: '',
							iconUrl: '',
							bannerUrl: '',
							ownerProfileUrl: '',
							promoted: false,
							promotedUntil: 0
						}],
						count: 1,
						timestamp: Date.now()
					}
				});
			}
			if (u.endsWith(`/switch/${uid}`)) {
				return createMockResponse({
					success: true,
					data: {
						uid,
						name: 'Shop window',
						description: 'Owner listing',
						location: 'Test City',
						category: 'Community',
						state: false,
						lastToggled: 0,
						toggleCount: 0,
						userCount: 0,
						link: '',
						iconUrl: '',
						bannerUrl: '',
						ownerProfileUrl: '',
						events: [],
						promoted: false,
						promotedUntil: 0
					}
				});
			}
			if (u.endsWith('/billing')) {
				return createMockResponse({
					success: true,
					data: {
						promoteEnabled: false,
						premiumEnabled: true,
						premiumAmount: 900,
						premiumCurrency: 'eur',
						maxPrivate: 5,
						maxPublic: 10
					}
				});
			}
			if (u.endsWith('/categories')) {
				return createMockResponse({ success: true, data: {} });
			}
			if (u.endsWith(`/v2/switch/${uid}/premium`)) {
				return createMockResponse({
					success: true,
					data: { url: checkoutUrl, id: 'cs_test_prem' }
				});
			}
			return createMockResponse({ success: false, error: `Unhandled fetch in test: ${u}` }, false, 404);
		});

		const script = fs.readFileSync(path.join(websiteRoot, 'script.js'), 'utf8');
		window.eval(script);
		window.setupEventListeners();
		window.sessionStorage.setItem(`vomesync_manage_key:${uid}`, accessKey);
		await window.loadSwitches();
		await window.openSwitchDetails(uid, true);

		const panel = document.getElementById('premiumPanel');
		expect(panel.classList.contains('hidden')).toBe(false);
		await window.startPremiumCheckout();

		const premiumCall = global.fetch.mock.calls.find((call) => String(call[0]).includes('/premium'));
		expect(premiumCall).toBeTruthy();
		expect(premiumCall[1].method).toBe('POST');
		expect(premiumCall[1].headers['X-Api-Key']).toBe(accessKey);
		expect(document.getElementById('premiumStatus').classList.contains('error')).toBe(false);
	});

	test('owner can open Stripe Customer Portal from the manage panel', async () => {
		window.setInterval = jest.fn();
		window.alert = jest.fn();

		const websiteRoot = path.resolve(__dirname, '../../../website');
		const html = fs.readFileSync(path.join(websiteRoot, 'index.html'), 'utf8');
		document.documentElement.innerHTML = html;
		window.history.pushState({}, '', '/');

		const uid = 'vs_portal_owner';
		const accessKey = '00000000-0000-4000-8000-000000000001';
		const portalUrl = 'https://billing.stripe.com/p/session/bps_test';

		global.fetch = jest.fn(async (url) => {
			const u = String(url);
			if (u.endsWith('/public-switches')) {
				return createMockResponse({
					success: true,
					data: {
						switches: [{
							uid,
							name: 'Shop window',
							description: 'Owner listing',
							location: 'Test City',
							category: 'Community',
							state: false,
							lastToggled: 0,
							toggleCount: 0,
							userCount: 0,
							link: '',
							iconUrl: '',
							bannerUrl: '',
							ownerProfileUrl: '',
							events: [],
							promoted: false,
							promotedUntil: 0
						}],
						count: 1,
						timestamp: Date.now()
					}
				});
			}
			if (u.endsWith(`/switch/${uid}`)) {
				return createMockResponse({
					success: true,
					data: {
						uid,
						name: 'Shop window',
						description: 'Owner listing',
						location: 'Test City',
						category: 'Community',
						state: false,
						lastToggled: 0,
						toggleCount: 0,
						userCount: 0,
						link: '',
						iconUrl: '',
						bannerUrl: '',
						ownerProfileUrl: '',
						events: [],
						promoted: false,
						promotedUntil: 0
					}
				});
			}
			if (u.endsWith('/billing')) {
				return createMockResponse({
					success: true,
					data: {
						promoteEnabled: false,
						premiumEnabled: true,
						premiumAmount: 900,
						premiumCurrency: 'eur',
						maxPrivate: 5,
						maxPublic: 10,
						taxEnabled: true
					}
				});
			}
			if (u.endsWith('/categories')) {
				return createMockResponse({ success: true, data: {} });
			}
			if (u.endsWith(`/v2/switch/${uid}/billing-portal`)) {
				return createMockResponse({
					success: true,
					data: { url: portalUrl, id: 'bps_test' }
				});
			}
			return createMockResponse({ success: false, error: `Unhandled fetch in test: ${u}` }, false, 404);
		});

		const script = fs.readFileSync(path.join(websiteRoot, 'script.js'), 'utf8');
		window.eval(script);
		window.setupEventListeners();
		window.sessionStorage.setItem(`vomesync_manage_key:${uid}`, accessKey);
		await window.loadSwitches();
		await window.openSwitchDetails(uid, true);

		await window.startBillingPortal();

		const portalCall = global.fetch.mock.calls.find((call) => String(call[0]).includes('/billing-portal'));
		expect(portalCall).toBeTruthy();
		expect(portalCall[1].method).toBe('POST');
		expect(portalCall[1].headers['X-Api-Key']).toBe(accessKey);
		expect(document.getElementById('premiumStatus').classList.contains('error')).toBe(false);
	});
});



describe('Website switch extras (properties, notes, commerce, rewards)', () => {
	const websiteRoot = path.resolve(__dirname, '../../../website');
	const flush = async () => {
		for (let i = 0; i < 6; i += 1) {
			// eslint-disable-next-line no-await-in-loop
			await new Promise((resolve) => setTimeout(resolve, 0));
		}
	};

	function baseSwitch(uid, extra = {}) {
		return {
			uid,
			name: 'Window lamp',
			description: 'Shop window lamp',
			location: 'Test City',
			category: 'Community',
			state: false,
			lastToggled: 0,
			toggleCount: 0,
			userCount: 0,
			link: '',
			iconUrl: '',
			bannerUrl: '',
			ownerProfileUrl: '',
			...extra
		};
	}

	/**
	 * Loads the page with a mocked API. `routes` maps a URL suffix to a JSON
	 * body, or to a function (url, options) => { body, status }.
	 */
	async function loadSite({ uid, listExtra = {}, detailExtra = {}, routes = {}, manageKey = '', search = '' }) {
		const html = fs.readFileSync(path.join(websiteRoot, 'index.html'), 'utf8');
		document.documentElement.innerHTML = html;
		window.setInterval = jest.fn();
		window.alert = jest.fn();
		window.history.replaceState({}, '', `/switch/${uid}${search}`);

		global.fetch = jest.fn(async (url, options) => {
			const u = String(url);
			const suffix = Object.keys(routes).find((key) => u.endsWith(key));
			if (suffix) {
				const route = routes[suffix];
				if (typeof route === 'function') {
					const { body, status = 200 } = route(u, options);
					return createMockResponse(body, status >= 200 && status < 300, status);
				}
				return createMockResponse(route);
			}
			if (u.endsWith('/public-switches')) {
				return createMockResponse({ success: true, data: { switches: [baseSwitch(uid, listExtra)], count: 1, timestamp: Date.now() } });
			}
			if (u.endsWith(`/switch/${uid}`)) {
				return createMockResponse({ success: true, data: { ...baseSwitch(uid, detailExtra), events: detailExtra.events || [] } });
			}
			if (u.endsWith('/billing')) {
				return createMockResponse({ success: true, data: { promoteEnabled: false } });
			}
			if (u.endsWith('/categories')) {
				return createMockResponse({ success: true, data: {} });
			}
			return createMockResponse({ success: false, error: `Unhandled fetch in test: ${u}` }, false, 404);
		});

		const script = fs.readFileSync(path.join(websiteRoot, 'script.js'), 'utf8');
		window.eval(script);
		window.setupEventListeners();
		if (manageKey) {
			window.sessionStorage.setItem(`vomesync_manage_key:${uid}`, manageKey);
		}
		await window.loadSwitches();
		await window.openSwitchDetails(uid, true);
		await flush();
	}

	function callsTo(suffix) {
		return global.fetch.mock.calls.filter(([u]) => String(u).endsWith(suffix));
	}

	test('cards show Public / Paid / Tips / Reward badges', async () => {
		const uid = 'vs_extras_badges';
		await loadSite({
			uid,
			listExtra: {
				commerce: { toggleMode: 'paid', tips: true, canTakePayments: true, price: { amount: 100, currency: 'eur' } },
				reward: { amount: 200, currency: 'sek', on: 'on', windowSeconds: 900, maxPerDay: 5 }
			}
		});
		const card = document.querySelector(`.switch-card[data-uid="${uid}"]`);
		const badges = Array.from(card.querySelectorAll('.extras-badge')).map((b) => b.textContent);
		expect(badges).toEqual(['Paid', 'Tips', 'Reward']);

		// A live update re-renders the card and keeps the badges.
		window.handleStateUpdate(uid, true, Date.now());
		expect(card.querySelectorAll('.extras-badge')).toHaveLength(3);
		expect(window.renderExtrasBadgesHtml({ commerce: { toggleMode: 'public' } })).toContain('>Public<');
		expect(window.renderExtrasBadgesHtml({ commerce: { toggleMode: 'paid', tips: true, canTakePayments: false } })).not.toContain('Tips');
		expect(window.renderExtrasBadgesHtml({})).toBe('');
	});

	test('switch page shows escaped properties, last note with source, commerce panel and reward offer', async () => {
		const uid = 'vs_extras_page';
		const hostile = '<img src=x onerror="window.__pwned=1">';
		await loadSite({
			uid,
			detailExtra: {
				properties: { wattage: 40, colour: hostile, dimmable: true },
				note: `Now playing ${hostile}`,
				lastSource: 'public',
				commerce: {
					toggleMode: 'public',
					action: 'toggle',
					holdSeconds: 60,
					cooldownSeconds: 10,
					price: null,
					tips: false,
					allowMessage: true,
					note: 'Be nice',
					payLink: 'https://ko-fi.com/example',
					canTakePayments: false
				},
				reward: { amount: 200, currency: 'sek', on: 'on', windowSeconds: 900, maxPerDay: 5, note: 'Thanks' },
				events: [
					{ type: 'state', state: true, timestamp: Date.now(), source: 'paid', note: 'Paid by a visitor', amount: 100, currency: 'eur' },
					{ type: 'tip', timestamp: Date.now(), amount: 500, currency: 'eur', note: 'Lovely' }
				]
			}
		});

		const extras = document.getElementById('switchExtras');
		expect(extras.classList.contains('hidden')).toBe(false);

		const props = document.getElementById('detailProperties');
		expect(props.querySelectorAll('tr')).toHaveLength(3);
		expect(props.textContent).toContain('Wattage');
		expect(props.textContent).toContain('40');
		expect(props.textContent).toContain('yes');
		expect(props.textContent).toContain(hostile);
		expect(document.querySelector('#switchExtras img')).toBeNull();
		expect(window.__pwned).toBeUndefined();

		const note = document.getElementById('detailNote');
		expect(note.classList.contains('hidden')).toBe(false);
		expect(note.querySelector('.source-badge').textContent).toBe('Visitor');
		expect(note.textContent).toContain('Now playing');

		const panel = document.getElementById('commercePanel');
		expect(panel.classList.contains('hidden')).toBe(false);
		expect(document.getElementById('publicToggleBtn').textContent).toBe('Flip it');
		expect(document.getElementById('commerceMessage').getAttribute('maxlength')).toBe('140');
		expect(panel.textContent).toContain('It goes back after 60 s.');
		expect(panel.textContent).toContain('Be nice');
		expect(document.getElementById('paidToggleBtn')).toBeNull();
		expect(document.getElementById('tipBtn')).toBeNull();
		const payLink = document.getElementById('ownerPayLink');
		expect(payLink.getAttribute('href')).toBe('https://ko-fi.com/example');
		expect(payLink.getAttribute('rel')).toBe('noopener nofollow');
		expect(payLink.getAttribute('target')).toBe('_blank');
		expect(panel.textContent).toContain('Vome does not handle that payment');

		const reward = document.getElementById('rewardOffer');
		expect(reward.classList.contains('hidden')).toBe(false);
		expect(reward.textContent).toContain('each time you act on this switch from Home Assistant when it turns on');
		expect(reward.textContent).toContain('Claim rewards');
		expect(reward.textContent).toContain('15 min');
		expect(reward.textContent).toContain(window.formatMoney(200, 'sek'));

		const timeline = document.getElementById('detailEvents');
		expect(timeline.textContent).toContain('Paid by a visitor');
		expect(timeline.querySelector('.source-paid')).toBeTruthy();
		expect(timeline.textContent).toContain('Tip');
		expect(timeline.textContent).toContain('Lovely');
	});

	test('javascript: pay links are never rendered', async () => {
		const uid = 'vs_extras_badlink';
		await loadSite({
			uid,
			detailExtra: { commerce: { toggleMode: 'owner', payLink: 'javascript:alert(1)', note: 'Hi' } }
		});
		expect(document.getElementById('ownerPayLink')).toBeNull();
		expect(document.getElementById('commercePanel').textContent).toContain('Hi');
	});

	test('live state_update updates the note; a snapshot without source leaves it alone', async () => {
		const uid = 'vs_extras_live';
		await loadSite({ uid, detailExtra: { note: 'Old note', lastSource: 'owner' } });
		const note = document.getElementById('detailNote');
		expect(note.textContent).toContain('Old note');

		window.handleStateUpdate(uid, true, Date.now(), { type: 'state_update', uid, state: true });
		expect(note.textContent).toContain('Old note');

		window.handleStateUpdate(uid, false, Date.now(), { type: 'state_update', uid, state: false, note: 'Now playing: Abba', source: 'paid', paid: { amount: 100, currency: 'eur' } });
		expect(note.textContent).toContain('Now playing: Abba');
		expect(note.querySelector('.source-badge').textContent).toBe('Paid');
		expect(note.textContent).toContain(window.formatMoney(100, 'eur'));

		window.handleStateUpdate(uid, true, Date.now(), { type: 'state_update', uid, state: true, source: 'auto' });
		expect(note.textContent).not.toContain('Abba');
		expect(note.querySelector('.source-badge').textContent).toBe('Auto');
	});

	test('Flip it posts to public-toggle with the message and shows the cooldown on 429', async () => {
		const uid = 'vs_extras_flip';
		let calls = 0;
		await loadSite({
			uid,
			detailExtra: { commerce: { toggleMode: 'public', action: 'on', holdSeconds: 0, cooldownSeconds: 10, allowMessage: true } },
			routes: {
				[`/v2/switch/${uid}/public-toggle`]: () => {
					calls += 1;
					if (calls === 1) return { body: { success: true, data: { uid, state: true, timestamp: Date.now(), note: 'Hello there' } } };
					return { status: 429, body: { success: false, error: 'Too soon', retryAfterMs: 7000 } };
				}
			}
		});

		const btn = document.getElementById('publicToggleBtn');
		expect(btn.textContent).toBe('Turn it on');

		document.getElementById('commerceMessage').value = 'see www.example.com';
		await window.publicToggleCurrentSwitch();
		expect(callsTo(`/v2/switch/${uid}/public-toggle`)).toHaveLength(0);
		expect(document.getElementById('commerceStatus').textContent).toContain('links');

		document.getElementById('commerceMessage').value = 'Hello there';
		await window.publicToggleCurrentSwitch();
		const [, opts] = callsTo(`/v2/switch/${uid}/public-toggle`)[0];
		expect(opts.method).toBe('POST');
		expect(opts.headers['X-Api-Key']).toBeUndefined();
		expect(JSON.parse(opts.body)).toEqual({ message: 'Hello there' });
		expect(document.getElementById('detailNote').textContent).toContain('Hello there');
		expect(btn.disabled).toBe(true);
		expect(btn.textContent).toMatch(/^Wait \d+ s$/);

		// Past the local cooldown, the server says 429 with retryAfterMs.
		const later = Date.now() + 60000;
		const nowSpy = jest.spyOn(Date, 'now').mockReturnValue(later);
		try {
			await window.publicToggleCurrentSwitch();
			expect(callsTo(`/v2/switch/${uid}/public-toggle`)).toHaveLength(2);
			expect(document.getElementById('commerceStatus').className).toContain('error');
			expect(document.getElementById('commerceStatus').textContent).toContain('7 s');
			expect(btn.disabled).toBe(true);
			expect(btn.textContent).toBe('Wait 7 s');
		} finally {
			nowSpy.mockRestore();
		}
	});

	test('Pay to switch and Tip start Stripe Checkout; ?paid=success shows a thank-you', async () => {
		const uid = 'vs_extras_pay';
		await loadSite({
			uid,
			search: '?paid=success',
			detailExtra: {
				commerce: {
					toggleMode: 'paid',
					action: 'toggle',
					holdSeconds: 120,
					cooldownSeconds: 10,
					price: { amount: 1500, currency: 'sek' },
					tips: true,
					allowMessage: false,
					note: '',
					payLink: '',
					canTakePayments: true
				}
			},
			routes: {
				[`/v2/switch/${uid}/pay`]: { success: true, data: { url: 'https://checkout.stripe.com/c/pay/cs_test_x', id: 'cs_test_x' } }
			}
		});
		window.eval('consumePaidQuery()');
		const notice = document.getElementById('siteNotice');
		expect(notice.classList.contains('hidden')).toBe(false);
		expect(notice.textContent).toContain('Thank you');
		expect(window.location.search).toBe('');

		const payBtn = document.getElementById('paidToggleBtn');
		expect(payBtn.textContent).toBe(`Pay ${window.formatMoney(1500, 'sek')} to switch`);
		expect(document.getElementById('commercePanel').textContent).toContain('It goes back after 2 min.');
		expect(document.getElementById('commerceMessage')).toBeNull();

		await window.startVisitorCheckout('switch');
		let [, opts] = callsTo(`/v2/switch/${uid}/pay`)[0];
		expect(JSON.parse(opts.body)).toEqual({ kind: 'switch' });

		// SEK floor is 10 kr.
		document.getElementById('tipAmount').value = '5';
		await window.startVisitorCheckout('tip');
		expect(callsTo(`/v2/switch/${uid}/pay`)).toHaveLength(1);
		expect(document.getElementById('commerceStatus').className).toContain('error');

		document.getElementById('tipAmount').value = '25,50';
		await window.startVisitorCheckout('tip');
		[, opts] = callsTo(`/v2/switch/${uid}/pay`)[1];
		expect(JSON.parse(opts.body)).toEqual({ kind: 'tip', amount: 2550 });
	});

	test('paid mode without payouts says so and offers no pay button', async () => {
		const uid = 'vs_extras_nopay';
		await loadSite({
			uid,
			detailExtra: { commerce: { toggleMode: 'paid', price: { amount: 100, currency: 'eur' }, tips: true, canTakePayments: false } }
		});
		expect(document.getElementById('paidToggleBtn')).toBeNull();
		expect(document.getElementById('tipBtn')).toBeNull();
		expect(document.getElementById('commercePanel').textContent).toContain('cannot take payments yet');
	});

	test('owner tools: properties, commerce (webhook secret once), reward, payouts and claims', async () => {
		const uid = 'vs_extras_manage';
		const accessKey = '00000000-0000-4000-8000-555555555555';
		const claimantA = 'ownerAAAAAAAAAAAAAAAAAAAAAAAA';
		const claimantB = 'ownerBBBBBBBBBBBBBBBBBBBBBBBB';
		let claims = [
			{ id: 'c1', claimant: claimantA, changeAt: Date.now() - 1000, claimedAt: Date.now(), entities: 2, amount: 200, currency: 'sek', status: 'owed' },
			{ id: 'c2', claimant: claimantA, changeAt: Date.now() - 2000, claimedAt: Date.now(), entities: 1, amount: 200, currency: 'sek', status: 'owed' },
			{ id: 'c3', claimant: claimantB, changeAt: Date.now() - 3000, claimedAt: Date.now(), entities: 1, amount: 200, currency: 'sek', status: 'paid' }
		];
		const metadataBodies = [];
		await loadSite({
			uid,
			manageKey: accessKey,
			detailExtra: {
				properties: { wattage: 40 },
				commerce: { toggleMode: 'public', action: 'toggle', holdSeconds: 30, cooldownSeconds: 10, tips: false, allowMessage: false, note: 'Hi', payLink: '', canTakePayments: false },
				reward: { amount: 200, currency: 'sek', on: 'on', windowSeconds: 900, maxPerDay: 5, note: '' }
			},
			routes: {
				[`/v2/switch/${uid}/metadata`]: (u, options) => {
					const body = JSON.parse(options.body);
					metadataBodies.push(body);
					if (body.commerce) {
						return { body: { success: true, data: { uid, commerce: { ...body.commerce }, webhookSecret: 'whsec_once_123' } } };
					}
					return { body: { success: true, data: { uid, ...body } } };
				},
				[`/v2/switch/${uid}/connect/status`]: { success: true, data: { connected: true, ready: false, requirementsDue: ['individual.verification.document'], dashboardUrl: 'https://connect.stripe.com/express/x' } },
				[`/v2/switch/${uid}/connect`]: { success: true, data: { url: 'https://connect.stripe.com/setup/x' } },
				[`/v2/switch/${uid}/reward-claims/list`]: () => ({ body: { success: true, data: { claims } } }),
				[`/v2/switch/${uid}/reward-claims/mark-paid`]: (u, options) => {
					const { ids } = JSON.parse(options.body);
					claims = claims.map((c) => (ids.includes(c.id) ? { ...c, status: 'paid' } : c));
					return { body: { success: true, data: { updated: ids.length } } };
				}
			}
		});

		expect(document.getElementById('managePanel').classList.contains('hidden')).toBe(false);

		// Properties: prefilled, edited, saved as a full replacement with the key header.
		const rows = document.querySelectorAll('#managePropsRows .prop-row');
		expect(rows).toHaveLength(1);
		expect(rows[0].querySelector('.prop-key').value).toBe('wattage');
		document.getElementById('managePropsAdd').click();
		const newRow = document.querySelectorAll('#managePropsRows .prop-row')[1];
		newRow.querySelector('.prop-key').value = 'Radio Station';
		newRow.querySelector('.prop-value').value = 'P3';
		await window.submitManageProperties();
		let [, opts] = callsTo(`/v2/switch/${uid}/metadata`).slice(-1)[0];
		expect(opts.headers['X-Api-Key']).toBe(accessKey);
		expect(JSON.parse(opts.body)).toEqual({ properties: { wattage: 40, radio_station: 'P3' }, propertiesReplace: true });
		expect(document.getElementById('managePropsStatus').textContent).toBe('Saved.');

		// Bad key is refused locally.
		document.querySelectorAll('#managePropsRows .prop-row')[0].querySelector('.prop-key').value = '9lives';
		const before = callsTo(`/v2/switch/${uid}/metadata`).length;
		await window.submitManageProperties();
		expect(callsTo(`/v2/switch/${uid}/metadata`)).toHaveLength(before);
		expect(document.getElementById('managePropsStatus').className).toContain('error');

		// Commerce: prefilled from the summary; paid without price is refused.
		expect(document.getElementById('commerceToggleMode').value).toBe('public');
		expect(document.getElementById('commerceHoldSeconds').value).toBe('30');
		document.getElementById('commerceToggleMode').value = 'paid';
		await window.submitManageCommerce();
		expect(document.getElementById('manageCommerceStatus').textContent).toContain('needs a price');

		document.getElementById('commercePriceAmount').value = '2.50';
		document.getElementById('commercePriceCurrency').value = 'eur';
		document.getElementById('commerceTips').checked = true;
		document.getElementById('commerceWebhookUrl').value = 'https://example.com/hook';
		await window.submitManageCommerce();
		[, opts] = callsTo(`/v2/switch/${uid}/metadata`).slice(-1)[0];
		const sent = JSON.parse(opts.body);
		expect(sent.commerce).toMatchObject({
			toggleMode: 'paid',
			action: 'toggle',
			holdSeconds: 30,
			cooldownSeconds: 10,
			price: { amount: 250, currency: 'eur' },
			tips: true,
			allowMessage: false,
			note: 'Hi',
			payLink: '',
			webhookUrl: 'https://example.com/hook'
		});
		expect(sent.rotateWebhookSecret).toBeUndefined();
		const secretBox = document.getElementById('webhookSecretBox');
		expect(secretBox.classList.contains('hidden')).toBe(false);
		expect(document.getElementById('webhookSecretValue').textContent).toBe('whsec_once_123');
		expect(secretBox.textContent).toContain('you will not see it again');

		// Saving again without touching the webhook does not resend it, and hides the old secret.
		await window.submitManageCommerce();
		[, opts] = callsTo(`/v2/switch/${uid}/metadata`).slice(-1)[0];
		expect(JSON.parse(opts.body).commerce.webhookUrl).toBeUndefined();

		// Reward: prefilled; remove sends null.
		expect(document.getElementById('rewardAmount').value).toBe('2.00');
		expect(document.getElementById('rewardWindowMinutes').value).toBe('15');
		expect(document.getElementById('rewardRemoveBtn').classList.contains('hidden')).toBe(false);
		document.getElementById('rewardRemoveBtn').click();
		await flush();
		expect(metadataBodies.slice(-1)[0]).toEqual({ reward: null });
		expect(document.getElementById('rewardRemoveBtn').classList.contains('hidden')).toBe(true);

		document.getElementById('rewardAmount').value = '3';
		document.getElementById('rewardOn').value = 'any';
		await window.submitManageReward();
		expect(metadataBodies.slice(-1)[0]).toEqual({ reward: { amount: 300, currency: 'sek', on: 'any', windowSeconds: 900, maxPerDay: 5, note: '' } });

		// Payouts status loaded on open.
		expect(callsTo(`/v2/switch/${uid}/connect/status`).length).toBeGreaterThanOrEqual(1);
		expect(document.getElementById('connectStatusText').textContent).toContain('still needs');
		expect(document.getElementById('connectStartBtn').textContent).toBe('Continue Stripe setup');
		expect(document.getElementById('connectRequirements').textContent).toContain('individual verification document');
		expect(document.getElementById('connectDashboardLink').classList.contains('hidden')).toBe(false);

		// Reward claims: totals per claimant (owed only), then mark paid.
		const totals = document.getElementById('rewardTotals');
		const totalRows = totals.querySelectorAll('tbody tr');
		expect(totalRows).toHaveLength(1);
		expect(totalRows[0].textContent).toContain(window.formatMoney(400, 'sek'));
		expect(totalRows[0].textContent).toContain('2');
		expect(document.querySelectorAll('#rewardClaims tbody tr')).toHaveLength(3);
		expect(document.querySelectorAll('#rewardClaims .reward-claim-select')).toHaveLength(2);

		const markSelected = document.getElementById('rewardClaimsMarkSelected');
		expect(markSelected.disabled).toBe(true);
		const firstBox = document.querySelector('#rewardClaims .reward-claim-select');
		firstBox.checked = true;
		firstBox.dispatchEvent(new window.Event('change', { bubbles: true }));
		expect(markSelected.disabled).toBe(false);

		totals.querySelector('.reward-mark-claimant').click();
		await flush();
		const markCall = callsTo(`/v2/switch/${uid}/reward-claims/mark-paid`)[0];
		expect(JSON.parse(markCall[1].body)).toEqual({ ids: ['c1', 'c2'] });
		expect(markCall[1].headers['X-Api-Key']).toBe(accessKey);
		expect(document.getElementById('rewardTotals').textContent).toContain('Nothing owed');
	});

	test('?connect=return re-checks payout status for the owner', async () => {
		const uid = 'vs_extras_connect';
		const accessKey = '00000000-0000-4000-8000-666666666666';
		await loadSite({
			uid,
			manageKey: accessKey,
			search: '?connect=return',
			routes: {
				[`/v2/switch/${uid}/connect/status`]: { success: true, data: { connected: true, ready: true, requirementsDue: [] } },
				[`/v2/switch/${uid}/reward-claims/list`]: { success: true, data: { claims: [] } }
			}
		});
		window.eval('consumeConnectQuery()');
		await flush();
		expect(document.getElementById('siteNotice').textContent).toContain('Payouts are set up');
		expect(document.getElementById('connectStatusText').textContent).toContain('You can take payments');
		expect(window.location.search).toBe('');
	});

	test('formatMoney uses minor units and the currency', () => {
		const html = fs.readFileSync(path.join(websiteRoot, 'index.html'), 'utf8');
		document.documentElement.innerHTML = html;
		const script = fs.readFileSync(path.join(websiteRoot, 'script.js'), 'utf8');
		window.eval(script);
		const expected = new Intl.NumberFormat(navigator.language, { style: 'currency', currency: 'SEK' }).format(2);
		expect(window.formatMoney(200, 'sek')).toBe(expected);
		expect(window.formatMoney(150, 'eur')).toContain('1.50');
	});

	test('script and stylesheet cache-busting versions were bumped', () => {
		const html = fs.readFileSync(path.join(websiteRoot, 'index.html'), 'utf8');
		expect(html).toContain('/script.js?v=20261029-1');
		expect(html).toContain('/styles.css?v=20261029-1');
	});
});

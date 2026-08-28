/**
 * Navbar wait sweep.
 *
 * Slow navigations and in-flight fetches after a click used to look like
 * nothing had happened.  The fat bit on ``[data-vome-bloom]`` sweeps
 * along the stripe until the next page is shown or the gesture-triggered
 * request finishes.
 *
 * Directory polling does not sweep: only ``fetch()`` that starts in
 * the same turn as a click / submit counts.  Opt out with
 * ``data-vome-no-wait`` on the link, button or form.
 */
(function () {
	'use strict';

	var WAITING = 'vome-bloom--waiting';
	var GESTURE_TAIL_MS = 100;
	var SAFETY_MS = 120000;
	var nav = document.querySelector('[data-vome-bloom]');
	if (!nav) return;

	var depth = 0;
	var gesturePending = false;
	var gestureClear = 0;
	var safetyTimer = 0;

	function closest(el, selector) {
		if (!el) return null;
		if (el.nodeType === 3) el = el.parentElement;
		if (!el || !el.closest) return null;
		return el.closest(selector);
	}

	function markGesture() {
		gesturePending = true;
		if (gestureClear) clearTimeout(gestureClear);
		gestureClear = setTimeout(function () {
			gesturePending = false;
			gestureClear = 0;
		}, GESTURE_TAIL_MS);
	}

	function start() {
		depth += 1;
		nav.classList.add(WAITING);
		nav.setAttribute('aria-busy', 'true');
		if (safetyTimer) clearTimeout(safetyTimer);
		safetyTimer = setTimeout(reset, SAFETY_MS);
	}

	function stop() {
		depth = Math.max(0, depth - 1);
		if (depth) return;
		nav.classList.remove(WAITING);
		nav.removeAttribute('aria-busy');
		if (safetyTimer) {
			clearTimeout(safetyTimer);
			safetyTimer = 0;
		}
	}

	function reset() {
		depth = 0;
		nav.classList.remove(WAITING);
		nav.removeAttribute('aria-busy');
		if (safetyTimer) {
			clearTimeout(safetyTimer);
			safetyTimer = 0;
		}
	}

	function willNavigate(anchor, event) {
		if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) {
			return false;
		}
		if (typeof event.button === 'number' && event.button !== 0) return false;
		if (anchor.target && anchor.target !== '_self') return false;
		if (anchor.hasAttribute('download')) return false;
		var href = anchor.getAttribute('href');
		if (!href || href.indexOf('javascript:') === 0) return false;
		if (href.charAt(0) === '#') return false;
		var url;
		try {
			url = new URL(anchor.href, window.location.href);
		} catch (err) {
			return false;
		}
		if (url.origin !== window.location.origin) return false;
		if (
			url.pathname === window.location.pathname &&
			url.search === window.location.search &&
			url.hash
		) {
			return false;
		}
		return true;
	}

	function optedOut(el) {
		return Boolean(closest(el, '[data-vome-no-wait]'));
	}

	function stopIfPrevented(event) {
		queueMicrotask(function () {
			if (event.defaultPrevented) stop();
		});
	}

	document.addEventListener('click', function (event) {
		if (optedOut(event.target)) return;
		if (closest(event.target, '[data-vome-nav-toggle], .vome-nav-toggle, .nav-burger')) {
			return;
		}
		if (closest(event.target, '[data-bs-dismiss], [data-bs-toggle]')) {
			return;
		}
		var anchor = closest(event.target, 'a[href]');
		if (anchor && willNavigate(anchor, event)) {
			markGesture();
			start();
			stopIfPrevented(event);
			return;
		}
		if (closest(event.target, 'button, input[type="submit"], input[type="button"], input[type="image"]')) {
			markGesture();
		}
	}, true);

	document.addEventListener('submit', function (event) {
		var form = event.target;
		if (!(form instanceof HTMLFormElement)) return;
		if (optedOut(form)) return;
		markGesture();
		if (form.getAttribute('data-ajax') === 'true') return;
		start();
		stopIfPrevented(event);
	}, true);

	var innerFetch = window.fetch;
	window.fetch = function () {
		var fromGesture = gesturePending;
		if (fromGesture) start();
		var result = innerFetch.apply(this, arguments);
		if (fromGesture && result && typeof result.finally === 'function') {
			return result.finally(function () {
				stop();
			});
		}
		return result;
	};

	window.addEventListener('pageshow', reset);
	document.addEventListener('vome:wait-start', start);
	document.addEventListener('vome:wait-stop', stop);
})();

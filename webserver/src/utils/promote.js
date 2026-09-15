/**
 * Paid directory promotion. Owner pays Vome (Stripe Checkout); we pin the
 * listing to the top until promotedUntil. Not a marketplace — we are the merchant.
 */
const MS_PER_DAY = 24 * 60 * 60 * 1000;

function promotedUntilMs(switchData) {
	return Number(switchData && switchData.promotedUntil) || 0;
}

function isPromoted(switchData, now = new Date()) {
	return promotedUntilMs(switchData) > now.getTime();
}

function listingPromotion(switchData, now = new Date()) {
	const until = promotedUntilMs(switchData);
	const promoted = until > now.getTime();
	return {
		promoted,
		promotedUntil: promoted ? until : 0
	};
}

function promotionBlockReason(switchData) {
	if (!switchData) {
		return 'Switch not found';
	}
	if (switchData.authVersion !== 2) {
		return 'Only v2 switches can be promoted';
	}
	if (!switchData.publicize) {
		return 'Switch must be public to be promoted';
	}
	if (!String(switchData.name || '').trim()) {
		return 'Switch needs a name';
	}
	if (switchData.category === 'Test') {
		return 'Test listings cannot be promoted';
	}
	if (String(switchData.description || '').trim() === 'Public Test Switch') {
		return 'Test listings cannot be promoted';
	}
	return null;
}

function sortPublicSwitches(switches, now = new Date()) {
	const promoted = [];
	const rest = [];
	for (const item of switches) {
		if (isPromoted(item, now)) {
			promoted.push(item);
		} else {
			rest.push(item);
		}
	}
	return [...promoted, ...rest];
}

function nextPromotedUntil(existingUntil, durationDays, now = new Date()) {
	const days = Number(durationDays);
	if (!Number.isFinite(days) || days <= 0) {
		throw new Error('promotion duration must be a positive number of days');
	}
	const base = Math.max(now.getTime(), Number(existingUntil) || 0);
	return base + days * MS_PER_DAY;
}

module.exports = {
	MS_PER_DAY,
	promotedUntilMs,
	isPromoted,
	listingPromotion,
	promotionBlockReason,
	sortPublicSwitches,
	nextPromotedUntil
};

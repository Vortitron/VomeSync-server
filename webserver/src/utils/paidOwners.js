/**
 * Who may take money through Vome for paid switching and tips.
 *
 * Destination charges make Vome liable for disputes, chargeback fees and
 * card testing on every owner's switch, so this is invite-only: the
 * catalogue owner (Vome itself sells), plus the owner ids listed in
 * STRIPE_PAID_SWITCHING_OWNERS ('*' opens it to everyone, as on dev).
 */
const config = require('../config/config');

function isPaidSwitchingAllowed(ownerId) {
	const id = String(ownerId || '').trim().toLowerCase();
	if (!id) {
		return false;
	}
	const catalogueOwner = String((config.limits && config.limits.catalogueOwnerId) || '').toLowerCase();
	if (catalogueOwner && id === catalogueOwner) {
		return true;
	}
	const allowed = (config.stripe && config.stripe.paidSwitchingOwners) || [];
	return allowed.includes('*') || allowed.includes(id);
}

const INVITE_ONLY_MESSAGE = 'Taking payments through Vome is invite-only for now. Your own payment link works without it; ask Vome if you want card payments.';

module.exports = { isPaidSwitchingAllowed, INVITE_ONLY_MESSAGE };

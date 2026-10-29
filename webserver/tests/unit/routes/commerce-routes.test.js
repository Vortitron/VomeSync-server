const request = require('supertest');
const express = require('express');
const redisClient = require('../../../src/utils/redis');
const config = require('../../../src/config/config');
const { setStripeForTests } = require('../../../src/utils/stripe');
const switchActions = require('../../../src/utils/switchActions');
const commerceRoutes = require('../../../src/routes/commerce-routes');
const {
	stableJsonStringify,
	deriveOwnerIdFromOwnerPubKeyB64Url,
	deriveSwitchUidFromSwitchPubKeyB64Url
} = require('../../../src/utils/crypto_v2');

let nonceSeq = 0;
const nextNonce = () => `nonce-${Date.now()}-${nonceSeq += 1}`;

function makeOwner() {
	const keys = global.testUtils.createEd25519Keypair();
	const ownerPubKey = Buffer.from(keys.rawPublicKey).toString('base64url');
	return {
		...keys,
		ownerPubKey,
		ownerId: deriveOwnerIdFromOwnerPubKeyB64Url(ownerPubKey)
	};
}

/** Sign { v:2, action, ownerPubKey, ts, nonce, ...extra } and return the body. */
function signed(owner, action, extra = {}, bodyExtra = {}) {
	const ts = Date.now();
	const nonce = nextNonce();
	const canonical = stableJsonStringify({ v: 2, action, ownerPubKey: owner.ownerPubKey, ts, nonce, ...extra });
	return {
		ownerPubKey: owner.ownerPubKey,
		ts,
		nonce,
		sigOwner: global.testUtils.ed25519SignBase64Url(owner.privateKey, canonical),
		...extra,
		...bodyExtra
	};
}

let uidSeq = 0;
async function makeSwitch(owner, { publicize = true, commerce = null, reward = null } = {}) {
	uidSeq += 1;
	const sw = global.testUtils.createEd25519Keypair();
	const switchPubKey = Buffer.from(sw.rawPublicKey).toString('base64url');
	const uid = deriveSwitchUidFromSwitchPubKeyB64Url(switchPubKey);
	await redisClient.createSwitchV2(uid, owner.ownerId, owner.ownerPubKey, switchPubKey, 0, {
		name: `Lamp ${uidSeq}`,
		publicize
	});
	const updates = {};
	if (commerce) {
		updates.commerce = commerce;
	}
	if (reward) {
		updates.reward = reward;
	}
	if (Object.keys(updates).length > 0) {
		await redisClient.updateSwitch(uid, updates);
	}
	return uid;
}

function fakeStripe() {
	const fake = {
		checkout: {
			sessions: {
				create: jest.fn().mockResolvedValue({ id: 'cs_test_1', url: 'https://checkout.stripe.com/c/pay/cs_test_1' })
			}
		},
		v2: {
			core: {
				accounts: {
					create: jest.fn().mockResolvedValue({ id: 'acct_owner' }),
					retrieve: jest.fn().mockResolvedValue({
						id: 'acct_owner',
						configuration: {
							merchant: { capabilities: { card_payments: { status: 'active' } } },
							recipient: { capabilities: { stripe_balance: { stripe_transfers: { status: 'active' } } } }
						},
						requirements: { entries: [] }
					})
				},
				accountLinks: {
					create: jest.fn().mockResolvedValue({ url: 'https://connect.stripe.com/setup/e/acct_owner/x' })
				}
			}
		},
		accounts: {
			createLoginLink: jest.fn().mockResolvedValue({ url: 'https://connect.stripe.com/express/login/x' })
		}
	};
	setStripeForTests(fake);
	return fake;
}

async function makeReadyOwner(owner) {
	await redisClient.client.hSet(`owner_connect:${owner.ownerId}`, {
		accountId: 'acct_owner',
		createdAt: `${Date.now()}`,
		ready: 'true',
		checkedAt: `${Date.now()}`,
		requirementsDue: '0'
	});
}

const PAID = { toggleMode: 'paid', action: 'toggle', holdSeconds: 0, price: { amount: 1000, currency: 'sek' }, tips: true, allowMessage: true };
const REWARD = { amount: 200, currency: 'sek', on: 'on', windowSeconds: 900, maxPerDay: 2, note: 'Thanks' };

describe('commerce routes', () => {
	let app;
	let stripe;
	const savedStripe = { ...config.stripe };
	const savedCatalogue = config.limits.catalogueOwnerId;

	beforeAll(async () => {
		app = express();
		app.use(express.json());
		app.use('/api', commerceRoutes);
		await redisClient.connect();
	});

	afterAll(async () => {
		if (redisClient.isConnected) {
			await redisClient.disconnect();
		}
	});

	beforeEach(async () => {
		await redisClient.client.flushDb();
		config.stripe.secretKey = 'sk_test_fake';
		config.stripe.webhookSecret = 'whsec_fake';
		stripe = fakeStripe();
		jest.spyOn(switchActions, 'dispatchOwnerWebhook').mockResolvedValue(true);
	});

	afterEach(() => {
		Object.assign(config.stripe, savedStripe);
		config.limits.catalogueOwnerId = savedCatalogue;
		setStripeForTests(null);
		jest.restoreAllMocks();
	});

	describe('POST /v2/switch/:uid/pay', () => {
		test('paying to switch through a ready owner starts a destination-charge Checkout', async () => {
			const owner = makeOwner();
			await makeReadyOwner(owner);
			const uid = await makeSwitch(owner, { commerce: PAID });
			const res = await request(app).post(`/api/v2/switch/${uid}/pay`)
				.send({ kind: 'switch', message: '  God jul  ' })
				.expect(200);
			expect(res.body.data).toEqual({ url: 'https://checkout.stripe.com/c/pay/cs_test_1', id: 'cs_test_1' });
			const params = stripe.checkout.sessions.create.mock.calls[0][0];
			expect(params.line_items[0].price_data).toMatchObject({ currency: 'sek', unit_amount: 1000 });
			expect(params.payment_intent_data).toMatchObject({
				on_behalf_of: 'acct_owner',
				transfer_data: { destination: 'acct_owner' },
				application_fee_amount: 130
			});
			expect(params.metadata).toMatchObject({ kind: 'vomesync_paid_switch', uid, ownerId: owner.ownerId, message: 'God jul' });
		});

		test('tips take the visitor amount within the currency limits', async () => {
			const owner = makeOwner();
			await makeReadyOwner(owner);
			const uid = await makeSwitch(owner, { commerce: PAID });
			await request(app).post(`/api/v2/switch/${uid}/pay`).send({ kind: 'tip', amount: 500 }).expect(400);
			await request(app).post(`/api/v2/switch/${uid}/pay`).send({ kind: 'tip' }).expect(400);
			await request(app).post(`/api/v2/switch/${uid}/pay`).send({ kind: 'tip', amount: 2500 }).expect(200);
			const params = stripe.checkout.sessions.create.mock.calls[0][0];
			expect(params.metadata).toMatchObject({ kind: 'vomesync_tip', amount: '2500', currency: 'sek' });
		});

		test('refuses switches that are private, owner-mode, tipless or whose owner cannot take money', async () => {
			const owner = makeOwner();
			const privateUid = await makeSwitch(owner, { publicize: false, commerce: PAID });
			await request(app).post(`/api/v2/switch/${privateUid}/pay`).send({ kind: 'switch' }).expect(404);

			const ownerMode = await makeSwitch(owner, { commerce: { toggleMode: 'owner', tips: false } });
			await request(app).post(`/api/v2/switch/${ownerMode}/pay`).send({ kind: 'switch' }).expect(409);
			await request(app).post(`/api/v2/switch/${ownerMode}/pay`).send({ kind: 'tip', amount: 2000 }).expect(409);

			const notReady = await makeSwitch(owner, { commerce: PAID });
			const res = await request(app).post(`/api/v2/switch/${notReady}/pay`).send({ kind: 'switch' }).expect(409);
			expect(res.body.error).toBe('Owner cannot take payments yet');

			await redisClient.blockOwnerId(owner.ownerId);
			await makeReadyOwner(owner);
			await request(app).post(`/api/v2/switch/${notReady}/pay`).send({ kind: 'switch' }).expect(404);
			expect(stripe.checkout.sessions.create).not.toHaveBeenCalled();
		});

		test('messages only when the owner allows them, and never links', async () => {
			const owner = makeOwner();
			await makeReadyOwner(owner);
			const quiet = await makeSwitch(owner, { commerce: { ...PAID, allowMessage: false } });
			await request(app).post(`/api/v2/switch/${quiet}/pay`).send({ kind: 'switch', message: 'hello' }).expect(200);
			expect(stripe.checkout.sessions.create.mock.calls[0][0].metadata.message).toBe('');

			const chatty = await makeSwitch(owner, { commerce: PAID });
			await request(app).post(`/api/v2/switch/${chatty}/pay`)
				.send({ kind: 'switch', message: 'see https://spam.example' })
				.expect(400);
		});

		test('the catalogue owner sells as Vome without a connected account', async () => {
			const owner = makeOwner();
			config.limits.catalogueOwnerId = owner.ownerId;
			const uid = await makeSwitch(owner, { commerce: PAID });
			await request(app).post(`/api/v2/switch/${uid}/pay`).send({ kind: 'switch' }).expect(200);
			const params = stripe.checkout.sessions.create.mock.calls[0][0];
			expect(params.payment_intent_data.on_behalf_of).toBeUndefined();
			expect(params.automatic_tax).toEqual({ enabled: true });
		});

		test('a Stripe refusal marks the owner not ready', async () => {
			const owner = makeOwner();
			await makeReadyOwner(owner);
			const uid = await makeSwitch(owner, { commerce: PAID });
			const err = Object.assign(new Error('capability inactive'), { type: 'StripeInvalidRequestError', code: 'account_invalid' });
			stripe.checkout.sessions.create.mockRejectedValueOnce(err);
			const res = await request(app).post(`/api/v2/switch/${uid}/pay`).send({ kind: 'switch' }).expect(502);
			expect(res.body.stripeCode).toBe('account_invalid');
			expect(await redisClient.ownerCanTakePayments(owner.ownerId)).toBe(false);
		});

		test('503 without Stripe keys', async () => {
			config.stripe.secretKey = '';
			const owner = makeOwner();
			const uid = await makeSwitch(owner, { commerce: PAID });
			await request(app).post(`/api/v2/switch/${uid}/pay`).send({ kind: 'switch' }).expect(503);
		});
	});

	describe('Connect onboarding and status', () => {
		test('owner-signed onboarding returns a Stripe link; replays and bad signatures fail', async () => {
			const owner = makeOwner();
			const body = signed(owner, 'connect_onboard');
			const res = await request(app).post('/api/v2/owner/connect').send(body).expect(200);
			expect(res.body.data).toEqual({ url: 'https://connect.stripe.com/setup/e/acct_owner/x' });
			await request(app).post('/api/v2/owner/connect').send(body).expect(409);

			const other = makeOwner();
			const forged = { ...signed(other, 'connect_onboard'), ownerPubKey: owner.ownerPubKey };
			await request(app).post('/api/v2/owner/connect').send(forged).expect(401);

			const wrongAction = signed(owner, 'connect_status');
			await request(app).post('/api/v2/owner/connect').send(wrongAction).expect(401);
		});

		test('owner-signed status reads Stripe and offers the dashboard when ready', async () => {
			const owner = makeOwner();
			await request(app).post('/api/v2/owner/connect/status').send(signed(owner, 'connect_status')).expect(200)
				.then((res) => expect(res.body.data).toEqual({ connected: false, ready: false, requirementsDue: 0 }));

			await request(app).post('/api/v2/owner/connect').send(signed(owner, 'connect_onboard')).expect(200);
			const res = await request(app).post('/api/v2/owner/connect/status').send(signed(owner, 'connect_status')).expect(200);
			expect(res.body.data).toEqual({
				connected: true,
				ready: true,
				requirementsDue: 0,
				dashboardUrl: 'https://connect.stripe.com/express/login/x'
			});
		});

		test('access-key routes need the metadata permission and return to the switch page', async () => {
			const owner = makeOwner();
			const uid = await makeSwitch(owner);
			const toggleOnly = await redisClient.createV2AccessKey(owner.ownerId, uid, 'web', ['toggle']);
			await request(app).post(`/api/v2/switch/${uid}/connect`).send({ apiKey: toggleOnly.apiKey }).expect(403);

			const key = await redisClient.createV2AccessKey(owner.ownerId, uid, 'web', ['metadata']);
			const res = await request(app).post(`/api/v2/switch/${uid}/connect`).send({ apiKey: key.apiKey }).expect(200);
			expect(res.body.data.url).toContain('connect.stripe.com');
			const linkParams = stripe.v2.core.accountLinks.create.mock.calls[0][0];
			expect(linkParams.use_case.account_onboarding.return_url).toContain(`/switch/${uid}?connect=return`);

			const status = await request(app).post(`/api/v2/switch/${uid}/connect/status`).send({ apiKey: key.apiKey }).expect(200);
			expect(status.body.data).toMatchObject({
				connected: true,
				ready: true,
				paymentsEnabled: true,
				platformSale: false,
				earnings: { paidCount: 0, tipCount: 0, paid: {}, tip: {} }
			});
		});
	});

	describe('reward claims', () => {
		async function setup({ reward = REWARD } = {}) {
			const publisher = makeOwner();
			const claimant = makeOwner();
			const uid = await makeSwitch(publisher, { reward });
			const change = await switchActions.applySwitchChange(uid, { state: true, source: 'owner' });
			return { publisher, claimant, uid, changeAt: change.timestamp };
		}

		const claimBody = (claimant, uid, changeAt, entities = 3) => signed(
			claimant,
			'reward_claim',
			{ uid, changeAt, entities },
			{}
		);

		// The signed payload carries uid but the body must not (it is in the path).
		const send = (uid, body) => {
			const { uid: _omit, ...rest } = body;
			return request(app).post(`/api/v2/switch/${uid}/reward-claims`).send(rest);
		};

		test('a qualifying claim is recorded once, indexed for the claimant and sent to the owner webhook', async () => {
			const { claimant, uid, changeAt } = await setup();
			const res = await send(uid, claimBody(claimant, uid, changeAt)).expect(200);
			expect(res.body.data.claim).toMatchObject({
				claimant: claimant.ownerId,
				changeAt,
				entities: 3,
				amount: 200,
				currency: 'sek',
				status: 'owed'
			});
			expect(res.body.data.claim.id).toMatch(/^rc_[0-9a-f]{18}$/);
			expect(await redisClient.client.sIsMember(`owner_rewards:${claimant.ownerId}`, uid)).toBe(true);
			expect(switchActions.dispatchOwnerWebhook).toHaveBeenCalledWith(
				expect.objectContaining({ uid }),
				'reward_claim',
				expect.objectContaining({ claimant: claimant.ownerId, amount: 200, currency: 'sek', state: true })
			);

			await send(uid, claimBody(claimant, uid, changeAt)).expect(409);
		});

		test('older changes from the event log count too', async () => {
			const { claimant, uid, changeAt } = await setup({ reward: { ...REWARD, on: 'any' } });
			await switchActions.applySwitchChange(uid, { state: false, source: 'owner' });
			await send(uid, claimBody(claimant, uid, changeAt)).expect(200);
		});

		test('refuses the publisher, unknown changes, the wrong direction and late claims', async () => {
			const { publisher, claimant, uid, changeAt } = await setup();
			await send(uid, claimBody(publisher, uid, changeAt)).expect(403);
			await send(uid, claimBody(claimant, uid, changeAt - 1)).expect(404);

			const off = await switchActions.applySwitchChange(uid, { state: false, source: 'owner' });
			await send(uid, claimBody(claimant, uid, off.timestamp)).expect(409);

			const old = Date.now() - (REWARD.windowSeconds * 1000) - 5000;
			await redisClient.client.hSet(`switch:${uid}`, { lastChangeAt: `${old}`, state: 'on' });
			await send(uid, claimBody(claimant, uid, old)).expect(410);
		});

		test('no offer, no claim', async () => {
			const publisher = makeOwner();
			const claimant = makeOwner();
			const uid = await makeSwitch(publisher);
			const change = await switchActions.applySwitchChange(uid, { state: true, source: 'owner' });
			await send(uid, claimBody(claimant, uid, change.timestamp)).expect(409);
		});

		test('maxPerDay is per claimant', async () => {
			const { claimant, uid } = await setup({ reward: { ...REWARD, on: 'any', maxPerDay: 1 } });
			const first = await switchActions.applySwitchChange(uid, { state: false, source: 'owner' });
			await send(uid, claimBody(claimant, uid, first.timestamp)).expect(200);
			await new Promise((r) => setTimeout(r, 5));
			const second = await switchActions.applySwitchChange(uid, { state: true, source: 'owner' });
			await send(uid, claimBody(claimant, uid, second.timestamp)).expect(429);
			// Refused claims do not burn the change: another claimant still can.
			const someoneElse = makeOwner();
			await send(uid, claimBody(someoneElse, uid, second.timestamp)).expect(200);
		});

		test('publisher lists, settles, and the claimant sees their rewards', async () => {
			const { publisher, claimant, uid, changeAt } = await setup();
			const other = makeOwner();
			const a = await send(uid, claimBody(claimant, uid, changeAt)).expect(200);
			await send(uid, claimBody(other, uid, changeAt, 1)).expect(200);

			const key = await redisClient.createV2AccessKey(publisher.ownerId, uid, 'web', ['metadata']);
			const list = await request(app).post(`/api/v2/switch/${uid}/reward-claims/list`).send({ apiKey: key.apiKey }).expect(200);
			expect(list.body.data.claims).toHaveLength(2);
			expect(list.body.data.totals).toEqual({ owed: { sek: 400 }, paid: {} });
			expect(list.body.data.owedByClaimant).toEqual(expect.arrayContaining([
				{ claimant: claimant.ownerId, currency: 'sek', amount: 200, count: 1 },
				{ claimant: other.ownerId, currency: 'sek', amount: 200, count: 1 }
			]));

			const paid = await request(app).post(`/api/v2/switch/${uid}/reward-claims/mark-paid`)
				.send({ apiKey: key.apiKey, ids: [a.body.data.claim.id, 'rc_unknown'] })
				.expect(200);
			expect(paid.body.data.marked).toBe(1);
			expect(paid.body.data.totals).toEqual({ owed: { sek: 200 }, paid: { sek: 200 } });
			const flipped = paid.body.data.claims.find((c) => c.id === a.body.data.claim.id);
			expect(flipped.status).toBe('paid');
			expect(flipped.paidAt).toBeGreaterThan(0);

			// Marking again changes nothing.
			const again = await request(app).post(`/api/v2/switch/${uid}/reward-claims/mark-paid`)
				.send({ apiKey: key.apiKey, ids: [a.body.data.claim.id] })
				.expect(200);
			expect(again.body.data.marked).toBe(0);

			const ownerList = await request(app).post('/api/v2/owner/reward-claims')
				.send(signed(publisher, 'reward_claims_list', { uid }))
				.expect(200);
			expect(ownerList.body.data.claims).toHaveLength(2);
			await request(app).post('/api/v2/owner/reward-claims')
				.send(signed(claimant, 'reward_claims_list', { uid }))
				.expect(404);

			const mine = await request(app).post('/api/v2/owner/my-rewards')
				.send(signed(claimant, 'my_rewards'))
				.expect(200);
			expect(mine.body.data.claims).toHaveLength(1);
			expect(mine.body.data.claims[0]).toMatchObject({ uid, status: 'paid', switchName: expect.stringMatching(/^Lamp /) });
			expect(mine.body.data.totals).toEqual({ owed: {}, paid: { sek: 200 } });
		});
	});
});

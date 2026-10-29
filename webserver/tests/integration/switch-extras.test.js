/**
 * Switch extras over the real routes: properties, notes/params, commerce
 * settings, public toggle with cooldown and hold, owner webhooks.
 * Contract: docs/SWITCH_EXTRAS.md.
 */
const crypto = require('crypto');
const request = require('supertest');
const express = require('express');
const apiRoutes = require('../../src/routes/api');
const redisClient = require('../../src/utils/redis');
const media = require('../../src/utils/media');
const switchActions = require('../../src/utils/switchActions');
const { deriveSwitchUidFromSwitchPubKeyB64Url, stableJsonStringify } = require('../../src/utils/crypto_v2');

const sign = (key, canonical) => global.testUtils.ed25519SignBase64Url(key, canonical);
let nonceCounter = 0;
const nextNonce = (label) => `n-${Date.now()}-${label}-${nonceCounter += 1}`;

async function createSwitch(app, { publicize = false, properties } = {}) {
	const owner = global.testUtils.createEd25519Keypair();
	const sw = global.testUtils.createEd25519Keypair();
	const ownerPubKey = Buffer.from(owner.rawPublicKey).toString('base64url');
	const switchPubKey = Buffer.from(sw.rawPublicKey).toString('base64url');
	const uid = deriveSwitchUidFromSwitchPubKeyB64Url(switchPubKey);
	const ts = Date.now();
	const nonce = nextNonce('create');
	const meta = {
		name: 'Tree lights',
		description: 'Lights on the tree',
		location: 'Hamnen',
		category: 'Event',
		publicize,
		link: '',
		...(properties !== undefined ? { properties } : {})
	};
	const canonical = stableJsonStringify({
		v: 2, action: 'create_switch', ownerPubKey, switchPubKey, uid, index: 0, ts, nonce, payload: meta
	});
	const resp = await request(app).post('/api/v2/switch').send({
		ownerPubKey, switchPubKey, index: 0, ts, nonce,
		sigOwner: sign(owner.privateKey, canonical),
		sigSwitch: sign(sw.privateKey, canonical),
		...meta
	});
	return { owner, sw, ownerPubKey, switchPubKey, uid, resp };
}

function setState(app, ctx, { state, params = {}, note }) {
	const ts = Date.now();
	const nonce = nextNonce('state');
	const canonical = stableJsonStringify({
		v: 2, action: 'set_state', uid: ctx.uid, ts, nonce, state, params,
		...(note ? { note } : {})
	});
	return request(app).post(`/api/v2/switch/${ctx.uid}/state`).send({
		ts, nonce, sigSwitch: sign(ctx.sw.privateKey, canonical), state, params,
		...(note !== undefined ? { note } : {})
	});
}

function signedUpdate(app, ctx, fields) {
	const ts = Date.now();
	const nonce = nextNonce('update');
	const canonical = stableJsonStringify({
		v: 2, action: 'update_switch', uid: ctx.uid, ownerPubKey: ctx.ownerPubKey, ts, nonce, payload: fields
	});
	return request(app).post(`/api/v2/switch/${ctx.uid}`).send({
		ownerPubKey: ctx.ownerPubKey, ts, nonce, sigOwner: sign(ctx.owner.privateKey, canonical), ...fields
	});
}

async function accessKey(app, ctx, permissions) {
	const ts = Date.now();
	const nonce = nextNonce('key');
	const payload = { name: 'test', permissions };
	const canonical = stableJsonStringify({
		v: 2, action: 'create_access_key', uid: ctx.uid, ownerPubKey: ctx.ownerPubKey, ts, nonce, payload
	});
	const resp = await request(app).post(`/api/v2/switch/${ctx.uid}/access-keys`).send({
		ownerPubKey: ctx.ownerPubKey, ts, nonce, sigOwner: sign(ctx.owner.privateKey, canonical), ...payload
	});
	expect(resp.status).toBe(200);
	return resp.body.data.apiKey;
}

describe('Switch extras', () => {
	let app;

	beforeAll(async () => {
		app = express();
		app.use(express.json({ limit: '10mb' }));
		app.use('/api', apiRoutes);
		await redisClient.connect();
	});

	afterAll(async () => {
		switchActions.stopRevertLoop();
		if (redisClient.isConnected) {
			await redisClient.disconnect();
		}
	});

	beforeEach(async () => {
		await redisClient.client.flushDb();
		jest.restoreAllMocks();
	});

	test('properties on create are signed only when sent, and show publicly', async () => {
		const plain = await createSwitch(app);
		expect(plain.resp.status).toBe(200);
		expect(plain.resp.body.data.properties).toEqual({});

		const ctx = await createSwitch(app, { publicize: true, properties: { wattage: 40, colour: 'warm white' } });
		expect(ctx.resp.status).toBe(200);
		expect(ctx.resp.body.data.properties).toEqual({ wattage: 40, colour: 'warm white' });

		const detail = await request(app).get(`/api/switch/${ctx.uid}`).expect(200);
		expect(detail.body.data.properties).toEqual({ wattage: 40, colour: 'warm white' });
		const listing = await request(app).get('/api/public-switches').expect(200);
		expect(listing.body.data.switches[0].properties).toEqual({ wattage: 40, colour: 'warm white' });

		const bad = await createSwitch(app, { properties: { 'Not OK': 1 } });
		expect(bad.resp.status).toBe(400);
	});

	test('a note is part of the signature only when present; each change replaces it', async () => {
		const ctx = await createSwitch(app);

		const old = await setState(app, ctx, { state: true, params: { brightness: 10 } });
		expect(old.status).toBe(200);

		const withNote = await setState(app, ctx, { state: true, note: 'Now playing: SOS', params: { song: 'SOS' } });
		expect(withNote.status).toBe(200);
		let status = await request(app).get(`/api/status/${ctx.uid}`).expect(200);
		expect(status.body.data.note).toBe('Now playing: SOS');
		expect(status.body.data.lastParams).toEqual({ song: 'SOS' });
		expect(status.body.data.lastSource).toBe('owner');

		// A note the signature did not cover is refused.
		const ts = Date.now();
		const nonce = nextNonce('forged');
		const canonical = stableJsonStringify({ v: 2, action: 'set_state', uid: ctx.uid, ts, nonce, state: false, params: {} });
		await request(app).post(`/api/v2/switch/${ctx.uid}/state`).send({
			ts, nonce, sigSwitch: sign(ctx.sw.privateKey, canonical), state: false, params: {}, note: 'sneaky'
		}).expect(401);

		await setState(app, ctx, { state: false }).expect(200);
		status = await request(app).get(`/api/status/${ctx.uid}`).expect(200);
		expect(status.body.data.note).toBe('');
		expect(status.body.data.lastParams).toEqual({});

		const events = await redisClient.getEvents(ctx.uid, 5);
		expect(events.find((e) => e.note === 'Now playing: SOS')).toBeTruthy();
	});

	test('numeric-looking notes stay text', async () => {
		const ctx = await createSwitch(app);
		await setState(app, ctx, { state: true, note: '42' }).expect(200);
		const status = await request(app).get(`/api/status/${ctx.uid}`).expect(200);
		expect(status.body.data.note).toBe('42');
	});

	test('params over the limits are refused', async () => {
		const ctx = await createSwitch(app);
		const resp = await setState(app, ctx, { state: true, params: { deep: { a: 1 } } });
		expect(resp.status).toBe(400);
		expect(resp.body.error).toMatch(/nested/);
	});

	test('signed update replaces extras and shows the webhook secret once', async () => {
		const ctx = await createSwitch(app, { publicize: true, properties: { a: 1 } });
		const first = await signedUpdate(app, ctx, {
			properties: { b: 'two' },
			commerce: { toggleMode: 'public', tips: true, webhookUrl: 'https://hooks.example/vome' },
			reward: { amount: 200, currency: 'sek' }
		});
		expect(first.status).toBe(200);
		expect(first.body.data.properties).toEqual({ b: 'two' });
		expect(first.body.data.commerce.toggleMode).toBe('public');
		expect(first.body.data.commerce.webhookUrl).toBe('https://hooks.example/vome');
		expect(first.body.data.webhookSecret).toMatch(/^whsec_[0-9a-f]{48}$/);
		expect(first.body.data.hasWebhookSecret).toBe(true);
		expect(first.body.data.reward.amount).toBe(200);

		const again = await signedUpdate(app, ctx, { description: 'still lights' });
		expect(again.status).toBe(200);
		expect(again.body.data.webhookSecret).toBeUndefined();

		const rotated = await signedUpdate(app, ctx, { rotateWebhookSecret: true });
		expect(rotated.body.data.webhookSecret).toMatch(/^whsec_/);
		expect(rotated.body.data.webhookSecret).not.toBe(first.body.data.webhookSecret);

		const detail = await request(app).get(`/api/switch/${ctx.uid}`).expect(200);
		expect(detail.body.data.commerce).toMatchObject({ toggleMode: 'public', tips: true, canTakePayments: false });
		expect(JSON.stringify(detail.body)).not.toMatch(/whsec_|hooks\.example/);

		const removed = await signedUpdate(app, ctx, { reward: null });
		expect(removed.body.data.reward).toBeNull();

		const paidWithoutPrice = await signedUpdate(app, ctx, { commerce: { toggleMode: 'paid' } });
		expect(paidWithoutPrice.status).toBe(400);
		expect(paidWithoutPrice.body.error).toMatch(/price/);
	});

	test('access key metadata merges properties and commerce', async () => {
		const ctx = await createSwitch(app, { properties: { a: 1, b: 2 } });
		const key = await accessKey(app, ctx, ['metadata', 'toggle']);
		const merged = await request(app).post(`/api/v2/switch/${ctx.uid}/metadata`)
			.set('x-api-key', key)
			.send({ properties: { a: null, c: 'three' }, commerce: { tips: true } })
			.expect(200);
		expect(merged.body.data.properties).toEqual({ b: 2, c: 'three' });
		expect(merged.body.data.commerce.tips).toBe(true);

		const second = await request(app).post(`/api/v2/switch/${ctx.uid}/metadata`)
			.set('x-api-key', key)
			.send({ commerce: { note: 'Tips welcome' } })
			.expect(200);
		expect(second.body.data.commerce).toMatchObject({ tips: true, note: 'Tips welcome' });

		const multipart = await request(app).post(`/api/v2/switch/${ctx.uid}/metadata`)
			.set('x-api-key', key)
			.field('properties', '{"only":"this"}')
			.field('propertiesReplace', 'true')
			.expect(200);
		expect(multipart.body.data.properties).toEqual({ only: 'this' });
	});

	test('access key toggle carries a note and can set a state', async () => {
		const ctx = await createSwitch(app);
		const key = await accessKey(app, ctx, ['toggle']);
		const on = await request(app).post(`/api/v2/switch/${ctx.uid}/toggle`)
			.set('x-api-key', key)
			.send({ state: true, note: 'From the kitchen' })
			.expect(200);
		expect(on.body.data.state).toBe(true);
		const again = await request(app).post(`/api/v2/switch/${ctx.uid}/toggle`)
			.set('x-api-key', key)
			.send({ state: true })
			.expect(200);
		expect(again.body.data.state).toBe(true);
		const status = await request(app).get(`/api/status/${ctx.uid}`).expect(200);
		expect(status.body.data.lastSource).toBe('key');
		expect(status.body.data.note).toBe('');
	});

	test('public toggle: opt-in, cooldown, messages, hold and revert, webhook', async () => {
		const ctx = await createSwitch(app, { publicize: true });

		await request(app).post(`/api/v2/switch/${ctx.uid}/public-toggle`).send({}).expect(403);

		await signedUpdate(app, ctx, {
			commerce: {
				toggleMode: 'public',
				action: 'on',
				holdSeconds: 60,
				cooldownSeconds: 30,
				webhookUrl: 'https://hooks.example/vome'
			}
		}).expect(200);

		// Messages are off unless the owner allows them.
		await request(app).post(`/api/v2/switch/${ctx.uid}/public-toggle`).send({ message: 'hi' }).expect(400);

		jest.spyOn(media, 'assertSafeRemoteUrl').mockResolvedValue(undefined);
		const fetchSpy = jest.spyOn(global, 'fetch').mockResolvedValue({ ok: true });

		const first = await request(app).post(`/api/v2/switch/${ctx.uid}/public-toggle`).send({}).expect(200);
		expect(first.body.data.state).toBe(true);
		expect(first.body.data.revertsAt).toBeGreaterThan(Date.now());

		const busy = await request(app).post(`/api/v2/switch/${ctx.uid}/public-toggle`).send({});
		expect(busy.status).toBe(429);
		expect(busy.body.retryAfterMs).toBeGreaterThan(0);

		// Webhook went out, signed with the stored secret.
		await new Promise((resolve) => setImmediate(resolve));
		expect(fetchSpy).toHaveBeenCalledTimes(1);
		const [url, init] = fetchSpy.mock.calls[0];
		expect(url).toBe('https://hooks.example/vome');
		const stored = await redisClient.getSwitchState(ctx.uid);
		const [tPart, sigPart] = init.headers['X-VomeSync-Signature'].split(',');
		const expected = crypto.createHmac('sha256', stored.commerceWebhookSecret)
			.update(`${tPart.slice(2)}.${init.body}`).digest('hex');
		expect(sigPart).toBe(`v1=${expected}`);
		expect(JSON.parse(init.body)).toMatchObject({ uid: ctx.uid, event: 'state', state: true, source: 'public' });

		// Not due yet, then due.
		expect(await switchActions.runDueReverts(Date.now())).toBe(0);
		expect(await switchActions.runDueReverts(Date.now() + 61000)).toBe(1);
		const after = await redisClient.getSwitchState(ctx.uid);
		expect(after.state).toBe(false);
		expect(after.lastSource).toBe('auto');
	});

	test('an owner change cancels a pending revert', async () => {
		const ctx = await createSwitch(app, { publicize: true });
		await signedUpdate(app, ctx, { commerce: { toggleMode: 'public', action: 'on', holdSeconds: 60 } }).expect(200);
		await request(app).post(`/api/v2/switch/${ctx.uid}/public-toggle`).send({}).expect(200);
		await setState(app, ctx, { state: true, note: 'Staying on' }).expect(200);
		expect(await switchActions.runDueReverts(Date.now() + 61000)).toBe(0);
		expect((await redisClient.getSwitchState(ctx.uid)).state).toBe(true);
	});

	test('visitor messages with links are refused', async () => {
		const ctx = await createSwitch(app, { publicize: true });
		await signedUpdate(app, ctx, { commerce: { toggleMode: 'public', allowMessage: true } }).expect(200);
		const resp = await request(app).post(`/api/v2/switch/${ctx.uid}/public-toggle`)
			.send({ message: 'visit www.spam.example' });
		expect(resp.status).toBe(400);
		const ok = await request(app).post(`/api/v2/switch/${ctx.uid}/public-toggle`)
			.send({ message: 'God jul!' })
			.expect(200);
		expect(ok.body.data.note).toBe('God jul!');
	});

	test('private switches cannot be publicly toggled', async () => {
		const ctx = await createSwitch(app);
		await signedUpdate(app, ctx, { commerce: { toggleMode: 'public' } }).expect(200);
		await request(app).post(`/api/v2/switch/${ctx.uid}/public-toggle`).send({}).expect(404);
	});
});

# Switch extras: properties, notes, paying to switch, getting paid to switch

Built 29–30 Oct 2026 on `Develop` (server) and `Develop` (VomeSync integration).
This is the contract every piece is built against. British English. If the code
and this file disagree, fix one of them in the same commit.

The owner asked for "all the sorts of things, and we see what works best", so
several money rails ship side by side. None of them is switched on for a switch
until its owner turns it on.

## 1. Fixed properties (`properties`)

Owner-defined key/value pairs that stay the same until the owner changes them.
"Wattage: 40", "colour: warm white", "radio: P3", "operator: Hamnen AB".

- Stored on the switch hash as JSON field `properties`.
- At most **12** entries. Key: `^[a-z][a-z0-9_]{0,31}$`. Value: string (≤ 200
  chars, trimmed), finite number, or boolean. `null` value in an update deletes
  that key.
- Set through:
  - signed `POST /api/v2/switch` (create) – optional, **never defaulted** (old
    clients' signed canonical payloads must stay the same),
  - signed `POST /api/v2/switch/:uid` (update) – `properties` is a **full
    replacement** of the map (signed payload = what is stored),
  - access key (`metadata` permission) `POST /api/v2/switch/:uid/metadata` –
    `properties` merges (null deletes); `propertiesReplace: true` replaces.
    Multipart bodies may send it as a JSON string.
  - admin listing override – not supported (yet).
- Returned in: `GET /api/status/:uid`, `GET /api/public-switches`,
  `GET /api/switch/:uid`, `POST /api/v2/my-switches`, and every update response.
- Public switches show them publicly. Do not put anything private in them.

## 2. Per-change note and params

Every state change can carry a short free-text **note** and a small **params**
object. They describe *this* change ("Now playing: Abba", `{ "song": "SOS" }`).

- `note`: string, ≤ 280 chars, control characters stripped, whitespace
  collapsed. Empty string clears.
- `params`: object, ≤ 16 keys, keys `^[A-Za-z][A-Za-z0-9_]{0,31}$`, JSON ≤ 2 KB.
  Values: string ≤ 200, finite number, boolean, null, or an array of ≤ 8
  numbers/strings (so `rgb_color: [255, 0, 0]` still works). The server
  **clips** rather than refuses: long text is cut, nested objects become short
  JSON text, bad keys and keys past the limits are dropped. Params are a
  pass-through that existing senders (the catalogue's error text, older Home
  Assistant installs) never had to size, and a long value must not stop the
  switch from changing. The signature covers what was sent; the clipped copy
  is what is stored and broadcast. (Before this, params had no limit at all.)
- Each change **replaces** the previous note/params (a change without them
  clears them, so stale "now playing" text cannot linger).
- Stored on the switch hash as `lastNote`, `params`, `lastSource`, `lastChangeAt`.
- Signed set-state: `POST /api/v2/switch/:uid/state`
  `{ ts, nonce, sigSwitch, state, params?, note? }`. Canonical JSON is
  `{ v:2, action:'set_state', uid, ts, nonce, state, params }` **plus `note`
  only when the request sends a non-empty note** (older clients keep working).
- Access key toggle: `POST /api/v2/switch/:uid/toggle` accepts optional JSON
  `{ note?, params?, state? }` (`state` boolean sets instead of flipping).
- WebSocket `state_update` payload gains: `note` (when non-empty), `params`
  (when non-empty, as before), `source` (`owner` | `key` | `public` | `paid` |
  `auto`), and `paid: { amount, currency }` for paid changes.
- Event log (`events` in `GET /api/switch/:uid`) rows of `type: 'state'` gain
  `note`, `source`, and for paid ones `amount`/`currency`.
- Public outputs gain `note` (last note), `lastParams`, `lastSource`.

## 3. Commerce settings (`commerce`)

One JSON object on the switch, owner-set through the same three routes as
`properties` (signed update replaces it whole; access key merges).

```jsonc
{
  "toggleMode": "owner",   // owner | public | paid  — who may change it from the website
  "action": "toggle",      // toggle | on | off      — what a public/paid change does
  "holdSeconds": 0,        // 0–3600: after a public/paid change the server puts it back
  "cooldownSeconds": 10,   // 0–3600: min gap between public changes (public mode min 5)
  "price": { "amount": 100, "currency": "eur" },  // paid mode, minor units
  "tips": false,           // show "Tip the owner" (tipper picks amount ≥ price floor)
  "allowMessage": false,   // visitors may attach a ≤140-char note to their change
  "note": "",              // ≤ 200 chars of owner copy on the card
  "payLink": "",           // DIY: owner's own payment link (Stripe Payment Link, Ko-fi…)
  "webhookUrl": ""         // DIY: we POST signed events here
}
```

- Currencies: `eur`, `sek`, `gbp`, `usd`. Floors: 100 minor units (1.00), SEK
  1000 (10 kr). Ceiling 50 000 minor units (500.00 / SEK 5000 → 500 000).
- `toggleMode` `public` and `paid` only work on **public** (publicized) v2
  switches. Community catalogue switches never get them (catalogue owner sets
  them only on its own stunt switches).
- `paid` needs the owner to be ready to take money (section 5) **or** be the
  catalogue owner (money then goes to Vome, which is the seller).
- `webhookSecret` is generated server-side when `webhookUrl` is first set (or
  when `rotateWebhookSecret: true` is sent). It is returned **once** in that
  response as `webhookSecret`, never again, and never in public output.
- Public output exposes a `commerce` summary only:
  `{ toggleMode, action, holdSeconds, cooldownSeconds, price, tips, allowMessage, note, payLink, canTakePayments }`.
  Never `webhookUrl` or the secret.

### 3a. Public toggle (free, rate-limited)

`POST /api/v2/switch/:uid/public-toggle` `{ message?, captchaToken? }`

- Only when `commerce.toggleMode === 'public'`.
- Per-IP limit 20 / 15 min; per-switch cooldown `cooldownSeconds` (min 5) via
  Redis `SET NX PX` → 429 with `retryAfterMs`.
- Message only if `allowMessage`; ≤ 140 chars, no URLs (`http`, `www.`) → 400.
- Applies `action`; source `public`; schedules `holdSeconds` revert.

### 3b. DIY webhooks (no money through us)

When `webhookUrl` is set, every change not made with the owner's own
signature (`key`, `public`, `paid`, `tip`, `auto`) and every reward claim is
POSTed. `key` matters for owners who sell access keys themselves: the
webhook is how they see each use (fire-and-forget, 5 s timeout, same
SSRF guard as image fetches, no redirects):

```
POST <webhookUrl>
Content-Type: application/json
X-VomeSync-Event: state | paid | tip | reward_claim
X-VomeSync-Signature: t=<ms>,v1=<hex hmac_sha256(secret, `${t}.${rawBody}`)>

{ "uid", "event", "state", "note", "source", "amount"?, "currency"?, "ts" }
```

### 3c. Hold / auto-revert

`holdSeconds > 0`: after a public/paid change the server schedules the
opposite state at `now + holdSeconds` (Redis ZSET `switch_reverts`, member
uid, plus hash `switch_revert:<uid>` with the target state). A 1 s loop in the
server claims due members with `ZREM` (only one process wins) and applies the
change with source `auto`. A newer public/paid change reschedules; an owner
change cancels the pending revert.

## 4. Paying to switch and tips (money through us)

`POST /api/v2/switch/:uid/pay` `{ kind: 'switch' | 'tip', amount?, message? }`
→ `{ url, id }` (Stripe Checkout, `mode: payment`).

- `switch`: only when `toggleMode === 'paid'`; amount = `commerce.price`.
- `tip`: only when `commerce.tips`; amount from the body, ≥ the currency floor,
  ≤ ceiling; currency = `commerce.price.currency` (default `eur`).
- `message` only if `allowMessage` (same rules as 3a); carried in session
  metadata (≤ 140 chars, fits Stripe's 500-char metadata value limit).
- Owner with a ready connected account: **destination charge** —
  `payment_intent_data: { on_behalf_of: acct, transfer_data: { destination: acct }, application_fee_amount }`.
  The owner is the settlement merchant; no `automatic_tax` (their sale).
- Catalogue owner: plain platform charge with the usual `automatic_tax`
  (Vome is the seller).
- Anyone else → 409 `Owner cannot take payments yet`.
- Application fee: `STRIPE_CONNECT_FEE_PERCENT` (default 10) % +
  `STRIPE_CONNECT_FEE_FIXED` (default 30 minor units), capped at the amount.
  Destination charges make the platform pay Stripe's fee, so the fixed part
  is not optional.
- Metadata (session and PaymentIntent): `kind = vomesync_paid_switch |
  vomesync_tip`, `uid`, `ownerId`, `message`, `amount`, `currency`.
- Only paid sessions count, so slow payment methods apply on
  `checkout.session.async_payment_succeeded`. A paid switch still applies if
  the owner turned paid mode off while the visitor was in Checkout (they paid).
- If Stripe refuses an owner charge, the owner is marked not ready so the next
  visitor gets the 409 instead of the same Stripe error.
- Webhook `checkout.session.completed` (paid) → idempotent on session id
  (`SET NX paid_session:<id>`):
  - `vomesync_paid_switch`: apply `action` with note = message or
    "Paid by a visitor", source `paid`, `paid: {amount, currency}`; schedule
    hold; append event; DIY webhook `paid`; bump the separate hash
    `switch:<uid>:earnings` (`paidCount`, `tipCount`, `paid:<cur>`,
    `tip:<cur>`).
  - `vomesync_tip`: no state change; append event `{type:'tip', amount,
    currency, note}`; DIY webhook `tip`; bump tip totals.
- Success/cancel URLs: `/switch/:uid?paid=success|cancel`.

## 5. Owners taking money: Stripe Connect (Accounts v2)

- One connected account per **owner** (Ed25519 owner id), Redis
  `owner_connect:<ownerId>` → `{ accountId, createdAt, ready, checkedAt }`.
- Created with Accounts v2: `dashboard: 'express'`,
  `defaults.responsibilities: { fees_collector: 'application', losses_collector: 'application' }`,
  `configuration.merchant.capabilities.card_payments.requested = true`,
  `configuration.recipient.capabilities.stripe_balance.stripe_transfers.requested = true`.
- Onboarding: Account Links v2, `use_case.type = 'account_onboarding'`,
  configurations `['merchant', 'recipient']`.
- Ready = card_payments **and** stripe_transfers status `active`. Status is
  read from Stripe on demand (status call, return URL) and cached 10 min for a
  ready account, 30 s for one that is not ready yet (so an owner coming back
  from onboarding is seen quickly). `requirementsDue` is a count. The v2
  account-updated thin events are not handled; they need an event
  destination of their own.
- **Not yet tried for real:** Connect and Accounts v2 are not enabled on the
  Stripe sandbox (`non_connect_platform_accounts_v2_access_blocked`). The
  destination-charge parameters were accepted by Stripe up to the account
  lookup; a platform-sale Checkout was created in the sandbox.
- Routes:
  - owner-signed (Home Assistant): `POST /api/v2/owner/connect`
    (start/resume onboarding → `{ url }`), `POST /api/v2/owner/connect/status`
    (→ `{ connected, ready, requirementsDue, dashboardUrl? }`). Canonical
    actions `connect_onboard` / `connect_status` (`{ v:2, action, ownerPubKey, ts, nonce }`).
  - access key with `metadata` (website): `POST /api/v2/switch/:uid/connect`,
    `POST /api/v2/switch/:uid/connect/status` (also returns `paymentsEnabled`,
    `platformSale` and this switch's `earnings`).
- Return/refresh URLs: `/switch/:uid?connect=return|refresh` (or `/?connect=…`).

## 6. Getting paid to switch: reward offers

A publisher (any switch owner) offers subscribers a reward for **acting on**
their switch – "turn your heat pump down when this goes on, 2 kr each time".
Community challenges, energy co-ops, a shop paying for window lamps.

```jsonc
"reward": {
  "amount": 200, "currency": "sek",   // per qualifying change
  "on": "on",                          // on | off | any — which change qualifies
  "windowSeconds": 900,                // claim must arrive within this of the change
  "maxPerDay": 5,                      // per claimant
  "note": "Thanks for easing the grid at peak"   // ≤ 200
}
```

- Set like `commerce` (signed update replaces; access key merges; `null` removes).
- Public output shows `reward` as-is (it is an offer).
- Claims: subscriber's Home Assistant, after it really switched its linked
  entities, sends owner-signed `POST /api/v2/switch/:uid/reward-claims`
  `{ ownerPubKey, ts, nonce, sigOwner, changeAt, entities }` (`entities` = how
  many linked entities it switched, 1–50). Canonical:
  `{ v:2, action:'reward_claim', uid, ownerPubKey, ts, nonce, changeAt, entities }`.
- Server checks: offer exists; `changeAt` equals the switch's `lastChangeAt`
  (or one of the last 20 state events); qualifying direction; within window;
  one claim per claimant per change; `maxPerDay`. Claimant ≠ publisher.
- Ledger: Redis list `switch:<uid>:reward_claims` (newest first, max 1000) of
  `{ id, claimant (owner id), changeAt, claimedAt, entities, amount, currency, status: 'owed'|'paid' }`.
- Publisher reads/settles with access key `metadata`:
  `POST /api/v2/switch/:uid/reward-claims/list` → claims + totals owed per
  claimant; `POST /api/v2/switch/:uid/reward-claims/mark-paid` `{ ids }`.
  Owner-signed equivalents for Home Assistant:
  `POST /api/v2/owner/reward-claims` `{ uid, … }` (canonical action `reward_claims_list`).
- Claimant sees their own: owner-signed `POST /api/v2/owner/my-rewards`
  (canonical action `my_rewards`) → claims across switches + totals owed.
- Responses: a claim is `{ id: 'rc_…', claimant, changeAt, claimedAt,
  entities, amount, currency, status }`. Lists return `{ uid, claims, totals:
  { owed: {cur: n}, paid: {cur: n} }, owedByClaimant: [{ claimant, currency,
  amount, count }] }`; my-rewards returns `{ claims: [{ uid, switchName, … }],
  totals }`. Errors: no offer 409, own reward 403, unknown change 404, wrong
  direction 409, too late 410, already claimed 409, over the daily limit 429
  (a refused claim does not use up the change).
- The `reward_claim` webhook body carries `claimId`, `claimant`, `changeAt`,
  `entities`, `amount`, `currency` (source `reward`).
- **Settlement is DIY for now** (publisher pays however they like, then marks
  paid). Claims are self-reported by the claimant's Home Assistant: good for
  community challenges, not for grid settlement. Paying claimants through
  Connect transfers is the obvious next step once both sides are onboarded.

## Home Assistant (integration `vomesync`)

- Switch entities (owned and subscribed) get attributes `properties`,
  `last_note`, `last_params`, `last_source`, `commerce` (summary), `reward`.
- Event `vomesync_state_changed` fired on every pushed change:
  `{ uid, entity_id, state, note, params, source, paid }`.
- Services:
  - `vomesync.set_state` – `entity_id`, `state` (on/off), `note?`, `params?`
  - `vomesync.set_properties` – `entity_id`, `properties` (map), `replace?`
  - `vomesync.set_commerce` – `entity_id`, any commerce fields; returns
    `webhook_secret` once when a webhook is set (service response)
  - `vomesync.set_reward` – `entity_id`, reward fields or `clear: true`
  - `vomesync.connect_payments` – returns onboarding URL (service response)
    and raises a persistent notification with the link
  - `vomesync.payments_status`, `vomesync.reward_claims` (publisher),
    `vomesync.my_rewards` (claimant) – service responses
- Option `claim_rewards` (default **off**): when on, after linked entities are
  switched for a subscribed switch that carries a reward offer, the integration
  sends the claim.
- All admin-only (services registered with admin requirement where they write).

## Website (sync.vome.io)

- Switch page: properties table, last note (+ source badge), commerce panel
  (Flip it / Pay X to switch / Tip / owner's pay link / owner's note), reward
  offer, `?paid=success` thank-you, live note updates over the WebSocket.
- Directory cards: small badges for Public / Paid / Tips / Reward.
- Manage view (access key with `metadata`): edit properties, commerce, reward,
  connect payments + status, reward claims list with mark-paid. Shows the
  webhook secret once.

## Not built / deliberately out

- Payouts to reward claimants through us.
- Paid toggles on community catalogue switches.
- Pay-per-view, paid subscribe, "boost user count".
- Moderation queue for visitor messages (owner opt-in, no URLs, 140 chars,
  owner can turn messages off; that is the whole defence for now).

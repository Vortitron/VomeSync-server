# Public directory catalogue

Operator tools for filling [sync.vome.io](https://sync.vome.io) with named, illustrated public switches.

The website only lists v2 switches with `publicize: true`. Creating those by hand means Ed25519 signatures, a captcha when enabled, and a premium cap above four public listings. This folder is the way around that toil: a JSON catalogue, generated icons/banners, and a CLI that signs the v2 API.

Style and copy: [STYLE.md](STYLE.md).

## Quick path

```bash
cd /var/www/VomeSync-server

# First run writes catalogue/.seed (gitignored). Keep it.
node catalogue/cli.js apply --dry-run

# Create/update listings, upload art, set calendar state
node catalogue/cli.js apply

# Pull live sources, write JSON, push ON/OFF (this is what the timer runs)
node catalogue/cli.js observe
```

Add one without editing JSON by hand:

```bash
node catalogue/cli.js add --apply --json '{"id":"nowruz","name":"Nowruz",…}'
```

Print stable UIDs (seed + index):

```bash
node catalogue/cli.js uids
```

Delist nameless public test rows, or delete leftover CI switches (needs `ADMIN_API_KEY`):

```bash
node catalogue/cli.js delist-tests
node catalogue/cli.js purge-debris --dry-run
node catalogue/cli.js purge-debris
```

`purge-debris` keeps the catalogue UIDs and anything named like GamlaBio. It deletes empty-name rows, “Public Test Switch”, and the e2e/websocket/claude-e2e/a2-registry names Jenkins leaves behind.

## Files

| Path | Role |
|---|---|
| `switches.json` | Committed definitions (ids, copy, tests). Observe does not write this. |
| `lib/paths.js` | Live vs repo catalogue paths. Live default `/var/lib/vomesync-catalogue`. |
| `lib/artwork.js` | SVG icons (256²) and banners (1600×900). |
| `lib/refresh.js` | Calendar / last observed state → desired ON/OFF. Stale live sources are OFF. |
| `lib/sources.js` | Live observers (bridges, sittings, Commons division, offices, storms, elections, USGS, TfL, Launch Library, GDACS). |
| `lib/offices.js` | Wikidata P1308 office-holders. |
| `lib/dutch-bridges.js` | Extra isdetunnelopen.nl movable spans. |
| `lib/live-listings.js` | Extra offices, bridges, live events, and AliExpress tentpole windows. |
| `lib/aliexpress-sales.js` | UTC windows for Anniversary, Summer, 11.11 and 12.12, plus Choice Day as the first seven UTC days of each month. Not a live scrape: Open Platform wants a business account, the storefront bot-walls us, and MTOP needs signed browser cookies. |
| `append-live-listings.js` | Idempotent merge of those extras into `switches.json`. |
| `lib/observe.js` | Fetch each source; short outages keep last state, then force OFF. |
| `lib/stale.js` | `staleAfterHours` clock from last successful `observedAt`. |
| `lib/crypto.js` | Same seed derivation as the Home Assistant integration. |
| `systemd/` | Five-minute `observe` timer, plus a one-minute timer for Commons divisions. |
| `.seed` | Catalogue owner master seed. **Do not commit.** |
| `.local-state.json` | Cached access keys and art hashes, next to the live JSON. **Do not commit.** |

Environment:

- `VOMESYNC_API_BASE` — default `https://sync.vome.io/api`
- `VOMESYNC_CATALOGUE_SEED` — overrides `.seed`
- `ADMIN_API_KEY` — or `docker/.env`; used to grant premium and purge tests
- `HCAPTCHA_BYPASS_TOKEN` — only if live captcha is on

Apply grants this owner premium for ten years. Set `CATALOGUE_OWNER_ID` so create/publicize caps skip that owner. Paying customers stay on 50 switches / 25 public. Watching a public UID is free and does not count toward it.

Live observe state lives in `/var/lib/vomesync-catalogue/switches.json`, not the git tree:

```bash
node catalogue/cli.js install-live
node catalogue/cli.js sync-live   # copy new git ids into the live file
```

## Keeping state honest

Nothing in this catalogue is flipped by a person. Two mechanisms:

1. **Calendar** (`annual`, `windows`, `month`, `month_days`, `nth_weekday`, `full_moon`) — computed from UTC dates in JSON.
2. **Observe** (`kind: "observe"`, `source: "…"`) — `lib/sources.js` fetches a public page or API. A failed fetch leaves the last good ON/OFF until `staleAfterHours` (default 24) after the last success, then the listing is forced OFF.

`node catalogue/cli.js observe` does both: it updates observed JSON, then `refresh` pushes every listing. Install the timer so it does not depend on a laptop:

```bash
sudo cp catalogue/systemd/vomesync-catalogue-observe.service /etc/systemd/system/
sudo cp catalogue/systemd/vomesync-catalogue-observe.timer /etc/systemd/system/
sudo cp catalogue/systemd/vomesync-catalogue-observe-division.service /etc/systemd/system/
sudo cp catalogue/systemd/vomesync-catalogue-observe-division.timer /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now vomesync-catalogue-observe.timer
sudo systemctl enable --now vomesync-catalogue-observe-division.timer
```

The main timer fires every five minutes (Tower Bridge lifts are treated as a 15-minute window). Commons divisions only last about eight minutes, so a second timer observes `uk-commons-division` every minute from the Parliament annunciator. The five-minute pass skips that listing so the two writers do not clobber each other. On this host the services run `catalogue/observe.sh`, which uses nvm’s Node 22 — Ubuntu’s `/usr/bin/node` is v12 and has no `fetch`.

Swedish election 2026 is **one** switch on purpose: ON after polls close while the preliminary count zip is still the latest file, or until Wikidata shows a prime minister appointed after election night.

Øresund and the Great Belt: ON means open to road traffic — the opposite of Tower Bridge / Erasmusbrug, where ON means open to ships.

Government listings keep a stable UID. The observer renames the listing when Wikidata’s office-holder (P1308) changes. If Wikidata omits an English label, keep the last good name — never publish a Q-id.

AliExpress tentpoles are UTC `windows`, not a scrape: their storefront returns a punish page to anonymous clients, and Open Platform signup asks for a full business account. **AliExpress sale** is ON during any listed tentpole; 11.11, Summer and Anniversary are the named ones. **AliExpress Choice Day** is the first seven UTC days of each month — that is the usual pattern, not a live campaign feed. Extend tentpole windows when they publish the next year.

## Tests

From `webserver/`:

```bash
npm run test:unit -- tests/unit/catalogue.test.js
```

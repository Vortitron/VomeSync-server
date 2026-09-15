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
| `switches.json` | Source of truth. `id` and `index` are permanent. |
| `lib/artwork.js` | SVG icons (256²) and banners (1600×900). |
| `lib/refresh.js` | Calendar / last observed state → desired ON/OFF. |
| `lib/sources.js` | Live observers (bridges, sittings, offices, storms, elections). |
| `lib/observe.js` | Fetch each source; on failure keep the last good state. |
| `lib/crypto.js` | Same seed derivation as the Home Assistant integration. |
| `systemd/` | Five-minute `observe` timer. |
| `.seed` | Catalogue owner master seed. **Do not commit.** |
| `.local-state.json` | Cached access keys and art hashes. **Do not commit.** |

Environment:

- `VOMESYNC_API_BASE` — default `https://sync.vome.io/api`
- `VOMESYNC_CATALOGUE_SEED` — overrides `.seed`
- `ADMIN_API_KEY` — or `docker/.env`; used to grant premium and purge tests
- `HCAPTCHA_BYPASS_TOKEN` — only if live captcha is on

Apply grants this owner premium for ten years so the free-tier cap of ten public switches does not bite.

## Keeping state honest

Nothing in this catalogue is flipped by a person. Two mechanisms:

1. **Calendar** (`annual`, `windows`, `month`, `nth_weekday`, `full_moon`) — computed from UTC dates in JSON.
2. **Observe** (`kind: "observe"`, `source: "…"`) — `lib/sources.js` fetches a public page or API. A failed fetch leaves the last good ON/OFF.

`node catalogue/cli.js observe` does both: it updates observed JSON, then `refresh` pushes every listing. Install the timer so it does not depend on a laptop:

```bash
sudo cp catalogue/systemd/vomesync-catalogue-observe.service /etc/systemd/system/
sudo cp catalogue/systemd/vomesync-catalogue-observe.timer /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now vomesync-catalogue-observe.timer
```

The timer fires every five minutes (Tower Bridge lifts are treated as a 15-minute window). On this host the service runs `catalogue/observe.sh`, which uses nvm’s Node 22 — Ubuntu’s `/usr/bin/node` is v12 and has no `fetch`.

Swedish election 2026 is **one** switch on purpose: ON after polls close while the preliminary count zip is still the latest file, or until Wikidata shows a prime minister appointed after election night. Splitting count vs formation would need a higher public cap (premium is 25).

Øresund and the Great Belt: ON means open to road traffic — the opposite of Tower Bridge / Erasmusbrug, where ON means open to ships.

Government listings keep a stable UID. The observer renames the listing when Wikidata’s office-holder (P1308) changes.

## Tests

From `webserver/`:

```bash
npm run test:unit -- tests/unit/catalogue.test.js
```

# To do, soon: TTN sensors as catalogue switches

Owner's call, 26 Oct 2026: put this on the soon pile. Nothing is built yet.

## The idea

A LoRaWAN sensor on The Things Network (TTN) becomes a VomeSync catalogue switch that any home can watch. Examples: a leak sensor, a mailbox flap, a flood-level gauge, a cabin door. The first ones should be Vome's own devices, as public showcase switches. Someone else's sensor can follow later, once its owner hands over a read-only key.

## How it fits what exists

Catalogue switches are already fed by polling, so a TTN sensor is just one more source:

- `observe.sh` runs on a 5-minute timer and calls each entry's observer in `lib/sources.js` (`OBSERVERS`).
- An observer returns `{ on, params }`.
- `refresh.js` posts that to `POST /api/v2/switch/:uid/state`, signed with the host's Ed25519 seed.
- An entry is just `schedule: { kind: 'observe', source: '<id>', staleAfterHours }` in `switches.json`. A failed fetch keeps the last state until `staleAfterHours` runs out, then forces OFF.

The TTN observer would:

1. Read the application's **Storage Integration**: `GET https://eu1.cloud.thethings.network/api/v3/as/applications/<app>/devices/<dev>/packages/storage/uplink_message?last=…`, with `Authorization: Bearer <API key>` that has read-only rights. The Sandbox keeps 24 h, which is plenty for a 5-minute poll.
2. Take the newest `decoded_payload`, map one field to ON/OFF (for example `water_leak`, `door_open`, or `level_cm > threshold`), and pass a few readings along in `params` (level, battery, `received_at`).
3. Set `staleAfterHours` to suit the sensor's uplink interval. A sensor that only reports on change needs a heartbeat, or a long staleness window.

The source spec needs: app id, device id, a key name (the key itself goes in the host env, never in `switches.json`), field, rule, and cluster (`eu1`). This is roughly the size of `uptimeObservers()`.

**Estimate:** 1–2 days for the polled observer, its tests and the first entry. A push version is about 3–5 days: a TTN webhook to a new authenticated endpoint on sync.vome.io that signs server-side. Only worth it if 5-minute latency hurts.

## Constraints to respect

- **Terms:** the TTN Sandbox (formerly the Community Edition) is *non-commercial, small-scale*. A handful of Vome's own showcase sensors is fine. Anything sold as a feature, or run for paying customers, belongs on Things Stack Cloud. Its free Discovery tier covers 10 devices and 10 gateways.
- **Airtime:** fair use is 30 s of uplink airtime and 10 downlinks per device per day. That is fine for status sensors and useless for commands.
- **Data access:** nobody's device data is public. Every TTN application is private, so each shared sensor needs its owner's key or webhook.
- **The free watch limit:** watching a catalogue switch counts toward a free home's 10 (`FREE_TIER_MAX_SUBSCRIPTIONS`). If LoRa switches multiply, decide whether public catalogue switches should still count.
- **Coverage:** Sweden is sparse, about 210 TTN gateways against about 760 in Great Britain. The test house may need its own gateway (a TTIG is €95–145). SMLIGHT sells no LoRa hardware.

## First steps when picked up

1. Choose the showcase sensor and check gateway coverage at the test house (TTN Mapper).
2. Make a TTN application, register the device, write the payload formatter, and create a read-only API key.
3. Add the `ttn` observer and a test with a recorded Storage response, then add the entry to `switches.json`.

Background: the research report of 26 Oct 2026, kept in the Claude memory note `ttn-lorawan-fit`.

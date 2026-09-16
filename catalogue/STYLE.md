# Public switch style guide

This is the look and voice of listings on [sync.vome.io](https://sync.vome.io). It exists because a directory of nameless “Public Test Switch” cards does not invite anyone to subscribe. Follow it when you add a switch with `node catalogue/cli.js add`.

## What a public switch is for

A public switch is a **shared binary event**. Home Assistant users subscribe to the UID and automate on ON/OFF.

Write for that. The name is the event. The description is the contract: what ON means, what a subscriber might do, and where the fact comes from.

Do not list locks, alarms, cameras, or anything a stranger should not be able to watch.

## Copy

British English. Short sentences. No marketing voice. If the listing claims a live source, `schedule.kind` must be `observe` and `lib/sources.js` must actually fetch it.

| Field | Limit | Rule |
|---|---|---|
| `name` | 80 | Event or office, not a slogan. Include the holder for government switches (`UK Prime Minister: Andy Burnham`). |
| `description` | 500 | First sentence is the ON condition. Second is a suggested automation. Third is the source. |
| `location` | 100 | City, country, or `Worldwide`. Never a street address. |
| `category` | enum | `Transport` for bridges and lines. `Government` for offices and sittings. `Holiday` for calendars of observance. `Weather` for storms and quakes. `Event` for elections, conclaves, Earth Hour, full moon. `Community` for Pride and lasting observances that are not a holiday. `Other` only if it fits nowhere. Do not use `Test` on the public directory. |
| `link` | 500 | Canonical https source. Parliament, GOV.UK, Hebcal, NOAA — not a tracking redirect. |

ON/OFF must be defined in `onMeans` / `offMeans` as well. Those fields stay in the catalogue JSON for operators; the public description still has to make sense on its own.

Good:

> ON while the bascules are up for river traffic. Flash a lamp or pause the garden when a ship is passing. Lift times: towerbridge.org.uk.

Bad:

> An amazing community lighting experience for London bridge fans!!!!

## Images

Every public switch needs an **icon** and a **banner**. The apply command rasterises SVG from `catalogue/lib/artwork.js` and the API re-hosts WebP.

| Asset | Size | Use |
|---|---|---|
| Icon | 256×256, rounded square | Card and detail title. It is 48px on the card, so the glyph must read at a glance. |
| Banner | 1600×900 | Card strip, detail hero. No fine detail in the lower third (the overlay sits there). |

Rules:

- Dark ground `#121212`, amber `#FF9800`, teal `#10B981`. One accent per switch.
- **No lettering in the image.** Names belong in the title field. (They wrap, translate, and remain selectable.)
- One glyph. No collage, no photograph of a person, no flag except the Pride stripes (which are the glyph).
- Do not use a third-party logo you do not have rights to. Parliament’s portcullis, the White House silhouette as a generic dome, a menorah, a crescent — symbols, not trademarks.
- Prefer the built-in `art` keys. Add a new key in `artwork.js` rather than hotlinking a random URL. Hotlinked images are fetched once, re-encoded, and then the original can rot.

When you add art, check it at 48px. If the glyph vanishes, simplify.

## Identity

`id` is lowercase kebab-case and never changes. `index` is the v2 key index and **never reused**. The UID is derived from the catalogue seed plus index. Changing either mint a different switch and abandon subscribers.

To correct copy or art, edit the JSON and run `apply --only <id>`. Office-holder names are rewritten by the Wikidata observer; do not hand-edit them unless the feed is wrong.

## State

| `schedule.kind` | When it is ON |
|---|---|
| `observe` | Last value written by `cli.js observe` from `schedule.source` (bridges, sittings, offices, storms, elections, Tube, quakes, launches, volcanoes, GDACS). Silent past `staleAfterHours` (default 24) is treated as OFF. |
| `manual` / `held` | Operator-held leftovers. Do not add new ones; wire a source instead. |
| `windows` | Inside explicit UTC intervals (lunar holidays, Easter, Eid). |
| `annual` | That UTC month/day every year (Christmas). |
| `month` | That UTC month (Pride). |
| `nth_weekday` | e.g. last Saturday of March (Earth Hour). |
| `full_moon` | UTC civil day of each listed instant. |

Calendar switches are UTC on purpose. Local midnight is not something a global directory can know. Say so in the description when it matters.

`node catalogue/cli.js observe` fetches live sources, writes JSON, and pushes ON/OFF. A systemd timer runs it every five minutes. A fetch error must not flip the switch until `observedAt` is older than `staleAfterHours` (per listing, default 24 hours; bridges, Tube and launches use 2; quakes, volcanoes and GDACS use 6; offices use 72). Then it is forced OFF and `params.stale` is set, so a dead feed cannot leave Tower Bridge “open” overnight. A listing that has never fetched successfully is not treated as stale — seed those OFF.

When an office-holder changes, the observer updates `name` / description / `schedule.params` and keeps the same `id` / `index`. A missing English label must not fall back to the Wikidata Q-id.

## Adding quickly

```bash
cd /var/www/VomeSync-server
node catalogue/cli.js add --apply --json "$(cat <<'EOF'
{
  "id": "nowruz",
  "name": "Nowruz",
  "description": "ON on 21 March UTC, the spring new year. A light-the-house switch for the equinox. Local observance can spill into 20 or 22 March.",
  "location": "Worldwide",
  "category": "Holiday",
  "link": "https://en.wikipedia.org/wiki/Nowruz",
  "art": "new-year",
  "onMeans": "It is 21 March, UTC.",
  "offMeans": "It is any other UTC day.",
  "schedule": { "kind": "annual", "month": 3, "day": 21 }
}
EOF
)"
```

Reuse an existing `art` key if the glyph is close enough. Add a new glyph when it is not.

If the public listing is already at the premium cap, grant premium to the catalogue owner (`grant-premium`) or raise `PREMIUM_MAX_PUBLIC_SWITCHES` (default 120).

Do not pad the directory with more holidays, sports, stocks, weather, sun/moon, extra Tube lines, or extra USGS quakes. Those already have Home Assistant integrations, or they are calendar events. Add live civic feeds (offices, movable bridges, launches, volcanoes, disaster alerts) instead.

* [x] **Create repo + baseline app**

    * [x] Initialize Next.js (JS-only) project
    * [x] Install TailwindCSS and set up global styles
    * [x] Install Convex client/server packages
    * [x] Add basic layout shell (header + main content)
    * [x] Add `NEXT_PUBLIC_CONVEX_URL` placeholder to `.env.local`

* [ ] **Set up Convex backend**

    * [x] Initialize Convex in the repo
    * [x] Create initial Convex folder structure:

        * [x] `convex/schema.js` (optional v1)
        * [x] `convex/crons.js`
        * [x] `convex/settings.js`
        * [x] `convex/weather.js`
        * [x] `convex/polymarket.js`
        * [x] `convex/dashboard.js`
    * [ ] Deploy Convex dev environment and confirm the dashboard can connect

* [x] **Define constants + “dayKey” utilities (shared logic)**

    * [x] Implement `America/Chicago` dayKey function (`YYYY-MM-DD` in Chicago local time)
    * [x] Implement UTC ↔ local conversions for display fields
    * [x] Decide and document the “day reset” rule (midnight America/Chicago)

* [x] **Create DB collections (start schemaless, but implement consistent shapes)**

    * [x] `settings` (singleton)
    * [x] `marketDays`
    * [x] `polymarketEvents`
    * [x] `polymarketBins`
    * [x] `observations`
    * [x] `dailyStats`
    * [x] `alerts`
    * [x] `calibrationRuns`
    * [x] Add indexes where it matters (later if you skip schema initially):

        * [x] `marketDays.dayKey`
        * [x] `polymarketBins.dayKey`
        * [x] `observations.dayKey`
        * [x] `dailyStats.dayKey`
        * [x] `alerts.dayKey`

* [x] **Implement settings bootstrap (required before anything else)**

    * [x] Create mutation `settings.upsertSettings()`
    * [x] Store:

        * [x] `station = "KORD"`
        * [x] `timezone = "America/Chicago"`
        * [x] `pollIntervalSeconds = 60`
        * [x] `stalePollSeconds` (e.g., 180)
        * [x] Weather endpoints:

            * [x] Primary: `https://tgftp.nws.noaa.gov/data/observations/metar/stations/KORD.TXT`
            * [x] Backup: `https://aviationweather.gov/api/data/metar?ids=KORD&format=json`
        * [x] WU emulation method placeholder (to be filled after calibration):

            * [x] `tempExtraction = "TGROUP_PREFERRED" | "METAR_INTEGER_C"`
            * [x] `rounding = "NEAREST" | "FLOOR" | "CEIL" | "MAX_OF_ROUNDED"`
    * [x] Create query `settings.getSettings()`
    * [x] Add a simple `/settings` page to view/edit key settings

* [x] **Build weather parsing utilities (pure functions + unit tests)**

    * [x] Implement parser for NWS `KORD.TXT`:

        * [x] Extract raw METAR line
        * [x] Extract observation Zulu timestamp from METAR (`DDHHMMZ`)
        * [x] Produce `{ rawMetar, obsZuluStamp, source: "NWS" }`
    * [x] Implement parser for AWC JSON:

        * [x] Extract `rawOb` (raw METAR)
        * [x] Extract `obsTime` or report timestamp
        * [x] Produce `{ rawMetar, obsZuluStamp, source: "AWC" }`
    * [x] Implement METAR temperature extraction:

        * [x] Parse T-group when present (`TsnTTTsnTTT` style → tenths °C)
        * [x] Fallback to standard temp/dew group (`M02/M09`, `15/02`, etc. → integer °C)
    * [x] Implement conversion:

        * [x] `tempF = tempC * 9/5 + 32`
    * [x] Implement WU-like whole °F rounding function with configurable rule:

        * [x] Nearest
        * [x] Floor
        * [x] Ceil
        * [x] Max-of-rounded (if you decide to test it)
    * [x] Add unit tests with a handful of real METAR examples (including negative temps + T-group present/absent)

* [x] **Implement Polymarket Gamma import (Action + parsing + storage)**

    * [x] Create Action `polymarket.importEventBySlugOrUrl(input)`

        * [x] If input is URL, extract slug from path
        * [x] Fetch `GET https://gamma-api.polymarket.com/events/slug/{slug}`
        * [x] Normalize event fields (`eventId`, `slug`, `title`, `endDate`)
        * [x] Normalize markets list → bins:

            * [x] Prefer `lowerBound`/`upperBound` when present
            * [x] Fallback parse bounds from `question` text if bounds missing
            * [x] Identify token IDs from `clobTokenIds` aligned to outcomes
            * [x] Create `label`, `lowerBoundF`, `upperBoundF`, open-ended flags, `orderIndex`
    * [x] Create Mutations:

        * [x] `polymarket.upsertEvent(event)`
        * [x] `polymarket.replaceBinsForDay(dayKey, eventId, bins[])`
        * [x] `polymarket.setActiveMarketForDay(dayKey, eventId, slug)`
    * [x] Create Queries:

        * [x] `polymarket.getActiveMarket(dayKey)`
        * [x] `polymarket.getBins(dayKey)` (sorted)
    * [x] Add `/market` page:

        * [x] Input box for URL/slug
        * [x] “Import” button → calls action
        * [x] Preview event title + bins table
        * [x] “Set Active for Today” button → mutation sets `marketDays.dayKey.activeEventId`

* [x] **Create core weather polling Action (single source of truth)**

    * [x] Create Action `weather.pollWeatherAndUpdateState()`

        * [x] Read `settings`
        * [x] Compute `dayKey` (America/Chicago)
        * [x] Fetch NWS primary

            * [x] If fetch or parse fails → log error and failover to AWC
        * [x] Fetch AWC backup only when needed
        * [x] Build an `obsKey` for dedupe (e.g., `station|obsZuluStamp|rawMetarHash`)
        * [x] If obs already exists for this dayKey → still update poll health timestamps, then return
        * [x] Extract temperature per WU-emulation config:

            * [x] temp extraction method (T-group preferred vs integer C)
            * [x] conversion + rounding
            * [x] produce `wuLikeTempWholeF`
        * [x] Write observation + update dailyStats + evaluate bins + emit alerts (via mutations below)
    * [x] Create Mutations used by the poller:

        * [x] `weather.insertObservationIfNew(dayKey, obsKey, payload)`
        * [x] `weather.upsertDailyStats(dayKey, payload)`
        * [x] `weather.insertAlert(dayKey, type, payload)`
        * [x] `weather.upsertBinStatuses(dayKey, statuses[])` (or compute bin status on read if you prefer)
    * [x] Implement dedupe invariant:

        * [x] “same obsKey never inserts twice”
        * [x] “highSoFar only increases”
    * [x] Implement failover tracking:

        * [x] If primary fails and backup succeeds → emit `SOURCE_FAILOVER` alert (optional)

* [x] **Implement bin evaluation logic (hard eliminations)**

    * [x] For the active dayKey, load today’s bins (if any)
    * [x] Compute status per bin using `highSoFarWholeF`:

        * [x] `DEAD` if upperBound exists and `upperBound < highSoFar`
        * [x] `ALIVE` otherwise
        * [x] `CURRENT` if highSoFar falls within bounds (including open-ended)
    * [x] When a bin becomes DEAD for the first time:

        * [x] Store `deadSinceLocalTime`
        * [x] Emit `BIN_ELIMINATED` alert with which bin + new high

* [x] **Implement freshness + “STALE” detection (separate poll health vs obs age)**

    * [x] In `dailyStats`, store:

        * [x] `lastSuccessfulPollLocal`
        * [x] `lastObservationTimeLocal`
        * [x] `pollStaleSeconds = now - lastSuccessfulPoll`
        * [x] `isStale = pollStaleSeconds > stalePollSeconds`
        * [x] `activeMarketSet` boolean
    * [x] Emit `DATA_STALE` alert when crossing into stale state
    * [x] Emit “back to healthy” alert when recovering (optional)

* [ ] **Schedule Convex cron**

    * [x] In `convex/crons.js`:

        * [x] Schedule `weather.pollWeatherAndUpdateState` every minute
    * [ ] Deploy Convex and verify cron runs (check `lastSuccessfulPollLocal` updates)

* [x] **Build dashboard queries (single payload to power the UI)**

    * [x] Query `dashboard.getDashboard(dayKey)` returning:

        * [x] settings summary
        * [x] active market metadata (or null)
        * [x] bins (sorted) with statuses
        * [x] dailyStats (current temp, high so far, time of high, freshness flags)
        * [x] latest N observations (for context)
        * [x] latest N alerts
    * [x] Query `dashboard.getHealth()` returning:

        * [x] last poll success time
        * [x] whether market is set for today
        * [x] recent errors count (if you track)

* [x] **Build Next.js pages (wire everything to Convex subscriptions)**

    * [x] `/` Dashboard “Golden Screen”

        * [x] Big: Current WU-like temp (whole °F)
        * [x] Big: High so far + time
        * [x] Big banner: STALE / OK
        * [x] Active market title + end date (if set)
        * [x] Bin ladder:

            * [x] DEAD bins greyed out
            * [x] CURRENT highlighted
            * [x] show “dead since HH:MM” if available
        * [x] Small panel: last obs time + source + raw METAR (expand/collapse)
        * [x] Alerts feed (most recent first)
    * [x] `/market` Market Picker

        * [x] Import + preview + set active for today
        * [x] Show warning if bounds parsing failed for any market
    * [x] `/observations`

        * [x] Table of observations (time, temp, new-high flag, raw METAR)
    * [x] `/alerts`

        * [x] Filterable alert timeline
    * [x] `/settings`

        * [x] Edit staleness threshold + rounding method + extraction method
    * [x] `/health`

        * [x] Cron last run time, last successful poll, active market set, stale status

* [ ] **Add “manual trading runbook” UI elements**

    * [ ] On dashboard, include a “Trading Checklist” box that updates live:

        * [ ] If STALE → “Do not trade”
        * [ ] If market not set → “Import today’s market”
        * [ ] If new high just happened → “Bins with upperBound < high are now impossible”
    * [ ] Add quick copy text:

        * [ ] `HighSoFarWholeF`
        * [ ] List of newly dead bins since last update

* [x] **Calibration module (Truth Engine)**

    * [x] `/calibration` page:

        * [x] Input a list of dates (or a date range)
        * [x] For each date, manually enter WU final daily high (whole °F)
        * [x] “Run calibration” button
    * [x] Convex Action `calibration.runCalibration(dateRange, wuValues[])`

        * [x] Fetch historical obs from IEM `asos.py` (routine + specials)
        * [x] Compute candidate highs for each tested method:

            * [x] integer °C method
            * [x] T-group method
            * [x] rounding variants
        * [x] Compare against manual WU highs
        * [x] Store results in `calibrationRuns`
        * [x] Output best method + mismatch list
    * [x] UI: show match rate table + mismatched dates
    * [x] Button: “Adopt best method” → writes to `settings`

* [ ] **End-to-end verification checklist (before real use)**

    * [ ] Import a real Polymarket event and confirm bins match the site
    * [ ] Confirm dayKey changes at Chicago midnight (simulate by overriding clock)
    * [ ] Confirm new observation dedupe works (same METAR doesn’t spam)
    * [ ] Confirm highSoFar only increases
    * [ ] Confirm bin elimination triggers exactly when `highSoFar` exceeds upperBound
    * [ ] Confirm STALE banner triggers only when polling fails (not when METAR is simply old)
    * [ ] Confirm failover to AWC when NWS file is unreachable
    * [ ] Confirm dashboard updates live without refresh (Convex subscription working)

* [ ] **Deployment checklist**

    * [ ] Deploy Next.js to Vercel
    * [ ] Set `NEXT_PUBLIC_CONVEX_URL` in Vercel env
    * [ ] Deploy Convex production
    * [ ] Confirm Convex cron runs in prod and updates `lastSuccessfulPollLocal`
    * [ ] Confirm `/health` shows OK in prod

* [ ] **Daily operating checklist (your manual routine)**

    * [ ] Open `/market` → paste today’s event URL/slug → Import → Set Active for Today
    * [ ] Open `/` dashboard → verify:

        * [ ] Active market title correct
        * [ ] Feed is OK (not STALE)
        * [ ] Observation time is updating normally
    * [ ] During the day, only act when:

        * [ ] NEW HIGH alert fires, and/or
        * [ ] BIN ELIMINATED alert fires
    * [ ] If STALE appears:

        * [ ] Pause trading decisions until feed recovers
    * [ ] After the day:

        * [ ] Screenshot/record WU final high
        * [ ] Add it to `/calibration` dataset when convenient

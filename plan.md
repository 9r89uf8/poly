Below is the **combined, full end‑to‑end plan**

## 0) Manifesto: what we’re building

You’re building an **Oracle Terminal** for temperature markets:

A web dashboard that tells you—**fast and reliably**:

1. **What the oracle will likely print** (Weather Underground–aligned, integer °F, calibrated)
2. **Today’s high so far** (the only state variable that matters for settlement)
3. **Which Polymarket bins are now dead** (hard eliminations)
4. Whether your feed is **healthy or broken** (broken = don’t trade)

### What it is not

* Not an order bot (you trade manually).
* Not a traditional weather app.
* Not “true runway physics.” It’s **oracle‑aligned intelligence**.

### North star

**Trade the oracle, not the atmosphere.**
WU is the settlement source, and WU describes airport ASOS observations as “updated hourly, or more frequently when adverse weather affecting aviation occurs.” ([Weather Underground][1])

---

## 1) Oracle definition: what settles this market

From your rules:

* **Station:** Chicago O’Hare Intl Airport Station (KORD)
* **Metric:** highest temperature recorded on the date
* **Precision:** whole degrees Fahrenheit
* **Resolution source:** Weather Underground daily history page (finalized)

This creates one big implication:

> Your “truth” is **WU’s final daily high**, not whatever a different weather app or the ASOS phone line said intraday.

---

## 2) Tech stack & responsibilities

### Next.js (JavaScript only)

* Hosts the **dashboard** and other pages.
* Accepts “paste Polymarket event URL/slug” for **one‑click daily setup**.
* Subscribes to Convex **queries** for live UI updates (reactive terminal feel).

### Convex (DB + backend brain + cron)

Convex is where the “terminal logic” lives.

* **Queries:** realtime dashboard reads (cached + subscribable). ([Convex Developer Hub][2])
* **Mutations:** transactional writes (dedupe + invariants). ([Convex Developer Hub][2])
* **Actions:** external HTTP calls (weather + Polymarket Gamma). ([Convex Developer Hub][2])
* **Cron jobs:** run polling reliably every minute (without Vercel cron hacks). ([Convex Developer Hub][3])

### TailwindCSS

* “Trading terminal UI”: big numbers, clear badges, dead bins greyed out, alert banners.

### Vercel

* Hosts Next.js.
* Stores `NEXT_PUBLIC_CONVEX_URL` environment variable.
* **Important:** per‑minute polling happens in Convex Cron, not Vercel. ([Convex Developer Hub][3])

---

## 3) Data sources

### Weather inputs (fast enough to beat WU refresh / weather apps)

#### Primary: NWS TGFTP station METAR file (KORD.TXT)

* NWS says the FTP dataset is updated **every two to five minutes** with the latest information received. ([National Weather Service][4])
* You fetch one tiny file and parse it.

```text
https://tgftp.nws.noaa.gov/data/observations/metar/stations/KORD.TXT
```

#### Backup: AviationWeather.gov (AWC) Data API (JSON)

* AWC explicitly states: rate limited to **100 requests/min**, and endpoints should not be consumed more frequently than **1 request/min per thread**. ([Aviation Weather Center][5])

```text
https://aviationweather.gov/api/data/metar?ids=KORD&format=json
```

**Why we don’t do 10‑second polling:** it risks getting blocked and usually doesn’t add info because METAR/SPECI updates are discrete events.

#### Not for realtime: IEM “1‑minute archive”

IEM says the 1‑minute archive is **not realtime** and is delayed **18–36 hours or more** (NCEI availability). ([Iowa Environmental Mesonet][6])
Use it for calibration/backtests only.

### Historical sources (for calibration/backtests)

#### IEM METAR/ASOS history API (`asos.py`)

* Lets you pull historical observations + raw METAR with report type filters.
* Report types include: `3 (Routine)` and `4 (Specials)` (and `1 (HFMETAR)` if needed). ([Iowa Environmental Mesonet][7])
* It also has rate limits / load protections—build calibration jobs politely. ([Iowa Environmental Mesonet][7])

---

### Polymarket inputs (dynamic bins)

#### Gamma API (read‑only)

* Polymarket docs: fetching market data requires **no API key, no authentication, no wallet required**. ([Polymarket Documentation][8])
* Gamma endpoint base: shown in docs. ([Polymarket Documentation][9])

```text
https://gamma-api.polymarket.com
```

#### One-click event import

Docs show:

```text
GET https://gamma-api.polymarket.com/events/slug/{slug}
```

([Polymarket Documentation][10])

#### Bounds on markets

The Gamma markets API response includes `lowerBound` and `upperBound` fields (as strings) in the documented schema. ([Polymarket Documentation][11])

---

## 4) The core model: the only state variables that matter

Everything the terminal shows derives from these:

### Day key (must be Chicago local)

* `dayKey = YYYY-MM-DD` in **America/Chicago**
* Do **not** use server UTC date; always compute in the Chicago timezone.

### WU‑like current temp (whole °F)

* `currentTempWholeF` = your **calibrated** “WU emulation rule” applied to the latest observation.

### High so far (whole °F)

* `highSoFarWholeF = max(highSoFarWholeF, currentTempWholeF)`
* Always running from local midnight.

This is what eliminates bins.

---

## 5) WU Oracle Emulator: the Truth Engine (critical)

You *must* answer:

> “Given KORD observations, what transformation best reproduces WU’s final daily ‘High Temp’?”

### Why this is non-trivial

IEM explicitly warns that people get burned by:

* unit conversion & rounding behavior,
* different averaging windows,
* and misunderstanding how “official” daily highs are defined. ([Iowa Environmental Mesonet][12])

Your market resolves on WU, not “official climate,” but the warning still applies: **you need to match WU’s pipeline.**

### Calibration workflow (simple + bulletproof)

#### Step A — Build a labeled dataset

Pick 30–90 historical days (ideally winter + boundary days).

For each day:

* Manually record **WU High Temp (whole °F)** from the WU daily history page for KORD.
* Store in `calibrationInputs`.

#### Step B — Pull matching historical observations

Use IEM `asos.py` to retrieve KORD obs for each day:

* include both routine + specials: `report_type=3,4` ([Iowa Environmental Mesonet][7])
* request at least: `metar` and/or `tmpf` (depending on your approach). ([Iowa Environmental Mesonet][7])

#### Step C — Test candidate emulation rules

At minimum test these candidates:

1. **Use METAR temp group** (integer °C)
   → convert to °F → apply rounding rule
2. **Use METAR “T-group”** (tenths °C in remarks when present)
   → convert to °F → apply rounding rule
3. Optionally: if your historical source provides Fahrenheit directly (`tmpf`), test using it.

Then try rounding rules:

* round to nearest whole °F
* floor
* ceil
* “max of already-rounded observations”

#### Step D — Choose the best method and lock it into `settings`

Store:

* extraction method: `tGroupPreferred` / `metarIntegerC`
* rounding: `nearest` / `floor` / …
* match rate
* mismatch notes (dates/regimes)

**Deliverable:** the dashboard’s temps become “WU-like,” not “weather-app-like.”

---

## 6) One-click Polymarket market discovery + import

### User flow (once per day)

1. Open your site → `/market`
2. Paste **Polymarket event URL or slug**
3. Click **Import**
4. Confirm the bins list looks right
5. Click **Set Active for Today**

### Backend logic

Convex Action: `importPolymarketEventBySlug(slugOrUrl)`

**Input accepted**

* Full URL → extract slug from pathname
* or slug directly

**Fetch**

* `GET /events/slug/{slug}` (Gamma). ([Polymarket Documentation][10])

**Normalize**
For each market under the event:

* `marketId`
* `question`
* `outcomes`, `outcomePrices` (map 1:1 per docs) ([Polymarket Documentation][8])
* `clobTokenIds` (store for UI display)
* `lowerBound`, `upperBound` when present ([Polymarket Documentation][11])

**Bin record creation**
Create a `polymarketBins` record for each market with:

* `label` (e.g., “30–31°F”, “34°F or higher”)
* parsed bounds:

    * `lowerBoundF` (nullable)
    * `upperBoundF` (nullable)
    * open-ended flags (≥ / ≤)
* `orderIndex` to sort bins properly
* `yesTokenId` / `noTokenId` mapping (based on outcomes array order)

**Why this is robust**

* Bins change daily? You import daily. No hardcoding.
* Bounds missing? Fallback parse from the question string.

---

## 7) Convex backend: functions, cron, and invariants

### Convex function types (how we’ll use them)

* **Queries:** dashboard reads, realtime subscriptions. ([Convex Developer Hub][2])
* **Mutations:** idempotent writes + dedupe + state transitions. ([Convex Developer Hub][2])
* **Actions:** weather fetches + Gamma fetches. ([Convex Developer Hub][2])

### Cron jobs (every minute)

Convex Cron can run **an internal mutation or internal action** every minute. ([Convex Developer Hub][3])

Important cron guarantee:

* At most one run of a cron job executes at a time; if a run takes too long, later runs can be skipped. ([Convex Developer Hub][3])
  So your polling action must be fast and resilient.

#### Cron 1: `poll_weather_kord` (every minute)

* runs action `pollWeatherAndUpdateState`

#### Cron 2 (optional): `refresh_active_market_prices` (every 2–5 minutes)

* refresh Gamma prices for the active market so your terminal shows price snapshots
* still read-only

---

## 8) The heart of the system: `pollWeatherAndUpdateState()` pipeline

This is the minute-by-minute engine.

### Step 1 — Fetch latest observation (primary then backup)

**Primary:** fetch KORD.TXT

* parse:

    * METAR string line
    * observation timestamp group inside METAR (`DDHHMMZ`)
* NWS updates this dataset every 2–5 minutes. ([National Weather Service][4])

**Backup:** fetch AWC JSON

* obey the “~1 request/min/thread” guidance. ([Aviation Weather Center][5])

### Step 2 — Dedupe

Create an `obsKey`, for example:

* `obsKey = station + "|" + metarTimestampZulu + "|" + rawMetar`

If `obsKey` already exists for today, don’t reprocess as “new observation.”

### Step 3 — Compute WU-like whole °F

Use your calibrated WU emulation rule from settings (Part 5).

Store:

* `wuLikeTempWholeF`
* optionally the underlying unrounded °F you computed (useful for debugging)

### Step 4 — Update dailyStats

* `currentTempWholeF = wuLikeTempWholeF`
* `highSoFarWholeF = max(previousHigh, currentTempWholeF)`
* if new high:

    * store `timeOfHighLocal`
    * emit alert `NEW_HIGH`

### Step 5 — Bin evaluation for the active market dayKey

If no market imported for today:

* set daily banner/alert `MARKET_NOT_SET`
* still track the weather state

Else:

* recompute each bin status:

    * `DEAD` if upperBoundF is not null and `upperBoundF < highSoFarWholeF`
    * `ALIVE` otherwise
    * `CURRENT` if `lowerBoundF <= highSoFarWholeF <= upperBoundF` (or open-ended rules)

When a bin becomes DEAD for the first time:

* record `deadSinceLocalTime`
* emit alert `BIN_ELIMINATED`

### Step 6 — Health & freshness (don’t confuse “no new METAR” with “system stale”)

Track two separate “ages”:

1. **Poll health** (system freshness):

    * time since last successful fetch+parse
    * if > N minutes (e.g., 3), show **STALE** banner

2. **Observation age** (how old the latest METAR is):

    * normal to be 30–60 minutes old in calm conditions
    * show it, but don’t treat it as system failure

---

## 9) Database design (v1 schema)

You can start schemaless, but the conceptual tables below will keep you sane.

### `settings` (singleton)

* `station = "KORD"`
* `timezone = "America/Chicago"`
* polling intervals
* staleness thresholds
* WU emulation method config

### `marketDays`

Keyed by `dayKey`:

* `dayKey`
* `activeEventSlug`
* `activeEventId`
* `importedAt`
* `status: ACTIVE | ENDED | ARCHIVED`

### `polymarketEvents`

* `eventId`, `slug`, `title`, `endDate`, `resolutionSource`, etc.

### `polymarketBins`

* `dayKey`
* `eventId`
* `marketId`
* `label`
* `lowerBoundF` (nullable)
* `upperBoundF` (nullable)
* `isLowerOpenEnded`, `isUpperOpenEnded`
* `yesTokenId`, `noTokenId`
* `orderIndex`

### `observations`

* `dayKey`
* `obsTimeUTC`, `obsTimeLocal`
* `source: NWS | AWC`
* `rawMetar`
* `wuLikeTempWholeF`
* flags: `isNewHigh`

### `dailyStats`

* `dayKey`
* `currentTempWholeF`
* `highSoFarWholeF`
* `timeOfHighLocal`
* `lastObsTimeLocal`
* `lastSuccessfulPollLocal`
* `pollStaleSeconds`
* `isStale` boolean
* `activeMarketSet` boolean

### `alerts`

* `dayKey`
* timestamp
* `type: NEW_HIGH | BIN_ELIMINATED | DATA_STALE | MARKET_NOT_SET | SOURCE_FAILOVER`
* payload

### `calibrationRuns`

* date range
* methods tested
* match rate vs WU (manual inputs)
* chosen method
* mismatch notes

---

## 10) Next.js site map (Oracle Terminal UI)

### `/` Dashboard (Golden Screen)

Show, big and obvious:

* **Today (dayKey in America/Chicago)**

* **Active event** (title, end date)

* **Feed health**

    * OK / STALE banner
    * last successful poll time
    * last METAR timestamp and “age”
    * which source (NWS vs AWC)

* **Current WU-like temp** (whole °F)

* **High so far** + time of occurrence

* **Bin ladder**

    * sorted bins
    * DEAD bins grey
    * CURRENT bin highlighted
    * “dead since HH:MM” tags
    * optional: show current Yes/No price snapshot (if you implement price refresh)

### `/market` Market Picker

* paste URL/slug → import → preview bins → “Set Active for Today”
* includes safeguards:

    * show event title and market count
    * warning if bounds parsing failed for any bin

### `/observations`

* last N obs rows
* highlight rows that created new highs

### `/alerts`

* chronological timeline
* filters by type

### `/calibration`

* input WU highs for selected dates
* run comparisons vs IEM historical data (`asos.py`)
* pick emulator method and save to settings

### `/settings`

* thresholds (poll frequency, stale threshold)
* station/timezone locked (KORD, America/Chicago)

### `/health`

* cron last run time
* last poll success
* error logs count
* market set for today? yes/no

---

## 11) Deployment & ops

### Vercel

* deploy Next.js
* set:

    * `NEXT_PUBLIC_CONVEX_URL`

### Convex

* deploy backend with:

    * functions (queries/mutations/actions)
    * `crons.ts` that schedules the polling every minute. ([Convex Developer Hub][3])

### Operational guardrails

* Weather polling always runs; market import is separate.
* If primary source fails, auto-failover to backup.
* If both fail: raise `DATA_STALE` and keep the last known state.

---

## 12) Manual trading runbook (your daily process)

### A) Daily setup (60 seconds)

1. Open `/market`
2. Paste today’s Polymarket event URL/slug → Import
3. Confirm bins match Polymarket
4. Click **Set Active for Today**
5. Go to dashboard and confirm:

    * Active event title is correct
    * Feed health is OK

### B) Before any trade

1. If dashboard says **STALE** → don’t trade (you’re blind).
2. Check **High So Far** (drives eliminations).
3. Look at latest alerts (NEW HIGH / BIN ELIMINATED).

### C) “Certainty edge” moment (hard eliminations)

When **High So Far** increases, some bins become **mathematically impossible**:

* For each bin: if `upperBound < highSoFar` → that bin’s “Yes” is dead.

If Polymarket pricing doesn’t reflect that immediately, that’s your cleanest manual action signal.

### D) Log what you did

Write down:

* timestamp
* highSoFar value
* which bins became dead
* what you traded

This improves your intuition and helps debug any mismatch days.

### E) After day ends

* Record your terminal’s final `highSoFarWholeF`
* Next day, confirm WU final value and archive it for calibration improvement

---

## 13) Concrete endpoints (copy/paste)

### Weather

```text
Primary (NWS station METAR text)
https://tgftp.nws.noaa.gov/data/observations/metar/stations/KORD.TXT

Backup (AviationWeather.gov JSON; obey 1 req/min/thread guidance)
https://aviationweather.gov/api/data/metar?ids=KORD&format=json
```

NWS update cadence: every 2–5 minutes. ([National Weather Service][4])
AWC rate guidance: 100/min overall, ~1/min/thread. ([Aviation Weather Center][5])

### Polymarket (read-only Gamma)

```text
Gamma base:
https://gamma-api.polymarket.com

Import event by slug:
GET https://gamma-api.polymarket.com/events/slug/{slug}
```

No auth needed for market data. ([Polymarket Documentation][8])

---

## 14) Build order (so you actually ship it)

### v0 (1–2 sessions)

* Hardcode an example market/bins
* Implement weather poll → highSoFar → dead bins

### v1 (ship-worthy)

* Add `/market` one‑click import via Gamma
* Store active market per dayKey
* Add alerts + health

### v2 (the “edge”)

* Build calibration page + IEM backtest harness
* Lock in WU emulator method

### v3 (nice-to-haves)

* Price snapshots from Gamma
* Push alerts (SMS/Telegram)
* “Front day” warning heuristics

---

[1]: https://www.wunderground.com/about/data?utm_source=chatgpt.com "About Data"
[2]: https://docs.convex.dev/functions?utm_source=chatgpt.com "Functions | Convex Developer Hub"
[3]: https://docs.convex.dev/scheduling/cron-jobs "Cron Jobs | Convex Developer Hub"
[4]: https://www.weather.gov/tg/engfiles?utm_source=chatgpt.com "Text Parsed Data"
[5]: https://aviationweather.gov/data/api/?utm_source=chatgpt.com "Data API"
[6]: https://mesonet.agron.iastate.edu/ASOS/?utm_source=chatgpt.com "IEM :: ASOS/AWOS Network - Iowa Environmental Mesonet"
[7]: https://mesonet.agron.iastate.edu/cgi-bin/request/asos.py?help= "Iowa Environmental Mesonet"
[8]: https://docs.polymarket.com/quickstart/fetching-data?utm_source=chatgpt.com "Fetching Market Data"
[9]: https://docs.polymarket.com/developers/gamma-markets-api/overview?utm_source=chatgpt.com "Overview - Polymarket Documentation"
[10]: https://docs.polymarket.com/api-reference/events/get-event-by-slug?utm_source=chatgpt.com "Get event by slug"
[11]: https://docs.polymarket.com/api-reference/markets/list-markets?utm_source=chatgpt.com "List markets"
[12]: https://mesonet.agron.iastate.edu/onsite/news.phtml?id=1469&utm_source=chatgpt.com "Wagering on ASOS Temperatures - IEM"

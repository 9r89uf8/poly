# Progress Summary

## Snapshot
- Project: Oracle Terminal for KORD temperature markets (Next.js + Convex).
- Date context: Work completed through current session.
- Source of truth for scope: `plan.md` and `plan_checklist.md`.

## What Is Built
- Baseline Next.js app (JavaScript only) with Tailwind and Convex dependency.
- Shared app shell with navigation and core pages:
  - `/`
  - `/market`
  - `/settings`
  - `/observations`
  - `/alerts`
  - `/health`
  - `/calibration`
- Convex schema + backend modules:
  - `convex/schema.js`
  - `convex/settings.js`
  - `convex/weather.js`
  - `convex/polymarket.js`
  - `convex/dashboard.js`
  - `convex/crons.js`

## Weather Pipeline Status
- Weather parsing utilities implemented in `convex/lib/weather.js`:
  - NWS text parser (`KORD.TXT`) -> raw METAR + `DDHHMMZ`.
  - AWC JSON parser -> raw METAR + derived `DDHHMMZ`.
  - METAR temp extraction:
    - T-group preferred.
    - Integer C fallback.
  - Conversion and rounding:
    - `tempF = tempC * 9/5 + 32`
    - `NEAREST`, `FLOOR`, `CEIL`, `MAX_OF_ROUNDED`.
- Poll action implemented in `convex/weather.js`:
  - Reads settings and computes Chicago `dayKey`.
  - Fetches NWS primary, falls back to AWC on failure.
  - Builds dedupe key (`obsKey`) and prevents duplicate inserts.
  - Computes WU-like temp from configured method.
  - Updates `dailyStats` with monotonic `highSoFar`.
  - Tracks freshness state from poll health (`lastSuccessfulPollLocal`, `lastSuccessfulPollAtMs`, `pollStaleSeconds`, `isStale`).
  - Evaluates bin statuses and records first-time eliminations.
  - Emits alerts:
    - `NEW_HIGH`
    - `BIN_ELIMINATED`
    - `SOURCE_FAILOVER`
    - `DATA_STALE`
    - `DATA_HEALTHY`

## Polymarket Status
- Import action implemented in `convex/polymarket.js`:
  - Accepts slug or full URL.
  - Calls `GET /events/slug/{slug}` on Gamma.
  - Normalizes event + bins.
  - Uses `lowerBound/upperBound` when present.
  - Falls back to question parsing when bounds are missing.
  - Aligns `clobTokenIds` to Yes/No outcomes.
- Market page flow (`/market`) implemented:
  - Import event by slug/URL.
  - Preview title + bins + token ids.
  - Warn on bins with unparsed bounds.
  - Set active market for today (stores event + day bins + active mapping).

## Settings + Health Status
- Settings bootstrap and editor implemented (`/settings`):
  - Station/timezone defaults (`KORD`, `America/Chicago`).
  - Poll/stale thresholds.
  - Primary/backup weather endpoints.
  - Temp extraction + rounding methods.
- Fixed schema bug in `settings.upsertSettings`:
  - Undefined patch values no longer remove required fields.
  - Required fields (like `dayResetRule`) now persist correctly.
- Health query implemented in `convex/dashboard.js` and surfaced in `/health`, including cron last-run, last successful poll, stale state, poll age, and market readiness.

## Next.js Pages Status
- `/` dashboard upgraded to the Golden Screen:
  - Large current WU-like temp and high-so-far (+ time of high).
  - STALE/OK banner.
  - Active market title and end date.
  - Bin ladder with DEAD gray state, CURRENT highlight, and dead-since timestamps.
  - Latest observation panel with source/time and expandable raw METAR.
  - Recent alerts feed.
- `/market` supports import + preview + set-active flow and warns on bounds parsing failures.
- `/observations` table includes time, source, temp, new-high flag, and raw METAR.
- `/alerts` now provides a filterable timeline (type filter + text search).
- `/health` shows cron last run, last successful poll, stale status, poll stale seconds, and active market status.

## Calibration Status
- Calibration engine implemented in `convex/calibration.js`:
  - Action `calibration.runCalibration(dateRange, wuValues[])`.
  - Pulls historical observations from IEM `asos.py` using routine + specials (`report_type=3,4`) with METAR data.
  - Evaluates method matrix across:
    - `TGROUP_PREFERRED` and `METAR_INTEGER_C`
    - `NEAREST`, `FLOOR`, `CEIL`, `MAX_OF_ROUNDED`
  - Compares against manual WU daily highs.
  - Persists run summary in `calibrationRuns`.
  - Returns best method and mismatches for UI.
- Calibration page implemented at `/calibration`:
  - Date-range row generation and manual WU input grid.
  - Run button and match-rate results table.
  - Best-method mismatch table.
  - “Adopt best method” button writing to `settings.tempExtraction` and `settings.rounding`.
  - Recent calibration run history panel.

## Test Status
- Unit tests added for weather parsing in `tests/weather-parsing.test.js`.
- Freshness unit tests added in `tests/freshness.test.js`.
- Calibration utility tests added in `tests/calibration-utils.test.js`.
- Current test command: `npm test`.
- Latest result in this session: passing.

## Checklist Progress (High Level)
- Completed:
  - Create repo + baseline app
  - Define constants + dayKey utilities
  - Create DB collections and core indexes
  - Implement settings bootstrap
  - Build weather parsing utilities + tests
  - Implement Polymarket import flow
  - Create core weather polling action
  - Implement bin evaluation logic
  - Implement freshness + stale transition detection
  - Build dashboard queries
  - Build Next.js pages (Convex subscriptions wired)
  - Calibration module (Truth Engine)
- Partially complete:
  - Set up Convex backend (dev deploy verification still open)
  - Schedule Convex cron (runtime verification still open)
- Not complete yet:
  - Manual trading runbook UI components
  - End-to-end verification checklist
  - Deployment checklist and daily operating checklist

## Current Working URLs (App Routes)
- `/`
- `/market`
- `/settings`
- `/observations`
- `/alerts`
- `/health`
- `/calibration`

## External Weather URLs Required In Settings
- Primary:
  - `https://tgftp.nws.noaa.gov/data/observations/metar/stations/KORD.TXT`
- Backup:
  - `https://aviationweather.gov/api/data/metar?ids=KORD&format=json`

## Resume Point
- Next recommended checklist item when work resumes:
  - `Schedule Convex cron` verification (`lastSuccessfulPollLocal` should advance every minute in deployed Convex).

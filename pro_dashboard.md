# Pro Dashboard Plan (Oracle-First, Implementation-Ready)

This plan replaces "automation-first telemetry" with a true trading terminal:

1. What the oracle will likely print (WU-like, whole F, calibrated)
2. High so far (the settlement state variable that matters)
3. Which bins are dead now (hard eliminations)
4. Whether data is healthy enough to trade

## 0) Non-Negotiable Rules

- Day boundary is always `America/Chicago` `dayKey`.
- Temperature shown for trading decisions is whole degrees Fahrenheit.
- Dashboard must make stale/broken feed obvious before showing trade cues.
- Bin elimination state must be visually primary, not buried in tabs.
- Automation decision telemetry is secondary to settlement state.

## 1) Screen Information Architecture (Top to Bottom)

## 1.1 Health Gate (First Thing On Screen)

- Show a top banner: `OK` or `STALE`.
- If stale, show last successful poll and poll age in seconds.
- If stale, show "Do not trade from this screen until feed recovers."
- Source fields to show: weather source and last METAR observation time.

Data source:
- `api.dashboard.getDashboard({ dayKey, observationsLimit, alertsLimit })`
- `api.dashboard.getHealth({ dayKey })`

## 1.2 Oracle State Strip (Primary Trading Stats)

- `Today (dayKey Chicago)`
- `Current WU-like temp (whole F)`
- `High so far (whole F)`
- `Time of high`
- `Active market title`

Data source:
- `api.dashboard.getDashboard`

## 1.3 Bin Ladder (Primary Action Surface)

- Sorted bins for active market day.
- States:
  - `DEAD` (greyed, with dead since time)
  - `CURRENT` (highlighted)
  - `ALIVE` (neutral)
- Show bounds (`upper/lower`) on every row.
- Optional later: show Yes/No prices next to each bin.

Data source:
- `api.dashboard.getDashboard` (`bins`, `activeMarket`)

## 1.4 Temperature Timeline (Context, Not Primary)

- X-axis: local time in Chicago for active `dayKey`.
- Y-axis: degrees Fahrenheit.
- Series:
  - METAR observations (`wuLikeTempWholeF`)
  - latest forecast hourly curve
  - call-derived temps (if present)
- Overlays:
  - decision markers (`CALL`, `CALL_FAILED`, `WOULD_CALL` in shadow mode)
  - horizontal line at latest `predictedMaxTempF`

Data source:
- `api.proDashboard.getDayForensics({ dayKey })`

## 1.5 Decision/Call Audit (Secondary, Expandable)

- Compact table with latest decisions:
  - time, window, action, reason code, call SID
- Compact table with call pipeline status:
  - time, status, parse ok, temp, error/warning

Data source:
- `api.autoCall.getRecentDecisions({ dayKey, limit })`
- `api.proDashboard.getCallsPipeline({ dayKey, limit })`

## 2) Existing Backend Surface to Reuse

Use existing APIs first; do not add new endpoints unless blocked.

- `api.dashboard.getDashboard`: current day market + bins + daily stats + obs + alerts
- `api.dashboard.getHealth`: stale status + active market presence + automation health fields
- `api.proDashboard.getDayForensics`: timeline-ready series and deep daily diagnostics
- `api.proDashboard.getHistoryRange`: multi-day summaries and cross-day phone temp series
- `api.proDashboard.getCallsPipeline`: call reliability and failure grouping
- `api.forecast.getLatestForecastSnapshot`: latest predicted max details
- `api.autoCall.getAutoCallState` + `api.autoCall.getRecentDecisions`: automation state/audit

## 3) Gap Fixes vs Current UI

Current app already has strong building blocks (`/`, `/history`, `/day/[dayKey]`, `/calls`, `/health`).
Main improvements needed:

- Promote health gating to a hard top-level banner with explicit "no-trade" state.
- Keep oracle state + bin ladder always above fold on `/`.
- Merge key timeline context into the main dashboard instead of requiring day-detail navigation.
- Add explicit dead-bin count and "newly dead in last 60m" badges.
- Add a "last state change" log line: high updated, bin died, feed recovered/staled.

## 4) Historical and Forensics Workflow

## 4.1 `/history` (Range Scan)

- Keep day range presets.
- Add columns:
  - `High - PredictedMax` delta
  - `Auto calls made`
  - `Would-call count` in shadow mode
- Sort newest first (already done).

Data source:
- `api.proDashboard.getHistoryRange`

## 4.2 `/day/[dayKey]` (Single-Day Debug)

- Keep timeline toggles and tabbed audit detail.
- Add settlement-focused callout card:
  - final high so far
  - first time high reached
  - bins dead at close
  - last forecast max before close

Data source:
- `api.proDashboard.getDayForensics`

## 5) Rollout Sequence (Fastest Safe Path)

## Phase A (Immediate)

- [ ] Upgrade `/` layout order to: Health -> Oracle State -> Bin Ladder -> Timeline -> Audit.
- [ ] Add stale no-trade banner logic and copy.
- [ ] Add dead-bin counters and recent eliminations pill.
- [ ] Surface predicted max/time beside current/high so forecast context is visible.

## Phase B (After A)

- [ ] Add compact decision strip directly on `/` from recent decisions.
- [ ] Add compact call pipeline strip directly on `/` from calls pipeline query.
- [ ] Add one-click jump links from `/` to `/day/{dayKey}` and `/history` with current filters.

## Phase C (Optional Edge)

- [ ] Add Polymarket price snapshots per bin.
- [ ] Add calibration confidence badge (based on recent calibration runs).
- [ ] Add operator "trade log note" capture tied to dayKey.

## 6) Acceptance Criteria

The dashboard is "good enough to trade" when all are true:

- Operator can tell in under 5 seconds: feed healthy or stale.
- Operator can tell in under 5 seconds: current temp, high so far, time of high.
- Operator can tell in under 10 seconds: which bins are dead/current/alive.
- Operator can validate timeline context without leaving `/`.
- Operator can audit why automation called/skipped from dashboard context.
- No timezone ambiguity: all displayed by Chicago local day and time.

## 7) Build Notes

- Keep JavaScript only.
- Reuse existing Convex queries and tables.
- Preserve source-of-truth boundaries:
  - settlement state from METAR pipeline (`dailyStats`, `observations`)
  - forecast is advisory
  - calls are directional telemetry and automation audit


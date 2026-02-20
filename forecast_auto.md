# Forecast Auto Plan (Canonical)

This is the single plan for forecast-driven airport call automation.
It is aligned to the current live codebase and keeps the existing Twilio pipeline intact.

## Goal

Use hourly forecast data to predict when daily max temperature is most likely, then call only in high-value windows to reduce unnecessary calls.

## Current System Baseline

1. Manual calls are triggered via `api.airportCalls.requestManualAirportCall`.
2. Twilio recording webhook and transcription flow are already working.
3. Market state (`currentTempWholeF`, `highSoFarWholeF`) is METAR-driven, not phone-call-driven.
4. Current cron only polls weather each minute (`convex/crons.js`).

## Non-Negotiable Rules

1. Do not bypass `requestManualAirportCall` for automated calls.
2. Phone call data remains directional only and does not affect settlement/high-so-far logic.
3. All automation decisions must be logged with reason codes.
4. Use America/Chicago day/time for planning and evaluation.

## Forecast Source

Use NWS hourly forecast:

1. `GET https://api.weather.gov/points/{lat},{lon}`
2. Read `properties.forecastHourly`
3. `GET {forecastHourly}` and parse `properties.periods`

Requirements:

1. Send a clear `User-Agent` header.
2. Persist forecast snapshots so decision runs are auditable.

## Architecture

### Layer 1: Forecast Refresh

1. Action fetches hourly forecast.
2. Computes `predictedMaxTempF` and `predictedMaxTimeLocal`.
3. Stores snapshot for current Chicago day.

### Layer 2: Auto-Call Decision

1. Action evaluates whether to call now.
2. Uses forecast snapshot + current observations + prior calls.
3. If conditions pass, calls `api.airportCalls.requestManualAirportCall({ requestedBy: "forecast_automation" })`.
4. Writes a decision record (`CALL` or `SKIP`) with reason code.

## Data Model Additions

### `forecastSnapshots`

1. `dayKey`
2. `fetchedAt`
3. `source`
4. `hourly`
5. `predictedMaxTempF`
6. `predictedMaxTimeLocal`

### `autoCallDecisions`

1. `dayKey`
2. `decisionKey` (idempotency key for each evaluation bucket)
3. `evaluatedAt`
4. `evaluatedAtLocal`
5. `decision` (`CALL` or `SKIP`)
6. `reasonCode`
7. `reasonDetail`
8. `window` (`PRE_PEAK`, `PEAK`, `POST_PEAK`, `OUTSIDE`)
9. `predictedMaxTimeLocal`
10. `callSid` (if call placed)

### `autoCallState` (daily)

1. `dayKey`
2. `enabled`
3. `shadowMode`
4. `autoCallsMade`
5. `lastAutoCallAt`
6. `lastDecisionAt`
7. `lastReasonCode`

## Settings Additions

1. `autoCallEnabled` (default `false`)
2. `autoCallShadowMode` (default `true`)
3. `autoCallMaxPerDay` (default `3`)
4. `autoCallMinSpacingMinutes` (default `45`)
5. `autoCallEvalEveryMinutes` (default `5`)
6. `autoCallPrePeakLeadMinutes` (default `90`)
7. `autoCallPrePeakLagMinutes` (default `30`)
8. `autoCallPeakLeadMinutes` (default `15`)
9. `autoCallPeakLagMinutes` (default `45`)
10. `autoCallPostPeakLeadMinutes` (default `90`)
11. `autoCallPostPeakLagMinutes` (default `180`)
12. `autoCallNearMaxThresholdF` (default `1`)

## Decision Algorithm

Inputs:

1. Latest forecast snapshot for current `dayKey`
2. `dailyStats` (`currentTempWholeF`, `highSoFarWholeF`, stale flags)
3. Recent observations (trend over recent non-duplicate points)
4. Latest/recent phone calls
5. Current `autoCallState`

Evaluation:

1. If disabled: `SKIP_DISABLED`
2. If no forecast: `SKIP_NO_FORECAST`
3. If stale weather system: `SKIP_DATA_STALE`
4. If call in flight (`REQUESTED`, `CALL_INITIATED`, `RECORDING_READY`): `SKIP_CALL_IN_FLIGHT`
5. If daily cap hit: `SKIP_DAILY_CAP`
6. If min spacing not met: `SKIP_MIN_SPACING`
7. Determine window relative to `predictedMaxTimeLocal`:
8. `PRE_PEAK`: `[maxTime-90m, maxTime-30m]`
9. `PEAK`: `[maxTime-15m, maxTime+45m]`
10. `POST_PEAK`: `[maxTime+90m, maxTime+180m]`
11. If outside all windows: `SKIP_OUTSIDE_WINDOW`
12. Compute:
13. `risingNow` from recent METAR-derived points
14. `nearForecastMax = abs(currentTempWholeF - predictedMaxTempF) <= threshold`
15. Call rules:
16. `PRE_PEAK`: call only if `risingNow` and `nearForecastMax`
17. `PEAK`: call if `nearForecastMax` or `risingNow`
18. `POST_PEAK`: call only if high changed recently or trend still rising
19. If call conditions pass:
20. If shadow mode: log would-call reason only
21. Else: invoke `requestManualAirportCall`
22. Always persist decision result and context

## Cron Plan

1. Keep existing `poll_weather_kord` at 1 minute.
2. Add `refresh_forecast_kord` every 60 minutes.
3. Add `evaluate_auto_call_need` every 5 minutes.

## Idempotency and Safety

1. Use `decisionKey = dayKey + rounded_5_minute_bucket`.
2. Upsert by `decisionKey` so repeated cron invocations do not duplicate actions.
3. Recheck spacing and in-flight status immediately before placing call.
4. Keep call execution through existing action to reuse cooldown and logging behavior.

## Reason Codes

1. `SKIP_DISABLED`
2. `SKIP_NO_FORECAST`
3. `SKIP_DATA_STALE`
4. `SKIP_CALL_IN_FLIGHT`
5. `SKIP_DAILY_CAP`
6. `SKIP_MIN_SPACING`
7. `SKIP_OUTSIDE_WINDOW`
8. `SKIP_PRE_PEAK_NOT_READY`
9. `SKIP_POST_PEAK_NO_UPTREND`
10. `CALL_PRE_PEAK`
11. `CALL_PEAK`
12. `CALL_POST_PEAK`
13. `CALL_FAILED`

## Optional Advanced Mode (Later)

If needed, add a planner that schedules specific one-off call checks with `ctx.scheduler.runAt()` and can cancel/replan with `ctx.scheduler.cancel()`.

Use this only after the decision-loop version is stable, because it adds lifecycle complexity.

## Rollout

### Phase 1: Shadow Mode

1. `autoCallEnabled=true`
2. `autoCallShadowMode=true`
3. Run 5-7 days and inspect decision quality.

### Phase 2: Guarded Live

1. `autoCallShadowMode=false`
2. `autoCallMaxPerDay=1`
3. Keep spacing conservative (`>= 60` minutes).

### Phase 3: Tuned Live

1. Increase cap to `2-3` if outcomes are good.
2. Tune window and threshold settings using logged decisions.

## Acceptance Criteria

1. Fewer calls than fixed-interval strategy.
2. No duplicate calls from cron retries/races.
3. Every call/skip decision has an explicit reason code.
4. Manual call path remains fully functional.
5. No changes to settlement/high-so-far from phone-call data.

## File Checklist

1. `convex/schema.js`: add forecast/decision/state tables.
2. `convex/lib/constants.js` and settings defaults: add automation settings.
3. `convex/settings.js`: read/write new settings.
4. `convex/forecast.js`: fetch/store forecast snapshots.
5. `convex/autoCall.js`: evaluate and optionally trigger call.
6. `convex/crons.js`: add forecast refresh + auto-call evaluation jobs.
7. `convex/dashboard.js` and `app/health/health-panel.js`: show automation status.
8. `tests/`: add decision-rule and idempotency tests.


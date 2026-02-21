# Forecast Automation Slice
# End-to-End Behavior
# Shadow-Mode Ready
# Live-Call Capable

## 1) Purpose

This document explains how the first forecast automation slice works in the current codebase.
It covers what is implemented now.
It covers how decisions are made.
It covers where calls are triggered.
It covers what changes state.
It covers what is intentionally out of scope.

## 2) Scope Of This Slice

This slice includes forecast ingestion.
This slice includes decision evaluation.
This slice includes shadow mode behavior.
This slice includes live call triggering behavior.
This slice includes state logging.
This slice includes health surface data in UI.

This slice does not change settlement rules.
This slice does not write phone values into market highs.
This slice does not remove manual call controls.
This slice does not replace METAR polling.

## 3) Source Of Truth Boundaries

METAR polling remains source of truth for market state.
Phone calls remain directional only.
Forecast data is advisory for timing decisions.
Decision records are source of truth for automation auditing.

## 4) Where The Code Lives

Forecast fetch and storage:
`convex/forecast.js`

Decision engine and state mutations:
`convex/autoCall.js`

Decision helper logic:
`convex/lib/autoCall.js`

Cron wiring:
`convex/crons.js`

Schema:
`convex/schema.js`

Settings API:
`convex/settings.js`

Backend defaults:
`convex/lib/constants.js`

Frontend defaults:
`lib/constants.js`

Health query:
`convex/dashboard.js`

Settings UI:
`app/settings/settings-form.js`

Health UI:
`app/health/health-panel.js`

Decision helper tests:
`tests/auto-call-decision.test.js`

## 5) Runtime Schedule

`poll_weather_kord` runs every 1 minute.
`refresh_forecast_kord` runs every 60 minutes.
`evaluate_auto_call_need` runs every 5 minutes.

All three are in `convex/crons.js`.
Weather polling is unchanged from prior behavior.
Forecast refresh and decision evaluation are new.

## 6) New Tables Added

`forecastSnapshots`
Stores point-in-time forecast interpretation for a day.

`autoCallDecisions`
Stores each decision evaluation bucket with reason and context.

`autoCallState`
Stores daily roll-up counters and last decision summary.

## 7) Backward Compatibility Choice

New automation fields in `settings` are optional in schema.
Reason:
existing settings rows were created before these fields existed.
Defaults are still applied by settings normalization.
Result:
older rows validate and runtime behavior remains deterministic.

## 8) Settings Introduced

`autoCallEnabled`
Master gate for evaluation.

`autoCallShadowMode`
If true, evaluate and log decisions but never place outbound calls.

`autoCallMaxPerDay`
Daily cap on automation-triggered calls.

`autoCallMinSpacingMinutes`
Minimum time between automation-triggered calls.

`autoCallEvalEveryMinutes`
Interval used to compute idempotent decision bucket key.

`autoCallPrePeakLeadMinutes`
Pre-peak window lead.

`autoCallPrePeakLagMinutes`
Pre-peak window lag.

`autoCallPeakLeadMinutes`
Peak window lead.

`autoCallPeakLagMinutes`
Peak window lag.

`autoCallPostPeakLeadMinutes`
Post-peak window lead.

`autoCallPostPeakLagMinutes`
Post-peak window lag.

`autoCallNearMaxThresholdF`
Allowed Fahrenheit distance between current temp and forecast max for near-max checks.

## 9) Default Settings Values

`autoCallEnabled = false`
`autoCallShadowMode = true`
`autoCallMaxPerDay = 3`
`autoCallMinSpacingMinutes = 45`
`autoCallEvalEveryMinutes = 5`
`autoCallPrePeakLeadMinutes = 90`
`autoCallPrePeakLagMinutes = 30`
`autoCallPeakLeadMinutes = 15`
`autoCallPeakLagMinutes = 45`
`autoCallPostPeakLeadMinutes = 90`
`autoCallPostPeakLagMinutes = 180`
`autoCallNearMaxThresholdF = 1`

## 10) Forecast Source

NWS points endpoint:
`https://api.weather.gov/points/41.9786,-87.9048`

From points payload, system reads:
`properties.forecastHourly`

Then system fetches hourly periods from that URL.
The code sends a `User-Agent` header.
The code normalizes temperatures into Fahrenheit.
The code computes day-specific peak based on Chicago day key.

## 11) Forecast Refresh Flow

Entry:
`internal.forecast.refreshForecastSnapshot`

Steps:
Read current timestamp.
Resolve current Chicago `dayKey`.
Fetch points payload from NWS.
Extract `forecastHourly` URL.
Fetch hourly payload.
Normalize each period.
Filter periods to target day key.
Compute predicted peak temp/time.
Insert a snapshot row.
Return summary payload.

Failure path:
Catch error.
Insert `FORECAST_REFRESH_FAILED` alert.
Throw error to caller.

## 12) Snapshot Fields Of Interest

`source` uses `NWS_HOURLY`.
`fetchedAt` stores epoch ms.
`fetchedAtLocal` stores formatted local time string.
`forecastGeneratedAt` stores upstream forecast update time when parseable.
`predictedMaxTempF` stores computed max Fahrenheit from day periods.
`predictedMaxAtMs` stores first period timestamp with max temp.
`predictedMaxTimeLocal` stores local formatted time for peak.
`hourly` stores normalized day periods used by decision engine.

## 13) Decision Engine Entry

Entry:
`internal.autoCall.evaluateAndMaybeCall`

Called by cron every 5 minutes.
Can also be invoked manually in future tooling if needed.

## 14) Idempotent Decision Key

Decision key is built with:
`dayKey`
`autoCallEvalEveryMinutes`
Rounded interval bucket index

Function:
`buildDecisionKey` in `convex/lib/autoCall.js`

Before any expensive checks, engine tries to create placeholder row.
If placeholder already exists, evaluation exits as duplicate.
This prevents duplicate evaluations in same bucket.

## 15) Pre-Decision Data Loaded

Settings from `api.settings.getSettings`.
Auto state from `api.autoCall.getAutoCallState`.
Dashboard snapshot from `api.dashboard.getDashboard`.
Latest forecast snapshot from `api.forecast.getLatestForecastSnapshot`.
Latest phone call from `api.calls.getLatestPhoneCall({ allDays: true })`.

If forecast snapshot is missing:
Engine attempts an immediate forecast refresh once.
Then retries reading latest snapshot.
If still missing, decision becomes `SKIP_NO_FORECAST`.

## 16) Decision Guard Sequence

Guard 1:
If `autoCallEnabled` is false -> skip.

Guard 2:
If no usable forecast peak timestamp -> skip.

Guard 3:
If weather system is stale -> skip.

Guard 4:
If manual/auto call is in flight -> skip.
In-flight statuses:
`REQUESTED`
`CALL_INITIATED`
`RECORDING_READY`

Guard 5:
If `autoCallsMade >= autoCallMaxPerDay` -> skip.

Guard 6:
If min spacing from last auto call not met -> skip.

Only when all guards pass does window logic run.

## 17) Window Classification

Function:
`classifyDecisionWindow`

Possible windows:
`PRE_PEAK`
`PEAK`
`POST_PEAK`
`OUTSIDE`

Window bounds are computed from:
`predictedMaxAtMs`
and configurable lead/lag settings.

## 18) Trend And Near-Max Signals

Function:
`computeRisingTrend`

Uses most recent two finite observation temps.
Observations are already ordered descending.
Signal is true when latest temp is greater than previous temp.

Function:
`toNearMaxFlag`

Signal is true when:
`abs(currentTempWholeF - predictedMaxTempF) <= autoCallNearMaxThresholdF`

Function:
`hasRecentHighObservation`

Signal is true when there is `isNewHigh` in recent observation window.
Current window used:
60 minutes.

## 19) Window Call Rules

`PRE_PEAK`
Call only if rising trend and near forecast max are both true.

`PEAK`
Call if either rising trend or near forecast max is true.

`POST_PEAK`
Call if recent new high exists or rising trend is true.

`OUTSIDE`
Never call.

## 20) Shadow Mode Behavior

If window logic says call is allowed and `autoCallShadowMode` is true:
Decision is still stored as `SKIP`.
Reason is `SKIP_SHADOW_MODE`.
`reasonDetail` includes `wouldCallReason`.
No call action is executed.
Call counters are not incremented.

## 21) Live Mode Behavior

If window logic says call is allowed and shadow mode is false:
Decision is set to `CALL`.
Reason code becomes one of:
`CALL_PRE_PEAK`
`CALL_PEAK`
`CALL_POST_PEAK`

Engine invokes:
`api.airportCalls.requestManualAirportCall`
with `requestedBy: "forecast_automation"`.

This intentionally reuses existing call controls:
cooldown enforcement
Twilio flow
recording/transcription pipeline
alert semantics from call path

If call invocation fails:
Reason code is rewritten to `CALL_FAILED`.
Engine stores failure message in `reasonDetail`.

## 22) Decision Persistence

Placeholder row is created first with:
`decision = SKIP`
`reasonCode = PENDING_EVALUATION`

Final row is patched with:
`decision`
`reasonCode`
`reasonDetail`
`window`
`predictedMaxTimeLocal`
`predictedMaxAtMs`
`callSid` (if present)
`shadowMode`

This produces stable per-bucket records for auditing.

## 23) State Roll-Up Updates

Mutation:
`applyDecisionToState`

Updates:
`enabled`
`shadowMode`
`autoCallsMade`
`lastAutoCallAt`
`lastDecisionAt`
`lastReasonCode`
`updatedAt`

Counter increments only on successful live calls.

## 24) Alerts Added By Auto Engine

On successful live call request:
`AUTO_CALL_TRIGGERED`

On call failure from decision engine:
`AUTO_CALL_FAILED`

Forecast refresh failure is emitted by forecast module:
`FORECAST_REFRESH_FAILED`

## 25) Health Surface Integration

`convex/dashboard.js` `getHealth` now returns:
`autoCallEnabled`
`autoCallShadowMode`
`autoCallsToday`
`lastAutoDecisionReason`
`lastAutoDecisionLocal`
`predictedMaxTimeLocal`
`forecastFetchedAtLocal`

Health UI renders these values in `app/health/health-panel.js`.

## 26) Settings UI Integration

Settings page now exposes all automation knobs.
Fields are editable in `app/settings/settings-form.js`.
Saved via existing `api.settings.upsertSettings`.
Numeric values are normalized using `toNumber`.
Boolean values are handled with checkbox toggles.

## 27) Separation From Settlement Logic

No writes were added to alter:
`dailyStats.highSoFarWholeF`
`dailyStats.currentTempWholeF`
`dailyStats.timeOfHighLocal`

Those remain driven by METAR processing in `convex/weather.js`.
Auto-call engine reads these values for context only.

## 28) Known Decision Reason Codes In Use

Skip reasons:
`SKIP_DISABLED`
`SKIP_NO_FORECAST`
`SKIP_DATA_STALE`
`SKIP_CALL_IN_FLIGHT`
`SKIP_DAILY_CAP`
`SKIP_MIN_SPACING`
`SKIP_OUTSIDE_WINDOW`
`SKIP_PRE_PEAK_NOT_READY`
`SKIP_POST_PEAK_NO_UPTREND`
`SKIP_PEAK_NOT_READY`
`SKIP_SHADOW_MODE`

Call reasons:
`CALL_PRE_PEAK`
`CALL_PEAK`
`CALL_POST_PEAK`
`CALL_FAILED`

## 29) Decision Quality Notes

The trend model is intentionally simple.
It uses latest two finite points.
This keeps behavior explainable.
This is appropriate for first slice rollout.

Forecast peak uses first hour at max.
Plateau optimization is deferred.
This also keeps behavior explainable in early rollout.

## 30) Failure Handling Summary

Forecast provider failure:
No crash loop in UI.
Alert emitted.
Decision likely becomes no-forecast skip.

Duplicate cron execution:
Suppressed by decision key uniqueness.

Call pipeline failure:
Captured as `CALL_FAILED`.
No state corruption in counters.

Settings missing fields in old rows:
Handled by optional schema fields plus defaults normalization.

## 31) Test Coverage Added

File:
`tests/auto-call-decision.test.js`

Covers:
Decision key bucketing.
Window classification.
Rising trend detection.
Recent high detection.
Window rule evaluation.
Near-max threshold logic.
In-flight status detection.

## 32) Operational Rollout Pattern

Step 1:
Set `autoCallEnabled = true`.

Step 2:
Keep `autoCallShadowMode = true`.

Step 3:
Observe `autoCallDecisions` rows for several days.

Step 4:
Tune settings if decision cadence is too strict or too loose.

Step 5:
Switch to live mode with `autoCallShadowMode = false`.

Step 6:
Monitor `AUTO_CALL_TRIGGERED` and `AUTO_CALL_FAILED` alerts.

Step 7:
Watch daily cap and spacing behavior in `autoCallState`.

## 33) Practical Verification Checklist

Confirm forecast snapshots are being inserted.
Confirm `predictedMaxTimeLocal` is visible in health panel.
Confirm decision rows appear every evaluation bucket.
Confirm shadow mode produces no outbound calls.
Confirm live mode can trigger exactly one call when allowed.
Confirm cooldown and in-flight checks are respected.
Confirm stale weather state blocks decisions.
Confirm daily cap blocks further calls.

## 34) Data Access Quick Reference

Latest snapshot:
`api.forecast.getLatestForecastSnapshot`

Recent snapshots:
`api.forecast.getRecentForecastSnapshots`

Current auto state:
`api.autoCall.getAutoCallState`

Recent decisions:
`api.autoCall.getRecentDecisions`

Current health:
`api.dashboard.getHealth`

## 35) Current Limitations

No dedicated UI table for decision history yet.
Forecast source is single-provider only.
No probabilistic confidence scoring.
No multi-station fallback.
No explicit holiday/weekend policy branch.
No explicit hard stop based on market liquidity windows.

## 36) Recommended Next Increment

Add a small read-only decision log panel in Health or Alerts.
Show:
decision time
reason code
window
would-call vs call
callSid if any

This gives operators immediate transparency during tuning.

## 37) Final Safety Statement

This slice is safe to enable in shadow mode immediately.
This slice is capable of live calls when shadow mode is disabled.
This slice preserves existing settlement data boundaries.
This slice is built to be auditable, deterministic, and reversible.


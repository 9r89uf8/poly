# Airport Call System (Current Implementation)

This doc explains how airport phone calls work in the current codebase, based on the implementation that followed `call_api.md`.

## Scope

This system is for manual, directional signal only.
It does not update settlement logic or the official `highSoFar`.
Market-critical temperature state comes from METAR polling, not from phone-call transcripts.

## Where Calls Are Triggered Today

1. UI trigger: `app/health/health-panel.js`
2. Action called from UI: `api.airportCalls.requestManualAirportCall`
3. Backend action implementation: `convex/airportCalls.js`

There is currently no cron that auto-calls the airport.
`convex/crons.js` only runs METAR polling every minute.

## End-to-End Call Flow

1. User clicks "Call airport now" in Health.
2. `requestManualAirportCall` enforces a global 60-second cooldown using latest row in `phoneCalls`.
3. A new `phoneCalls` row is inserted with initial status `REQUESTED`.
4. Twilio call is created to airport number (default `+17738000035`).
5. Twilio records inbound audio and sends webhook to `/twilio/recording`.
6. `recordingWebhook` validates secret, checks `RecordingStatus === completed`, then schedules processing.
7. `processRecording` downloads recording from Twilio (`.mp3` then `.wav` fallback).
8. Audio is transcribed with OpenAI model fallback sequence.
9. Temperature is parsed from transcript (F/C/unknown-unit logic).
10. `phoneCalls` row is patched with transcript, parsed temp, and final status.
11. Alerts are inserted (`PHONE_CALL_REQUESTED`, `PHONE_CALL_SUCCESS`, `PHONE_PARSE_FAILED`, `PHONE_CALL_FAILED`).

## Runtime Components

1. Call request action: `convex/airportCalls.js` (`requestManualAirportCall`)
2. Recording processor: `convex/airportCalls.js` (`processRecording`)
3. Twilio webhook + audio proxy: `convex/twilioWebhook.js`
4. HTTP routes: `convex/http.js`
5. Call storage queries/mutations: `convex/calls.js`
6. Table schema: `convex/schema.js` (`phoneCalls`)

## Current Call Status Values

1. `REQUESTED`
2. `CALL_INITIATED`
3. `RECORDING_READY`
4. `PROCESSED`
5. `PARSE_FAILED`
6. `FAILED`

## Env Vars Required for Call Path

1. `TWILIO_ACCOUNT_SID`
2. `TWILIO_AUTH_TOKEN`
3. `TWILIO_FROM_NUMBER`
4. `TWILIO_WEBHOOK_SECRET`
5. `CONVEX_SITE_URL`
6. `OPENAI_API_KEY`
7. Optional: `TWILIO_TO_OHARE_NUMBER` (override default airport number)
8. Optional: `OPENAI_TRANSCRIBE_MODEL` (first-choice transcription model)

## Safety / Behavior Details

1. Cooldown is 60 seconds across all calls (`getLatestPhoneCall({ allDays: true })`).
2. 07:00-13:00 America/Chicago adds warning metadata but does not block.
3. Transcript parse prefers explicit unit markers; unknown unit defaults to Celsius assumption.
4. Recording playback is protected by per-call `playbackToken` and proxied through Convex.

## API and Route Surface

1. Action to request call: `api.airportCalls.requestManualAirportCall`
2. Query latest call: `api.calls.getLatestPhoneCall`
3. Query recent calls: `api.calls.getRecentPhoneCalls`
4. Twilio webhook endpoint: `POST /twilio/recording`
5. Recording proxy endpoint: `GET /twilio/recording-audio`

## Important Separation from Weather Polling

1. Official temperature ingestion is METAR-based in `convex/weather.js`.
2. METAR poll runs every minute via cron in `convex/crons.js`.
3. Phone call temperatures are visible in Health but intentionally not merged into daily stats/high calculations.

## Integration Hooks for Forecast-Based Automation

Goal: call less often by using forecast timing (for example, expected hour of max temperature).

Use this pattern to integrate with minimal change:

1. Add a forecast fetcher that stores hourly forecast + predicted max-temp hour for the current Chicago day.
2. Add a decision action (for example `evaluateAirportCallNeed`).
3. In that decision action, check forecast window (are we near predicted max hour?).
4. In that decision action, check last phone call status/time (`api.calls.getLatestPhoneCall`).
5. In that decision action, check recent METAR trend from observations (optional guardrail).
6. If conditions pass, call `api.airportCalls.requestManualAirportCall` with `requestedBy: "forecast_automation"`.
7. Insert an alert each decision cycle (called vs skipped + reason) for auditability.

This keeps Twilio/transcription logic unchanged and adds automation only at the decision layer.

## Quick Sequence (Current)

`Health UI -> requestManualAirportCall -> Twilio Call -> /twilio/recording webhook -> processRecording -> phoneCalls + alerts`

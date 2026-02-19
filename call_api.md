
1**If you specifically want to use Twilio** → schedule an outbound call, record the audio, transcribe it (Whisper / etc), extract temperature, store it.

Below is an end‑to‑end setup for both using **Next.js + Convex + Vercel**.


## Option A: use Twilio calls + recording + transcription 

If you still want to call `773‑800‑0035` every 10 minutes:

**High-level pipeline**

1. **Convex cron** triggers every 10 minutes.
2. A **Convex Node action** calls the Twilio Calls API to dial `+17738000035`, records the call, and tells Twilio where to send a **RecordingStatusCallback**.
3. Twilio hits a **Convex HTTP action** (webhook) when the recording is completed (includes `RecordingUrl`, `RecordingSid`, etc.). ([Twilio][4])
4. A Node action downloads the `.mp3` (or `.wav`) recording and transcribes it.
5. Extract temperature from transcript → store in Convex → show in Next.js.

### 0) Install deps

```bash
npm i twilio openai
```

### 1) Convex env vars

Set these in the Convex dashboard or via CLI. Convex functions access them via `process.env`. ([Convex Developer Hub][5])

* `TWILIO_ACCOUNT_SID`
* `TWILIO_AUTH_TOKEN`
* `TWILIO_FROM_NUMBER` (your Twilio number in E.164, e.g. `+1...`)
* `TWILIO_WEBHOOK_SECRET` (random long string)
* `OPENAI_API_KEY`

### 2) DB schema + helpers

**convex/schema.ts**

```ts
import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export default defineSchema({
  ohareTemps: defineTable({
    observedAt: v.number(),            // ms epoch
    source: v.string(),                // "twilio" | "awc-metar" | ...
    tempC: v.optional(v.number()),
    tempF: v.optional(v.number()),
    rawTranscript: v.optional(v.string()),
    rawMetar: v.optional(v.string()),
    parseOk: v.boolean(),
    error: v.optional(v.string()),

    // Twilio metadata (optional)
    callSid: v.optional(v.string()),
    recordingSid: v.optional(v.string()),
    recordingUrl: v.optional(v.string()),
    recordingDurationSec: v.optional(v.number()),
  }).index("by_observedAt", ["observedAt"]),
});
```

**convex/ohareDb.ts**

```ts
import { v } from "convex/values";
import { query, internalMutation } from "./_generated/server";

export const insertReading = internalMutation({
  args: {
    observedAt: v.number(),
    source: v.string(),
    parseOk: v.boolean(),

    tempC: v.optional(v.number()),
    tempF: v.optional(v.number()),
    rawTranscript: v.optional(v.string()),
    rawMetar: v.optional(v.string()),
    error: v.optional(v.string()),

    callSid: v.optional(v.string()),
    recordingSid: v.optional(v.string()),
    recordingUrl: v.optional(v.string()),
    recordingDurationSec: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    await ctx.db.insert("ohareTemps", args);
  },
});

export const latest = query({
  args: {},
  handler: async (ctx) => {
    return await ctx.db
      .query("ohareTemps")
      .withIndex("by_observedAt", (q) => q)
      .order("desc")
      .first();
  },
});
```

### 3) Cron job to trigger the call

**convex/crons.ts**

```ts
import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";

const crons = cronJobs();

crons.interval(
  "call ohare weather line",
  { minutes: 10 },
  internal.ohareTwilio.callWeatherLine,
);

export default crons;
```

([Convex Developer Hub][3])

### 4) Twilio call action (Node runtime)

Convex actions that need Node APIs / certain npm packages should use `"use node"`. ([Convex Developer Hub][6])

**convex/ohareTwilio.ts**

```ts
"use node";

import { internalAction } from "./_generated/server";
import { internal } from "./_generated/api";
import twilio from "twilio";

const TO_NUMBER = "+17738000035"; // O'Hare line (E.164)

export const callWeatherLine = internalAction({
  args: {},
  handler: async (ctx) => {
    const accountSid = process.env.TWILIO_ACCOUNT_SID!;
    const authToken = process.env.TWILIO_AUTH_TOKEN!;
    const from = process.env.TWILIO_FROM_NUMBER!;
    const secret = process.env.TWILIO_WEBHOOK_SECRET!;
    const siteUrl = process.env.CONVEX_SITE_URL!; // system env var :contentReference[oaicite:8]{index=8}

    const client = twilio(accountSid, authToken);

    // Twilio can take inline TwiML via the `twiml` parameter (no need for a hosted TwiML URL). :contentReference[oaicite:9]{index=9}
    // We just keep the call open long enough to capture the automated message.
    const twiml = `<Response><Pause length="75"/><Hangup/></Response>`;

    // RecordingStatusCallback params include RecordingUrl/RecordingSid/etc. :contentReference[oaicite:10]{index=10}
    const recordingStatusCallback =
      `${siteUrl}/twilio/recording?secret=${encodeURIComponent(secret)}`;

    await client.calls.create({
      to: TO_NUMBER,
      from,
      twiml,

      // Record the call (default false). :contentReference[oaicite:11]{index=11}
      record: true,

      // Only keep inbound audio (what the weather line says).
      // RecordingTrack allowed values: inbound/outbound/both. :contentReference[oaicite:12]{index=12}
      recordingTrack: "inbound",

      // Get a webhook when the recording is ready. :contentReference[oaicite:13]{index=13}
      recordingStatusCallback,
      recordingStatusCallbackEvent: ["completed"],

      // Optional: give up if it rings too long
      timeout: 20,

      // Optional: if the line requires pressing keys, you can send DTMF after connect. :contentReference[oaicite:14]{index=14}
      // sendDigits: "W1", // 1-second pause then press "1"
    });
  },
});
```

**If the phone line has a menu:** use `sendDigits`. Twilio supports digits plus `w` (0.5s pause) and `W` (1s pause). ([Twilio][4])

### 5) Convex HTTP action to receive Twilio webhook

HTTP actions are exposed at `https://<deployment>.convex.site/...` and are commonly used for webhooks. ([Convex Developer Hub][7])

**convex/twilioWebhook.ts**

```ts
import { httpAction } from "./_generated/server";
import { internal } from "./_generated/api";

export const recordingWebhook = httpAction(async (ctx, request) => {
  const url = new URL(request.url);
  const secret = url.searchParams.get("secret");
  if (secret !== process.env.TWILIO_WEBHOOK_SECRET) {
    return new Response("unauthorized", { status: 401 });
  }

  // Twilio sends x-www-form-urlencoded for callbacks.
  const body = await request.text();
  const params = new URLSearchParams(body);

  const status = params.get("RecordingStatus"); // in-progress/completed/absent :contentReference[oaicite:17]{index=17}
  if (status !== "completed") return new Response("ignored", { status: 200 });

  const callSid = params.get("CallSid") ?? undefined;
  const recordingSid = params.get("RecordingSid") ?? undefined;
  const recordingUrl = params.get("RecordingUrl") ?? undefined;
  const durationSec = Number(params.get("RecordingDuration") ?? "0") || undefined;
  const startTime = params.get("RecordingStartTime") ?? undefined;

  if (!recordingSid || !recordingUrl) {
    return new Response("missing fields", { status: 400 });
  }

  // Respond fast to Twilio: schedule the heavy work.
  await ctx.scheduler.runAfter(0, internal.ohareTwilio.processRecording, {
    callSid,
    recordingSid,
    recordingUrl,
    durationSec,
    startTime,
  });

  return new Response("ok", { status: 200 });
});
```

**convex/http.ts**

```ts
import { httpRouter } from "convex/server";
import { recordingWebhook } from "./twilioWebhook";

const http = httpRouter();

http.route({
  path: "/twilio/recording",
  method: "POST",
  handler: recordingWebhook,
});

export default http;
```

([Convex Developer Hub][7])

### 6) Download the recording + transcribe (OpenAI)

Twilio lets you fetch the media by appending `.mp3` or `.wav` to the Recording URL/URI (only when status is `completed`). ([Twilio][8])

OpenAI’s Audio API `transcriptions` supports `whisper-1` and newer `gpt-4o-*-transcribe` models; file uploads are limited to 25MB and common audio formats are supported. ([OpenAI Developers][9])

**convex/ohareTwilio.ts** (add to the same Node file)

```ts
"use node";

import { v } from "convex/values";
import { internalAction } from "./_generated/server";
import { internal } from "./_generated/api";
import fs from "node:fs";
import path from "node:path";
import OpenAI from "openai";

function cToF(c: number) {
  return (c * 9) / 5 + 32;
}

// Very basic extractor; you can make this smarter if needed.
function extractTemperature(transcript: string): { temp: number | null; unit: "C" | "F" | "unknown" } {
  const t = transcript.toLowerCase();

  // Look for "temperature 13" / "temperature is 13"
  const m = t.match(/temperature(?:\s+is)?\s+(-?\d{1,3})/i);
  if (!m) return { temp: null, unit: "unknown" };

  const value = parseInt(m[1], 10);
  if (Number.isNaN(value)) return { temp: null, unit: "unknown" };

  // If transcript explicitly says Fahrenheit/Celsius, honor it.
  if (t.includes("fahrenheit")) return { temp: value, unit: "F" };
  if (t.includes("celsius") || t.includes("centigrade")) return { temp: value, unit: "C" };

  // Otherwise: unknown (airport ATIS/AWOS often uses °C).
  return { temp: value, unit: "unknown" };
}

export const processRecording = internalAction({
  args: {
    callSid: v.optional(v.string()),
    recordingSid: v.string(),
    recordingUrl: v.string(),
    durationSec: v.optional(v.number()),
    startTime: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const accountSid = process.env.TWILIO_ACCOUNT_SID!;
    const authToken = process.env.TWILIO_AUTH_TOKEN!;
    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY! });

    const observedAt =
      args.startTime ? Date.parse(args.startTime) : Date.now();

    // Prefer mp3 (smaller). If quality is bad, switch to .wav (bigger, higher bitrate). :contentReference[oaicite:21]{index=21}
    const mediaUrl = `${args.recordingUrl}.mp3`;

    try {
      const res = await fetch(mediaUrl, {
        headers: {
          Authorization:
            "Basic " + Buffer.from(`${accountSid}:${authToken}`).toString("base64"),
        },
      });

      if (!res.ok) {
        throw new Error(`Failed to download recording: HTTP ${res.status}`);
      }

      const audioBuf = Buffer.from(await res.arrayBuffer());
      const tmpFile = path.join("/tmp", `${args.recordingSid}.mp3`);
      await fs.promises.writeFile(tmpFile, audioBuf);

      // Transcribe
      const transcription = await openai.audio.transcriptions.create({
        file: fs.createReadStream(tmpFile),
        model: "gpt-4o-mini-transcribe", // or "whisper-1" :contentReference[oaicite:22]{index=22}
        language: "en",
        temperature: 0,
        // prompt can help with consistent wording :contentReference[oaicite:23]{index=23}
        prompt:
          "This is an automated airport weather report. It contains the word 'temperature' followed by a number.",
      });

      const text = transcription.text ?? "";
      const extracted = extractTemperature(text);

      let tempC: number | undefined;
      let tempF: number | undefined;

      if (extracted.temp != null) {
        if (extracted.unit === "C") {
          tempC = extracted.temp;
          tempF = cToF(extracted.temp);
        } else if (extracted.unit === "F") {
          tempF = extracted.temp;
        } else {
          // Unknown unit: store as tempC (common for aviation) AND convert to F for display if you want.
          tempC = extracted.temp;
          tempF = cToF(extracted.temp);
        }
      }

      await ctx.runMutation(internal.ohareDb.insertReading, {
        observedAt,
        source: "twilio",
        parseOk: extracted.temp != null,
        tempC,
        tempF,
        rawTranscript: text,
        callSid: args.callSid,
        recordingSid: args.recordingSid,
        recordingUrl: args.recordingUrl,
        recordingDurationSec: args.durationSec,
      });

      // cleanup
      await fs.promises.unlink(tmpFile).catch(() => {});
    } catch (err: any) {
      await ctx.runMutation(internal.ohareDb.insertReading, {
        observedAt,
        source: "twilio",
        parseOk: false,
        error: err?.message ?? String(err),
        callSid: args.callSid,
        recordingSid: args.recordingSid,
        recordingUrl: args.recordingUrl,
        recordingDurationSec: args.durationSec,
      });
    }
  },
});
```

---

## Next.js UI (Vercel) — show the latest reading

Your Vercel app can just read from Convex and display the last stored value.

**app/LatestTemp.tsx**

```tsx
"use client";

import { useQuery } from "convex/react";
import { api } from "../convex/_generated/api";

export function LatestTemp() {
  const latest = useQuery(api.ohareDb.latest, {});
  if (latest === undefined) return <div>Loading…</div>;
  if (!latest) return <div>No readings yet.</div>;

  return (
    <div>
      <div>
        Latest:{" "}
        {latest.tempF != null ? `${latest.tempF.toFixed(1)} °F` : "—"}
        {latest.tempC != null ? ` (${latest.tempC.toFixed(0)} °C)` : ""}
      </div>
      <div>At: {new Date(latest.observedAt).toLocaleString()}</div>
      {latest.rawTranscript && (
        <details>
          <summary>Transcript</summary>
          <pre style={{ whiteSpace: "pre-wrap" }}>{latest.rawTranscript}</pre>
        </details>
      )}
      {latest.error && <div style={{ color: "red" }}>Error: {latest.error}</div>}
    </div>
  );
}
```

---

## Practical gotchas

* **Calling a number every 10 minutes** (144 calls/day) can be considered abusive by whoever runs that line. If your goal is just temperature, Option A (METAR API) is far more polite + reliable + cheap.
* **Twilio trial accounts** often can’t call arbitrary numbers (only verified numbers). If you’re on trial, you may need to upgrade.
* If transcription quality is poor:

    * fetch `.wav` instead of `.mp3` (bigger but higher bitrate). ([Twilio][8])
    * increase `<Pause length="...">` so you record the whole message.
* If the weather line has a menu: use `sendDigits` with pauses `W`/`w`. ([Twilio][4])

---

[1]: https://aviationweather.gov/data/api/ "https://aviationweather.gov/data/api/"
[2]: https://aviationweather.gov/api/data/metar?format=raw&ids=KORD "https://aviationweather.gov/api/data/metar?format=raw&ids=KORD"
[3]: https://docs.convex.dev/scheduling/cron-jobs "https://docs.convex.dev/scheduling/cron-jobs"
[4]: https://www.twilio.com/docs/voice/api/call-resource "https://www.twilio.com/docs/voice/api/call-resource"
[5]: https://docs.convex.dev/production/environment-variables "https://docs.convex.dev/production/environment-variables"
[6]: https://docs.convex.dev/functions/actions "https://docs.convex.dev/functions/actions"
[7]: https://docs.convex.dev/functions/http-actions "https://docs.convex.dev/functions/http-actions"
[8]: https://www.twilio.com/docs/voice/api/recording "https://www.twilio.com/docs/voice/api/recording"
[9]: https://developers.openai.com/api/docs/guides/speech-to-text/ "Speech to text | OpenAI API"

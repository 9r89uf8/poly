import { httpAction } from "./_generated/server";
import { internal } from "./_generated/api";

function parseOptionalNumber(value) {
  const numberValue = Number(value);
  return Number.isFinite(numberValue) ? numberValue : undefined;
}

function requireEnvVar(name) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required env var: ${name}`);
  }
  return value;
}

function corsHeaders(contentType = "application/octet-stream") {
  return {
    "Content-Type": contentType,
    "Cache-Control": "private, max-age=30",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, OPTIONS",
  };
}

export const recordingWebhook = httpAction(async (ctx, request) => {
  const url = new URL(request.url);
  const providedSecret = url.searchParams.get("secret");
  const expectedSecret = process.env.TWILIO_WEBHOOK_SECRET;

  if (!expectedSecret || providedSecret !== expectedSecret) {
    return new Response("unauthorized", { status: 401 });
  }

  const body = await request.text();
  const params = new URLSearchParams(body);
  const recordingStatus = params.get("RecordingStatus");

  if (recordingStatus !== "completed") {
    return new Response("ignored", { status: 200 });
  }

  const callSid = params.get("CallSid") ?? undefined;
  const recordingSid = params.get("RecordingSid") ?? undefined;
  const recordingUrl = params.get("RecordingUrl") ?? undefined;
  const recordingDurationSec = parseOptionalNumber(params.get("RecordingDuration"));

  if (!recordingSid || !recordingUrl) {
    return new Response("missing recording details", { status: 400 });
  }

  await ctx.scheduler.runAfter(0, internal.airportCalls.processRecording, {
    callSid,
    recordingSid,
    recordingUrl,
    recordingDurationSec,
  });

  return new Response("ok", { status: 200 });
});

export const recordingAudioProxy = httpAction(async (ctx, request) => {
  if (request.method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: corsHeaders(),
    });
  }

  const url = new URL(request.url);
  const recordingSid = String(url.searchParams.get("recordingSid") ?? "").trim();
  const token = String(url.searchParams.get("token") ?? "").trim();
  const format = String(url.searchParams.get("format") ?? "mp3").toLowerCase();

  if (!recordingSid || !token) {
    return new Response("missing recordingSid/token", { status: 400 });
  }

  const call = await ctx.db
    .query("phoneCalls")
    .withIndex("by_recordingSid", (q) => q.eq("recordingSid", recordingSid))
    .first();

  if (!call || !call.recordingUrl) {
    return new Response("recording not found", { status: 404 });
  }

  if (!call.playbackToken || call.playbackToken !== token) {
    return new Response("unauthorized", { status: 401 });
  }

  const accountSid = requireEnvVar("TWILIO_ACCOUNT_SID");
  const authToken = requireEnvVar("TWILIO_AUTH_TOKEN");
  const authHeader =
    `Basic ${Buffer.from(`${accountSid}:${authToken}`).toString("base64")}`;
  const normalizedFormat = format === "wav" ? "wav" : "mp3";

  const response = await fetch(`${call.recordingUrl}.${normalizedFormat}`, {
    method: "GET",
    headers: {
      Authorization: authHeader,
    },
  });

  if (!response.ok) {
    return new Response(
      `twilio recording fetch failed: HTTP ${response.status}`,
      { status: 502 },
    );
  }

  const payload = await response.arrayBuffer();
  const contentType = normalizedFormat === "wav" ? "audio/wav" : "audio/mpeg";

  return new Response(payload, {
    status: 200,
    headers: corsHeaders(contentType),
  });
});

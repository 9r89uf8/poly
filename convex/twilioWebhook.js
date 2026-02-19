import { httpAction } from "./_generated/server";
import { internal } from "./_generated/api";

function parseOptionalNumber(value) {
  const numberValue = Number(value);
  return Number.isFinite(numberValue) ? numberValue : undefined;
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

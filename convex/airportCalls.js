"use node";

import { action, internalAction } from "./_generated/server";
import { api, internal } from "./_generated/api";
import { v } from "convex/values";
import twilio from "twilio";
import OpenAI from "openai";
import fs from "node:fs";
import path from "node:path";
import { formatUtcToChicago, getChicagoDayKey } from "./lib/time";

const DEFAULT_TARGET_NUMBER = "+17738000035";
const CALL_COOLDOWN_MS = 15 * 60 * 1000;
const DAYTIME_WARNING =
  "Manual call requested during 07:00-13:00 America/Chicago (sun-heating window).";

function cToF(tempC) {
  return (tempC * 9) / 5 + 32;
}

function fToC(tempF) {
  return ((tempF - 32) * 5) / 9;
}

function toErrorMessage(error) {
  if (error instanceof Error) {
    return error.message;
  }
  if (typeof error === "string") {
    return error;
  }
  return "Unknown error";
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isRetryableTranscriptionError(error) {
  const status = Number(error?.status);
  const code = String(error?.code ?? "").toLowerCase();
  const name = String(error?.name ?? "").toLowerCase();
  const message = String(error?.message ?? "").toLowerCase();

  if (Number.isFinite(status) && status >= 500) {
    return true;
  }

  return (
    code.includes("timeout") ||
    code.includes("econn") ||
    name.includes("connection") ||
    message.includes("connection error") ||
    message.includes("network")
  );
}

function formatErrorDetails(error) {
  const name = String(error?.name ?? "UnknownError");
  const status = error?.status ?? null;
  const code = error?.code ?? null;
  const message = toErrorMessage(error);
  return `${name} status=${status ?? "n/a"} code=${code ?? "n/a"} message=${message}`;
}

function buildTranscriptionModelCandidates() {
  const configured = String(process.env.OPENAI_TRANSCRIBE_MODEL ?? "").trim();
  const models = [];

  if (configured) {
    models.push(configured);
  }

  if (!models.includes("gpt-4o-mini-transcribe")) {
    models.push("gpt-4o-mini-transcribe");
  }

  if (!models.includes("whisper-1")) {
    models.push("whisper-1");
  }

  return models;
}

async function transcribeRecordingWithFallback(openaiClient, audioPath) {
  const models = buildTranscriptionModelCandidates();
  const maxAttemptsPerModel = 3;
  const prompt =
    "Automated airport weather phone line. Focus on extracting the spoken temperature value.";

  let lastError = null;
  let attempts = 0;

  for (const model of models) {
    for (let attempt = 1; attempt <= maxAttemptsPerModel; attempt += 1) {
      attempts += 1;
      try {
        const transcription = await openaiClient.audio.transcriptions.create({
          file: fs.createReadStream(audioPath),
          model,
          language: "en",
          temperature: 0,
          prompt,
        });

        return {
          transcription,
          model,
          attempt,
          attempts,
        };
      } catch (error) {
        lastError = error;
        const retryable = isRetryableTranscriptionError(error);
        const isLastAttempt = attempt >= maxAttemptsPerModel;

        if (retryable && !isLastAttempt) {
          await sleep(attempt * 800);
          continue;
        }

        break;
      }
    }
  }

  throw new Error(
    `Transcription failed after ${attempts} attempts. ${formatErrorDetails(lastError)}`,
  );
}

function getChicagoHour(input = Date.now()) {
  const value = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Chicago",
    hour: "2-digit",
    hour12: false,
  }).format(input instanceof Date ? input : new Date(input));
  return Number(value);
}

function isDiscouragedCallWindow(input = Date.now()) {
  const hour = getChicagoHour(input);
  return Number.isFinite(hour) && hour >= 7 && hour < 13;
}

function requireEnvVar(name) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required env var: ${name}`);
  }
  return value;
}

function extractTemperatureFromTranscript(transcript) {
  const text = String(transcript ?? "").toLowerCase();

  const fahrenheitMatch = text.match(
    /(?:temperature(?:\s+is)?\s*)?(-?\d{1,3})(?:\s*degrees?)?\s*(?:fahrenheit|\bf\b)/i,
  );
  if (fahrenheitMatch) {
    return { value: Number(fahrenheitMatch[1]), unit: "F" };
  }

  const celsiusMatch = text.match(
    /(?:temperature(?:\s+is)?\s*)?(-?\d{1,3})(?:\s*degrees?)?\s*(?:celsius|centigrade|\bc\b)/i,
  );
  if (celsiusMatch) {
    return { value: Number(celsiusMatch[1]), unit: "C" };
  }

  const genericTempMatch = text.match(/temperature(?:\s+is)?\s+(-?\d{1,3})/i);
  if (genericTempMatch) {
    return { value: Number(genericTempMatch[1]), unit: "UNKNOWN" };
  }

  const genericFallback = text.match(/\b(-?\d{1,3})\b/);
  if (genericFallback) {
    return { value: Number(genericFallback[1]), unit: "UNKNOWN" };
  }

  return { value: null, unit: "UNKNOWN" };
}

async function patchPhoneCallWithFallback(ctx, args, patch) {
  if (args.callSid) {
    const callSidPatch = await ctx.runMutation(internal.calls.patchPhoneCallByCallSid, {
      callSid: args.callSid,
      patch,
    });
    if (callSidPatch.updated) {
      return callSidPatch;
    }
  }

  return await ctx.runMutation(internal.calls.patchPhoneCallByRecordingSid, {
    recordingSid: args.recordingSid,
    patch,
  });
}

async function downloadRecording(recordingUrl, accountSid, authToken) {
  const authHeader = `Basic ${Buffer.from(`${accountSid}:${authToken}`).toString("base64")}`;
  const variants = [".mp3", ".wav"];
  let lastError = "Unknown recording download error.";

  for (const extension of variants) {
    const response = await fetch(`${recordingUrl}${extension}`, {
      method: "GET",
      headers: {
        Authorization: authHeader,
      },
    });

    if (response.ok) {
      return {
        extension,
        binary: Buffer.from(await response.arrayBuffer()),
      };
    }

    lastError = `Download failed for ${extension}: HTTP ${response.status}`;
  }

  throw new Error(lastError);
}

export const requestManualAirportCall = action({
  args: {
    requestedBy: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    const dayKey = getChicagoDayKey(now);
    const requestedAtLocal = formatUtcToChicago(now, true);

    const latest = await ctx.runQuery(api.calls.getLatestPhoneCall, {
      allDays: true,
    });
    const elapsedMs = latest ? now - latest.requestedAt : Number.POSITIVE_INFINITY;

    if (elapsedMs < CALL_COOLDOWN_MS) {
      const remainingMs = CALL_COOLDOWN_MS - elapsedMs;
      const remainingSeconds = Math.ceil(remainingMs / 1000);
      const availableAtMs = now + remainingMs;

      throw new Error(
        `Manual call cooldown active for ${remainingSeconds}s (next allowed: ${formatUtcToChicago(
          availableAtMs,
          true,
        )}).`,
      );
    }

    const accountSid = requireEnvVar("TWILIO_ACCOUNT_SID");
    const authToken = requireEnvVar("TWILIO_AUTH_TOKEN");
    const fromNumber = requireEnvVar("TWILIO_FROM_NUMBER");
    const webhookSecret = requireEnvVar("TWILIO_WEBHOOK_SECRET");
    const convexSiteUrl = requireEnvVar("CONVEX_SITE_URL");
    const targetNumber = process.env.TWILIO_TO_OHARE_NUMBER ?? DEFAULT_TARGET_NUMBER;
    const warning = isDiscouragedCallWindow(now) ? DAYTIME_WARNING : undefined;

    const inserted = await ctx.runMutation(internal.calls.createPhoneCall, {
      dayKey,
      requestedBy: args.requestedBy,
      requestedAt: now,
      requestedAtLocal,
      sourceNumber: fromNumber,
      targetNumber,
      warning,
    });

    const client = twilio(accountSid, authToken);
    const twiml = "<Response><Pause length=\"15\"/><Hangup/></Response>";
    const recordingStatusCallback =
      `${convexSiteUrl}/twilio/recording?secret=${encodeURIComponent(webhookSecret)}`;

    try {
      const call = await client.calls.create({
        to: targetNumber,
        from: fromNumber,
        twiml,
        timeout: 20,
        record: true,
        recordingTrack: "inbound",
        recordingStatusCallback,
        recordingStatusCallbackMethod: "POST",
        recordingStatusCallbackEvent: ["completed"],
      });

      await ctx.runMutation(internal.calls.patchPhoneCallById, {
        phoneCallId: inserted.phoneCallId,
        patch: {
          status: "CALL_INITIATED",
          callSid: call.sid,
          callStartedAt: Date.now(),
        },
      });

      await ctx.runMutation(internal.weather.insertAlert, {
        dayKey,
        type: "PHONE_CALL_REQUESTED",
        payload: {
          callSid: call.sid,
          requestedAtLocal,
          requestedBy: args.requestedBy ?? null,
          warning: warning ?? null,
        },
      });

      return {
        ok: true,
        phoneCallId: inserted.phoneCallId,
        callSid: call.sid,
        requestedAtLocal,
        warning: warning ?? null,
        cooldownSeconds: CALL_COOLDOWN_MS / 1000,
      };
    } catch (error) {
      const reason = toErrorMessage(error);

      await ctx.runMutation(internal.calls.patchPhoneCallById, {
        phoneCallId: inserted.phoneCallId,
        patch: {
          status: "FAILED",
          error: reason,
        },
      });

      await ctx.runMutation(internal.weather.insertAlert, {
        dayKey,
        type: "PHONE_CALL_FAILED",
        payload: {
          stage: "twilio_call_create",
          reason,
        },
      });

      throw new Error(`Airport phone call failed: ${reason}`);
    }
  },
});

export const processRecording = internalAction({
  args: {
    callSid: v.optional(v.string()),
    recordingSid: v.string(),
    recordingUrl: v.string(),
    recordingDurationSec: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    const dayKey = getChicagoDayKey(now);

    await patchPhoneCallWithFallback(ctx, args, {
      status: "RECORDING_READY",
      callCompletedAt: now,
      recordingSid: args.recordingSid,
      recordingUrl: args.recordingUrl,
      recordingDurationSec: args.recordingDurationSec,
    });

    const accountSid = requireEnvVar("TWILIO_ACCOUNT_SID");
    const authToken = requireEnvVar("TWILIO_AUTH_TOKEN");
    const openaiApiKey = requireEnvVar("OPENAI_API_KEY");
    const openaiClient = new OpenAI({ apiKey: openaiApiKey });

    let tempPath = null;
    let failureStage = "recording_download";

    try {
      const recording = await downloadRecording(
        args.recordingUrl,
        accountSid,
        authToken,
      );

      tempPath = path.join("/tmp", `${args.recordingSid}${recording.extension}`);
      await fs.promises.writeFile(tempPath, recording.binary);

      failureStage = "transcription_request";

      const transcriptionResult = await transcribeRecordingWithFallback(
        openaiClient,
        tempPath,
      );
      const transcription = transcriptionResult.transcription;
      const transcriptionModel = transcriptionResult.model;

      const transcript = String(transcription.text ?? "").trim();
      failureStage = "temperature_parse";
      const extracted = extractTemperatureFromTranscript(transcript);

      if (extracted.value === null || !Number.isFinite(extracted.value)) {
        const parseError = "Could not extract a temperature from transcript.";
        await patchPhoneCallWithFallback(ctx, args, {
          status: "PARSE_FAILED",
          transcript,
          parsedOk: false,
          error: parseError,
        });

        await ctx.runMutation(internal.weather.insertAlert, {
          dayKey,
          type: "PHONE_PARSE_FAILED",
          payload: {
            callSid: args.callSid ?? null,
            recordingSid: args.recordingSid,
            transcript,
          },
        });

        return {
          ok: false,
          parseOk: false,
          reason: parseError,
        };
      }

      let tempC = null;
      let tempF = null;
      if (extracted.unit === "C") {
        tempC = extracted.value;
        tempF = cToF(extracted.value);
      } else if (extracted.unit === "F") {
        tempF = extracted.value;
        tempC = fToC(extracted.value);
      } else {
        // Aviation lines commonly report Celsius when units are omitted.
        tempC = extracted.value;
        tempF = cToF(extracted.value);
      }

      await patchPhoneCallWithFallback(ctx, args, {
        status: "PROCESSED",
        transcript,
        tempC,
        tempF,
        parsedOk: true,
      });

      await ctx.runMutation(internal.weather.insertAlert, {
        dayKey,
        type: "PHONE_CALL_SUCCESS",
        payload: {
          callSid: args.callSid ?? null,
          recordingSid: args.recordingSid,
          transcriptionModel,
          tempC,
          tempF,
          assumedUnit: extracted.unit,
        },
      });

      return {
        ok: true,
        parseOk: true,
        tempC,
        tempF,
      };
    } catch (error) {
      const reason = formatErrorDetails(error);
      await patchPhoneCallWithFallback(ctx, args, {
        status: "FAILED",
        parsedOk: false,
        error: reason,
      });

      await ctx.runMutation(internal.weather.insertAlert, {
        dayKey,
        type: "PHONE_CALL_FAILED",
        payload: {
          stage: failureStage,
          reason,
          callSid: args.callSid ?? null,
          recordingSid: args.recordingSid,
        },
      });

      return {
        ok: false,
        parseOk: false,
        reason,
      };
    } finally {
      if (tempPath) {
        await fs.promises.unlink(tempPath).catch(() => {});
      }
    }
  },
});

import { query } from "./_generated/server";
import { v } from "convex/values";
import { formatUtcToChicago, getChicagoDayKey } from "./lib/time";

const DAY_KEY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const MAX_HISTORY_RANGE_DAYS = 45;
const IN_FLIGHT_STATUSES = new Set(["REQUESTED", "CALL_INITIATED", "RECORDING_READY"]);
const TWILIO_EST_COST_PER_MINUTE = 0.021;
const TRANSCRIBE_EST_COST_PER_MINUTE = 0.006;

function assertDayKey(dayKey, label) {
  const normalized = String(dayKey ?? "").trim();
  if (!DAY_KEY_PATTERN.test(normalized)) {
    throw new Error(`${label} must be YYYY-MM-DD.`);
  }
  return normalized;
}

function dayKeyToUtcMs(dayKey) {
  const [year, month, day] = dayKey.split("-").map(Number);
  return Date.UTC(year, month - 1, day);
}

function addDays(dayKey, daysToAdd) {
  const next = new Date(dayKeyToUtcMs(dayKey) + (daysToAdd * 24 * 60 * 60 * 1000));
  return next.toISOString().slice(0, 10);
}

function listDayKeysInclusive(startDayKey, endDayKey) {
  const dayKeys = [];
  let cursor = startDayKey;

  while (cursor <= endDayKey) {
    dayKeys.push(cursor);
    if (dayKeys.length > MAX_HISTORY_RANGE_DAYS) {
      throw new Error(
        `Range is too large. Please request ${MAX_HISTORY_RANGE_DAYS} days or fewer.`,
      );
    }
    cursor = addDays(cursor, 1);
  }

  return dayKeys;
}

function toRoundedNumber(value, precision = 1) {
  const num = Number(value);
  if (!Number.isFinite(num)) {
    return null;
  }
  const factor = 10 ** precision;
  return Math.round(num * factor) / factor;
}

function toLocalLabel(epochMs) {
  return Number.isFinite(Number(epochMs))
    ? formatUtcToChicago(Number(epochMs), true)
    : null;
}

function toCallPoint(call) {
  const t = Number(call?.callCompletedAt ?? call?.requestedAt);
  const tempF = toRoundedNumber(call?.tempF, 1);

  if (!Number.isFinite(t) || tempF === null) {
    return null;
  }

  return {
    t,
    tempF,
    requestedBy: call?.requestedBy ?? "unknown",
    status: call?.status ?? "UNKNOWN",
    callSid: call?.callSid ?? null,
    requestedAtLocal: call?.requestedAtLocal ?? toLocalLabel(t),
    transcriptSnippet: call?.transcript
      ? String(call.transcript).slice(0, 140)
      : null,
  };
}

function toObservationPoint(observation) {
  const parsedObsTime = Date.parse(String(observation?.obsTimeUtc ?? ""));
  const t = Number.isFinite(parsedObsTime)
    ? parsedObsTime
    : Number(observation?.createdAt);
  const tempF = Number(observation?.wuLikeTempWholeF);

  if (!Number.isFinite(t) || !Number.isFinite(tempF)) {
    return null;
  }

  return {
    t,
    tempF,
    source: observation?.source ?? "UNKNOWN",
    obsTimeLocal: observation?.obsTimeLocal ?? toLocalLabel(t),
  };
}

function isSuccessfulAutoDecision(decision) {
  return decision?.decision === "CALL" && decision?.reasonCode !== "CALL_FAILED";
}

function isShadowWouldCall(decision) {
  return (
    decision?.reasonCode === "SKIP_SHADOW_MODE" &&
    Boolean(decision?.reasonDetail?.wouldCallReason)
  );
}

function classifyFailure(call) {
  const status = String(call?.status ?? "");
  const error = String(call?.error ?? "").toLowerCase();

  if (status === "PARSE_FAILED") {
    return "PARSE_FAILED";
  }

  if (status !== "FAILED") {
    return null;
  }

  if (error.includes("transcription")) {
    return "TRANSCRIPTION_FAILED";
  }
  if (error.includes("download") || error.includes("recording")) {
    return "RECORDING_DOWNLOAD_FAILED";
  }
  if (error.includes("timeout")) {
    return "TIMEOUT";
  }
  if (error.includes("twilio")) {
    return "TWILIO_FAILED";
  }
  return "FAILED_UNKNOWN";
}

export const getHistoryRange = query({
  args: {
    startDayKey: v.string(),
    endDayKey: v.string(),
  },
  handler: async (ctx, args) => {
    const startDayKey = assertDayKey(args.startDayKey, "startDayKey");
    const endDayKey = assertDayKey(args.endDayKey, "endDayKey");

    if (startDayKey > endDayKey) {
      throw new Error("startDayKey must be before or equal to endDayKey.");
    }

    const dayKeys = listDayKeysInclusive(startDayKey, endDayKey);
    const phoneTempSeries = [];
    const daySummaries = [];

    for (const dayKey of dayKeys) {
      const [dailyStats, latestForecast, calls, autoState, decisions] = await Promise.all([
        ctx.db
          .query("dailyStats")
          .withIndex("by_dayKey", (q) => q.eq("dayKey", dayKey))
          .unique(),
        ctx.db
          .query("forecastSnapshots")
          .withIndex("by_dayKey_fetchedAt", (q) => q.eq("dayKey", dayKey))
          .order("desc")
          .first(),
        ctx.db
          .query("phoneCalls")
          .withIndex("by_dayKey", (q) => q.eq("dayKey", dayKey))
          .collect(),
        ctx.db
          .query("autoCallState")
          .withIndex("by_dayKey", (q) => q.eq("dayKey", dayKey))
          .unique(),
        ctx.db
          .query("autoCallDecisions")
          .withIndex("by_dayKey_createdAt", (q) => q.eq("dayKey", dayKey))
          .collect(),
      ]);

      const callPoints = calls
        .map(toCallPoint)
        .filter(Boolean)
        .sort((a, b) => a.t - b.t);
      const allTemps = callPoints.map((item) => item.tempF);
      const autoCallCount = calls.filter(
        (call) => call.requestedBy === "forecast_automation",
      ).length;
      const successfulCalls = decisions.filter(isSuccessfulAutoDecision).length;
      const shadowWouldCalls = decisions.filter(isShadowWouldCall).length;

      phoneTempSeries.push(
        ...callPoints.map((point) => ({
          ...point,
          dayKey,
        })),
      );

      daySummaries.push({
        dayKey,
        metarHighF: dailyStats?.highSoFarWholeF ?? null,
        metarHighTimeLocal: dailyStats?.timeOfHighLocal ?? null,
        predictedMaxTempF: toRoundedNumber(latestForecast?.predictedMaxTempF, 1),
        predictedMaxTimeLocal: latestForecast?.predictedMaxTimeLocal ?? null,
        forecastFetchedAtLocal:
          latestForecast?.fetchedAtLocal ??
          toLocalLabel(latestForecast?.fetchedAt),
        phoneCallsTotal: calls.length,
        phoneCallsAuto: autoCallCount,
        phoneMaxTempF: allTemps.length > 0 ? Math.max(...allTemps) : null,
        autoCallDecisionsCall: successfulCalls,
        autoCallDecisionsWouldCall: shadowWouldCalls,
        autoCallsMade: Number(autoState?.autoCallsMade ?? 0),
        lastReasonCode: autoState?.lastReasonCode ?? null,
      });
    }

    phoneTempSeries.sort((a, b) => a.t - b.t);
    daySummaries.sort((a, b) => {
      if (a.dayKey === b.dayKey) {
        return 0;
      }
      return a.dayKey > b.dayKey ? -1 : 1;
    });

    return {
      startDayKey,
      endDayKey,
      dayKeys,
      phoneTempSeries,
      daySummaries,
      generatedAt: Date.now(),
    };
  },
});

export const getDayForensics = query({
  args: {
    dayKey: v.string(),
  },
  handler: async (ctx, args) => {
    const dayKey = assertDayKey(args.dayKey, "dayKey");

    const [
      dailyStats,
      observationsRaw,
      callsRaw,
      decisionsRaw,
      forecastSnapshotsRaw,
      alertsRaw,
      autoState,
    ] = await Promise.all([
      ctx.db
        .query("dailyStats")
        .withIndex("by_dayKey", (q) => q.eq("dayKey", dayKey))
        .unique(),
      ctx.db
        .query("observations")
        .withIndex("by_dayKey", (q) => q.eq("dayKey", dayKey))
        .order("asc")
        .take(2400),
      ctx.db
        .query("phoneCalls")
        .withIndex("by_dayKey", (q) => q.eq("dayKey", dayKey))
        .order("asc")
        .take(300),
      ctx.db
        .query("autoCallDecisions")
        .withIndex("by_dayKey_createdAt", (q) => q.eq("dayKey", dayKey))
        .order("desc")
        .take(600),
      ctx.db
        .query("forecastSnapshots")
        .withIndex("by_dayKey_fetchedAt", (q) => q.eq("dayKey", dayKey))
        .order("desc")
        .take(96),
      ctx.db
        .query("alerts")
        .withIndex("by_dayKey_createdAt", (q) => q.eq("dayKey", dayKey))
        .order("desc")
        .take(100),
      ctx.db
        .query("autoCallState")
        .withIndex("by_dayKey", (q) => q.eq("dayKey", dayKey))
        .unique(),
    ]);

    const observations = observationsRaw
      .map(toObservationPoint)
      .filter(Boolean)
      .sort((a, b) => a.t - b.t);
    const calls = callsRaw
      .map((call) => ({
        _id: call._id,
        requestedAt: call.requestedAt,
        requestedAtLocal: call.requestedAtLocal ?? toLocalLabel(call.requestedAt),
        completedAtLocal: toLocalLabel(call.callCompletedAt),
        status: call.status,
        requestedBy: call.requestedBy ?? "manual",
        callSid: call.callSid ?? null,
        recordingSid: call.recordingSid ?? null,
        recordingDurationSec: call.recordingDurationSec ?? null,
        parsedOk: Boolean(call.parsedOk),
        tempF: toRoundedNumber(call.tempF, 1),
        tempC: toRoundedNumber(call.tempC, 1),
        warning: call.warning ?? null,
        error: call.error ?? null,
        transcript: call.transcript ?? null,
      }))
      .sort((a, b) => Number(a.requestedAt) - Number(b.requestedAt));
    const callSeries = callsRaw
      .map(toCallPoint)
      .filter(Boolean)
      .sort((a, b) => a.t - b.t);
    const decisions = decisionsRaw.map((decision) => ({
      _id: decision._id,
      evaluatedAt: decision.evaluatedAt,
      evaluatedAtLocal: decision.evaluatedAtLocal ?? toLocalLabel(decision.evaluatedAt),
      window: decision.window ?? "OUTSIDE",
      decision: decision.decision ?? "SKIP",
      reasonCode: decision.reasonCode ?? "UNKNOWN",
      reasonDetail: decision.reasonDetail ?? null,
      predictedMaxTimeLocal: decision.predictedMaxTimeLocal ?? null,
      predictedMaxAtMs: decision.predictedMaxAtMs ?? null,
      callSid: decision.callSid ?? null,
      shadowMode: Boolean(decision.shadowMode),
    }));

    const forecastSnapshots = forecastSnapshotsRaw.map((snapshot) => ({
      _id: snapshot._id,
      fetchedAt: snapshot.fetchedAt,
      fetchedAtLocal: snapshot.fetchedAtLocal ?? toLocalLabel(snapshot.fetchedAt),
      forecastGeneratedAtLocal: snapshot.forecastGeneratedAt
        ? toLocalLabel(snapshot.forecastGeneratedAt)
        : null,
      predictedMaxTempF: toRoundedNumber(snapshot.predictedMaxTempF, 1),
      predictedMaxTimeLocal: snapshot.predictedMaxTimeLocal ?? null,
      hourlyCount: Array.isArray(snapshot.hourly) ? snapshot.hourly.length : 0,
    }));

    const latestSnapshot = forecastSnapshotsRaw[0] ?? null;
    const forecastSeries = Array.isArray(latestSnapshot?.hourly)
      ? latestSnapshot.hourly
          .map((item) => ({
            t: Number(item?.startMs),
            tempF: toRoundedNumber(item?.tempF, 1),
            shortForecast: item?.shortForecast ?? null,
          }))
          .filter((item) => Number.isFinite(item.t) && item.tempF !== null)
          .sort((a, b) => a.t - b.t)
      : [];

    const forecastDriftSeries = forecastSnapshots
      .filter((item) => Number.isFinite(Number(item.fetchedAt)) && item.predictedMaxTempF !== null)
      .map((item) => ({
        t: Number(item.fetchedAt),
        tempF: item.predictedMaxTempF,
        predictedMaxTimeLocal: item.predictedMaxTimeLocal,
      }))
      .sort((a, b) => a.t - b.t);

    return {
      dayKey,
      dailyStats: dailyStats ?? null,
      autoState: autoState ?? null,
      observations,
      calls,
      decisions,
      forecastSnapshots,
      alerts: alertsRaw,
      timeline: {
        observations,
        calls: callSeries,
        forecast: forecastSeries,
      },
      forecastDriftSeries,
    };
  },
});

export const getCallsPipeline = query({
  args: {
    limit: v.optional(v.number()),
    dayKey: v.optional(v.string()),
    allDays: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const limit = Math.min(Math.max(Math.round(Number(args.limit ?? 200)), 1), 400);
    const allDays = Boolean(args.allDays);
    const dayKey = args.dayKey ?? getChicagoDayKey();

    const rawCalls = allDays
      ? await ctx.db
          .query("phoneCalls")
          .withIndex("by_requestedAt", (q) => q)
          .order("desc")
          .take(limit)
      : await ctx.db
          .query("phoneCalls")
          .withIndex("by_dayKey", (q) => q.eq("dayKey", dayKey))
          .order("desc")
          .take(limit);

    const normalizedCalls = rawCalls.map((call) => {
      const requestedAt = Number(call.requestedAt);
      const callCompletedAt = Number(call.callCompletedAt);
      const updatedAt = Number(call.updatedAt);
      const durationSec = Number(call.recordingDurationSec);
      const transcriptionLatencySec =
        Number.isFinite(callCompletedAt) &&
        Number.isFinite(updatedAt) &&
        updatedAt >= callCompletedAt
          ? (updatedAt - callCompletedAt) / 1000
          : null;
      const failureGroup = classifyFailure(call);

      return {
        _id: call._id,
        dayKey: call.dayKey,
        status: call.status,
        requestedBy: call.requestedBy ?? "manual",
        requestedAt,
        requestedAtLocal: call.requestedAtLocal ?? toLocalLabel(requestedAt),
        callSid: call.callSid ?? null,
        recordingSid: call.recordingSid ?? null,
        recordingDurationSec: Number.isFinite(durationSec) ? durationSec : null,
        transcriptionLatencySec: Number.isFinite(transcriptionLatencySec)
          ? Math.round(transcriptionLatencySec * 10) / 10
          : null,
        parsedOk: Boolean(call.parsedOk),
        tempF: toRoundedNumber(call.tempF, 1),
        error: call.error ?? null,
        warning: call.warning ?? null,
        inFlight: IN_FLIGHT_STATUSES.has(String(call.status ?? "")),
        failureGroup,
      };
    });

    const statusCounts = {};
    const failureCounts = {};
    let inFlightCount = 0;
    let parsedSuccessCount = 0;
    let parseFailureCount = 0;
    let failedCount = 0;
    let totalDurationSec = 0;
    let durationCount = 0;
    let totalLatencySec = 0;
    let latencyCount = 0;
    let autoCallCount = 0;

    for (const call of normalizedCalls) {
      const status = String(call.status ?? "UNKNOWN");
      statusCounts[status] = Number(statusCounts[status] ?? 0) + 1;

      if (call.inFlight) {
        inFlightCount += 1;
      }
      if (call.parsedOk) {
        parsedSuccessCount += 1;
      }
      if (status === "PARSE_FAILED") {
        parseFailureCount += 1;
      }
      if (status === "FAILED") {
        failedCount += 1;
      }
      if (call.requestedBy === "forecast_automation") {
        autoCallCount += 1;
      }

      if (Number.isFinite(Number(call.recordingDurationSec))) {
        totalDurationSec += Number(call.recordingDurationSec);
        durationCount += 1;
      }

      if (Number.isFinite(Number(call.transcriptionLatencySec))) {
        totalLatencySec += Number(call.transcriptionLatencySec);
        latencyCount += 1;
      }

      if (call.failureGroup) {
        failureCounts[call.failureGroup] = Number(failureCounts[call.failureGroup] ?? 0) + 1;
      }
    }

    const totalCalls = normalizedCalls.length;
    const totalMinutes = totalDurationSec / 60;
    const twilioEstimate = totalMinutes * TWILIO_EST_COST_PER_MINUTE;
    const transcriptionEstimate = totalMinutes * TRANSCRIBE_EST_COST_PER_MINUTE;
    const estimatedCostUsd = twilioEstimate + transcriptionEstimate;

    return {
      scope: {
        dayKey: allDays ? null : dayKey,
        allDays,
        limit,
      },
      stats: {
        totalCalls,
        autoCallCount,
        manualCallCount: Math.max(totalCalls - autoCallCount, 0),
        inFlightCount,
        parsedSuccessCount,
        parseFailureCount,
        failedCount,
        parseSuccessRate: totalCalls > 0
          ? Math.round((parsedSuccessCount / totalCalls) * 1000) / 10
          : null,
        avgDurationSec: durationCount > 0
          ? Math.round((totalDurationSec / durationCount) * 10) / 10
          : null,
        avgTranscriptionLatencySec: latencyCount > 0
          ? Math.round((totalLatencySec / latencyCount) * 10) / 10
          : null,
        estimatedCostUsd: Math.round(estimatedCostUsd * 100) / 100,
        costAssumptions: {
          twilioPerMinuteUsd: TWILIO_EST_COST_PER_MINUTE,
          transcribePerMinuteUsd: TRANSCRIBE_EST_COST_PER_MINUTE,
        },
      },
      statusCounts,
      failureCounts,
      calls: normalizedCalls,
    };
  },
});

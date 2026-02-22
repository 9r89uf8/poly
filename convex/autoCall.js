import { action, internalAction, internalMutation, query } from "./_generated/server";
import { api, internal } from "./_generated/api";
import { v } from "convex/values";
import { formatUtcToChicago, getChicagoDayKey } from "./lib/time";
import { DEFAULT_SETTINGS } from "./lib/constants";
import { normalizeSettings } from "./lib/settings";
import {
  buildDecisionKey,
  isCallInFlight,
  isInsideHottestWindow,
  resolveHottestTwoHourWindow,
} from "./lib/autoCall";

const AUTO_CALL_CADENCE_MINUTES = 20;
const CALL_WINDOW_LABEL = "PEAK_2H";
const CALL_REASON_CODE = "CALL_PEAK_2H_WINDOW";

function toErrorMessage(error) {
  if (error instanceof Error) {
    return error.message;
  }
  if (typeof error === "string") {
    return error;
  }
  return "Unknown error";
}

function pickDefinedFields(value) {
  return Object.fromEntries(
    Object.entries(value ?? {}).filter(([, fieldValue]) => fieldValue !== undefined),
  );
}

function toFiniteNumberOrUndefined(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function toWindowDetail(window) {
  const startMs = Number(window?.windowStartAtMs);
  const endMs = Number(window?.windowEndAtMs);
  const hottestHourAtMs = Number(window?.hottestHourAtMs);
  const hottestHourTempF = Number(window?.hottestHourTempF);
  const pairTempSumF = Number(window?.pairTempSumF);

  if (!Number.isFinite(startMs) || !Number.isFinite(endMs)) {
    return null;
  }

  return {
    windowStartAtMs: startMs,
    windowEndAtMs: endMs,
    windowStartLocal: formatUtcToChicago(startMs, true),
    windowEndLocal: formatUtcToChicago(endMs, true),
    hottestHourAtMs: Number.isFinite(hottestHourAtMs) ? hottestHourAtMs : null,
    hottestHourLocal: Number.isFinite(hottestHourAtMs)
      ? formatUtcToChicago(hottestHourAtMs, true)
      : null,
    hottestHourTempF: Number.isFinite(hottestHourTempF) ? hottestHourTempF : null,
    pairTempSumF: Number.isFinite(pairTempSumF) ? pairTempSumF : null,
  };
}

const decisionPatchValidator = v.object({
  decision: v.optional(v.string()),
  reasonCode: v.optional(v.string()),
  reasonDetail: v.optional(v.any()),
  window: v.optional(v.string()),
  predictedMaxTimeLocal: v.optional(v.string()),
  predictedMaxAtMs: v.optional(v.number()),
  callSid: v.optional(v.string()),
  shadowMode: v.optional(v.boolean()),
});

const simulationOverridesValidator = v.object({
  autoCallEnabled: v.optional(v.boolean()),
  autoCallShadowMode: v.optional(v.boolean()),
  autoCallMaxPerDay: v.optional(v.number()),
  autoCallMinSpacingMinutes: v.optional(v.number()),
  autoCallEvalEveryMinutes: v.optional(v.number()),
  autoCallPrePeakLeadMinutes: v.optional(v.number()),
  autoCallPrePeakLagMinutes: v.optional(v.number()),
  autoCallPeakLeadMinutes: v.optional(v.number()),
  autoCallPeakLagMinutes: v.optional(v.number()),
  autoCallPostPeakLeadMinutes: v.optional(v.number()),
  autoCallPostPeakLagMinutes: v.optional(v.number()),
  autoCallNearMaxThresholdF: v.optional(v.number()),
});

function applySimulationOverrides(baseSettings, overrides = {}) {
  const next = {
    ...baseSettings,
    ...pickDefinedFields({
      autoCallEnabled: overrides.autoCallEnabled,
      autoCallShadowMode: overrides.autoCallShadowMode,
      autoCallMaxPerDay: toFiniteNumberOrUndefined(overrides.autoCallMaxPerDay),
      autoCallMinSpacingMinutes: toFiniteNumberOrUndefined(
        overrides.autoCallMinSpacingMinutes,
      ),
      autoCallEvalEveryMinutes: toFiniteNumberOrUndefined(
        overrides.autoCallEvalEveryMinutes,
      ),
      autoCallPrePeakLeadMinutes: toFiniteNumberOrUndefined(
        overrides.autoCallPrePeakLeadMinutes,
      ),
      autoCallPrePeakLagMinutes: toFiniteNumberOrUndefined(
        overrides.autoCallPrePeakLagMinutes,
      ),
      autoCallPeakLeadMinutes: toFiniteNumberOrUndefined(
        overrides.autoCallPeakLeadMinutes,
      ),
      autoCallPeakLagMinutes: toFiniteNumberOrUndefined(
        overrides.autoCallPeakLagMinutes,
      ),
      autoCallPostPeakLeadMinutes: toFiniteNumberOrUndefined(
        overrides.autoCallPostPeakLeadMinutes,
      ),
      autoCallPostPeakLagMinutes: toFiniteNumberOrUndefined(
        overrides.autoCallPostPeakLagMinutes,
      ),
      autoCallNearMaxThresholdF: toFiniteNumberOrUndefined(
        overrides.autoCallNearMaxThresholdF,
      ),
    }),
  };

  return normalizeSettings(next);
}

export const evaluateAndMaybeCall = internalAction({
  args: {},
  handler: async (ctx) => {
    const now = Date.now();
    const dayKey = getChicagoDayKey(now);
    const evaluatedAtLocal = formatUtcToChicago(now, true);

    const settings = await ctx.runQuery(api.settings.getSettings, {});
    const decisionKey = buildDecisionKey(dayKey, now, AUTO_CALL_CADENCE_MINUTES);

    const claimed = await ctx.runMutation(internal.autoCall.createDecisionPlaceholder, {
      dayKey,
      decisionKey,
      evaluatedAt: now,
      evaluatedAtLocal,
      shadowMode: Boolean(settings.autoCallShadowMode),
    });

    if (!claimed.created) {
      return {
        ok: true,
        duplicate: true,
        dayKey,
        decisionKey,
      };
    }

    const dashboard = await ctx.runQuery(api.dashboard.getDashboard, {
      dayKey,
      observationsLimit: 2,
      alertsLimit: 1,
    });
    const forecastSnapshot = await ctx.runQuery(api.forecast.getLatestForecastSnapshot, {
      dayKey,
    });
    const latestCall = await ctx.runQuery(api.calls.getLatestPhoneCall, {
      allDays: true,
    });

    let decision = "SKIP";
    let reasonCode = "SKIP_DISABLED";
    let reasonDetail = null;
    let window = "OUTSIDE";
    let callSid = undefined;

    const predictedMaxAtMs = Number(forecastSnapshot?.predictedMaxAtMs);
    const callWindow = resolveHottestTwoHourWindow(forecastSnapshot?.hourly);
    const inCallWindow = isInsideHottestWindow(now, callWindow);
    const windowDetail = toWindowDetail(callWindow);
    const baseWindowDetail = windowDetail ?? {};
    window = inCallWindow ? CALL_WINDOW_LABEL : "OUTSIDE";

    if (!settings.autoCallEnabled) {
      reasonCode = "SKIP_DISABLED";
    } else if (!forecastSnapshot || !callWindow) {
      reasonCode = "SKIP_NO_FORECAST";
    } else if (dashboard.dailyStats?.isStale) {
      reasonCode = "SKIP_DATA_STALE";
    } else if (!inCallWindow) {
      reasonCode = "SKIP_OUTSIDE_WINDOW";
      reasonDetail = {
        ...baseWindowDetail,
        nowLocal: evaluatedAtLocal,
      };
    } else if (latestCall && isCallInFlight(latestCall.status)) {
      reasonCode = "SKIP_CALL_IN_FLIGHT";
      reasonDetail = {
        ...baseWindowDetail,
        latestCallStatus: latestCall.status,
      };
    } else if (settings.autoCallShadowMode) {
      reasonCode = "SKIP_SHADOW_MODE";
      reasonDetail = {
        ...baseWindowDetail,
        wouldCallReason: CALL_REASON_CODE,
      };
    } else {
      decision = "CALL";
      reasonCode = CALL_REASON_CODE;

      try {
        const callResult = await ctx.runAction(api.airportCalls.requestManualAirportCall, {
          requestedBy: "forecast_automation",
        });
        callSid = callResult?.callSid;
        reasonDetail = {
          ...baseWindowDetail,
          requestedAtLocal: callResult?.requestedAtLocal ?? evaluatedAtLocal,
          warning: callResult?.warning ?? null,
        };
      } catch (error) {
        reasonCode = "CALL_FAILED";
        reasonDetail = {
          ...baseWindowDetail,
          error: toErrorMessage(error),
          intendedReason: CALL_REASON_CODE,
        };
      }
    }

    const finalPatch = {
      decision,
      reasonCode,
      reasonDetail: reasonDetail ?? undefined,
      window,
      predictedMaxTimeLocal: forecastSnapshot?.predictedMaxTimeLocal,
      predictedMaxAtMs: Number.isFinite(predictedMaxAtMs) ? predictedMaxAtMs : undefined,
      callSid,
      shadowMode: Boolean(settings.autoCallShadowMode),
    };

    await ctx.runMutation(internal.autoCall.finalizeDecisionById, {
      decisionId: claimed.decisionId,
      patch: finalPatch,
    });

    const calledSuccessfully = decision === "CALL" && reasonCode !== "CALL_FAILED";

    const nextState = await ctx.runMutation(internal.autoCall.applyDecisionToState, {
      dayKey,
      enabled: Boolean(settings.autoCallEnabled),
      shadowMode: Boolean(settings.autoCallShadowMode),
      evaluatedAt: now,
      reasonCode,
      incrementCallCount: calledSuccessfully,
    });

    if (calledSuccessfully) {
      await ctx.runMutation(internal.weather.insertAlert, {
        dayKey,
        type: "AUTO_CALL_TRIGGERED",
        payload: {
          reasonCode,
          decisionKey,
          callSid: callSid ?? null,
          predictedMaxTimeLocal: forecastSnapshot?.predictedMaxTimeLocal ?? null,
          callWindowStartLocal: windowDetail?.windowStartLocal ?? null,
          callWindowEndLocal: windowDetail?.windowEndLocal ?? null,
        },
      });
    } else if (reasonCode === "CALL_FAILED") {
      await ctx.runMutation(internal.weather.insertAlert, {
        dayKey,
        type: "AUTO_CALL_FAILED",
        payload: {
          decisionKey,
          reasonDetail: reasonDetail ?? null,
        },
      });
    }

    return {
      ok: true,
      dayKey,
      decisionKey,
      decision,
      reasonCode,
      callSid: callSid ?? null,
      autoCallsMade: nextState.autoCallsMade,
    };
  },
});

export const evaluateNow = action({
  args: {},
  handler: async (ctx) => {
    return await ctx.runAction(internal.autoCall.evaluateAndMaybeCall, {});
  },
});

export const createDecisionPlaceholder = internalMutation({
  args: {
    dayKey: v.string(),
    decisionKey: v.string(),
    evaluatedAt: v.number(),
    evaluatedAtLocal: v.string(),
    shadowMode: v.boolean(),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("autoCallDecisions")
      .withIndex("by_decisionKey", (q) => q.eq("decisionKey", args.decisionKey))
      .unique();

    if (existing) {
      return { created: false, decisionId: existing._id };
    }

    const now = Date.now();
    const decisionId = await ctx.db.insert("autoCallDecisions", {
      dayKey: args.dayKey,
      decisionKey: args.decisionKey,
      evaluatedAt: args.evaluatedAt,
      evaluatedAtLocal: args.evaluatedAtLocal,
      decision: "SKIP",
      reasonCode: "PENDING_EVALUATION",
      window: "OUTSIDE",
      shadowMode: args.shadowMode,
      createdAt: now,
      updatedAt: now,
    });

    return { created: true, decisionId };
  },
});

export const finalizeDecisionById = internalMutation({
  args: {
    decisionId: v.id("autoCallDecisions"),
    patch: decisionPatchValidator,
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db.get(args.decisionId);
    if (!existing) {
      return { updated: false };
    }

    await ctx.db.patch(args.decisionId, {
      ...pickDefinedFields(args.patch),
      updatedAt: Date.now(),
    });

    return { updated: true };
  },
});

export const applyDecisionToState = internalMutation({
  args: {
    dayKey: v.string(),
    enabled: v.boolean(),
    shadowMode: v.boolean(),
    evaluatedAt: v.number(),
    reasonCode: v.string(),
    incrementCallCount: v.boolean(),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("autoCallState")
      .withIndex("by_dayKey", (q) => q.eq("dayKey", args.dayKey))
      .unique();

    const baseCount = Number(existing?.autoCallsMade ?? 0);
    const nextCount = args.incrementCallCount ? baseCount + 1 : baseCount;

    const value = {
      dayKey: args.dayKey,
      enabled: args.enabled,
      shadowMode: args.shadowMode,
      autoCallsMade: nextCount,
      lastAutoCallAt: args.incrementCallCount
        ? args.evaluatedAt
        : existing?.lastAutoCallAt,
      lastDecisionAt: args.evaluatedAt,
      lastReasonCode: args.reasonCode,
      updatedAt: Date.now(),
    };

    if (!existing) {
      const stateId = await ctx.db.insert("autoCallState", value);
      return { ...value, stateId };
    }

    await ctx.db.patch(existing._id, value);
    return { ...value, stateId: existing._id };
  },
});

export const getAutoCallState = query({
  args: {
    dayKey: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const dayKey = args.dayKey ?? getChicagoDayKey();
    return await ctx.db
      .query("autoCallState")
      .withIndex("by_dayKey", (q) => q.eq("dayKey", dayKey))
      .unique();
  },
});

export const getRecentDecisions = query({
  args: {
    dayKey: v.optional(v.string()),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const dayKey = args.dayKey ?? getChicagoDayKey();
    const limit = Math.min(Math.max(args.limit ?? 20, 1), 100);
    return await ctx.db
      .query("autoCallDecisions")
      .withIndex("by_dayKey_createdAt", (q) => q.eq("dayKey", dayKey))
      .order("desc")
      .take(limit);
  },
});

export const simulateCurrentDecision = query({
  args: {
    dayKey: v.optional(v.string()),
    overrides: v.optional(simulationOverridesValidator),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    const dayKey = args.dayKey ?? getChicagoDayKey(now);

    const storedSettings = await ctx.db
      .query("settings")
      .withIndex("by_key", (q) => q.eq("key", DEFAULT_SETTINGS.key))
      .unique();
    const settings = applySimulationOverrides(
      normalizeSettings(storedSettings),
      args.overrides ?? {},
    );

    const [state, dailyStats, forecastSnapshot, latestCall] = await Promise.all([
      ctx.db
        .query("autoCallState")
        .withIndex("by_dayKey", (q) => q.eq("dayKey", dayKey))
        .unique(),
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
        .withIndex("by_requestedAt", (q) => q)
        .order("desc")
        .first(),
    ]);

    const callWindow = resolveHottestTwoHourWindow(forecastSnapshot?.hourly);
    const inCallWindow = isInsideHottestWindow(now, callWindow);
    const windowDetail = toWindowDetail(callWindow);

    let decision = "SKIP";
    let reasonCode = "SKIP_DISABLED";
    let reasonDetail = null;
    let window = "OUTSIDE";

    if (inCallWindow) {
      window = CALL_WINDOW_LABEL;
    }

    if (!settings.autoCallEnabled) {
      reasonCode = "SKIP_DISABLED";
    } else if (!forecastSnapshot || !callWindow) {
      reasonCode = "SKIP_NO_FORECAST";
    } else if (dailyStats?.isStale) {
      reasonCode = "SKIP_DATA_STALE";
    } else if (!inCallWindow) {
      reasonCode = "SKIP_OUTSIDE_WINDOW";
      reasonDetail = {
        ...(windowDetail ?? {}),
        nowLocal: formatUtcToChicago(now, true),
      };
    } else if (latestCall && isCallInFlight(latestCall.status)) {
      reasonCode = "SKIP_CALL_IN_FLIGHT";
      reasonDetail = {
        ...(windowDetail ?? {}),
        latestCallStatus: latestCall.status,
      };
    } else if (settings.autoCallShadowMode) {
      reasonCode = "SKIP_SHADOW_MODE";
      reasonDetail = {
        ...(windowDetail ?? {}),
        wouldCallReason: CALL_REASON_CODE,
      };
    } else {
      decision = "CALL";
      reasonCode = CALL_REASON_CODE;
    }

    return {
      dayKey,
      simulatedAt: now,
      simulatedAtLocal: formatUtcToChicago(now, true),
      decision,
      reasonCode,
      reasonDetail,
      window,
      signals: {
        hasForecastWindow: Boolean(callWindow),
        inPeakTwoHourWindow: inCallWindow,
      },
      guards: {
        enabled: Boolean(settings.autoCallEnabled),
        hasForecast: Boolean(callWindow),
        dataFresh: !Boolean(dailyStats?.isStale),
        inWindow: inCallWindow,
        callInFlight: Boolean(latestCall && isCallInFlight(latestCall.status)),
      },
      context: {
        predictedMaxTempF: Number.isFinite(Number(forecastSnapshot?.predictedMaxTempF))
          ? Number(forecastSnapshot.predictedMaxTempF)
          : null,
        predictedMaxTimeLocal: forecastSnapshot?.predictedMaxTimeLocal ?? null,
        latestForecastFetchedAtLocal:
          forecastSnapshot?.fetchedAtLocal ??
          (forecastSnapshot?.fetchedAt
            ? formatUtcToChicago(forecastSnapshot.fetchedAt, true)
            : null),
        callWindowStartLocal: windowDetail?.windowStartLocal ?? null,
        callWindowEndLocal: windowDetail?.windowEndLocal ?? null,
        hottestHourLocal: windowDetail?.hottestHourLocal ?? null,
        autoCallsMade: Number(state?.autoCallsMade ?? 0),
      },
      settingsUsed: {
        autoCallEnabled: Boolean(settings.autoCallEnabled),
        autoCallShadowMode: Boolean(settings.autoCallShadowMode),
        autoCallCadenceMinutes: AUTO_CALL_CADENCE_MINUTES,
      },
    };
  },
});

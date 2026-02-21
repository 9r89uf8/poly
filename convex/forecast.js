import { action, internalAction, internalMutation, query } from "./_generated/server";
import { api, internal } from "./_generated/api";
import { v } from "convex/values";
import { formatUtcToChicago, getChicagoDayKey } from "./lib/time";

const NWS_POINTS_URL = "https://api.weather.gov/points/41.9786,-87.9048";
const DEFAULT_NWS_USER_AGENT = "poly-forecast-auto/1.0 (ops@example.com)";

function toErrorMessage(error) {
  if (error instanceof Error) {
    return error.message;
  }
  if (typeof error === "string") {
    return error;
  }
  return "Unknown error";
}

function toTempF(temperature, unit) {
  if (!Number.isFinite(temperature)) {
    return null;
  }

  const normalizedUnit = String(unit ?? "").toUpperCase();
  if (normalizedUnit === "F") {
    return Number(temperature);
  }

  if (normalizedUnit === "C") {
    return (Number(temperature) * 9) / 5 + 32;
  }

  return null;
}

function normalizeHourlyPeriods(periods) {
  const list = Array.isArray(periods) ? periods : [];
  const normalized = [];

  for (const period of list) {
    const startTime = String(period?.startTime ?? "");
    const startMs = Date.parse(startTime);
    if (!Number.isFinite(startMs)) {
      continue;
    }

    const temperature = Number(period?.temperature);
    const temperatureUnit = String(period?.temperatureUnit ?? "").toUpperCase();
    const tempF = toTempF(temperature, temperatureUnit);

    normalized.push({
      startTime,
      startMs,
      startTimeLocal: formatUtcToChicago(startMs, true),
      temperature: Number.isFinite(temperature) ? temperature : null,
      temperatureUnit: temperatureUnit || null,
      tempF,
      shortForecast: period?.shortForecast ?? null,
    });
  }

  return normalized;
}

function computePredictedPeak(dayPeriods) {
  let maxTempF = Number.NEGATIVE_INFINITY;

  for (const period of dayPeriods) {
    if (Number.isFinite(period?.tempF)) {
      maxTempF = Math.max(maxTempF, period.tempF);
    }
  }

  if (!Number.isFinite(maxTempF)) {
    return {
      predictedMaxTempF: null,
      predictedMaxAtMs: null,
      predictedMaxTimeLocal: null,
    };
  }

  const peakPeriod = dayPeriods.find((period) => period.tempF === maxTempF) ?? null;
  const predictedMaxAtMs = peakPeriod?.startMs ?? null;

  return {
    predictedMaxTempF: maxTempF,
    predictedMaxAtMs,
    predictedMaxTimeLocal: predictedMaxAtMs
      ? formatUtcToChicago(predictedMaxAtMs, true)
      : null,
  };
}

export const refreshForecastSnapshot = internalAction({
  args: {
    dayKey: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    const nowDayKey = getChicagoDayKey(now);
    const dayKey = args.dayKey ?? nowDayKey;
    const fetchedAtLocal = formatUtcToChicago(now, true);
    const userAgent = String(process.env.NWS_USER_AGENT ?? DEFAULT_NWS_USER_AGENT).trim();

    try {
      const pointsResponse = await fetch(NWS_POINTS_URL, {
        method: "GET",
        headers: {
          "User-Agent": userAgent,
          Accept: "application/geo+json",
        },
      });

      if (!pointsResponse.ok) {
        throw new Error(`NWS points endpoint returned HTTP ${pointsResponse.status}.`);
      }

      const pointsPayload = await pointsResponse.json();
      const hourlyUrl = pointsPayload?.properties?.forecastHourly;
      if (!hourlyUrl) {
        throw new Error("NWS points payload is missing properties.forecastHourly.");
      }

      const hourlyResponse = await fetch(hourlyUrl, {
        method: "GET",
        headers: {
          "User-Agent": userAgent,
          Accept: "application/geo+json",
        },
      });

      if (!hourlyResponse.ok) {
        throw new Error(`NWS hourly endpoint returned HTTP ${hourlyResponse.status}.`);
      }

      const hourlyPayload = await hourlyResponse.json();
      const forecastGeneratedAtRaw = hourlyPayload?.properties?.updateTime;
      const forecastGeneratedAt = Date.parse(String(forecastGeneratedAtRaw ?? ""));
      const periods = normalizeHourlyPeriods(hourlyPayload?.properties?.periods);
      const dayPeriods = periods.filter(
        (period) => getChicagoDayKey(period.startMs) === dayKey,
      );

      const peak = computePredictedPeak(dayPeriods);

      const inserted = await ctx.runMutation(internal.forecast.insertForecastSnapshot, {
        dayKey,
        source: "NWS_HOURLY",
        fetchedAt: now,
        fetchedAtLocal,
        forecastGeneratedAt: Number.isFinite(forecastGeneratedAt)
          ? forecastGeneratedAt
          : undefined,
        predictedMaxTempF: Number.isFinite(peak.predictedMaxTempF)
          ? peak.predictedMaxTempF
          : undefined,
        predictedMaxAtMs: Number.isFinite(peak.predictedMaxAtMs)
          ? peak.predictedMaxAtMs
          : undefined,
        predictedMaxTimeLocal: peak.predictedMaxTimeLocal ?? undefined,
        hourly: dayPeriods,
      });

      return {
        ok: true,
        dayKey,
        forecastSnapshotId: inserted.forecastSnapshotId,
        periodsStored: dayPeriods.length,
        predictedMaxTempF: peak.predictedMaxTempF,
        predictedMaxTimeLocal: peak.predictedMaxTimeLocal,
      };
    } catch (error) {
      const reason = toErrorMessage(error);

      await ctx.runMutation(internal.weather.insertAlert, {
        dayKey: nowDayKey,
        type: "FORECAST_REFRESH_FAILED",
        payload: {
          dayKey,
          reason,
        },
      });

      throw new Error(`Forecast refresh failed: ${reason}`);
    }
  },
});

export const refreshForecastNow = action({
  args: {},
  handler: async (ctx) => {
    return await ctx.runAction(internal.forecast.refreshForecastSnapshot, {});
  },
});

export const insertForecastSnapshot = internalMutation({
  args: {
    dayKey: v.string(),
    source: v.string(),
    fetchedAt: v.number(),
    fetchedAtLocal: v.optional(v.string()),
    forecastGeneratedAt: v.optional(v.number()),
    predictedMaxTempF: v.optional(v.number()),
    predictedMaxAtMs: v.optional(v.number()),
    predictedMaxTimeLocal: v.optional(v.string()),
    hourly: v.array(v.any()),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    const forecastSnapshotId = await ctx.db.insert("forecastSnapshots", {
      dayKey: args.dayKey,
      source: args.source,
      fetchedAt: args.fetchedAt,
      fetchedAtLocal: args.fetchedAtLocal,
      forecastGeneratedAt: args.forecastGeneratedAt,
      predictedMaxTempF: args.predictedMaxTempF,
      predictedMaxAtMs: args.predictedMaxAtMs,
      predictedMaxTimeLocal: args.predictedMaxTimeLocal,
      hourly: args.hourly,
      createdAt: now,
      updatedAt: now,
    });

    return { forecastSnapshotId };
  },
});

export const getLatestForecastSnapshot = query({
  args: {
    dayKey: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const dayKey = args.dayKey ?? getChicagoDayKey();
    return await ctx.db
      .query("forecastSnapshots")
      .withIndex("by_dayKey_fetchedAt", (q) => q.eq("dayKey", dayKey))
      .order("desc")
      .first();
  },
});

export const getRecentForecastSnapshots = query({
  args: {
    dayKey: v.optional(v.string()),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const dayKey = args.dayKey ?? getChicagoDayKey();
    const limit = Math.min(Math.max(args.limit ?? 10, 1), 100);
    return await ctx.db
      .query("forecastSnapshots")
      .withIndex("by_dayKey_fetchedAt", (q) => q.eq("dayKey", dayKey))
      .order("desc")
      .take(limit);
  },
});

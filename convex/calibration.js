//convex/calibration.js
import { action, mutation, query } from "./_generated/server";
import { api } from "./_generated/api";
import { v } from "convex/values";
import { CALIBRATION_METHODS, evaluateCalibrationDays, parseIemAsosCsv } from "./lib/calibration";
import { CHICAGO_TIMEZONE } from "./lib/constants";

const DAY_KEY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const IEM_ASOS_ENDPOINT = "https://mesonet.agron.iastate.edu/cgi-bin/request/asos.py";

function assertDayKey(dayKey, label) {
  const normalized = String(dayKey ?? "").trim();
  if (!DAY_KEY_PATTERN.test(normalized)) {
    throw new Error(`${label} must be YYYY-MM-DD.`);
  }
  return normalized;
}

function toDayKey(date) {
  return date.toISOString().slice(0, 10);
}

function addDays(dayKey, daysToAdd) {
  const [year, month, day] = dayKey.split("-").map(Number);
  const next = new Date(Date.UTC(year, month - 1, day + daysToAdd));
  return toDayKey(next);
}

function listDayKeysInclusive(startDayKey, endDayKey) {
  const dayKeys = [];
  let cursor = startDayKey;

  while (cursor <= endDayKey) {
    dayKeys.push(cursor);
    cursor = addDays(cursor, 1);
    if (dayKeys.length > 180) {
      throw new Error("Calibration range is too large. Use 180 days or fewer.");
    }
  }

  return dayKeys;
}

function dayKeyFromUtcMsInTimeZone(utcMs, timeZone) {
  if (!Number.isFinite(utcMs)) {
    return null;
  }

  const date = new Date(utcMs);
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);

  const year = parts.find((part) => part.type === "year")?.value;
  const month = parts.find((part) => part.type === "month")?.value;
  const day = parts.find((part) => part.type === "day")?.value;

  if (!year || !month || !day) {
    return null;
  }

  return `${year}-${month}-${day}`;
}

function resolveTimeZone(timeZone) {
  const normalized = String(timeZone ?? CHICAGO_TIMEZONE).trim() || CHICAGO_TIMEZONE;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: normalized }).format(new Date(0));
    return normalized;
  } catch {
    return CHICAGO_TIMEZONE;
  }
}

async function fetchIemRowsForRange(station, startDayKey, endDayKeyExclusive) {
  const primaryParams = new URLSearchParams();
  primaryParams.set("station", station);
  primaryParams.append("data", "metar");
  primaryParams.append("data", "tmpf");
  primaryParams.append("report_type", "3");
  primaryParams.append("report_type", "4");
  primaryParams.set("tz", "UTC");
  primaryParams.set("format", "onlycomma");
  primaryParams.set("missing", "empty");
  primaryParams.set("sts", `${startDayKey}T00:00Z`);
  primaryParams.set("ets", `${endDayKeyExclusive}T00:00Z`);

  let response = await fetch(`${IEM_ASOS_ENDPOINT}?${primaryParams.toString()}`, {
    method: "GET",
    headers: {
      "Cache-Control": "no-cache",
      Pragma: "no-cache",
    },
  });

  if (response.status === 422) {
    // Fallback for stricter validators preferring year/month/day style windows.
    const [year1, month1, day1] = startDayKey.split("-").map(Number);
    const [year2, month2, day2] = endDayKeyExclusive.split("-").map(Number);

    const fallbackParams = new URLSearchParams();
    fallbackParams.set("station", station);
    fallbackParams.append("data", "metar");
    fallbackParams.append("data", "tmpf");
    fallbackParams.append("report_type", "3");
    fallbackParams.append("report_type", "4");
    fallbackParams.set("tz", "UTC");
    fallbackParams.set("format", "onlycomma");
    fallbackParams.set("missing", "empty");
    fallbackParams.set("year1", String(year1));
    fallbackParams.set("month1", String(month1));
    fallbackParams.set("day1", String(day1));
    fallbackParams.set("year2", String(year2));
    fallbackParams.set("month2", String(month2));
    fallbackParams.set("day2", String(day2));

    response = await fetch(`${IEM_ASOS_ENDPOINT}?${fallbackParams.toString()}`, {
      method: "GET",
      headers: {
        "Cache-Control": "no-cache",
        Pragma: "no-cache",
      },
    });
  }

  if (!response.ok) {
    const details = (await response.text()).trim();
    throw new Error(
      `IEM asos.py returned HTTP ${response.status}${details ? `: ${details.slice(0, 400)}` : ""}`,
    );
  }

  const csvText = await response.text();
  return parseIemAsosCsv(csvText);
}

function methodLabel(method) {
  return `${method.tempExtraction} + ${method.rounding}`;
}

function normalizeWuValues(wuValues, dayKeysInRange) {
  const byDayKey = new Map();
  for (const row of wuValues) {
    const dayKey = assertDayKey(row.dayKey, "wuValues.dayKey");
    if (!dayKeysInRange.has(dayKey)) {
      continue;
    }

    const wuHighWholeF = Number(row.wuHighWholeF);
    if (!Number.isFinite(wuHighWholeF) || !Number.isInteger(wuHighWholeF)) {
      throw new Error(`WU high for ${dayKey} must be an integer.`);
    }

    byDayKey.set(dayKey, wuHighWholeF);
  }

  const missingDays = [...dayKeysInRange].filter((dayKey) => !byDayKey.has(dayKey));
  if (missingDays.length > 0) {
    throw new Error(
      `Missing WU highs for day(s): ${missingDays.join(", ")}.`,
    );
  }

  return byDayKey;
}

export const runCalibration = action({
  args: {
    dateRange: v.object({
      startDayKey: v.string(),
      endDayKey: v.string(),
    }),
    wuValues: v.array(
      v.object({
        dayKey: v.string(),
        wuHighWholeF: v.number(),
      }),
    ),
    station: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const startDayKey = assertDayKey(args.dateRange.startDayKey, "startDayKey");
    const endDayKey = assertDayKey(args.dateRange.endDayKey, "endDayKey");

    if (startDayKey > endDayKey) {
      throw new Error("startDayKey must be on or before endDayKey.");
    }

    const dayKeys = listDayKeysInclusive(startDayKey, endDayKey);
    const dayKeySet = new Set(dayKeys);
    const wuByDayKey = normalizeWuValues(args.wuValues, dayKeySet);

    const settings = await ctx.runQuery(api.settings.getSettings, {});
    const station = String(args.station ?? settings.station ?? "KORD")
      .trim()
      .toUpperCase();

    const rows = await fetchIemRowsForRange(
      station,
      startDayKey,
      addDays(endDayKey, 2),
    );

    const timeZone = resolveTimeZone(settings.timezone);
    const observationsByDay = new Map(dayKeys.map((dayKey) => [dayKey, []]));
    for (const row of rows) {
      if (!Number.isFinite(row.validUtcMs)) {
        continue;
      }

      const localDayKey = dayKeyFromUtcMsInTimeZone(row.validUtcMs, timeZone);
      if (!localDayKey || !observationsByDay.has(localDayKey)) {
        continue;
      }

      observationsByDay.get(localDayKey).push({
        valid: row.valid,
        validUtcMs: row.validUtcMs,
        rawMetar: row.rawMetar,
        tmpf: row.tmpf,
      });
    }

    const calibrationDays = dayKeys.map((dayKey) => ({
      dayKey,
      wuHighWholeF: wuByDayKey.get(dayKey),
      observations: observationsByDay.get(dayKey) ?? [],
    }));

    const evaluation = evaluateCalibrationDays(calibrationDays);
    const chosenMethod = evaluation.chosenMethod;

    if (!chosenMethod) {
      throw new Error("No calibration method results were produced.");
    }

    const runId = await ctx.runMutation(api.calibration.insertCalibrationRun, {
      dateRangeStart: startDayKey,
      dateRangeEnd: endDayKey,
      methodsTested: evaluation.methodResults.map((result) => result.methodId),
      matchRate: chosenMethod.matchRate,
      chosenMethod: chosenMethod.methodId,
      mismatches: chosenMethod.mismatches,
      notes: `station=${station}; days=${calibrationDays.length}; source=IEM asos.py report_type=3,4 data=metar,tmpf`,
    });

    return {
      runId,
      station,
      dateRange: {
        startDayKey,
        endDayKey,
      },
      totalDays: calibrationDays.length,
      dayCoverage: calibrationDays.map((day) => ({
        dayKey: day.dayKey,
        observationCount: day.observations.length,
        wuHighWholeF: day.wuHighWholeF,
      })),
      methodResults: evaluation.methodResults.map((result) => ({
        methodId: result.methodId,
        label: methodLabel(result),
        tempExtraction: result.tempExtraction,
        rounding: result.rounding,
        matchedDays: result.matchedDays,
        totalDays: result.totalDays,
        matchRate: result.matchRate,
        mismatches: result.mismatches,
      })),
      chosenMethod: {
        methodId: chosenMethod.methodId,
        label: methodLabel(chosenMethod),
        tempExtraction: chosenMethod.tempExtraction,
        rounding: chosenMethod.rounding,
        matchedDays: chosenMethod.matchedDays,
        totalDays: chosenMethod.totalDays,
        matchRate: chosenMethod.matchRate,
        mismatches: chosenMethod.mismatches,
      },
    };
  },
});

export const insertCalibrationRun = mutation({
  args: {
    dateRangeStart: v.string(),
    dateRangeEnd: v.string(),
    methodsTested: v.array(v.string()),
    matchRate: v.optional(v.number()),
    chosenMethod: v.optional(v.string()),
    mismatches: v.optional(v.array(v.any())),
    notes: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    return await ctx.db.insert("calibrationRuns", {
      dateRangeStart: args.dateRangeStart,
      dateRangeEnd: args.dateRangeEnd,
      methodsTested: args.methodsTested,
      matchRate: args.matchRate,
      chosenMethod: args.chosenMethod,
      mismatches: args.mismatches,
      notes: args.notes,
      createdAt: Date.now(),
    });
  },
});

export const getRecentCalibrationRuns = query({
  args: {
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const limit = Math.min(Math.max(args.limit ?? 10, 1), 50);

    return await ctx.db
      .query("calibrationRuns")
      .withIndex("by_createdAt")
      .order("desc")
      .take(limit);
  },
});

export const getCalibrationMethods = query({
  args: {},
  handler: async () => {
    return CALIBRATION_METHODS.map((method) => ({
      methodId: method.methodId,
      tempExtraction: method.tempExtraction,
      rounding: method.rounding,
      rank: method.rank,
    }));
  },
});

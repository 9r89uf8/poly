import { api, internal } from "./_generated/api";
import { internalAction, mutation, query } from "./_generated/server";
import { v } from "convex/values";
import { formatUtcToChicago, getChicagoDayKey } from "./lib/time";
import {
  computePollFreshness,
  resolveLastSuccessfulPollAtMs,
} from "./lib/freshness";
import {
  deriveWuLikeTempWholeF,
  parseAwcMetarJson,
  parseNwsMetarText,
} from "./lib/weather";

function toErrorMessage(error) {
  if (error instanceof Error) {
    return error.message;
  }

  if (typeof error === "string") {
    return error;
  }

  return "Unknown error";
}

function hashString(value) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash +=
      (hash << 1) +
      (hash << 4) +
      (hash << 7) +
      (hash << 8) +
      (hash << 24);
  }

  return (hash >>> 0).toString(16).padStart(8, "0");
}

function buildObsKey(station, obsZuluStamp, rawMetar) {
  return `${String(station).toUpperCase()}|${obsZuluStamp}|${hashString(rawMetar)}`;
}

function obsZuluStampToUtcIso(obsZuluStamp, referenceTime) {
  const match = String(obsZuluStamp).match(/^(\d{2})(\d{2})(\d{2})Z$/);
  if (!match) {
    return new Date(referenceTime).toISOString();
  }

  const [, dayPart, hourPart, minutePart] = match;
  const referenceDate = new Date(referenceTime);
  const year = referenceDate.getUTCFullYear();
  const month = referenceDate.getUTCMonth();

  let candidate = new Date(
    Date.UTC(
      year,
      month,
      Number(dayPart),
      Number(hourPart),
      Number(minutePart),
      0,
      0,
    ),
  );

  const diffMs = candidate.getTime() - referenceTime;
  if (diffMs > 36 * 60 * 60 * 1000) {
    candidate = new Date(
      Date.UTC(
        year,
        month - 1,
        Number(dayPart),
        Number(hourPart),
        Number(minutePart),
        0,
        0,
      ),
    );
  }

  if (referenceTime - candidate.getTime() > 29 * 24 * 60 * 60 * 1000) {
    candidate = new Date(
      Date.UTC(
        year,
        month + 1,
        Number(dayPart),
        Number(hourPart),
        Number(minutePart),
        0,
        0,
      ),
    );
  }

  return candidate.toISOString();
}

function getNumberOrNull(value) {
  return Number.isFinite(value) ? value : null;
}

function computeBinStatus(bin, highSoFarWholeF) {
  const lower = getNumberOrNull(bin.lowerBoundF);
  const upper = getNumberOrNull(bin.upperBoundF);

  if (upper !== null && upper < highSoFarWholeF) {
    return "DEAD";
  }

  const belowLower = lower !== null && highSoFarWholeF < lower;
  const aboveUpper = upper !== null && highSoFarWholeF > upper;

  if (!belowLower && !aboveUpper) {
    return "CURRENT";
  }

  return "ALIVE";
}

function buildBinUpdates(bins, highSoFarWholeF, timestampLocal) {
  const statuses = [];
  const eliminated = [];

  for (const bin of bins) {
    const status = computeBinStatus(bin, highSoFarWholeF);
    const becameDead = status === "DEAD" && bin.status !== "DEAD";

    statuses.push({
      marketId: bin.marketId,
      status,
      deadSinceLocalTime: becameDead
        ? timestampLocal
        : (bin.deadSinceLocalTime ?? undefined),
    });

    if (becameDead) {
      eliminated.push({
        marketId: bin.marketId,
        label: bin.label,
        upperBoundF: bin.upperBoundF,
      });
    }
  }

  return {
    statuses,
    eliminated,
  };
}

async function fetchPrimaryObservation(primaryUrl, station) {
  const response = await fetch(primaryUrl, {
    method: "GET",
    headers: {
      "Cache-Control": "no-cache",
      Pragma: "no-cache",
    },
  });

  if (!response.ok) {
    throw new Error(`NWS returned HTTP ${response.status}`);
  }

  const rawText = await response.text();
  return parseNwsMetarText(rawText, { station });
}

async function fetchBackupObservation(backupUrl) {
  const response = await fetch(backupUrl, {
    method: "GET",
    headers: {
      "Cache-Control": "no-cache",
      Pragma: "no-cache",
    },
  });

  if (!response.ok) {
    throw new Error(`AWC returned HTTP ${response.status}`);
  }

  const payload = await response.json();
  return parseAwcMetarJson(payload);
}

export const pollWeatherAndUpdateState = internalAction({
  args: {},
  handler: async (ctx) => {
    const now = Date.now();
    const dayKey = getChicagoDayKey(now);
    const polledAtLocal = formatUtcToChicago(now, true);

    const settings = await ctx.runQuery(api.settings.getSettings, {});
    const dashboard = await ctx.runQuery(api.dashboard.getDashboard, {
      dayKey,
      observationsLimit: 1,
      alertsLimit: 20,
    });
    const wasStale = Boolean(dashboard.dailyStats?.isStale);
    const previousLastSuccessfulPollAtMs = resolveLastSuccessfulPollAtMs(
      dashboard.dailyStats,
    );

    let observation = null;
    let failoverPayload = null;

    try {
      observation = await fetchPrimaryObservation(
        settings.weatherPrimaryUrl,
        settings.station,
      );
    } catch (primaryError) {
      const primaryReason = toErrorMessage(primaryError);
      try {
        observation = await fetchBackupObservation(settings.weatherBackupUrl);
        failoverPayload = {
          station: settings.station,
          from: "NWS",
          to: "AWC",
          reason: primaryReason,
        };
      } catch (backupError) {
        const freshness = computePollFreshness({
          nowMs: now,
          lastSuccessfulPollAtMs: previousLastSuccessfulPollAtMs,
          stalePollSeconds: settings.stalePollSeconds,
        });

        await ctx.runMutation(internal.weather.upsertDailyStats, {
          dayKey,
          payload: {
            lastSuccessfulPollAtMs:
              previousLastSuccessfulPollAtMs ?? undefined,
            pollStaleSeconds: freshness.pollStaleSeconds,
            isStale: freshness.isStale,
            activeMarketSet: Boolean(dashboard.activeMarket),
          },
        });

        if (!wasStale && freshness.isStale) {
          await ctx.runMutation(internal.weather.insertAlert, {
            dayKey,
            type: "DATA_STALE",
            payload: {
              stalePollSeconds: freshness.pollStaleSeconds ?? null,
              staleThresholdSeconds: settings.stalePollSeconds,
              lastSuccessfulPollLocal:
                dashboard.dailyStats?.lastSuccessfulPollLocal ?? null,
            },
          });
        }

        throw new Error(
          `Weather fetch failed (primary and backup). Primary: ${primaryReason}; Backup: ${toErrorMessage(backupError)}`,
        );
      }
    }

    const obsKey = buildObsKey(
      settings.station,
      observation.obsZuluStamp,
      observation.rawMetar,
    );

    const obsTimeUtc = obsZuluStampToUtcIso(observation.obsZuluStamp, now);
    const obsTimeLocal = formatUtcToChicago(obsTimeUtc, true);

    const derivedTemp = deriveWuLikeTempWholeF(observation.rawMetar, {
      tempExtraction: settings.tempExtraction,
      rounding: settings.rounding,
    });

    const previousHigh = dashboard.dailyStats?.highSoFarWholeF;
    const highSoFarWholeF =
      previousHigh === null || previousHigh === undefined
        ? derivedTemp.tempWholeF
        : Math.max(previousHigh, derivedTemp.tempWholeF);

    const isNewHigh =
      previousHigh === null ||
      previousHigh === undefined ||
      derivedTemp.tempWholeF > previousHigh;

    const insertResult = await ctx.runMutation(internal.weather.insertObservationIfNew, {
      dayKey,
      obsKey,
      payload: {
        source: observation.source,
        rawMetar: observation.rawMetar,
        obsTimeUtc,
        obsTimeLocal,
        wuLikeTempWholeF: derivedTemp.tempWholeF,
        isNewHigh,
      },
    });

    if (failoverPayload) {
      await ctx.runMutation(internal.weather.insertAlert, {
        dayKey,
        type: "SOURCE_FAILOVER",
        payload: failoverPayload,
      });
    }

    if (!insertResult.inserted) {
      await ctx.runMutation(internal.weather.upsertDailyStats, {
        dayKey,
        payload: {
          lastSuccessfulPollLocal: polledAtLocal,
          lastSuccessfulPollAtMs: now,
          pollStaleSeconds: 0,
          isStale: false,
          activeMarketSet: Boolean(dashboard.activeMarket),
        },
      });

      if (wasStale) {
        await ctx.runMutation(internal.weather.insertAlert, {
          dayKey,
          type: "DATA_HEALTHY",
          payload: {
            recoveredAtLocal: polledAtLocal,
            staleThresholdSeconds: settings.stalePollSeconds,
            stalePollSecondsBeforeRecovery:
              dashboard.dailyStats?.pollStaleSeconds ?? null,
          },
        });
      }

      return {
        ok: true,
        dayKey,
        duplicate: true,
        obsKey,
        source: observation.source,
      };
    }

    await ctx.runMutation(internal.weather.upsertDailyStats, {
      dayKey,
      payload: {
        currentTempWholeF: derivedTemp.tempWholeF,
        highSoFarWholeF,
        timeOfHighLocal: isNewHigh ? obsTimeLocal : undefined,
        lastObservationTimeLocal: obsTimeLocal,
        lastSuccessfulPollLocal: polledAtLocal,
        lastSuccessfulPollAtMs: now,
        pollStaleSeconds: 0,
        isStale: false,
        activeMarketSet: Boolean(dashboard.activeMarket),
      },
    });

    if (wasStale) {
      await ctx.runMutation(internal.weather.insertAlert, {
        dayKey,
        type: "DATA_HEALTHY",
        payload: {
          recoveredAtLocal: polledAtLocal,
          staleThresholdSeconds: settings.stalePollSeconds,
          stalePollSecondsBeforeRecovery:
            dashboard.dailyStats?.pollStaleSeconds ?? null,
        },
      });
    }

    if (isNewHigh) {
      await ctx.runMutation(internal.weather.insertAlert, {
        dayKey,
        type: "NEW_HIGH",
        payload: {
          previousHigh: previousHigh ?? null,
          newHigh: highSoFarWholeF,
          rawMetar: observation.rawMetar,
          source: observation.source,
          obsZuluStamp: observation.obsZuluStamp,
        },
      });
    }

    const binUpdates = buildBinUpdates(
      dashboard.bins ?? [],
      highSoFarWholeF,
      obsTimeLocal,
    );

    if (binUpdates.statuses.length > 0) {
      await ctx.runMutation(internal.weather.upsertBinStatuses, {
        dayKey,
        statuses: binUpdates.statuses,
      });
    }

    for (const bin of binUpdates.eliminated) {
      await ctx.runMutation(internal.weather.insertAlert, {
        dayKey,
        type: "BIN_ELIMINATED",
        payload: {
          marketId: bin.marketId,
          label: bin.label,
          upperBoundF: bin.upperBoundF,
          highSoFarWholeF,
        },
      });
    }

    return {
      ok: true,
      dayKey,
      duplicate: false,
      obsKey,
      source: observation.source,
      currentTempWholeF: derivedTemp.tempWholeF,
      highSoFarWholeF,
      isNewHigh,
      eliminatedBins: binUpdates.eliminated.length,
    };
  },
});

export const touchPollHealth = mutation({
  args: {
    dayKey: v.string(),
    lastSuccessfulPollLocal: v.string(),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("dailyStats")
      .withIndex("by_dayKey", (q) => q.eq("dayKey", args.dayKey))
      .unique();

    const value = {
      dayKey: args.dayKey,
      lastSuccessfulPollLocal: args.lastSuccessfulPollLocal,
      updatedAt: Date.now(),
    };

    if (!existing) {
      await ctx.db.insert("dailyStats", value);
      return value;
    }

    await ctx.db.patch(existing._id, value);
    return value;
  },
});

export const insertObservationIfNew = mutation({
  args: {
    dayKey: v.string(),
    obsKey: v.string(),
    payload: v.object({
      source: v.string(),
      rawMetar: v.string(),
      obsTimeUtc: v.string(),
      obsTimeLocal: v.optional(v.string()),
      wuLikeTempWholeF: v.optional(v.number()),
      isNewHigh: v.optional(v.boolean()),
    }),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("observations")
      .withIndex("by_dayKey_obsKey", (q) =>
        q.eq("dayKey", args.dayKey).eq("obsKey", args.obsKey),
      )
      .unique();

    if (existing) {
      return { inserted: false, observationId: existing._id };
    }

    const observationId = await ctx.db.insert("observations", {
      dayKey: args.dayKey,
      obsKey: args.obsKey,
      ...args.payload,
      createdAt: Date.now(),
    });

    return { inserted: true, observationId };
  },
});

export const upsertDailyStats = mutation({
  args: {
    dayKey: v.string(),
    payload: v.object({
      currentTempWholeF: v.optional(v.number()),
      highSoFarWholeF: v.optional(v.number()),
      timeOfHighLocal: v.optional(v.string()),
      lastObservationTimeLocal: v.optional(v.string()),
      lastSuccessfulPollLocal: v.optional(v.string()),
      lastSuccessfulPollAtMs: v.optional(v.number()),
      pollStaleSeconds: v.optional(v.number()),
      isStale: v.optional(v.boolean()),
      activeMarketSet: v.optional(v.boolean()),
    }),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("dailyStats")
      .withIndex("by_dayKey", (q) => q.eq("dayKey", args.dayKey))
      .unique();

    const nextHigh = existing
      ? Math.max(
          existing.highSoFarWholeF ?? Number.NEGATIVE_INFINITY,
          args.payload.highSoFarWholeF ?? Number.NEGATIVE_INFINITY,
        )
      : args.payload.highSoFarWholeF;

    const value = {
      dayKey: args.dayKey,
      currentTempWholeF: args.payload.currentTempWholeF ?? existing?.currentTempWholeF,
      highSoFarWholeF:
        nextHigh === Number.NEGATIVE_INFINITY ? undefined : nextHigh,
      timeOfHighLocal: args.payload.timeOfHighLocal ?? existing?.timeOfHighLocal,
      lastObservationTimeLocal:
        args.payload.lastObservationTimeLocal ?? existing?.lastObservationTimeLocal,
      lastSuccessfulPollLocal:
        args.payload.lastSuccessfulPollLocal ?? existing?.lastSuccessfulPollLocal,
      lastSuccessfulPollAtMs:
        args.payload.lastSuccessfulPollAtMs ?? existing?.lastSuccessfulPollAtMs,
      pollStaleSeconds: args.payload.pollStaleSeconds ?? existing?.pollStaleSeconds,
      isStale: args.payload.isStale ?? existing?.isStale,
      activeMarketSet: args.payload.activeMarketSet ?? existing?.activeMarketSet,
      updatedAt: Date.now(),
    };

    if (!existing) {
      await ctx.db.insert("dailyStats", value);
      return value;
    }

    await ctx.db.patch(existing._id, value);
    return value;
  },
});

export const insertAlert = mutation({
  args: {
    dayKey: v.string(),
    type: v.string(),
    payload: v.optional(v.any()),
  },
  handler: async (ctx, args) => {
    return await ctx.db.insert("alerts", {
      dayKey: args.dayKey,
      type: args.type,
      payload: args.payload,
      createdAt: Date.now(),
    });
  },
});

export const upsertBinStatuses = mutation({
  args: {
    dayKey: v.string(),
    statuses: v.array(
      v.object({
        marketId: v.string(),
        status: v.string(),
        deadSinceLocalTime: v.optional(v.string()),
      }),
    ),
  },
  handler: async (ctx, args) => {
    const bins = await ctx.db
      .query("polymarketBins")
      .withIndex("by_dayKey", (q) => q.eq("dayKey", args.dayKey))
      .collect();

    const byMarketId = new Map(bins.map((bin) => [bin.marketId, bin]));

    let updated = 0;
    for (const item of args.statuses) {
      const bin = byMarketId.get(item.marketId);
      if (!bin) {
        continue;
      }

      await ctx.db.patch(bin._id, {
        status: item.status,
        deadSinceLocalTime: item.deadSinceLocalTime,
      });
      updated += 1;
    }

    return { updated };
  },
});

export const getLatestObservations = query({
  args: {
    dayKey: v.optional(v.string()),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const dayKey = args.dayKey ?? getChicagoDayKey();
    const limit = args.limit ?? 20;

    return await ctx.db
      .query("observations")
      .withIndex("by_dayKey", (q) => q.eq("dayKey", dayKey))
      .order("desc")
      .take(limit);
  },
});

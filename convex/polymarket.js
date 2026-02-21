import {
  action,
  internalAction,
  internalMutation,
  mutation,
  query,
} from "./_generated/server";
import { api, internal as internalApi } from "./_generated/api";
import { v } from "convex/values";
import { formatUtcToChicago, getChicagoDayKey } from "./lib/time";

const GAMMA_BASE_URL = "https://gamma-api.polymarket.com";
const MAX_PRICE_SNAPSHOT_WRITES = 300;

function extractSlug(input) {
  const trimmed = input.trim();

  if (!trimmed) {
    throw new Error("Input is required.");
  }

  if (/^https?:\/\//i.test(trimmed)) {
    const url = new URL(trimmed);
    const segments = url.pathname.split("/").filter(Boolean);
    const slug = segments[segments.length - 1];
    if (!slug) {
      throw new Error("Could not parse a slug from the URL.");
    }
    return slug;
  }

  return trimmed;
}

function parseArrayField(value) {
  if (Array.isArray(value)) {
    return value;
  }

  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) {
      return [];
    }

    try {
      const parsed = JSON.parse(trimmed);
      return Array.isArray(parsed) ? parsed : [trimmed];
    } catch {
      return [trimmed];
    }
  }

  return [];
}

function parseTokenIds(clobTokenIds, outcomes) {
  const tokenIds = parseArrayField(clobTokenIds).map((value) => String(value));
  const normalizedOutcomes = parseArrayField(outcomes).map((value) =>
    String(value).trim().toLowerCase(),
  );

  if (tokenIds.length === 0) {
    return { yesTokenId: null, noTokenId: null };
  }

  const yesIndex = normalizedOutcomes.findIndex((value) => value === "yes");
  const noIndex = normalizedOutcomes.findIndex((value) => value === "no");

  return {
    yesTokenId:
      yesIndex >= 0 && tokenIds[yesIndex]
        ? tokenIds[yesIndex]
        : tokenIds[0] ?? null,
    noTokenId:
      noIndex >= 0 && tokenIds[noIndex]
        ? tokenIds[noIndex]
        : tokenIds[1] ?? null,
  };
}

function toFinitePriceOrNull(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return null;
  }

  if (parsed < 0) {
    return 0;
  }

  if (parsed > 1) {
    return 1;
  }

  return parsed;
}

function parseYesNoPrices(market) {
  const outcomes = parseArrayField(market?.outcomes).map((value) =>
    String(value).trim().toLowerCase(),
  );
  const prices = parseArrayField(market?.outcomePrices).map(toFinitePriceOrNull);

  if (prices.length === 0) {
    return { yesPrice: null, noPrice: null };
  }

  const yesIndex = outcomes.findIndex((value) => value === "yes");
  const noIndex = outcomes.findIndex((value) => value === "no");

  return {
    yesPrice:
      yesIndex >= 0 && prices[yesIndex] !== undefined
        ? prices[yesIndex]
        : (prices[0] ?? null),
    noPrice:
      noIndex >= 0 && prices[noIndex] !== undefined
        ? prices[noIndex]
        : (prices[1] ?? null),
  };
}

async function fetchGammaEventBySlug(slug) {
  const response = await fetch(`${GAMMA_BASE_URL}/events/slug/${slug}`, {
    method: "GET",
  });

  if (!response.ok) {
    throw new Error(`Gamma returned ${response.status} for slug '${slug}'.`);
  }

  return await response.json();
}

function parseBoundsFromQuestion(question) {
  const range = question.match(/(-?\d+)\s*(?:to|-|–)\s*(-?\d+)\s*(?:°?f)?/i);
  if (range) {
    const lower = Number(range[1]);
    const upper = Number(range[2]);
    return {
      lowerBoundF: Math.min(lower, upper),
      upperBoundF: Math.max(lower, upper),
      isLowerOpenEnded: false,
      isUpperOpenEnded: false,
    };
  }

  const between = question.match(
    /between\s+(-?\d+)\s*(?:°?f)?\s+and\s+(-?\d+)\s*(?:°?f)?/i,
  );
  if (between) {
    const lower = Number(between[1]);
    const upper = Number(between[2]);
    return {
      lowerBoundF: Math.min(lower, upper),
      upperBoundF: Math.max(lower, upper),
      isLowerOpenEnded: false,
      isUpperOpenEnded: false,
    };
  }

  const high = question.match(/(-?\d+)\s*(?:°?f)?\s*(?:or higher|and above|\+)/i);
  if (high) {
    return {
      lowerBoundF: Number(high[1]),
      upperBoundF: null,
      isLowerOpenEnded: true,
      isUpperOpenEnded: true,
    };
  }

  const low = question.match(/(-?\d+)\s*(?:°?f)?\s*(?:or lower|or less|and below)/i);
  if (low) {
    return {
      lowerBoundF: null,
      upperBoundF: Number(low[1]),
      isLowerOpenEnded: true,
      isUpperOpenEnded: true,
    };
  }

  return {
    lowerBoundF: null,
    upperBoundF: null,
    isLowerOpenEnded: false,
    isUpperOpenEnded: false,
  };
}

function normalizeBin(market, orderIndex) {
  const outcomes = parseArrayField(market.outcomes).map((value) => String(value));
  const outcomePrices = parseArrayField(market.outcomePrices);
  const { yesTokenId, noTokenId } = parseTokenIds(market.clobTokenIds, outcomes);

  const lowerBound =
    market.lowerBound === null || market.lowerBound === undefined
      ? null
      : Number(market.lowerBound);
  const upperBound =
    market.upperBound === null || market.upperBound === undefined
      ? null
      : Number(market.upperBound);

  const parsed =
    lowerBound === null && upperBound === null
      ? parseBoundsFromQuestion(market.question ?? "")
      : {
          lowerBoundF: lowerBound,
          upperBoundF: upperBound,
          isLowerOpenEnded: lowerBound === null,
          isUpperOpenEnded: upperBound === null,
        };

  return {
    marketId: String(market.id ?? market.marketId ?? `market-${orderIndex}`),
    label: market.question ?? `Bin ${orderIndex + 1}`,
    lowerBoundF: parsed.lowerBoundF,
    upperBoundF: parsed.upperBoundF,
    isLowerOpenEnded: parsed.isLowerOpenEnded,
    isUpperOpenEnded: parsed.isUpperOpenEnded,
    yesTokenId,
    noTokenId,
    orderIndex,
    outcomes,
    outcomePrices,
    boundsParsedFromQuestion:
      lowerBound === null && upperBound === null &&
      (parsed.lowerBoundF !== null || parsed.upperBoundF !== null),
    boundsParsingFailed:
      parsed.lowerBoundF === null && parsed.upperBoundF === null,
  };
}

export const importEventBySlugOrUrl = action({
  args: {
    input: v.string(),
  },
  handler: async (_ctx, args) => {
    const slug = extractSlug(args.input);
    const payload = await fetchGammaEventBySlug(slug);

    const event = {
      eventId: String(payload.id ?? payload.eventId),
      slug: payload.slug ?? slug,
      title: payload.title ?? payload.name ?? slug,
      endDate: payload.endDate ?? payload.end_date ?? null,
      resolutionSource: payload.resolutionSource ?? null,
      metadata: {
        rawMarketCount: Array.isArray(payload.markets) ? payload.markets.length : 0,
      },
    };

    const bins = Array.isArray(payload.markets)
      ? payload.markets.map((market, index) => normalizeBin(market, index))
      : [];

    return {
      event,
      bins,
      slug,
    };
  },
});

export const upsertEvent = mutation({
  args: {
    event: v.object({
      eventId: v.string(),
      slug: v.string(),
      title: v.string(),
      endDate: v.optional(v.union(v.string(), v.null())),
      resolutionSource: v.optional(v.union(v.string(), v.null())),
      metadata: v.optional(v.any()),
    }),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("polymarketEvents")
      .withIndex("by_eventId", (q) => q.eq("eventId", args.event.eventId))
      .unique();

    const value = {
      eventId: args.event.eventId,
      slug: args.event.slug,
      title: args.event.title,
      endDate: args.event.endDate ?? undefined,
      resolutionSource: args.event.resolutionSource ?? undefined,
      metadata: args.event.metadata,
      updatedAt: Date.now(),
    };

    if (!existing) {
      const id = await ctx.db.insert("polymarketEvents", value);
      return { inserted: true, id };
    }

    await ctx.db.patch(existing._id, value);
    return { inserted: false, id: existing._id };
  },
});

export const replaceBinsForDay = mutation({
  args: {
    dayKey: v.string(),
    eventId: v.string(),
    bins: v.array(
      v.object({
        marketId: v.string(),
        label: v.string(),
        lowerBoundF: v.optional(v.union(v.number(), v.null())),
        upperBoundF: v.optional(v.union(v.number(), v.null())),
        isLowerOpenEnded: v.optional(v.boolean()),
        isUpperOpenEnded: v.optional(v.boolean()),
        yesTokenId: v.optional(v.union(v.string(), v.null())),
        noTokenId: v.optional(v.union(v.string(), v.null())),
        orderIndex: v.number(),
      }),
    ),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("polymarketBins")
      .withIndex("by_dayKey", (q) => q.eq("dayKey", args.dayKey))
      .collect();

    for (const bin of existing) {
      await ctx.db.delete(bin._id);
    }

    for (const bin of args.bins) {
      await ctx.db.insert("polymarketBins", {
        dayKey: args.dayKey,
        eventId: args.eventId,
        marketId: bin.marketId,
        label: bin.label,
        lowerBoundF: bin.lowerBoundF ?? undefined,
        upperBoundF: bin.upperBoundF ?? undefined,
        isLowerOpenEnded: bin.isLowerOpenEnded,
        isUpperOpenEnded: bin.isUpperOpenEnded,
        yesTokenId: bin.yesTokenId ?? undefined,
        noTokenId: bin.noTokenId ?? undefined,
        orderIndex: bin.orderIndex,
      });
    }

    return { replaced: args.bins.length };
  },
});

export const setActiveMarketForDay = mutation({
  args: {
    dayKey: v.string(),
    eventId: v.string(),
    slug: v.string(),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("marketDays")
      .withIndex("by_dayKey", (q) => q.eq("dayKey", args.dayKey))
      .unique();

    const value = {
      dayKey: args.dayKey,
      activeEventId: args.eventId,
      activeEventSlug: args.slug,
      importedAt: Date.now(),
      status: "ACTIVE",
    };

    if (!existing) {
      const id = await ctx.db.insert("marketDays", value);
      return { inserted: true, id };
    }

    await ctx.db.patch(existing._id, value);
    return { inserted: false, id: existing._id };
  },
});

export const getActiveMarket = query({
  args: {
    dayKey: v.string(),
  },
  handler: async (ctx, args) => {
    const day = await ctx.db
      .query("marketDays")
      .withIndex("by_dayKey", (q) => q.eq("dayKey", args.dayKey))
      .unique();

    if (!day?.activeEventId) {
      return null;
    }

    const event = await ctx.db
      .query("polymarketEvents")
      .withIndex("by_eventId", (q) => q.eq("eventId", day.activeEventId))
      .unique();

    return {
      day,
      event,
    };
  },
});

export const getBins = query({
  args: {
    dayKey: v.string(),
  },
  handler: async (ctx, args) => {
    const bins = await ctx.db
      .query("polymarketBins")
      .withIndex("by_dayKey_orderIndex", (q) => q.eq("dayKey", args.dayKey))
      .collect();

    return bins.sort((a, b) => a.orderIndex - b.orderIndex);
  },
});

export const insertBinPriceSnapshots = internalMutation({
  args: {
    dayKey: v.string(),
    eventId: v.string(),
    source: v.string(),
    fetchedAt: v.number(),
    fetchedAtLocal: v.optional(v.string()),
    snapshots: v.array(
      v.object({
        marketId: v.string(),
        yesPrice: v.optional(v.union(v.number(), v.null())),
        noPrice: v.optional(v.union(v.number(), v.null())),
      }),
    ),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    const uniqueByMarketId = new Map();
    for (const snapshot of args.snapshots) {
      uniqueByMarketId.set(snapshot.marketId, snapshot);
      if (uniqueByMarketId.size >= MAX_PRICE_SNAPSHOT_WRITES) {
        break;
      }
    }

    let inserted = 0;
    for (const snapshot of uniqueByMarketId.values()) {
      await ctx.db.insert("binPriceSnapshots", {
        dayKey: args.dayKey,
        eventId: args.eventId,
        marketId: snapshot.marketId,
        source: args.source,
        yesPrice: snapshot.yesPrice ?? undefined,
        noPrice: snapshot.noPrice ?? undefined,
        fetchedAt: args.fetchedAt,
        fetchedAtLocal: args.fetchedAtLocal ?? undefined,
        createdAt: now,
      });
      inserted += 1;
    }

    return {
      inserted,
      fetchedAt: args.fetchedAt,
      fetchedAtLocal: args.fetchedAtLocal ?? null,
    };
  },
});

export const refreshBinPriceSnapshots = internalAction({
  args: {
    dayKey: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    const dayKey = args.dayKey ?? getChicagoDayKey(now);
    const activeMarket = await ctx.runQuery(api.polymarket.getActiveMarket, {
      dayKey,
    });
    const bins = await ctx.runQuery(api.polymarket.getBins, { dayKey });

    if (!activeMarket?.day?.activeEventId || !activeMarket?.day?.activeEventSlug) {
      return {
        ok: true,
        dayKey,
        skipped: "NO_ACTIVE_MARKET",
      };
    }

    if (!Array.isArray(bins) || bins.length === 0) {
      return {
        ok: true,
        dayKey,
        skipped: "NO_BINS",
      };
    }

    let payload;
    try {
      payload = await fetchGammaEventBySlug(activeMarket.day.activeEventSlug);
    } catch (error) {
      await ctx.runMutation(api.weather.insertAlert, {
        dayKey,
        type: "POLYMARKET_PRICE_REFRESH_FAILED",
        payload: {
          message: error?.message ?? "Unknown error",
          slugTried: activeMarket.day.activeEventSlug,
        },
      });
      throw error;
    }

    const markets = Array.isArray(payload?.markets) ? payload.markets : [];
    const marketById = new Map(
      markets.map((market) => [String(market.id ?? market.marketId ?? ""), market]),
    );

    const snapshots = bins.map((bin) => {
      const market = marketById.get(String(bin.marketId));
      const prices = market ? parseYesNoPrices(market) : { yesPrice: null, noPrice: null };
      return {
        marketId: String(bin.marketId),
        yesPrice: prices.yesPrice,
        noPrice: prices.noPrice,
      };
    });

    const insertResult = await ctx.runMutation(
      internalApi.polymarket.insertBinPriceSnapshots,
      {
        dayKey,
        eventId: String(activeMarket.day.activeEventId),
        source: "GAMMA_EVENT",
        fetchedAt: now,
        fetchedAtLocal: formatUtcToChicago(now, true),
        snapshots,
      },
    );

    return {
      ok: true,
      dayKey,
      eventId: activeMarket.day.activeEventId,
      slug: activeMarket.day.activeEventSlug,
      binsTracked: bins.length,
      snapshotsInserted: insertResult.inserted,
      fetchedAt: insertResult.fetchedAt,
      fetchedAtLocal: insertResult.fetchedAtLocal,
    };
  },
});

export const refreshBinPriceSnapshotsNow = action({
  args: {
    dayKey: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    return await ctx.runAction(internalApi.polymarket.refreshBinPriceSnapshots, {
      dayKey: args.dayKey,
    });
  },
});

export const getLatestBinPriceSnapshots = query({
  args: {
    dayKey: v.optional(v.string()),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    const dayKey = args.dayKey ?? getChicagoDayKey(now);
    const limit = Math.min(Math.max(Math.round(Number(args.limit ?? 800)), 50), 2400);

    const bins = await ctx.db
      .query("polymarketBins")
      .withIndex("by_dayKey_orderIndex", (q) => q.eq("dayKey", dayKey))
      .collect();

    const snapshots = await ctx.db
      .query("binPriceSnapshots")
      .withIndex("by_dayKey_fetchedAt", (q) => q.eq("dayKey", dayKey))
      .order("desc")
      .take(limit);

    const latestByMarketId = new Map();
    for (const snapshot of snapshots) {
      if (!latestByMarketId.has(snapshot.marketId)) {
        latestByMarketId.set(snapshot.marketId, snapshot);
      }
      if (latestByMarketId.size >= bins.length) {
        break;
      }
    }

    const latestFetchedAt = snapshots[0]?.fetchedAt ?? null;
    const latestFetchedAtLocal = snapshots[0]?.fetchedAtLocal ??
      (Number.isFinite(Number(latestFetchedAt))
        ? formatUtcToChicago(Number(latestFetchedAt), true)
        : null);

    const prices = bins.map((bin) => {
      const snapshot = latestByMarketId.get(bin.marketId);
      return {
        marketId: bin.marketId,
        yesPrice: snapshot?.yesPrice ?? null,
        noPrice: snapshot?.noPrice ?? null,
        fetchedAt: snapshot?.fetchedAt ?? null,
        fetchedAtLocal: snapshot?.fetchedAtLocal ??
          (Number.isFinite(Number(snapshot?.fetchedAt))
            ? formatUtcToChicago(Number(snapshot.fetchedAt), true)
            : null),
      };
    });

    return {
      dayKey,
      latestFetchedAt,
      latestFetchedAtLocal,
      ageSeconds: Number.isFinite(Number(latestFetchedAt))
        ? Math.max(0, Math.floor((now - Number(latestFetchedAt)) / 1000))
        : null,
      prices,
    };
  },
});

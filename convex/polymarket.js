import { action, mutation, query } from "./_generated/server";
import { v } from "convex/values";

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
    const response = await fetch(
      `https://gamma-api.polymarket.com/events/slug/${slug}`,
      {
        method: "GET",
      },
    );

    if (!response.ok) {
      throw new Error(`Gamma returned ${response.status} for slug '${slug}'.`);
    }

    const payload = await response.json();

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

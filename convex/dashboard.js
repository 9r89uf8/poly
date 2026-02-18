import { query } from "./_generated/server";
import { v } from "convex/values";
import { DEFAULT_SETTINGS } from "./lib/constants";
import { formatUtcToChicago, getChicagoDayKey } from "./lib/time";

export const getDashboard = query({
  args: {
    dayKey: v.optional(v.string()),
    observationsLimit: v.optional(v.number()),
    alertsLimit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const dayKey = args.dayKey ?? getChicagoDayKey();
    const observationsLimit = args.observationsLimit ?? 20;
    const alertsLimit = args.alertsLimit ?? 20;

    const settings = await ctx.db
      .query("settings")
      .withIndex("by_key", (q) => q.eq("key", DEFAULT_SETTINGS.key))
      .unique();

    const marketDay = await ctx.db
      .query("marketDays")
      .withIndex("by_dayKey", (q) => q.eq("dayKey", dayKey))
      .unique();

    const activeEvent = marketDay?.activeEventId
      ? await ctx.db
          .query("polymarketEvents")
          .withIndex("by_eventId", (q) => q.eq("eventId", marketDay.activeEventId))
          .unique()
      : null;

    const bins = await ctx.db
      .query("polymarketBins")
      .withIndex("by_dayKey_orderIndex", (q) => q.eq("dayKey", dayKey))
      .collect();

    const dailyStats = await ctx.db
      .query("dailyStats")
      .withIndex("by_dayKey", (q) => q.eq("dayKey", dayKey))
      .unique();

    const observations = await ctx.db
      .query("observations")
      .withIndex("by_dayKey", (q) => q.eq("dayKey", dayKey))
      .order("desc")
      .take(observationsLimit);

    const alerts = await ctx.db
      .query("alerts")
      .withIndex("by_dayKey_createdAt", (q) => q.eq("dayKey", dayKey))
      .order("desc")
      .take(alertsLimit);

    return {
      dayKey,
      settings: settings ?? DEFAULT_SETTINGS,
      activeMarket: activeEvent
        ? {
            event: activeEvent,
            marketDay,
          }
        : null,
      bins,
      dailyStats,
      observations,
      alerts,
    };
  },
});

export const getHealth = query({
  args: {
    dayKey: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const dayKey = args.dayKey ?? getChicagoDayKey();

    const stats = await ctx.db
      .query("dailyStats")
      .withIndex("by_dayKey", (q) => q.eq("dayKey", dayKey))
      .unique();

    const marketDay = await ctx.db
      .query("marketDays")
      .withIndex("by_dayKey", (q) => q.eq("dayKey", dayKey))
      .unique();

    const recentErrors = await ctx.db
      .query("alerts")
      .withIndex("by_dayKey_createdAt", (q) => q.eq("dayKey", dayKey))
      .order("desc")
      .take(20);

    return {
      dayKey,
      lastCronRunLocal: stats?.updatedAt
        ? formatUtcToChicago(stats.updatedAt, true)
        : null,
      lastPollSuccess: stats?.lastSuccessfulPollLocal ?? null,
      pollStaleSeconds: stats?.pollStaleSeconds ?? null,
      marketSetForToday: Boolean(marketDay?.activeEventId),
      stale: Boolean(stats?.isStale),
      recentErrorsCount: recentErrors.filter((x) =>
        ["DATA_STALE", "SOURCE_FAILOVER"].includes(x.type),
      ).length,
    };
  },
});

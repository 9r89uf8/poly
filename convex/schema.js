import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

const extractionValidator = v.union(
  v.literal("TGROUP_PREFERRED"),
  v.literal("METAR_INTEGER_C"),
);

const roundingValidator = v.union(
  v.literal("NEAREST"),
  v.literal("FLOOR"),
  v.literal("CEIL"),
  v.literal("MAX_OF_ROUNDED"),
);

export default defineSchema({
  settings: defineTable({
    key: v.string(),
    station: v.string(),
    timezone: v.string(),
    pollIntervalSeconds: v.number(),
    stalePollSeconds: v.number(),
    weatherPrimaryUrl: v.string(),
    weatherBackupUrl: v.string(),
    tempExtraction: extractionValidator,
    rounding: roundingValidator,
    dayResetRule: v.string(),
    updatedAt: v.number(),
  }).index("by_key", ["key"]),

  marketDays: defineTable({
    dayKey: v.string(),
    activeEventId: v.optional(v.string()),
    activeEventSlug: v.optional(v.string()),
    importedAt: v.optional(v.number()),
    status: v.optional(v.string()),
  }).index("by_dayKey", ["dayKey"]),

  polymarketEvents: defineTable({
    eventId: v.string(),
    slug: v.string(),
    title: v.string(),
    endDate: v.optional(v.string()),
    resolutionSource: v.optional(v.string()),
    metadata: v.optional(v.any()),
    updatedAt: v.number(),
  })
    .index("by_eventId", ["eventId"])
    .index("by_slug", ["slug"]),

  polymarketBins: defineTable({
    dayKey: v.string(),
    eventId: v.string(),
    marketId: v.string(),
    label: v.string(),
    lowerBoundF: v.optional(v.number()),
    upperBoundF: v.optional(v.number()),
    isLowerOpenEnded: v.optional(v.boolean()),
    isUpperOpenEnded: v.optional(v.boolean()),
    yesTokenId: v.optional(v.string()),
    noTokenId: v.optional(v.string()),
    orderIndex: v.number(),
    status: v.optional(v.string()),
    deadSinceLocalTime: v.optional(v.string()),
  })
    .index("by_dayKey", ["dayKey"])
    .index("by_dayKey_orderIndex", ["dayKey", "orderIndex"]),

  observations: defineTable({
    dayKey: v.string(),
    obsKey: v.string(),
    obsTimeUtc: v.string(),
    obsTimeLocal: v.optional(v.string()),
    source: v.string(),
    rawMetar: v.string(),
    wuLikeTempWholeF: v.optional(v.number()),
    isNewHigh: v.optional(v.boolean()),
    createdAt: v.number(),
  })
    .index("by_dayKey", ["dayKey"])
    .index("by_dayKey_obsKey", ["dayKey", "obsKey"]),

  dailyStats: defineTable({
    dayKey: v.string(),
    currentTempWholeF: v.optional(v.number()),
    highSoFarWholeF: v.optional(v.number()),
    timeOfHighLocal: v.optional(v.string()),
    lastObservationTimeLocal: v.optional(v.string()),
    lastSuccessfulPollLocal: v.optional(v.string()),
    lastSuccessfulPollAtMs: v.optional(v.number()),
    pollStaleSeconds: v.optional(v.number()),
    isStale: v.optional(v.boolean()),
    activeMarketSet: v.optional(v.boolean()),
    updatedAt: v.number(),
  }).index("by_dayKey", ["dayKey"]),

  alerts: defineTable({
    dayKey: v.string(),
    type: v.string(),
    payload: v.optional(v.any()),
    createdAt: v.number(),
    createdAtLocal: v.optional(v.string()),
  })
    .index("by_dayKey", ["dayKey"])
    .index("by_dayKey_createdAt", ["dayKey", "createdAt"]),

  calibrationRuns: defineTable({
    dateRangeStart: v.string(),
    dateRangeEnd: v.string(),
    methodsTested: v.array(v.string()),
    matchRate: v.optional(v.number()),
    chosenMethod: v.optional(v.string()),
    mismatches: v.optional(v.array(v.any())),
    notes: v.optional(v.string()),
    createdAt: v.number(),
  }).index("by_createdAt", ["createdAt"]),
});

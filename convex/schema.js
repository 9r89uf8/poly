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

  binPriceSnapshots: defineTable({
    dayKey: v.string(),
    eventId: v.string(),
    marketId: v.string(),
    source: v.string(),
    yesPrice: v.optional(v.number()),
    noPrice: v.optional(v.number()),
    fetchedAt: v.number(),
    fetchedAtLocal: v.optional(v.string()),
    createdAt: v.number(),
  })
    .index("by_dayKey", ["dayKey"])
    .index("by_dayKey_fetchedAt", ["dayKey", "fetchedAt"])
    .index("by_dayKey_marketId_fetchedAt", ["dayKey", "marketId", "fetchedAt"]),

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

  forecastSnapshots: defineTable({
    dayKey: v.string(),
    source: v.string(),
    fetchedAt: v.number(),
    fetchedAtLocal: v.optional(v.string()),
    forecastGeneratedAt: v.optional(v.number()),
    predictedMaxTempF: v.optional(v.number()),
    predictedMaxTimeLocal: v.optional(v.string()),
    predictedMaxAtMs: v.optional(v.number()),
    hourly: v.array(v.any()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_dayKey", ["dayKey"])
    .index("by_dayKey_fetchedAt", ["dayKey", "fetchedAt"]),

  phoneCalls: defineTable({
    dayKey: v.string(),
    status: v.string(),
    requestedBy: v.optional(v.string()),
    requestedAt: v.number(),
    requestedAtLocal: v.string(),
    sourceNumber: v.optional(v.string()),
    targetNumber: v.string(),
    callSid: v.optional(v.string()),
    callStartedAt: v.optional(v.number()),
    callCompletedAt: v.optional(v.number()),
    recordingSid: v.optional(v.string()),
    recordingUrl: v.optional(v.string()),
    recordingDurationSec: v.optional(v.number()),
    playbackToken: v.optional(v.string()),
    transcript: v.optional(v.string()),
    tempC: v.optional(v.number()),
    tempF: v.optional(v.number()),
    parsedOk: v.optional(v.boolean()),
    error: v.optional(v.string()),
    warning: v.optional(v.string()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_dayKey", ["dayKey"])
    .index("by_requestedAt", ["requestedAt"])
    .index("by_callSid", ["callSid"])
    .index("by_recordingSid", ["recordingSid"]),

  autoCallDecisions: defineTable({
    dayKey: v.string(),
    decisionKey: v.string(),
    evaluatedAt: v.number(),
    evaluatedAtLocal: v.optional(v.string()),
    decision: v.string(),
    reasonCode: v.string(),
    reasonDetail: v.optional(v.any()),
    window: v.optional(v.string()),
    predictedMaxTimeLocal: v.optional(v.string()),
    predictedMaxAtMs: v.optional(v.number()),
    callSid: v.optional(v.string()),
    shadowMode: v.optional(v.boolean()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_dayKey_createdAt", ["dayKey", "createdAt"])
    .index("by_decisionKey", ["decisionKey"]),

  autoCallState: defineTable({
    dayKey: v.string(),
    enabled: v.boolean(),
    shadowMode: v.boolean(),
    autoCallsMade: v.number(),
    lastAutoCallAt: v.optional(v.number()),
    lastDecisionAt: v.optional(v.number()),
    lastReasonCode: v.optional(v.string()),
    updatedAt: v.number(),
  }).index("by_dayKey", ["dayKey"]),

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

  tradeNotes: defineTable({
    dayKey: v.string(),
    note: v.string(),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_dayKey", ["dayKey"])
    .index("by_updatedAt", ["updatedAt"]),
});

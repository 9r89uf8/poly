import { mutation, query } from "./_generated/server";
import { v } from "convex/values";
import { DEFAULT_SETTINGS } from "./lib/constants";
import { normalizeSettings } from "./lib/settings";

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

const settingsPatchValidator = {
  station: v.optional(v.string()),
  timezone: v.optional(v.string()),
  pollIntervalSeconds: v.optional(v.number()),
  stalePollSeconds: v.optional(v.number()),
  weatherPrimaryUrl: v.optional(v.string()),
  weatherBackupUrl: v.optional(v.string()),
  tempExtraction: v.optional(extractionValidator),
  rounding: v.optional(roundingValidator),
};

function keepDefined(value) {
  return Object.fromEntries(
    Object.entries(value ?? {}).filter(([, fieldValue]) => fieldValue !== undefined),
  );
}

function mergeSettings(existing, patch = {}) {
  const existingFields = keepDefined({
    station: existing?.station,
    timezone: existing?.timezone,
    pollIntervalSeconds: existing?.pollIntervalSeconds,
    stalePollSeconds: existing?.stalePollSeconds,
    weatherPrimaryUrl: existing?.weatherPrimaryUrl,
    weatherBackupUrl: existing?.weatherBackupUrl,
    tempExtraction: existing?.tempExtraction,
    rounding: existing?.rounding,
    dayResetRule: existing?.dayResetRule,
  });

  return normalizeSettings({
    ...existingFields,
    ...keepDefined(patch),
  });
}

export const getSettings = query({
  args: {},
  handler: async (ctx) => {
    const stored = await ctx.db
      .query("settings")
      .withIndex("by_key", (q) => q.eq("key", DEFAULT_SETTINGS.key))
      .unique();

    return mergeSettings(stored);
  },
});

export const upsertSettings = mutation({
  args: settingsPatchValidator,
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("settings")
      .withIndex("by_key", (q) => q.eq("key", DEFAULT_SETTINGS.key))
      .unique();

    const nextValue = {
      ...mergeSettings(existing, args),
      key: DEFAULT_SETTINGS.key,
      updatedAt: Date.now(),
    };

    if (!existing) {
      await ctx.db.insert("settings", nextValue);
      return nextValue;
    }

    await ctx.db.patch(existing._id, nextValue);
    return nextValue;
  },
});

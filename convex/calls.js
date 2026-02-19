import { query, internalMutation } from "./_generated/server";
import { v } from "convex/values";
import { getChicagoDayKey } from "./lib/time";

const phoneCallPatchValidator = v.object({
  status: v.optional(v.string()),
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
  sourceNumber: v.optional(v.string()),
});

function pickDefinedFields(value) {
  return Object.fromEntries(
    Object.entries(value ?? {}).filter(([, fieldValue]) => fieldValue !== undefined),
  );
}

export const getLatestPhoneCall = query({
  args: {
    dayKey: v.optional(v.string()),
    allDays: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    if (args.allDays) {
      return await ctx.db
        .query("phoneCalls")
        .withIndex("by_requestedAt", (q) => q)
        .order("desc")
        .first();
    }

    const dayKey = args.dayKey ?? getChicagoDayKey();
    return await ctx.db
      .query("phoneCalls")
      .withIndex("by_dayKey", (q) => q.eq("dayKey", dayKey))
      .order("desc")
      .first();
  },
});

export const getRecentPhoneCalls = query({
  args: {
    dayKey: v.optional(v.string()),
    limit: v.optional(v.number()),
    allDays: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const limit = Math.min(Math.max(args.limit ?? 20, 1), 100);

    if (args.allDays) {
      return await ctx.db
        .query("phoneCalls")
        .withIndex("by_requestedAt", (q) => q)
        .order("desc")
        .take(limit);
    }

    const dayKey = args.dayKey ?? getChicagoDayKey();
    return await ctx.db
      .query("phoneCalls")
      .withIndex("by_dayKey", (q) => q.eq("dayKey", dayKey))
      .order("desc")
      .take(limit);
  },
});

export const createPhoneCall = internalMutation({
  args: {
    dayKey: v.string(),
    requestedBy: v.optional(v.string()),
    requestedAt: v.number(),
    requestedAtLocal: v.string(),
    sourceNumber: v.optional(v.string()),
    targetNumber: v.string(),
    warning: v.optional(v.string()),
    playbackToken: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    const phoneCallId = await ctx.db.insert("phoneCalls", {
      dayKey: args.dayKey,
      status: "REQUESTED",
      requestedBy: args.requestedBy,
      requestedAt: args.requestedAt,
      requestedAtLocal: args.requestedAtLocal,
      sourceNumber: args.sourceNumber,
      targetNumber: args.targetNumber,
      warning: args.warning,
      playbackToken: args.playbackToken,
      parsedOk: false,
      createdAt: now,
      updatedAt: now,
    });

    return { phoneCallId };
  },
});

export const patchPhoneCallById = internalMutation({
  args: {
    phoneCallId: v.id("phoneCalls"),
    patch: phoneCallPatchValidator,
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db.get(args.phoneCallId);
    if (!existing) {
      return { updated: false };
    }

    await ctx.db.patch(args.phoneCallId, {
      ...pickDefinedFields(args.patch),
      updatedAt: Date.now(),
    });

    return { updated: true };
  },
});

export const patchPhoneCallByCallSid = internalMutation({
  args: {
    callSid: v.string(),
    patch: phoneCallPatchValidator,
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("phoneCalls")
      .withIndex("by_callSid", (q) => q.eq("callSid", args.callSid))
      .first();

    if (!existing) {
      return { updated: false };
    }

    await ctx.db.patch(existing._id, {
      ...pickDefinedFields(args.patch),
      updatedAt: Date.now(),
    });

    return { updated: true, phoneCallId: existing._id, dayKey: existing.dayKey };
  },
});

export const patchPhoneCallByRecordingSid = internalMutation({
  args: {
    recordingSid: v.string(),
    patch: phoneCallPatchValidator,
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("phoneCalls")
      .withIndex("by_recordingSid", (q) => q.eq("recordingSid", args.recordingSid))
      .first();

    if (!existing) {
      return { updated: false };
    }

    await ctx.db.patch(existing._id, {
      ...pickDefinedFields(args.patch),
      updatedAt: Date.now(),
    });

    return { updated: true, phoneCallId: existing._id, dayKey: existing.dayKey };
  },
});

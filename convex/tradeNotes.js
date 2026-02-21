import { mutation, query } from "./_generated/server";
import { v } from "convex/values";
import { getChicagoDayKey } from "./lib/time";

const MAX_NOTE_LENGTH = 3000;

function normalizeNote(value) {
  return String(value ?? "")
    .replace(/\r\n/g, "\n")
    .trim();
}

export const getDayTradeNote = query({
  args: {
    dayKey: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const dayKey = args.dayKey ?? getChicagoDayKey();
    return await ctx.db
      .query("tradeNotes")
      .withIndex("by_dayKey", (q) => q.eq("dayKey", dayKey))
      .unique();
  },
});

export const upsertDayTradeNote = mutation({
  args: {
    dayKey: v.string(),
    note: v.string(),
  },
  handler: async (ctx, args) => {
    const note = normalizeNote(args.note);
    if (note.length > MAX_NOTE_LENGTH) {
      throw new Error(`Trade note is too long. Max ${MAX_NOTE_LENGTH} characters.`);
    }

    const existing = await ctx.db
      .query("tradeNotes")
      .withIndex("by_dayKey", (q) => q.eq("dayKey", args.dayKey))
      .unique();

    if (!note) {
      if (existing) {
        await ctx.db.delete(existing._id);
      }
      return {
        dayKey: args.dayKey,
        cleared: true,
      };
    }

    const now = Date.now();
    if (!existing) {
      const id = await ctx.db.insert("tradeNotes", {
        dayKey: args.dayKey,
        note,
        createdAt: now,
        updatedAt: now,
      });
      return {
        dayKey: args.dayKey,
        cleared: false,
        inserted: true,
        id,
        updatedAt: now,
      };
    }

    await ctx.db.patch(existing._id, {
      note,
      updatedAt: now,
    });
    return {
      dayKey: args.dayKey,
      cleared: false,
      inserted: false,
      id: existing._id,
      updatedAt: now,
    };
  },
});


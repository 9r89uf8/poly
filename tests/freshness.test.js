import test from "node:test";
import assert from "node:assert/strict";
import {
  computePollFreshness,
  resolveLastSuccessfulPollAtMs,
} from "../convex/lib/freshness.js";

test("computePollFreshness marks data healthy when within threshold", () => {
  const freshness = computePollFreshness({
    nowMs: 10_000,
    lastSuccessfulPollAtMs: 9_200,
    stalePollSeconds: 180,
  });

  assert.deepEqual(freshness, {
    pollStaleSeconds: 0,
    isStale: false,
  });
});

test("computePollFreshness marks stale when poll age exceeds threshold", () => {
  const freshness = computePollFreshness({
    nowMs: 500_000,
    lastSuccessfulPollAtMs: 250_000,
    stalePollSeconds: 180,
  });

  assert.deepEqual(freshness, {
    pollStaleSeconds: 250,
    isStale: true,
  });
});

test("computePollFreshness marks stale when no successful poll exists", () => {
  const freshness = computePollFreshness({
    nowMs: 500_000,
    lastSuccessfulPollAtMs: null,
    stalePollSeconds: 180,
  });

  assert.deepEqual(freshness, {
    pollStaleSeconds: undefined,
    isStale: true,
  });
});

test("resolveLastSuccessfulPollAtMs prefers explicit timestamp field", () => {
  const lastSuccessfulPollAtMs = resolveLastSuccessfulPollAtMs({
    lastSuccessfulPollAtMs: 123_456,
    updatedAt: 999_999,
  });

  assert.equal(lastSuccessfulPollAtMs, 123_456);
});

test("resolveLastSuccessfulPollAtMs supports legacy records", () => {
  const lastSuccessfulPollAtMs = resolveLastSuccessfulPollAtMs({
    lastSuccessfulPollLocal: "02/18/2026, 09:15:00 AM",
    pollStaleSeconds: 0,
    updatedAt: 456_789,
  });

  assert.equal(lastSuccessfulPollAtMs, 456_789);
});

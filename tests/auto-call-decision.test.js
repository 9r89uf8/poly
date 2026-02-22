import test from "node:test";
import assert from "node:assert/strict";
import {
  buildDecisionKey,
  isCallInFlight,
  isInsideHottestWindow,
  resolveHottestTwoHourWindow,
} from "../convex/lib/autoCall.js";

test("buildDecisionKey groups timestamps into stable interval buckets", () => {
  const dayKey = "2026-02-20";
  const keyA = buildDecisionKey(dayKey, 1_000_000, 20);
  const keyB = buildDecisionKey(dayKey, 1_000_000 + 30_000, 20);
  const keyC = buildDecisionKey(dayKey, 1_000_000 + (21 * 60 * 1000), 20);

  assert.equal(keyA, keyB);
  assert.notEqual(keyA, keyC);
});

test("resolveHottestTwoHourWindow selects the hottest adjacent two-hour block", () => {
  const periods = [
    { startMs: Date.UTC(2026, 1, 20, 18, 0, 0), tempF: 30 },
    { startMs: Date.UTC(2026, 1, 20, 19, 0, 0), tempF: 31 },
    { startMs: Date.UTC(2026, 1, 20, 20, 0, 0), tempF: 32 },
    { startMs: Date.UTC(2026, 1, 20, 21, 0, 0), tempF: 31 },
  ];

  const window = resolveHottestTwoHourWindow(periods);
  assert.ok(window);
  assert.equal(window.windowStartAtMs, Date.UTC(2026, 1, 20, 19, 0, 0));
  assert.equal(window.windowEndAtMs, Date.UTC(2026, 1, 20, 21, 0, 0));
  assert.equal(window.hottestHourTempF, 32);
});

test("resolveHottestTwoHourWindow falls back around single hottest hour when no adjacent pair exists", () => {
  const periods = [
    { startMs: Date.UTC(2026, 1, 20, 18, 0, 0), tempF: 30 },
    { startMs: Date.UTC(2026, 1, 20, 20, 30, 0), tempF: 36 },
    { startMs: Date.UTC(2026, 1, 20, 23, 0, 0), tempF: 32 },
  ];

  const window = resolveHottestTwoHourWindow(periods);
  assert.ok(window);
  assert.equal(window.windowStartAtMs, Date.UTC(2026, 1, 20, 19, 30, 0));
  assert.equal(window.windowEndAtMs, Date.UTC(2026, 1, 20, 21, 30, 0));
  assert.equal(window.hottestHourAtMs, Date.UTC(2026, 1, 20, 20, 30, 0));
});

test("isInsideHottestWindow treats the end of window as exclusive", () => {
  const window = {
    windowStartAtMs: Date.UTC(2026, 1, 20, 20, 0, 0),
    windowEndAtMs: Date.UTC(2026, 1, 20, 22, 0, 0),
  };

  assert.equal(isInsideHottestWindow(Date.UTC(2026, 1, 20, 20, 0, 0), window), true);
  assert.equal(isInsideHottestWindow(Date.UTC(2026, 1, 20, 21, 59, 59), window), true);
  assert.equal(isInsideHottestWindow(Date.UTC(2026, 1, 20, 22, 0, 0), window), false);
});

test("isCallInFlight matches active pipeline statuses", () => {
  assert.equal(isCallInFlight("REQUESTED"), true);
  assert.equal(isCallInFlight("CALL_INITIATED"), true);
  assert.equal(isCallInFlight("RECORDING_READY"), true);
  assert.equal(isCallInFlight("PROCESSED"), false);
});

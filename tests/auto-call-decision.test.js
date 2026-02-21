import test from "node:test";
import assert from "node:assert/strict";
import {
  buildDecisionKey,
  classifyDecisionWindow,
  computeRisingTrend,
  hasRecentHighObservation,
  isCallInFlight,
  shouldCallForWindow,
  toNearMaxFlag,
} from "../convex/lib/autoCall.js";

const SETTINGS = {
  autoCallPrePeakLeadMinutes: 90,
  autoCallPrePeakLagMinutes: 30,
  autoCallPeakLeadMinutes: 15,
  autoCallPeakLagMinutes: 45,
  autoCallPostPeakLeadMinutes: 90,
  autoCallPostPeakLagMinutes: 180,
};

test("buildDecisionKey groups timestamps into stable interval buckets", () => {
  const dayKey = "2026-02-20";
  const keyA = buildDecisionKey(dayKey, 1_000_000, 5);
  const keyB = buildDecisionKey(dayKey, 1_000_000 + 30_000, 5);
  const keyC = buildDecisionKey(dayKey, 1_000_000 + (6 * 60 * 1000), 5);

  assert.equal(keyA, keyB);
  assert.notEqual(keyA, keyC);
});

test("classifyDecisionWindow resolves PRE_PEAK, PEAK, POST_PEAK, OUTSIDE", () => {
  const predictedMaxAtMs = Date.UTC(2026, 1, 20, 20, 0, 0);

  const prePeak = classifyDecisionWindow({
    nowMs: predictedMaxAtMs - (60 * 60 * 1000),
    predictedMaxAtMs,
    settings: SETTINGS,
  });
  const peak = classifyDecisionWindow({
    nowMs: predictedMaxAtMs,
    predictedMaxAtMs,
    settings: SETTINGS,
  });
  const postPeak = classifyDecisionWindow({
    nowMs: predictedMaxAtMs + (120 * 60 * 1000),
    predictedMaxAtMs,
    settings: SETTINGS,
  });
  const outside = classifyDecisionWindow({
    nowMs: predictedMaxAtMs - (4 * 60 * 60 * 1000),
    predictedMaxAtMs,
    settings: SETTINGS,
  });

  assert.equal(prePeak, "PRE_PEAK");
  assert.equal(peak, "PEAK");
  assert.equal(postPeak, "POST_PEAK");
  assert.equal(outside, "OUTSIDE");
});

test("computeRisingTrend requires two finite observations", () => {
  assert.equal(computeRisingTrend([]), false);
  assert.equal(
    computeRisingTrend([
      { wuLikeTempWholeF: null },
      { wuLikeTempWholeF: 42 },
    ]),
    false,
  );

  assert.equal(
    computeRisingTrend([
      { wuLikeTempWholeF: 43 },
      { wuLikeTempWholeF: 42 },
      { wuLikeTempWholeF: 41 },
    ]),
    true,
  );
  assert.equal(
    computeRisingTrend([
      { wuLikeTempWholeF: 42 },
      { wuLikeTempWholeF: 43 },
    ]),
    false,
  );
});

test("hasRecentHighObservation checks high marks inside lookback window", () => {
  const nowMs = Date.UTC(2026, 1, 20, 20, 0, 0);
  const recentHigh = new Date(nowMs - (20 * 60 * 1000)).toISOString();
  const oldHigh = new Date(nowMs - (3 * 60 * 60 * 1000)).toISOString();

  assert.equal(
    hasRecentHighObservation(
      [
        { isNewHigh: true, obsTimeUtc: recentHigh },
        { isNewHigh: false, obsTimeUtc: oldHigh },
      ],
      nowMs,
      60,
    ),
    true,
  );

  assert.equal(
    hasRecentHighObservation(
      [
        { isNewHigh: true, obsTimeUtc: oldHigh },
      ],
      nowMs,
      60,
    ),
    false,
  );
});

test("shouldCallForWindow applies per-window rules", () => {
  assert.equal(
    shouldCallForWindow("PRE_PEAK", {
      nearForecastMax: true,
      risingNow: true,
      highChangedRecently: false,
    }),
    true,
  );
  assert.equal(
    shouldCallForWindow("PRE_PEAK", {
      nearForecastMax: true,
      risingNow: false,
      highChangedRecently: false,
    }),
    false,
  );
  assert.equal(
    shouldCallForWindow("PEAK", {
      nearForecastMax: false,
      risingNow: true,
      highChangedRecently: false,
    }),
    true,
  );
  assert.equal(
    shouldCallForWindow("POST_PEAK", {
      nearForecastMax: false,
      risingNow: false,
      highChangedRecently: true,
    }),
    true,
  );
});

test("toNearMaxFlag compares current and predicted temperatures with threshold", () => {
  assert.equal(toNearMaxFlag(42, 43, 1), true);
  assert.equal(toNearMaxFlag(42, 44, 1), false);
  assert.equal(toNearMaxFlag(null, 44, 1), false);
});

test("isCallInFlight matches active pipeline statuses", () => {
  assert.equal(isCallInFlight("REQUESTED"), true);
  assert.equal(isCallInFlight("CALL_INITIATED"), true);
  assert.equal(isCallInFlight("RECORDING_READY"), true);
  assert.equal(isCallInFlight("PROCESSED"), false);
});


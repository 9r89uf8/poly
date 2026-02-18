import test from "node:test";
import assert from "node:assert/strict";
import {
  computePredictedHighForMethod,
  evaluateCalibrationDays,
  parseIemAsosCsv,
} from "../convex/lib/calibration.js";

const DAY1_HIGH_METAR =
  "KORD 011200Z 00000KT 10SM CLR 05/00 A3000 RMK AO2 T00500000";
const DAY1_LOW_METAR =
  "KORD 011000Z 00000KT 10SM CLR 02/00 A3000 RMK AO2 T00200000";
const DAY2_HIGH_METAR =
  "KORD 021200Z 00000KT 10SM CLR 04/00 A3000 RMK AO2 T00470000";
const DAY2_LOW_METAR =
  "KORD 021000Z 00000KT 10SM CLR 01/00 A3000 RMK AO2 T00100000";

test("parseIemAsosCsv parses rows and valid UTC timestamps from IEM CSV", () => {
  const csv = [
    "# station metadata",
    "station,valid,tmpf,metar",
    `KORD,2026-02-01 10:00,35.6,${DAY1_LOW_METAR}`,
    `KORD,2026-02-01 12:00,41.0,${DAY1_HIGH_METAR}`,
    `KORD,2026-02-02 10:00,34.0,${DAY2_LOW_METAR}`,
  ].join("\n");

  const rows = parseIemAsosCsv(csv);

  assert.equal(rows.length, 3);
  assert.equal(rows[0].valid, "2026-02-01 10:00");
  assert.equal(rows[0].validUtcMs, Date.UTC(2026, 1, 1, 10, 0, 0));
  assert.equal(rows[2].validUtcMs, Date.UTC(2026, 1, 2, 10, 0, 0));
  assert.equal(rows[1].rawMetar, DAY1_HIGH_METAR);
});

test("computePredictedHighForMethod returns daily high for method config", () => {
  const observations = [
    { rawMetar: DAY1_LOW_METAR },
    { rawMetar: DAY1_HIGH_METAR },
  ];

  const tGroupNearest = computePredictedHighForMethod(observations, {
    tempExtraction: "TGROUP_PREFERRED",
    rounding: "NEAREST",
  });
  const integerNearest = computePredictedHighForMethod(observations, {
    tempExtraction: "METAR_INTEGER_C",
    rounding: "NEAREST",
  });

  assert.equal(tGroupNearest, 41);
  assert.equal(integerNearest, 41);
});

test("computePredictedHighForMethod prefers COR report for duplicate timestamps", () => {
  const observations = [
    {
      valid: "2026-02-02 12:00",
      validUtcMs: Date.UTC(2026, 1, 2, 12, 0, 0),
      rawMetar: "KORD 021200Z 00000KT 10SM CLR 15/00 A3000 RMK AO2",
    },
    {
      valid: "2026-02-02 12:00",
      validUtcMs: Date.UTC(2026, 1, 2, 12, 0, 0),
      rawMetar: "KORD 021200Z 00000KT 10SM CLR 10/00 A3000 RMK AO2 COR",
    },
  ];

  const predicted = computePredictedHighForMethod(observations, {
    tempExtraction: "METAR_INTEGER_C",
    rounding: "NEAREST",
  });

  assert.equal(predicted, 50);
});

test("evaluateCalibrationDays ranks methods and returns mismatches", () => {
  const evaluation = evaluateCalibrationDays([
    {
      dayKey: "2026-02-01",
      wuHighWholeF: 41,
      observations: [
        { rawMetar: DAY1_LOW_METAR },
        { rawMetar: DAY1_HIGH_METAR },
      ],
    },
    {
      dayKey: "2026-02-02",
      wuHighWholeF: 40,
      observations: [
        { rawMetar: DAY2_LOW_METAR },
        { rawMetar: DAY2_HIGH_METAR },
      ],
    },
  ]);

  assert.equal(evaluation.chosenMethod.methodId, "TGROUP_PREFERRED__NEAREST");
  assert.equal(evaluation.chosenMethod.matchRate, 1);
  assert.equal(evaluation.chosenMethod.mismatches.length, 0);

  const integerNearest = evaluation.methodResults.find(
    (result) => result.methodId === "METAR_INTEGER_C__NEAREST",
  );
  assert.equal(integerNearest.matchRate, 0.5);
  assert.equal(integerNearest.mismatches.length, 1);
  assert.equal(integerNearest.mismatches[0].dayKey, "2026-02-02");
});

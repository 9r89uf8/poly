import test from "node:test";
import assert from "node:assert/strict";
import {
  deriveWuLikeTempWholeF,
  extractMetarTempC,
  extractObsZuluStamp,
  parseAwcMetarJson,
  parseMetarIntegerTempC,
  parseMetarTGroupTempC,
  parseNwsMetarText,
  roundWuLikeTempF,
  tempCToF,
} from "../convex/lib/weather.js";

const METAR_WITH_TGROUP_POSITIVE =
  "KORD 171951Z 18012G18KT 10SM FEW045 SCT250 05/M02 A2992 RMK AO2 SLP133 T00501017";

const METAR_WITH_TGROUP_NEGATIVE =
  "KORD 060251Z 31012KT 10SM CLR M07/M12 A3015 RMK AO2 SLP213 T10671117";

const METAR_WITHOUT_TGROUP =
  "KORD 271651Z 23011KT 10SM FEW050 SCT250 15/02 A3004 RMK AO2 SLP172";

const METAR_NEGATIVE_INTEGER_ONLY =
  "KORD 081651Z 35015KT 10SM CLR M02/M09 A3045 RMK AO2";

test("parseNwsMetarText extracts raw metar and zulu stamp", () => {
  const nwsPayload = `
2026/02/18 19:51
${METAR_WITH_TGROUP_POSITIVE}
`;

  const parsed = parseNwsMetarText(nwsPayload);

  assert.equal(parsed.source, "NWS");
  assert.equal(parsed.rawMetar, METAR_WITH_TGROUP_POSITIVE);
  assert.equal(parsed.obsZuluStamp, "171951Z");
});

test("parseAwcMetarJson uses obsTime when present", () => {
  const awcPayload = [
    {
      rawOb: METAR_WITH_TGROUP_POSITIVE,
      obsTime: "2026-02-18T03:05:00Z",
    },
  ];

  const parsed = parseAwcMetarJson(awcPayload);

  assert.equal(parsed.source, "AWC");
  assert.equal(parsed.rawMetar, METAR_WITH_TGROUP_POSITIVE);
  assert.equal(parsed.obsZuluStamp, "180305Z");
});

test("parseAwcMetarJson falls back to METAR zulu stamp", () => {
  const awcPayload = {
    data: [
      {
        rawOb: METAR_WITHOUT_TGROUP,
      },
    ],
  };

  const parsed = parseAwcMetarJson(awcPayload);
  assert.equal(parsed.obsZuluStamp, "271651Z");
});

test("parseMetarTGroupTempC handles positive and negative tenths Celsius", () => {
  assert.equal(parseMetarTGroupTempC(METAR_WITH_TGROUP_POSITIVE), 5.0);
  assert.equal(parseMetarTGroupTempC(METAR_WITH_TGROUP_NEGATIVE), -6.7);
  assert.equal(parseMetarTGroupTempC(METAR_WITHOUT_TGROUP), null);
});

test("parseMetarIntegerTempC handles integer fallback groups", () => {
  assert.equal(parseMetarIntegerTempC(METAR_WITH_TGROUP_NEGATIVE), -7);
  assert.equal(parseMetarIntegerTempC(METAR_WITHOUT_TGROUP), 15);
  assert.equal(parseMetarIntegerTempC(METAR_NEGATIVE_INTEGER_ONLY), -2);
});

test("extractMetarTempC respects extraction method", () => {
  const preferred = extractMetarTempC(
    METAR_WITH_TGROUP_NEGATIVE,
    "TGROUP_PREFERRED",
  );
  const integerOnly = extractMetarTempC(
    METAR_WITH_TGROUP_NEGATIVE,
    "METAR_INTEGER_C",
  );

  assert.deepEqual(preferred, { tempC: -6.7, methodUsed: "TGROUP" });
  assert.deepEqual(integerOnly, { tempC: -7, methodUsed: "METAR_INTEGER_C" });
});

test("tempCToF and roundWuLikeTempF cover configured rules", () => {
  assert.equal(tempCToF(0), 32);
  assert.equal(tempCToF(15), 59);

  const minusTwoCInF = tempCToF(-2);
  assert.equal(roundWuLikeTempF(minusTwoCInF, "NEAREST"), 28);
  assert.equal(roundWuLikeTempF(minusTwoCInF, "FLOOR"), 28);
  assert.equal(roundWuLikeTempF(minusTwoCInF, "CEIL"), 29);

  assert.equal(
    roundWuLikeTempF(31.49, "MAX_OF_ROUNDED", {
      windowTempsF: [31.51, 31.4],
    }),
    32,
  );
});

test("deriveWuLikeTempWholeF returns a rounded WU-like integer Fahrenheit value", () => {
  const tGroupBased = deriveWuLikeTempWholeF(METAR_WITH_TGROUP_NEGATIVE, {
    tempExtraction: "TGROUP_PREFERRED",
    rounding: "NEAREST",
  });
  const integerBased = deriveWuLikeTempWholeF(METAR_WITH_TGROUP_NEGATIVE, {
    tempExtraction: "METAR_INTEGER_C",
    rounding: "NEAREST",
  });

  assert.equal(tGroupBased.tempWholeF, 20);
  assert.equal(integerBased.tempWholeF, 19);
});

test("extractObsZuluStamp returns null when stamp is absent", () => {
  const noStampMetar = "KORD AUTO METAR WITHOUT VALID ZULU GROUP";
  assert.equal(extractObsZuluStamp(noStampMetar), null);
});

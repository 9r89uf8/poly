import test from "node:test";
import assert from "node:assert/strict";
import {
  assertDayKey,
  buildChicagoHighestTempSlugForDayKey,
  buildChicagoHighestTempUrlForDayKey,
} from "../convex/lib/polymarket.js";

test("buildChicagoHighestTempSlugForDayKey formats slug from day key", () => {
  const slug = buildChicagoHighestTempSlugForDayKey("2026-02-21");
  assert.equal(slug, "highest-temperature-in-chicago-on-february-21-2026");
});

test("buildChicagoHighestTempUrlForDayKey formats full polymarket url", () => {
  const url = buildChicagoHighestTempUrlForDayKey("2026-02-22");
  assert.equal(
    url,
    "https://polymarket.com/event/highest-temperature-in-chicago-on-february-22-2026",
  );
});

test("assertDayKey validates YYYY-MM-DD", () => {
  assert.equal(assertDayKey("2026-02-22"), "2026-02-22");
  assert.throws(() => assertDayKey("2026-2-22"), /must be YYYY-MM-DD/);
});

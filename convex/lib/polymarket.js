const DAY_KEY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

const MONTH_NAMES = [
  "january",
  "february",
  "march",
  "april",
  "may",
  "june",
  "july",
  "august",
  "september",
  "october",
  "november",
  "december",
];

export function assertDayKey(dayKey, label = "dayKey") {
  const normalized = String(dayKey ?? "").trim();
  if (!DAY_KEY_PATTERN.test(normalized)) {
    throw new Error(`${label} must be YYYY-MM-DD.`);
  }
  return normalized;
}

export function buildChicagoHighestTempSlugForDayKey(dayKey) {
  const normalizedDayKey = assertDayKey(dayKey);
  const [yearRaw, monthRaw, dayRaw] = normalizedDayKey.split("-");
  const year = Number(yearRaw);
  const month = Number(monthRaw);
  const day = Number(dayRaw);

  const monthName = MONTH_NAMES[month - 1];
  if (!monthName) {
    throw new Error(`Invalid month in dayKey '${normalizedDayKey}'.`);
  }

  return `highest-temperature-in-chicago-on-${monthName}-${day}-${year}`;
}

export function buildChicagoHighestTempUrlForDayKey(dayKey) {
  const slug = buildChicagoHighestTempSlugForDayKey(dayKey);
  return `https://polymarket.com/event/${slug}`;
}

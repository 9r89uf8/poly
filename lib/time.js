import { CHICAGO_TIMEZONE } from "./constants";

function getPartsForTimezone(date, timezone = CHICAGO_TIMEZONE) {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });

  const parts = formatter.formatToParts(date);

  return parts.reduce((acc, part) => {
    if (part.type !== "literal") {
      acc[part.type] = part.value;
    }
    return acc;
  }, {});
}

function getTimezoneOffsetMs(date, timezone = CHICAGO_TIMEZONE) {
  const parts = getPartsForTimezone(date, timezone);
  const asUtcMs = Date.UTC(
    Number(parts.year),
    Number(parts.month) - 1,
    Number(parts.day),
    Number(parts.hour),
    Number(parts.minute),
    Number(parts.second),
  );
  return asUtcMs - date.getTime();
}

export function getChicagoDayKey(input = Date.now()) {
  const date = input instanceof Date ? input : new Date(input);
  const parts = getPartsForTimezone(date, CHICAGO_TIMEZONE);
  return `${parts.year}-${parts.month}-${parts.day}`;
}

export function formatUtcToChicago(input, includeSeconds = false) {
  if (!input) {
    return null;
  }

  const date = input instanceof Date ? input : new Date(input);

  return new Intl.DateTimeFormat("en-US", {
    timeZone: CHICAGO_TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: includeSeconds ? "2-digit" : undefined,
    hour12: true,
  }).format(date);
}

export function chicagoLocalToUtcIso(localDateTime) {
  const normalized = String(localDateTime).trim().replace(" ", "T");
  const match = normalized.match(
    /^(\\d{4})-(\\d{2})-(\\d{2})T(\\d{2}):(\\d{2})(?::(\\d{2}))?$/,
  );

  if (!match) {
    throw new Error(
      "Expected localDateTime in the format YYYY-MM-DDTHH:mm or YYYY-MM-DDTHH:mm:ss",
    );
  }

  const [, year, month, day, hour, minute, second = "00"] = match;
  const localAsUtcMs = Date.UTC(
    Number(year),
    Number(month) - 1,
    Number(day),
    Number(hour),
    Number(minute),
    Number(second),
  );

  // Resolve timezone offset at the target instant; run twice to handle DST boundaries.
  let resolvedUtcMs = localAsUtcMs - getTimezoneOffsetMs(new Date(localAsUtcMs));
  resolvedUtcMs =
    localAsUtcMs - getTimezoneOffsetMs(new Date(resolvedUtcMs));

  return new Date(resolvedUtcMs).toISOString();
}

export function getDayResetRuleDescription() {
  return "Day rolls over exactly at 00:00 America/Chicago.";
}

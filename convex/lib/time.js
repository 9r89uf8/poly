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

//convex/lib/weather.js
const ZULU_STAMP_REGEX = /\b(\d{6}Z)\b/;
const T_GROUP_REGEX = /\bT([01])(\d{3})([01])(\d{3})\b/;
const INTEGER_TEMP_GROUP_REGEX = /(?:^|\s)(M?\d{2})\/(?:M?\d{2}|\/\/)(?=\s|$)/;

function normalizeMetar(rawMetar) {
  if (typeof rawMetar !== "string" || !rawMetar.trim()) {
    throw new Error("rawMetar must be a non-empty string.");
  }

  return rawMetar.trim().replace(/\s*=\s*$/, "").replace(/\s+/g, " ");
}

function toZuluStampFromDate(date) {
  const day = String(date.getUTCDate()).padStart(2, "0");
  const hour = String(date.getUTCHours()).padStart(2, "0");
  const minute = String(date.getUTCMinutes()).padStart(2, "0");
  return `${day}${hour}${minute}Z`;
}

function parseDateLike(value) {
  if (value === null || value === undefined || value === "") {
    return null;
  }

  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value;
  }

  if (typeof value === "number") {
    const milliseconds = value < 1_000_000_000_000 ? value * 1000 : value;
    const date = new Date(milliseconds);
    return Number.isNaN(date.getTime()) ? null : date;
  }

  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) {
      return null;
    }

    if (/^\d+$/.test(trimmed)) {
      return parseDateLike(Number(trimmed));
    }

    const date = new Date(trimmed);
    return Number.isNaN(date.getTime()) ? null : date;
  }

  return null;
}

function getAwcRecord(payload) {
  if (Array.isArray(payload)) {
    return payload[0] ?? null;
  }

  if (!payload || typeof payload !== "object") {
    return null;
  }

  if (Array.isArray(payload.data)) {
    return payload.data[0] ?? null;
  }

  if (Array.isArray(payload.observations)) {
    return payload.observations[0] ?? null;
  }

  return payload;
}

function parseIntegerTempToken(token) {
  if (typeof token !== "string") {
    return null;
  }

  if (token.startsWith("M")) {
    return -Number(token.slice(1));
  }

  return Number(token);
}

export function extractObsZuluStamp(rawMetar) {
  const normalized = normalizeMetar(rawMetar);
  const match = normalized.match(ZULU_STAMP_REGEX);
  return match ? match[1] : null;
}

export function parseNwsMetarText(rawText, options = {}) {
  if (typeof rawText !== "string" || !rawText.trim()) {
    throw new Error("NWS KORD.TXT payload must be a non-empty string.");
  }

  const station = String(options.station ?? "KORD").toUpperCase();
  const lines = rawText
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  const stationPattern = new RegExp(`^${station}\\s+\\d{6}Z\\b`);
  const genericPattern = /^[A-Z]{4}\s+\d{6}Z\b/;

  const metarLine =
    lines.find((line) => stationPattern.test(line)) ??
    lines.find((line) => genericPattern.test(line));

  if (!metarLine) {
    throw new Error("Could not find a METAR line in NWS payload.");
  }

  const rawMetar = normalizeMetar(metarLine);
  const obsZuluStamp = extractObsZuluStamp(rawMetar);

  if (!obsZuluStamp) {
    throw new Error("Could not extract observation Zulu stamp from METAR.");
  }

  return {
    rawMetar,
    obsZuluStamp,
    source: "NWS",
  };
}

export function parseAwcMetarJson(payload) {
  const record = getAwcRecord(payload);
  if (!record || typeof record !== "object") {
    throw new Error("AWC payload does not include a METAR record.");
  }

  const rawMetarCandidate =
    record.rawOb ??
    record.raw_text ??
    record.rawText ??
    record.metar ??
    record.metarText;

  if (typeof rawMetarCandidate !== "string" || !rawMetarCandidate.trim()) {
    throw new Error("AWC payload is missing rawOb/raw METAR text.");
  }

  const rawMetar = normalizeMetar(rawMetarCandidate);

  const obsTimeCandidate =
    record.obsTime ??
    record.reportTime ??
    record.observationTime ??
    record.receiptTime ??
    null;

  const parsedObsTime = parseDateLike(obsTimeCandidate);
  const obsZuluStamp = parsedObsTime
    ? toZuluStampFromDate(parsedObsTime)
    : extractObsZuluStamp(rawMetar);

  if (!obsZuluStamp) {
    throw new Error("Could not derive observation Zulu stamp from AWC payload.");
  }

  return {
    rawMetar,
    obsZuluStamp,
    source: "AWC",
  };
}

export function parseMetarTGroupTempC(rawMetar) {
  const normalized = normalizeMetar(rawMetar);
  const match = normalized.match(T_GROUP_REGEX);
  if (!match) {
    return null;
  }

  const sign = match[1] === "1" ? -1 : 1;
  const tenthsC = Number(match[2]);

  if (!Number.isFinite(tenthsC)) {
    return null;
  }

  return sign * (tenthsC / 10);
}

export function parseMetarIntegerTempC(rawMetar) {
  const normalized = normalizeMetar(rawMetar);
  const match = normalized.match(INTEGER_TEMP_GROUP_REGEX);
  if (!match) {
    return null;
  }

  const tempC = parseIntegerTempToken(match[1]);
  return Number.isFinite(tempC) ? tempC : null;
}

export function extractMetarTempC(rawMetar, method = "TGROUP_PREFERRED") {
  if (method === "TGROUP_PREFERRED") {
    const tGroupTempC = parseMetarTGroupTempC(rawMetar);
    if (tGroupTempC !== null) {
      return {
        tempC: tGroupTempC,
        methodUsed: "TGROUP",
      };
    }

    const integerTempC = parseMetarIntegerTempC(rawMetar);
    if (integerTempC !== null) {
      return {
        tempC: integerTempC,
        methodUsed: "METAR_INTEGER_C",
      };
    }
  } else if (method === "METAR_INTEGER_C") {
    const integerTempC = parseMetarIntegerTempC(rawMetar);
    if (integerTempC !== null) {
      return {
        tempC: integerTempC,
        methodUsed: "METAR_INTEGER_C",
      };
    }
  } else {
    throw new Error(`Unsupported extraction method: ${method}`);
  }

  throw new Error("Could not extract temperature from METAR.");
}

export function tempCToF(tempC) {
  if (!Number.isFinite(tempC)) {
    throw new Error("tempC must be a finite number.");
  }

  return (tempC * 9) / 5 + 32;
}

export function roundWuLikeTempF(tempF, rule = "NEAREST", options = {}) {
  if (!Number.isFinite(tempF)) {
    throw new Error("tempF must be a finite number.");
  }

  switch (rule) {
    case "NEAREST":
      return Math.round(tempF);
    case "FLOOR":
      return Math.floor(tempF);
    case "CEIL":
      return Math.ceil(tempF);
    case "MAX_OF_ROUNDED": {
      const windowTemps = Array.isArray(options.windowTempsF)
        ? options.windowTempsF.filter((value) => Number.isFinite(value))
        : [];
      const rounded = [...windowTemps, tempF].map((value) => Math.round(value));
      return Math.max(...rounded);
    }
    default:
      throw new Error(`Unsupported rounding rule: ${rule}`);
  }
}

export function deriveWuLikeTempWholeF(rawMetar, options = {}) {
  const extractionMethod = options.tempExtraction ?? "TGROUP_PREFERRED";
  const roundingMethod = options.rounding ?? "NEAREST";

  const extracted = extractMetarTempC(rawMetar, extractionMethod);
  const tempF = tempCToF(extracted.tempC);
  const tempWholeF = roundWuLikeTempF(tempF, roundingMethod, {
    windowTempsF: options.windowTempsF,
  });

  return {
    tempC: extracted.tempC,
    tempF,
    tempWholeF,
    methodUsed: extracted.methodUsed,
  };
}

//convex/lib/calibration.js
import { extractMetarTempC, roundWuLikeTempF, tempCToF } from "./weather.js";

export const CALIBRATION_METHODS = [
  {
    methodId: "TGROUP_PREFERRED__NEAREST",
    tempExtraction: "TGROUP_PREFERRED",
    rounding: "NEAREST",
    rank: 1,
  },
  {
    methodId: "TGROUP_PREFERRED__FLOOR",
    tempExtraction: "TGROUP_PREFERRED",
    rounding: "FLOOR",
    rank: 2,
  },
  {
    methodId: "TGROUP_PREFERRED__CEIL",
    tempExtraction: "TGROUP_PREFERRED",
    rounding: "CEIL",
    rank: 3,
  },
  {
    methodId: "TGROUP_PREFERRED__MAX_OF_ROUNDED",
    tempExtraction: "TGROUP_PREFERRED",
    rounding: "MAX_OF_ROUNDED",
    rank: 4,
  },
  {
    methodId: "METAR_INTEGER_C__NEAREST",
    tempExtraction: "METAR_INTEGER_C",
    rounding: "NEAREST",
    rank: 5,
  },
  {
    methodId: "METAR_INTEGER_C__FLOOR",
    tempExtraction: "METAR_INTEGER_C",
    rounding: "FLOOR",
    rank: 6,
  },
  {
    methodId: "METAR_INTEGER_C__CEIL",
    tempExtraction: "METAR_INTEGER_C",
    rounding: "CEIL",
    rank: 7,
  },
  {
    methodId: "METAR_INTEGER_C__MAX_OF_ROUNDED",
    tempExtraction: "METAR_INTEGER_C",
    rounding: "MAX_OF_ROUNDED",
    rank: 8,
  },
];

function parseCsvLine(line) {
  const fields = [];
  let current = "";
  let inQuotes = false;

  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    const nextChar = line[index + 1];

    if (char === "\"") {
      if (inQuotes && nextChar === "\"") {
        current += "\"";
        index += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }

    if (char === "," && !inQuotes) {
      fields.push(current);
      current = "";
      continue;
    }

    current += char;
  }

  fields.push(current);
  return fields;
}

function safeNumber(value) {
  if (value === null || value === undefined || value === "") {
    return null;
  }

  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function parseIemValidUtcMs(valid) {
  if (typeof valid !== "string") {
    return null;
  }

  const match = valid
    .trim()
    .match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?/);

  if (!match) {
    return null;
  }

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const hour = Number(match[4]);
  const minute = Number(match[5]);
  const second = match[6] ? Number(match[6]) : 0;

  if (![year, month, day, hour, minute, second].every(Number.isFinite)) {
    return null;
  }

  return Date.UTC(year, month - 1, day, hour, minute, second);
}

export function parseIemAsosCsv(csvText) {
  if (typeof csvText !== "string" || !csvText.trim()) {
    return [];
  }

  const lines = csvText
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((line) => !line.startsWith("#"));

  if (lines.length < 2) {
    return [];
  }

  const headers = parseCsvLine(lines[0]).map((header) =>
    String(header).trim().toLowerCase(),
  );

  const rows = [];
  for (let index = 1; index < lines.length; index += 1) {
    const fields = parseCsvLine(lines[index]);
    if (fields.length === 0) {
      continue;
    }

    const row = {};
    for (let headerIndex = 0; headerIndex < headers.length; headerIndex += 1) {
      row[headers[headerIndex]] = fields[headerIndex] ?? "";
    }

    const rawMetar = String(row.metar ?? "").trim();
    const valid = String(row.valid ?? "").trim();
    const validUtcMs = parseIemValidUtcMs(valid);
    const tmpf = safeNumber(row.tmpf);

    if (!rawMetar && tmpf === null) {
      continue;
    }

    rows.push({
      valid: valid || null,
      validUtcMs,
      rawMetar,
      tmpf,
    });
  }

  return rows;
}

function roundedTempForMethod(tempF, method) {
  if (method.rounding === "MAX_OF_ROUNDED") {
    return Math.round(tempF);
  }

  return roundWuLikeTempF(tempF, method.rounding);
}

export function computePredictedHighForMethod(observations, method) {
  if (!Array.isArray(observations) || observations.length === 0) {
    return null;
  }

  const observationsByTimestamp = new Map();
  const observationsWithoutTimestamp = [];

  for (const observation of observations) {
    if (!observation?.rawMetar) {
      continue;
    }

    const timestampKey = observation.validUtcMs ?? observation.valid;
    if (!timestampKey) {
      observationsWithoutTimestamp.push(observation);
      continue;
    }

    const existing = observationsByTimestamp.get(timestampKey);
    if (!existing) {
      observationsByTimestamp.set(timestampKey, observation);
      continue;
    }

    const existingIsCorrection = /\bCOR\b/.test(existing.rawMetar);
    const currentIsCorrection = /\bCOR\b/.test(observation.rawMetar);

    if (
      (currentIsCorrection && !existingIsCorrection) ||
      currentIsCorrection === existingIsCorrection
    ) {
      observationsByTimestamp.set(timestampKey, observation);
    }
  }

  const dedupedObservations = [
    ...observationsByTimestamp.values(),
    ...observationsWithoutTimestamp,
  ];

  const roundedTemps = [];

  for (const observation of dedupedObservations) {
    if (!observation?.rawMetar) {
      continue;
    }

    let extractedTempC = null;
    try {
      extractedTempC = extractMetarTempC(
        observation.rawMetar,
        method.tempExtraction,
      ).tempC;
    } catch {
      extractedTempC = null;
    }

    if (!Number.isFinite(extractedTempC)) {
      continue;
    }

    const tempF = tempCToF(extractedTempC);
    roundedTemps.push(roundedTempForMethod(tempF, method));
  }

  if (roundedTemps.length === 0) {
    return null;
  }

  return Math.max(...roundedTemps);
}

function compareMethodResults(left, right) {
  if (right.matchRate !== left.matchRate) {
    return right.matchRate - left.matchRate;
  }

  if (right.matchedDays !== left.matchedDays) {
    return right.matchedDays - left.matchedDays;
  }

  return left.rank - right.rank;
}

export function evaluateCalibrationDays(days) {
  if (!Array.isArray(days) || days.length === 0) {
    throw new Error("Calibration run requires at least one day.");
  }

  const methodResults = CALIBRATION_METHODS.map((method) => {
    let matchedDays = 0;
    const mismatches = [];

    for (const day of days) {
      const predictedHigh = computePredictedHighForMethod(
        day.observations,
        method,
      );

      if (predictedHigh === day.wuHighWholeF) {
        matchedDays += 1;
      } else {
        mismatches.push({
          dayKey: day.dayKey,
          expectedWuHigh: day.wuHighWholeF,
          predictedHigh,
          observationsUsed: day.observations.length,
        });
      }
    }

    const totalDays = days.length;
    const matchRate = totalDays > 0 ? matchedDays / totalDays : 0;

    return {
      ...method,
      matchedDays,
      totalDays,
      matchRate,
      mismatches,
    };
  }).sort(compareMethodResults);

  return {
    methodResults,
    chosenMethod: methodResults[0] ?? null,
  };
}

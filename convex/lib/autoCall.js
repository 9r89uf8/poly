const MINUTE_MS = 60 * 1000;
const HOUR_MS = 60 * MINUTE_MS;

function toWholeMinutes(value, fallback = 5) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }
  return Math.max(1, Math.round(parsed));
}

function toFiniteNumber(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function normalizeHourlyPeriods(hourlyPeriods) {
  const periods = Array.isArray(hourlyPeriods) ? hourlyPeriods : [];
  const normalized = [];

  for (const period of periods) {
    const startMs = toFiniteNumber(period?.startMs);
    const tempF = toFiniteNumber(period?.tempF);
    if (startMs === null || tempF === null) {
      continue;
    }
    normalized.push({ startMs, tempF });
  }

  normalized.sort((a, b) => a.startMs - b.startMs);
  return normalized;
}

export function isCallInFlight(status) {
  return ["REQUESTED", "CALL_INITIATED", "RECORDING_READY"].includes(
    String(status ?? ""),
  );
}

export function buildDecisionKey(dayKey, nowMs, intervalMinutes = 5) {
  const safeInterval = toWholeMinutes(intervalMinutes, 5);
  const bucketMs = safeInterval * MINUTE_MS;
  const bucket = Math.floor(nowMs / bucketMs);
  return `${dayKey}|${safeInterval}|${bucket}`;
}

export function resolveHottestTwoHourWindow(hourlyPeriods) {
  const periods = normalizeHourlyPeriods(hourlyPeriods);
  if (periods.length === 0) {
    return null;
  }

  let bestPair = null;
  for (let index = 0; index < periods.length - 1; index += 1) {
    const first = periods[index];
    const second = periods[index + 1];
    const gapMs = second.startMs - first.startMs;

    // NWS hourly periods should be 1 hour apart; keep small tolerance.
    if (gapMs < 45 * MINUTE_MS || gapMs > 75 * MINUTE_MS) {
      continue;
    }

    const pairTempSumF = first.tempF + second.tempF;
    const pairPeakTempF = Math.max(first.tempF, second.tempF);
    if (
      !bestPair ||
      pairTempSumF > bestPair.pairTempSumF ||
      (pairTempSumF === bestPair.pairTempSumF &&
        pairPeakTempF > bestPair.pairPeakTempF) ||
      (pairTempSumF === bestPair.pairTempSumF &&
        pairPeakTempF === bestPair.pairPeakTempF &&
        first.startMs < bestPair.first.startMs)
    ) {
      bestPair = {
        first,
        second,
        pairTempSumF,
        pairPeakTempF,
      };
    }
  }

  if (bestPair) {
    const hottestHour =
      bestPair.second.tempF >= bestPair.first.tempF
        ? bestPair.second
        : bestPair.first;

    return {
      windowStartAtMs: bestPair.first.startMs,
      windowEndAtMs: bestPair.first.startMs + (2 * HOUR_MS),
      pairTempSumF: bestPair.pairTempSumF,
      hottestHourAtMs: hottestHour.startMs,
      hottestHourTempF: hottestHour.tempF,
    };
  }

  let hottestHour = periods[0];
  for (const period of periods) {
    if (
      period.tempF > hottestHour.tempF ||
      (period.tempF === hottestHour.tempF && period.startMs < hottestHour.startMs)
    ) {
      hottestHour = period;
    }
  }

  return {
    windowStartAtMs: hottestHour.startMs - HOUR_MS,
    windowEndAtMs: hottestHour.startMs + HOUR_MS,
    pairTempSumF: hottestHour.tempF * 2,
    hottestHourAtMs: hottestHour.startMs,
    hottestHourTempF: hottestHour.tempF,
  };
}

export function isInsideHottestWindow(nowMs, window) {
  const startMs = toFiniteNumber(window?.windowStartAtMs);
  const endMs = toFiniteNumber(window?.windowEndAtMs);
  if (
    !Number.isFinite(nowMs) ||
    startMs === null ||
    endMs === null ||
    endMs <= startMs
  ) {
    return false;
  }

  // End is exclusive to avoid an extra call exactly at the boundary.
  return nowMs >= startMs && nowMs < endMs;
}

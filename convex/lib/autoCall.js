const MINUTE_MS = 60 * 1000;

function toWholeMinutes(value, fallback = 5) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }
  return Math.max(1, Math.round(parsed));
}

function getFiniteTemp(value) {
  return Number.isFinite(value) ? Number(value) : null;
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

export function classifyDecisionWindow({
  nowMs,
  predictedMaxAtMs,
  settings,
}) {
  if (!Number.isFinite(nowMs) || !Number.isFinite(predictedMaxAtMs)) {
    return "OUTSIDE";
  }

  const preLead = toWholeMinutes(settings?.autoCallPrePeakLeadMinutes, 90);
  const preLag = toWholeMinutes(settings?.autoCallPrePeakLagMinutes, 30);
  const peakLead = toWholeMinutes(settings?.autoCallPeakLeadMinutes, 15);
  const peakLag = toWholeMinutes(settings?.autoCallPeakLagMinutes, 45);
  const postLead = toWholeMinutes(settings?.autoCallPostPeakLeadMinutes, 90);
  const postLag = toWholeMinutes(settings?.autoCallPostPeakLagMinutes, 180);

  const preStart = predictedMaxAtMs - (preLead * MINUTE_MS);
  const preEnd = predictedMaxAtMs - (preLag * MINUTE_MS);
  const peakStart = predictedMaxAtMs - (peakLead * MINUTE_MS);
  const peakEnd = predictedMaxAtMs + (peakLag * MINUTE_MS);
  const postStart = predictedMaxAtMs + (postLead * MINUTE_MS);
  const postEnd = predictedMaxAtMs + (postLag * MINUTE_MS);

  if (nowMs >= peakStart && nowMs <= peakEnd) {
    return "PEAK";
  }
  if (nowMs >= preStart && nowMs <= preEnd) {
    return "PRE_PEAK";
  }
  if (nowMs >= postStart && nowMs <= postEnd) {
    return "POST_PEAK";
  }

  return "OUTSIDE";
}

export function computeRisingTrend(observations) {
  const ordered = Array.isArray(observations) ? observations : [];
  const temps = [];

  for (const observation of ordered) {
    const temp = getFiniteTemp(observation?.wuLikeTempWholeF);
    if (temp === null) {
      continue;
    }
    temps.push(temp);
    if (temps.length >= 2) {
      break;
    }
  }

  if (temps.length < 2) {
    return false;
  }

  return temps[0] > temps[1];
}

export function hasRecentHighObservation(observations, nowMs, withinMinutes = 60) {
  const ordered = Array.isArray(observations) ? observations : [];
  const cutoffMs = nowMs - (toWholeMinutes(withinMinutes, 60) * MINUTE_MS);

  for (const observation of ordered) {
    if (!observation?.isNewHigh) {
      continue;
    }

    const timeMs = Date.parse(String(observation?.obsTimeUtc ?? ""));
    if (Number.isFinite(timeMs) && timeMs >= cutoffMs) {
      return true;
    }
  }

  return false;
}

export function shouldCallForWindow(window, context) {
  const nearForecastMax = Boolean(context?.nearForecastMax);
  const risingNow = Boolean(context?.risingNow);
  const highChangedRecently = Boolean(context?.highChangedRecently);

  if (window === "PRE_PEAK") {
    return nearForecastMax && risingNow;
  }

  if (window === "PEAK") {
    return nearForecastMax || risingNow;
  }

  if (window === "POST_PEAK") {
    return highChangedRecently || risingNow;
  }

  return false;
}

export function toNearMaxFlag(currentTempWholeF, predictedMaxTempF, thresholdF = 1) {
  const current = getFiniteTemp(currentTempWholeF);
  const predicted = getFiniteTemp(predictedMaxTempF);
  const threshold = Math.abs(Number(thresholdF));

  if (current === null || predicted === null || !Number.isFinite(threshold)) {
    return false;
  }

  return Math.abs(current - predicted) <= threshold;
}


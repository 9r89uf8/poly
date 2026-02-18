export function resolveLastSuccessfulPollAtMs(dailyStats) {
  if (!dailyStats) {
    return null;
  }

  if (Number.isFinite(dailyStats.lastSuccessfulPollAtMs)) {
    return dailyStats.lastSuccessfulPollAtMs;
  }

  const hasLegacyPollStamp =
    typeof dailyStats.lastSuccessfulPollLocal === "string" &&
    (dailyStats.pollStaleSeconds === 0 ||
      dailyStats.pollStaleSeconds === undefined);

  if (hasLegacyPollStamp && Number.isFinite(dailyStats.updatedAt)) {
    return dailyStats.updatedAt;
  }

  return null;
}

export function computePollFreshness({
  nowMs,
  lastSuccessfulPollAtMs,
  stalePollSeconds,
}) {
  if (!Number.isFinite(lastSuccessfulPollAtMs)) {
    return {
      pollStaleSeconds: undefined,
      isStale: true,
    };
  }

  const pollStaleSeconds = Math.max(
    0,
    Math.floor((nowMs - lastSuccessfulPollAtMs) / 1000),
  );

  return {
    pollStaleSeconds,
    isStale: pollStaleSeconds > stalePollSeconds,
  };
}

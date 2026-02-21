"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useAction, useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { formatUtcToChicago, getChicagoDayKey } from "@/lib/time";
import TemperatureTimelineChart from "@/app/components/temperature-timeline-chart";

const RECENT_ELIMINATION_WINDOW_MS = 60 * 60 * 1000;
const STATE_CHANGE_ALERT_TYPES = new Set([
  "NEW_HIGH",
  "BIN_ELIMINATED",
  "DATA_STALE",
  "DATA_HEALTHY",
]);

function formatBinBounds(bin) {
  const lower = bin.lowerBoundF;
  const upper = bin.upperBoundF;

  if (lower !== null && lower !== undefined && upper !== null && upper !== undefined) {
    return `${lower} to ${upper}°F`;
  }

  if (lower !== null && lower !== undefined) {
    return `${lower}°F or higher`;
  }

  if (upper !== null && upper !== undefined) {
    return `${upper}°F or lower`;
  }

  return "Unparsed bounds";
}

function formatWholeTemp(value) {
  return Number.isFinite(Number(value)) ? `${Math.round(Number(value))}°F` : "--";
}

function formatPercent(value) {
  return Number.isFinite(Number(value)) ? `${Number(value).toFixed(1)}%` : "--";
}

function formatPriceCents(value) {
  return Number.isFinite(Number(value)) ? `${(Number(value) * 100).toFixed(1)}c` : "--";
}

function shiftDayKey(dayKey, daysToAdd) {
  const [year, month, day] = String(dayKey).split("-").map(Number);
  const shifted = new Date(Date.UTC(year, month - 1, day + daysToAdd));
  return shifted.toISOString().slice(0, 10);
}

function resolveCalibrationBadge(runs, nowMs) {
  const latestRun = Array.isArray(runs) ? (runs[0] ?? null) : null;
  if (!latestRun || !Number.isFinite(Number(latestRun.matchRate))) {
    return {
      label: "UNCALIBRATED",
      tone: "badge-warn",
      detail: "No calibration run with a valid match rate yet.",
    };
  }

  const matchRate = Number(latestRun.matchRate);
  const ageDays = Number.isFinite(Number(latestRun.createdAt))
    ? Math.max(0, (nowMs - Number(latestRun.createdAt)) / (24 * 60 * 60 * 1000))
    : Infinity;

  if (matchRate >= 0.9 && ageDays <= 14) {
    return {
      label: "CALIBRATION HIGH",
      tone: "badge-ok",
      detail: `${Math.round(matchRate * 100)}% match · ${formatUtcToChicago(latestRun.createdAt, true)} · ${latestRun.chosenMethod ?? "N/A"}`,
    };
  }

  if (matchRate >= 0.8 && ageDays <= 30) {
    return {
      label: "CALIBRATION MEDIUM",
      tone: "badge-current",
      detail: `${Math.round(matchRate * 100)}% match · ${formatUtcToChicago(latestRun.createdAt, true)} · ${latestRun.chosenMethod ?? "N/A"}`,
    };
  }

  return {
    label: "CALIBRATION LOW",
    tone: "badge-warn",
    detail: `${Math.round(matchRate * 100)}% match · ${formatUtcToChicago(latestRun.createdAt, true)} · ${latestRun.chosenMethod ?? "N/A"}`,
  };
}

function toObservationTimeMs(observation) {
  const fromObsUtc = Date.parse(String(observation?.obsTimeUtc ?? ""));
  if (Number.isFinite(fromObsUtc)) {
    return fromObsUtc;
  }

  const fromCreatedAt = Number(observation?.createdAt);
  return Number.isFinite(fromCreatedAt) ? fromCreatedAt : null;
}

function toDecisionActionLabel(decision) {
  if (decision?.decision === "CALL") {
    return decision?.reasonCode === "CALL_FAILED" ? "CALL_FAILED" : "CALL";
  }

  if (
    decision?.reasonCode === "SKIP_SHADOW_MODE" &&
    decision?.reasonDetail?.wouldCallReason
  ) {
    return `WOULD_CALL (${decision.reasonDetail.wouldCallReason})`;
  }

  return "SKIP";
}

export default function DashboardOverview() {
  const dayKey = useMemo(() => getChicagoDayKey(), []);
  const dashboard = useQuery(api.dashboard.getDashboard, {
    dayKey,
    observationsLimit: 240,
    alertsLimit: 120,
  });
  const latestForecast = useQuery(api.forecast.getLatestForecastSnapshot, {
    dayKey,
  });
  const decisions = useQuery(api.autoCall.getRecentDecisions, {
    dayKey,
    limit: 12,
  });
  const callsPipeline = useQuery(api.proDashboard.getCallsPipeline, {
    dayKey,
    limit: 40,
  });
  const binPriceSnapshots = useQuery(api.polymarket.getLatestBinPriceSnapshots, {
    dayKey,
    limit: 1200,
  });
  const calibrationRuns = useQuery(api.calibration.getRecentCalibrationRuns, {
    limit: 5,
  });
  const dayTradeNote = useQuery(api.tradeNotes.getDayTradeNote, {
    dayKey,
  });
  const refreshBinPriceSnapshotsNow = useAction(api.polymarket.refreshBinPriceSnapshotsNow);
  const upsertDayTradeNote = useMutation(api.tradeNotes.upsertDayTradeNote);

  const [priceRefreshStatus, setPriceRefreshStatus] = useState("idle");
  const [priceRefreshError, setPriceRefreshError] = useState(null);
  const [tradeNoteDraft, setTradeNoteDraft] = useState("");
  const [tradeNoteStatus, setTradeNoteStatus] = useState("idle");
  const [tradeNoteError, setTradeNoteError] = useState(null);

  useEffect(() => {
    if (dayTradeNote === undefined) {
      return;
    }

    setTradeNoteDraft(dayTradeNote?.note ?? "");
    setTradeNoteError(null);
  }, [dayKey, dayTradeNote?._id, dayTradeNote?.updatedAt]);

  if (
    dashboard === undefined ||
    latestForecast === undefined ||
    decisions === undefined ||
    callsPipeline === undefined ||
    binPriceSnapshots === undefined ||
    calibrationRuns === undefined ||
    dayTradeNote === undefined
  ) {
    return <section className="panel">Loading dashboard...</section>;
  }

  const stats = dashboard.dailyStats;
  const latestObservation = dashboard.observations[0] ?? null;
  const healthy = Boolean(stats) && !stats?.isStale;
  const now = Date.now();
  const highLabel = formatWholeTemp(stats?.highSoFarWholeF);
  const currentLabel = formatWholeTemp(stats?.currentTempWholeF);
  const forecastMaxLabel = formatWholeTemp(latestForecast?.predictedMaxTempF);
  const latestObservationTime = stats?.lastObservationTimeLocal ??
    (latestObservation
      ? formatUtcToChicago(latestObservation.createdAt, true)
      : "N/A");
  const forecastFetchedAt = latestForecast?.fetchedAtLocal ??
    (Number.isFinite(Number(latestForecast?.fetchedAt))
      ? formatUtcToChicago(Number(latestForecast?.fetchedAt), true)
      : "N/A");
  const historyDayHref = `/history?preset=CUSTOM&startDayKey=${encodeURIComponent(dayKey)}&endDayKey=${encodeURIComponent(dayKey)}`;
  const historyLast7Href = `/history?preset=CUSTOM&startDayKey=${encodeURIComponent(shiftDayKey(dayKey, -6))}&endDayKey=${encodeURIComponent(dayKey)}`;
  const calibrationBadge = resolveCalibrationBadge(calibrationRuns, now);

  const deadBins = dashboard.bins.filter((bin) => bin.status === "DEAD");
  const currentBins = dashboard.bins.filter((bin) => bin.status === "CURRENT");
  const aliveBins = Math.max(
    dashboard.bins.length - deadBins.length - currentBins.length,
    0,
  );
  const recentEliminations = dashboard.alerts.filter(
    (alert) =>
      alert.type === "BIN_ELIMINATED" &&
      Number(alert.createdAt) >= now - RECENT_ELIMINATION_WINDOW_MS,
  );
  const latestPriceByMarketId = new Map(
    (Array.isArray(binPriceSnapshots?.prices) ? binPriceSnapshots.prices : []).map((item) => [
      String(item.marketId),
      item,
    ]),
  );
  const latestStateChange = dashboard.alerts.find((alert) =>
    STATE_CHANGE_ALERT_TYPES.has(String(alert?.type ?? "")),
  );

  const metarPoints = dashboard.observations
    .map((observation) => {
      const t = toObservationTimeMs(observation);
      const tempF = Number(observation?.wuLikeTempWholeF);
      if (!Number.isFinite(t) || !Number.isFinite(tempF)) {
        return null;
      }
      return { t, tempF };
    })
    .filter(Boolean);

  const forecastPoints = (Array.isArray(latestForecast?.hourly) ? latestForecast.hourly : [])
    .map((point) => {
      const t = Number(point?.startMs);
      const tempF = Number(point?.tempF);
      if (!Number.isFinite(t) || !Number.isFinite(tempF)) {
        return null;
      }
      return { t, tempF };
    })
    .filter(Boolean);

  const callPoints = (Array.isArray(callsPipeline?.calls) ? callsPipeline.calls : [])
    .map((call) => {
      const t = Number(call?.requestedAt);
      const tempF = Number(call?.tempF);
      if (!Number.isFinite(t) || !Number.isFinite(tempF)) {
        return null;
      }
      return { t, tempF };
    })
    .filter(Boolean);

  const timelineSeries = [];
  if (metarPoints.length > 0) {
    timelineSeries.push({
      key: "metar",
      label: "METAR observations",
      color: "#1f8b4d",
      points: metarPoints,
    });
  }
  if (forecastPoints.length > 0) {
    timelineSeries.push({
      key: "forecast",
      label: "Forecast hourly",
      color: "#9a3d22",
      strokeDasharray: "5 4",
      points: forecastPoints,
    });
  }
  if (callPoints.length > 0) {
    timelineSeries.push({
      key: "calls",
      label: "Phone calls",
      color: "#114fd6",
      showDots: true,
      points: callPoints,
    });
  }

  const auditDecisions = decisions.slice(0, 8);
  const auditCalls = (Array.isArray(callsPipeline?.calls) ? callsPipeline.calls : []).slice(0, 8);
  const latestDecision = decisions[0] ?? null;
  const latestCall = callsPipeline?.calls?.[0] ?? null;
  const decisionCounts = decisions.reduce(
    (acc, decision) => {
      const action = toDecisionActionLabel(decision);
      if (action.startsWith("CALL_FAILED")) {
        acc.failed += 1;
      } else if (action.startsWith("CALL")) {
        acc.called += 1;
      } else if (action.startsWith("WOULD_CALL")) {
        acc.wouldCall += 1;
      } else {
        acc.skipped += 1;
      }
      return acc;
    },
    { called: 0, wouldCall: 0, failed: 0, skipped: 0 },
  );
  const pipelineStats = callsPipeline?.stats ?? {};
  const savedTradeNote = dayTradeNote?.note ?? "";
  const tradeNoteDirty = tradeNoteDraft !== savedTradeNote;

  const handleRefreshPrices = async () => {
    setPriceRefreshStatus("refreshing");
    setPriceRefreshError(null);
    try {
      await refreshBinPriceSnapshotsNow({ dayKey });
      setPriceRefreshStatus("refreshed");
      setTimeout(() => setPriceRefreshStatus("idle"), 1500);
    } catch (refreshError) {
      setPriceRefreshStatus("error");
      setPriceRefreshError(refreshError?.message ?? "Could not refresh prices.");
    }
  };

  const handleSaveTradeNote = async () => {
    setTradeNoteStatus("saving");
    setTradeNoteError(null);
    try {
      await upsertDayTradeNote({
        dayKey,
        note: tradeNoteDraft,
      });
      setTradeNoteStatus("saved");
      setTimeout(() => setTradeNoteStatus("idle"), 1500);
    } catch (saveError) {
      setTradeNoteStatus("error");
      setTradeNoteError(saveError?.message ?? "Could not save trade note.");
    }
  };

  return (
    <div className="grid">
      <section className={`panel health-gate ${healthy ? "health-gate-ok" : "health-gate-warn"}`}>
        <div className="dashboard-header">
          <div>
            <p className="stat-label">Feed health</p>
            <h2 className="dashboard-headline">Today ({dashboard.dayKey})</h2>
          </div>
          <span className={`badge ${healthy ? "badge-ok" : "badge-warn"}`}>
            {healthy ? "OK" : "STALE"}
          </span>
        </div>

        <p className={healthy ? "health-gate-message-ok" : "health-gate-message-warn"}>
          {healthy
            ? "Feed healthy. Trading cues are current."
            : stats
              ? "Feed is stale. Do not trade from this screen until feed recovers."
              : "No poll data is available yet. Do not trade from this screen yet."}
        </p>

        <div className="dashboard-meta">
          <p className="muted">Last successful poll: {stats?.lastSuccessfulPollLocal ?? "N/A"}</p>
          <p className="muted">Last METAR observation: {latestObservationTime}</p>
          <p className="muted">Poll age: {stats?.pollStaleSeconds ?? "--"}s</p>
          <p className="muted">Source: {latestObservation?.source ?? "N/A"}</p>
          <p className="muted">Active market set: {dashboard.activeMarket ? "yes" : "no"}</p>
          <p className="muted">
            Last state change: {latestStateChange
              ? `${latestStateChange.type} @ ${formatUtcToChicago(latestStateChange.createdAt, true)}`
              : "N/A"}
          </p>
        </div>
      </section>

      <section className="panel">
        <div className="dashboard-header">
          <div>
            <p className="stat-label">Oracle state</p>
            <h2 className="dashboard-headline">Oracle Terminal</h2>
            <p className="muted" style={{ marginTop: 6, marginBottom: 0 }}>
              {calibrationBadge.detail}
            </p>
          </div>
          <span className={`badge ${calibrationBadge.tone}`}>{calibrationBadge.label}</span>
        </div>

        <div className="dashboard-header" style={{ marginTop: 8 }}>
          <div />
          <div className="dashboard-links">
            <Link href={`/day/${dashboard.dayKey}`}>Day detail</Link>
            <Link href={historyDayHref}>History (day)</Link>
            <Link href={historyLast7Href}>History (7d)</Link>
          </div>
        </div>

        <div className="metric-cards metric-cards-4">
          <div className="metric-card">
            <p className="stat-label">Current WU-like Temp</p>
            <p className="stat-value">{currentLabel}</p>
          </div>
          <div className="metric-card">
            <p className="stat-label">High So Far</p>
            <p className="stat-value">{highLabel}</p>
            <p className="muted" style={{ marginBottom: 0 }}>
              Time of high: {stats?.timeOfHighLocal ?? "N/A"}
            </p>
          </div>
          <div className="metric-card">
            <p className="stat-label">Forecast max</p>
            <p className="stat-value">{forecastMaxLabel}</p>
            <p className="muted" style={{ marginBottom: 0 }}>
              Peak time: {latestForecast?.predictedMaxTimeLocal ?? "N/A"}
            </p>
            <p className="muted" style={{ marginBottom: 0 }}>
              Snapshot: {forecastFetchedAt}
            </p>
          </div>
          <div className="metric-card">
            <p className="stat-label">Active market</p>
            <p style={{ marginTop: 0, marginBottom: 6, fontWeight: 600 }}>
              {dashboard.activeMarket?.event?.title ?? "No market set for today"}
            </p>
            <p className="muted" style={{ marginBottom: 0 }}>
              End date: {dashboard.activeMarket?.event?.endDate ?? "Unknown"}
            </p>
          </div>
        </div>
      </section>

      <section className="panel">
        <div className="dashboard-header">
          <div>
            <p className="stat-label">Execution strip</p>
            <h3 style={{ margin: 0 }}>Compact automation and call pipeline view</h3>
          </div>
          <div className="dashboard-links">
            <Link href="/automation">Automation</Link>
            <Link href="/calls">Calls</Link>
          </div>
        </div>

        <div className="strip-grid">
          <article className="strip-card">
            <p className="stat-label">Decision strip</p>
            <p className="strip-headline">
              {latestDecision
                ? toDecisionActionLabel(latestDecision)
                : "No recent decisions"}
            </p>
            <p className="muted">
              {latestDecision
                ? `${latestDecision.reasonCode} @ ${
                    latestDecision.evaluatedAtLocal ??
                    formatUtcToChicago(latestDecision.evaluatedAt, true)
                  }`
                : "No decision buckets recorded yet."}
            </p>
            <div className="pill-row">
              <span className="badge badge-ok">Called: {decisionCounts.called}</span>
              <span className="badge badge-current">Would-call: {decisionCounts.wouldCall}</span>
              <span className="badge badge-warn">Failed: {decisionCounts.failed}</span>
              <span className="badge badge-neutral">Skip: {decisionCounts.skipped}</span>
            </div>
          </article>

          <article className="strip-card">
            <p className="stat-label">Call pipeline strip</p>
            <p className="strip-headline">{latestCall?.status ?? "No recent calls"}</p>
            <p className="muted">
              {latestCall
                ? `${latestCall.requestedAtLocal ?? "N/A"} | ${
                    latestCall.requestedBy ?? "manual"
                  } | ${formatWholeTemp(latestCall.tempF)}`
                : "No call pipeline records for this day."}
            </p>
            <div className="pill-row">
              <span className="badge badge-neutral">Total: {pipelineStats.totalCalls ?? 0}</span>
              <span className="badge badge-current">In flight: {pipelineStats.inFlightCount ?? 0}</span>
              <span className="badge badge-ok">
                Parse ok: {formatPercent(pipelineStats.parseSuccessRate)}
              </span>
              <span className="badge badge-warn">Failed: {pipelineStats.failedCount ?? 0}</span>
            </div>
          </article>
        </div>
      </section>

      <section className="panel">
        <div className="dashboard-header">
          <div>
            <p className="stat-label">Trade note</p>
            <h3 style={{ margin: 0 }}>Operator note for {dayKey}</h3>
          </div>
          <span className="badge badge-neutral">Max 3000 chars</span>
        </div>

        <div className="form-row" style={{ marginTop: 10 }}>
          <label htmlFor="trade-note-textarea">Manual trade log</label>
          <textarea
            id="trade-note-textarea"
            name="trade-note-textarea"
            rows={4}
            value={tradeNoteDraft}
            onChange={(event) => setTradeNoteDraft(event.target.value)}
            placeholder="Record setups, fills, confidence, and post-trade notes for this day."
          />
        </div>

        <div className="actions" style={{ marginTop: 10 }}>
          <button
            type="button"
            onClick={handleSaveTradeNote}
            disabled={tradeNoteStatus === "saving" || !tradeNoteDirty}
          >
            {tradeNoteStatus === "saving" ? "Saving..." : "Save note"}
          </button>
          <span className="muted">
            {tradeNoteStatus === "saved"
              ? "Saved"
              : tradeNoteDirty
                ? "Unsaved changes"
                : "No changes"}
          </span>
          {tradeNoteError ? (
            <span className="muted" style={{ color: "var(--warn)" }}>{tradeNoteError}</span>
          ) : null}
        </div>
      </section>

      <section className="panel">
        <div className="dashboard-header">
          <div>
            <p className="stat-label">Bin ladder</p>
            <h3 style={{ margin: 0 }}>Hard eliminations</h3>
          </div>
          <div style={{ textAlign: "right" }}>
            <div className="pill-row">
              <span className="badge badge-dead">Dead: {deadBins.length}</span>
              <span className="badge badge-current">Current: {currentBins.length}</span>
              <span className="badge badge-ok">Alive: {aliveBins}</span>
              <span className={`badge ${recentEliminations.length > 0 ? "badge-warn" : "badge-neutral"}`}>
                New dead (60m): {recentEliminations.length}
              </span>
            </div>
            <div className="inline-row">
              <span className="muted">
                Prices: {binPriceSnapshots.latestFetchedAtLocal ?? "N/A"}
                {Number.isFinite(Number(binPriceSnapshots.ageSeconds))
                  ? ` (${binPriceSnapshots.ageSeconds}s old)`
                  : ""}
              </span>
              <button
                type="button"
                className="mini-button"
                onClick={handleRefreshPrices}
                disabled={priceRefreshStatus === "refreshing"}
              >
                {priceRefreshStatus === "refreshing" ? "Refreshing..." : "Refresh prices"}
              </button>
            </div>
            {priceRefreshError ? (
              <p className="muted" style={{ marginTop: 4, color: "var(--warn)" }}>
                {priceRefreshError}
              </p>
            ) : null}
          </div>
        </div>

        {dashboard.bins.length === 0 && (
          <p className="muted">No bins available for {dashboard.dayKey}.</p>
        )}

        {dashboard.bins.length > 0 && (
          <div className="bin-ladder">
            {dashboard.bins.map((bin) => {
              const price = latestPriceByMarketId.get(String(bin.marketId));
              return (
              <article
                key={bin._id}
                className={`bin-row ${
                  bin.status === "DEAD"
                    ? "bin-row-dead"
                    : bin.status === "CURRENT"
                      ? "bin-row-current"
                      : ""
                }`}
              >
                <div>
                  <p style={{ marginTop: 0, marginBottom: 6, fontWeight: 600 }}>{bin.label}</p>
                  <p className="muted" style={{ marginBottom: 0 }}>
                    Bounds: {formatBinBounds(bin)}
                  </p>
                  <p className="muted" style={{ marginBottom: 0 }}>
                    Yes: {formatPriceCents(price?.yesPrice)} | No: {formatPriceCents(price?.noPrice)}
                  </p>
                </div>
                <div style={{ textAlign: "right" }}>
                  <span
                    className={`badge ${
                      bin.status === "DEAD"
                        ? "badge-dead"
                        : bin.status === "CURRENT"
                          ? "badge-current"
                          : "badge-ok"
                    }`}
                  >
                    {bin.status ?? "ALIVE"}
                  </span>
                  {bin.status === "DEAD" && (
                    <p className="muted" style={{ marginBottom: 0 }}>
                      dead since {bin.deadSinceLocalTime ?? "N/A"}
                    </p>
                  )}
                </div>
              </article>
              );
            })}
          </div>
        )}
      </section>

      <TemperatureTimelineChart
        title="Temperature timeline"
        subtitle="METAR observations, latest forecast, and call-derived temperatures for the active Chicago day."
        series={timelineSeries}
        noDataLabel="No timeline points are available for this day yet."
      />

      <section className="panel">
        <p className="stat-label">Audit</p>
        <h3 style={{ marginTop: 0 }}>Recent decisions and call outcomes</h3>

        <div className="grid grid-2">
          <div style={{ overflowX: "auto" }}>
            <p className="stat-label">Automation decisions</p>
            {auditDecisions.length === 0 ? (
              <p className="muted">No decisions recorded yet.</p>
            ) : (
              <table className="table">
                <thead>
                  <tr>
                    <th align="left">Time</th>
                    <th align="left">Action</th>
                    <th align="left">Reason</th>
                    <th align="left">Window</th>
                  </tr>
                </thead>
                <tbody>
                  {auditDecisions.map((decision) => (
                    <tr key={decision._id}>
                      <td>{decision.evaluatedAtLocal ?? formatUtcToChicago(decision.evaluatedAt, true)}</td>
                      <td>{toDecisionActionLabel(decision)}</td>
                      <td>{decision.reasonCode}</td>
                      <td>{decision.window ?? "OUTSIDE"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>

          <div style={{ overflowX: "auto" }}>
            <p className="stat-label">Calls pipeline</p>
            {auditCalls.length === 0 ? (
              <p className="muted">No calls recorded yet.</p>
            ) : (
              <table className="table">
                <thead>
                  <tr>
                    <th align="left">Time</th>
                    <th align="left">Status</th>
                    <th align="left">Temp</th>
                    <th align="left">By</th>
                  </tr>
                </thead>
                <tbody>
                  {auditCalls.map((call) => (
                    <tr key={call._id}>
                      <td>{call.requestedAtLocal ?? "N/A"}</td>
                      <td>{call.status}</td>
                      <td>{formatWholeTemp(call.tempF)}</td>
                      <td>{call.requestedBy ?? "manual"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      </section>
    </div>
  );
}

"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import TemperatureTimelineChart from "@/app/components/temperature-timeline-chart";
import { resolveConvexSiteUrl } from "@/lib/convex-site";

const DAY_KEY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const TABS = [
  { key: "timeline", label: "Timeline" },
  { key: "calls", label: "Calls" },
  { key: "decisions", label: "Automation decisions" },
  { key: "forecast", label: "Forecast snapshots" },
];

function formatTemp(value) {
  return Number.isFinite(Number(value)) ? `${Number(value).toFixed(1)}°F` : "--";
}

function decisionActionLabel(decision) {
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

function renderReasonDetail(value) {
  if (!value) {
    return "N/A";
  }

  try {
    return JSON.stringify(value);
  } catch {
    return "N/A";
  }
}

export default function DayDetailClient({ dayKey }) {
  const isValidDayKey = DAY_KEY_PATTERN.test(String(dayKey ?? "").trim());
  const convexSiteUrl = useMemo(() => resolveConvexSiteUrl(), []);
  const dayData = useQuery(
    api.proDashboard.getDayForensics,
    isValidDayKey ? { dayKey } : "skip",
  );

  const [activeTab, setActiveTab] = useState("timeline");
  const [decisionFilter, setDecisionFilter] = useState("ALL");
  const [showMetar, setShowMetar] = useState(true);
  const [showCalls, setShowCalls] = useState(true);
  const [showForecast, setShowForecast] = useState(true);

  const timelineSeries = useMemo(() => {
    if (!dayData) {
      return [];
    }

    const series = [];

    if (showMetar) {
      series.push({
        key: "metar",
        label: "METAR observations",
        color: "#1f8b4d",
        points: dayData.timeline.observations,
      });
    }

    if (showForecast) {
      series.push({
        key: "forecast",
        label: "Forecast hourly",
        color: "#9a3d22",
        strokeDasharray: "5 4",
        points: dayData.timeline.forecast,
      });
    }

    if (showCalls) {
      series.push({
        key: "calls",
        label: "Phone calls",
        color: "#114fd6",
        showDots: true,
        points: dayData.timeline.calls,
      });
    }

    return series;
  }, [dayData, showCalls, showForecast, showMetar]);

  const filteredDecisions = useMemo(() => {
    if (!dayData?.decisions) {
      return [];
    }

    if (decisionFilter === "ALL") {
      return dayData.decisions;
    }

    if (decisionFilter === "CALL") {
      return dayData.decisions.filter(
        (item) => item.decision === "CALL" && item.reasonCode !== "CALL_FAILED",
      );
    }

    if (decisionFilter === "WOULD_CALL") {
      return dayData.decisions.filter(
        (item) =>
          item.reasonCode === "SKIP_SHADOW_MODE" &&
          Boolean(item.reasonDetail?.wouldCallReason),
      );
    }

    if (decisionFilter === "FAIL") {
      return dayData.decisions.filter((item) => item.reasonCode === "CALL_FAILED");
    }

    return dayData.decisions.filter((item) => item.decision !== "CALL");
  }, [dayData?.decisions, decisionFilter]);

  const dayExportUrl = isValidDayKey && convexSiteUrl
    ? `${convexSiteUrl}/exports/day.csv?dayKey=${encodeURIComponent(dayKey)}`
    : null;

  if (!isValidDayKey) {
    return (
      <section className="panel">
        <p className="stat-label">Day detail</p>
        <h2 style={{ marginTop: 0 }}>Invalid day key</h2>
        <p className="muted">Use the format YYYY-MM-DD, for example 2026-02-20.</p>
        <p className="muted" style={{ marginBottom: 0 }}>
          <Link href="/history">Back to history</Link>
        </p>
      </section>
    );
  }

  if (dayData === undefined) {
    return (
      <section className="panel">
        <p className="stat-label">Day detail</p>
        <h2 style={{ marginTop: 0 }}>Loading {dayKey}...</h2>
      </section>
    );
  }

  return (
    <div className="grid">
      <section className="panel">
        <p className="stat-label">Day forensics</p>
        <h2 style={{ marginTop: 0 }}>Operational detail for {dayKey}</h2>
        <p className="muted" style={{ marginTop: 0 }}>
          <Link href="/history">Back to history</Link>
        </p>
        {dayExportUrl ? (
          <p className="muted" style={{ marginTop: 0 }}>
            <a href={dayExportUrl} target="_blank" rel="noreferrer">
              Export day CSV
            </a>
          </p>
        ) : null}

        <div className="metric-cards">
          <div className="metric-card">
            <p className="stat-label">METAR high</p>
            <p className="stat-value">{formatTemp(dayData.dailyStats?.highSoFarWholeF)}</p>
            <p className="muted" style={{ marginBottom: 0 }}>
              {dayData.dailyStats?.timeOfHighLocal ?? "N/A"}
            </p>
          </div>
          <div className="metric-card">
            <p className="stat-label">Current temp</p>
            <p className="stat-value">{formatTemp(dayData.dailyStats?.currentTempWholeF)}</p>
            <p className="muted" style={{ marginBottom: 0 }}>
              Last obs: {dayData.dailyStats?.lastObservationTimeLocal ?? "N/A"}
            </p>
          </div>
          <div className="metric-card">
            <p className="stat-label">Auto calls made</p>
            <p className="stat-value">{dayData.autoState?.autoCallsMade ?? 0}</p>
            <p className="muted" style={{ marginBottom: 0 }}>
              Last reason: {dayData.autoState?.lastReasonCode ?? "N/A"}
            </p>
          </div>
        </div>
      </section>

      <section className="panel">
        <div className="tab-row">
          {TABS.map((tab) => (
            <button
              key={tab.key}
              type="button"
              className={`tab-button ${activeTab === tab.key ? "tab-button-active" : ""}`}
              onClick={() => setActiveTab(tab.key)}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </section>

      {activeTab === "timeline" && (
        <>
          <section className="panel">
            <p className="stat-label">Series toggles</p>
            <div className="toggle-row">
              <label>
                <input
                  type="checkbox"
                  checked={showMetar}
                  onChange={(event) => setShowMetar(event.target.checked)}
                />
                METAR
              </label>
              <label>
                <input
                  type="checkbox"
                  checked={showForecast}
                  onChange={(event) => setShowForecast(event.target.checked)}
                />
                Forecast
              </label>
              <label>
                <input
                  type="checkbox"
                  checked={showCalls}
                  onChange={(event) => setShowCalls(event.target.checked)}
                />
                Phone calls
              </label>
            </div>
          </section>

          <TemperatureTimelineChart
            title="Timeline"
            subtitle="Overlay of METAR, forecast, and call-derived temperatures."
            series={timelineSeries}
            noDataLabel="No timeline points available for this day."
          />
        </>
      )}

      {activeTab === "calls" && (
        <section className="panel">
          <p className="stat-label">Calls</p>
          <h3 style={{ marginTop: 0 }}>Call pipeline records ({dayData.calls.length})</h3>
          {dayData.calls.length === 0 ? (
            <p className="muted">No calls recorded for this day.</p>
          ) : (
            <div style={{ overflowX: "auto" }}>
              <table className="table">
                <thead>
                  <tr>
                    <th align="left">Time</th>
                    <th align="left">Status</th>
                    <th align="left">Temp</th>
                    <th align="left">Requested by</th>
                    <th align="left">Duration</th>
                    <th align="left">Call SID</th>
                    <th align="left">Notes</th>
                  </tr>
                </thead>
                <tbody>
                  {dayData.calls.map((call) => (
                    <tr key={call._id}>
                      <td>{call.requestedAtLocal ?? "N/A"}</td>
                      <td>{call.status}</td>
                      <td>
                        {formatTemp(call.tempF)}
                        <div className="table-subtle">
                          {Number.isFinite(Number(call.tempC))
                            ? `${Number(call.tempC).toFixed(1)}°C`
                            : "--"}
                        </div>
                      </td>
                      <td>{call.requestedBy ?? "manual"}</td>
                      <td>{call.recordingDurationSec ?? "--"}s</td>
                      <td>{call.callSid ?? "--"}</td>
                      <td>
                        {call.warning ? (
                          <div className="table-subtle">{call.warning}</div>
                        ) : null}
                        {call.error ? (
                          <div className="table-subtle" style={{ color: "var(--warn)" }}>
                            {call.error}
                          </div>
                        ) : null}
                        {call.transcript ? (
                          <details>
                            <summary>Transcript</summary>
                            <code>{call.transcript}</code>
                          </details>
                        ) : (
                          <span className="table-subtle">No transcript</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}

      {activeTab === "decisions" && (
        <section className="panel">
          <p className="stat-label">Automation decisions</p>
          <h3 style={{ marginTop: 0 }}>Decision audit trail ({dayData.decisions.length})</h3>

          <div className="form-row" style={{ maxWidth: 360 }}>
            <label htmlFor="decision-filter">Filter</label>
            <select
              id="decision-filter"
              value={decisionFilter}
              onChange={(event) => setDecisionFilter(event.target.value)}
            >
              <option value="ALL">All</option>
              <option value="CALL">Call</option>
              <option value="WOULD_CALL">Would-call (shadow)</option>
              <option value="FAIL">Call failed</option>
              <option value="SKIP">Skip</option>
            </select>
          </div>

          {filteredDecisions.length === 0 ? (
            <p className="muted">No decisions match this filter.</p>
          ) : (
            <div style={{ overflowX: "auto" }}>
              <table className="table">
                <thead>
                  <tr>
                    <th align="left">Time</th>
                    <th align="left">Window</th>
                    <th align="left">Action</th>
                    <th align="left">Reason code</th>
                    <th align="left">Predicted max</th>
                    <th align="left">Call SID</th>
                    <th align="left">Reason detail</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredDecisions.map((decision) => (
                    <tr key={decision._id}>
                      <td>{decision.evaluatedAtLocal ?? "N/A"}</td>
                      <td>{decision.window ?? "OUTSIDE"}</td>
                      <td>{decisionActionLabel(decision)}</td>
                      <td>{decision.reasonCode}</td>
                      <td>{decision.predictedMaxTimeLocal ?? "N/A"}</td>
                      <td>{decision.callSid ?? "--"}</td>
                      <td className="table-subtle">{renderReasonDetail(decision.reasonDetail)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}

      {activeTab === "forecast" && (
        <>
          <TemperatureTimelineChart
            title="Forecast Drift"
            subtitle="How predicted max temperature changed as snapshots refreshed."
            series={[
              {
                key: "forecast-drift",
                label: "Predicted max",
                color: "#9a3d22",
                showDots: true,
                points: dayData.forecastDriftSeries,
              },
            ]}
            noDataLabel="No forecast snapshots recorded for this day."
          />

          <section className="panel">
            <p className="stat-label">Forecast snapshots</p>
            <h3 style={{ marginTop: 0 }}>Recent snapshots ({dayData.forecastSnapshots.length})</h3>
            {dayData.forecastSnapshots.length === 0 ? (
              <p className="muted">No snapshots for this day.</p>
            ) : (
              <div style={{ overflowX: "auto" }}>
                <table className="table">
                  <thead>
                    <tr>
                      <th align="left">Fetched at</th>
                      <th align="left">Generated at</th>
                      <th align="left">Predicted max</th>
                      <th align="left">Predicted max time</th>
                      <th align="left">Hourly rows</th>
                    </tr>
                  </thead>
                  <tbody>
                    {dayData.forecastSnapshots.map((snapshot) => (
                      <tr key={snapshot._id}>
                        <td>{snapshot.fetchedAtLocal ?? "N/A"}</td>
                        <td>{snapshot.forecastGeneratedAtLocal ?? "N/A"}</td>
                        <td>{formatTemp(snapshot.predictedMaxTempF)}</td>
                        <td>{snapshot.predictedMaxTimeLocal ?? "N/A"}</td>
                        <td>{snapshot.hourlyCount}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </>
      )}
    </div>
  );
}

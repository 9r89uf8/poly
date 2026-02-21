"use client";

import { useMemo, useState } from "react";
import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { getChicagoDayKey } from "@/lib/time";

function formatTemp(value) {
  return Number.isFinite(Number(value)) ? `${Number(value).toFixed(1)}°F` : "--";
}

function formatSeconds(value) {
  return Number.isFinite(Number(value)) ? `${Number(value).toFixed(1)}s` : "--";
}

function formatUsd(value) {
  return Number.isFinite(Number(value)) ? `$${Number(value).toFixed(2)}` : "--";
}

export default function CallsClient() {
  const todayDayKey = useMemo(() => getChicagoDayKey(), []);
  const [scope, setScope] = useState("ALL_RECENT");

  const allDays = scope === "ALL_RECENT";
  const pipeline = useQuery(api.proDashboard.getCallsPipeline, {
    allDays,
    dayKey: todayDayKey,
    limit: 250,
  });

  const failureEntries = useMemo(() => {
    if (!pipeline?.failureCounts) {
      return [];
    }

    return Object.entries(pipeline.failureCounts)
      .map(([group, count]) => ({ group, count }))
      .sort((a, b) => b.count - a.count);
  }, [pipeline?.failureCounts]);

  const inFlightCalls = useMemo(() => {
    if (!pipeline?.calls) {
      return [];
    }
    return pipeline.calls.filter((call) => call.inFlight);
  }, [pipeline?.calls]);

  return (
    <div className="grid">
      <section className="panel">
        <p className="stat-label">Calls</p>
        <h2 style={{ marginTop: 0 }}>Call pipeline and quality metrics</h2>
        <p className="muted" style={{ marginTop: 0 }}>
          Track in-flight calls, failures, latency, and estimated spend.
        </p>

        <div className="preset-row">
          <button
            type="button"
            className={`preset-button ${scope === "ALL_RECENT" ? "preset-button-active" : ""}`}
            onClick={() => setScope("ALL_RECENT")}
          >
            All recent
          </button>
          <button
            type="button"
            className={`preset-button ${scope === "TODAY_ONLY" ? "preset-button-active" : ""}`}
            onClick={() => setScope("TODAY_ONLY")}
          >
            Today ({todayDayKey})
          </button>
        </div>
      </section>

      {pipeline === undefined ? (
        <section className="panel">
          <p className="muted">Loading call pipeline...</p>
        </section>
      ) : (
        <>
          <section className="panel">
            <p className="stat-label">Pipeline KPIs</p>
            <div className="metric-cards">
              <div className="metric-card">
                <p className="stat-label">Total calls</p>
                <p className="stat-value">{pipeline.stats.totalCalls}</p>
                <p className="muted" style={{ marginBottom: 0 }}>
                  {pipeline.stats.manualCallCount} manual / {pipeline.stats.autoCallCount} auto
                </p>
              </div>
              <div className="metric-card">
                <p className="stat-label">In-flight</p>
                <p className="stat-value">{pipeline.stats.inFlightCount}</p>
                <p className="muted" style={{ marginBottom: 0 }}>
                  REQUESTED/CALL_INITIATED/RECORDING_READY
                </p>
              </div>
              <div className="metric-card">
                <p className="stat-label">Parse success rate</p>
                <p className="stat-value">
                  {pipeline.stats.parseSuccessRate === null
                    ? "--"
                    : `${pipeline.stats.parseSuccessRate.toFixed(1)}%`}
                </p>
                <p className="muted" style={{ marginBottom: 0 }}>
                  {pipeline.stats.parsedSuccessCount} success / {pipeline.stats.parseFailureCount} parse failures
                </p>
              </div>
              <div className="metric-card">
                <p className="stat-label">Avg recording duration</p>
                <p className="stat-value">{formatSeconds(pipeline.stats.avgDurationSec)}</p>
              </div>
              <div className="metric-card">
                <p className="stat-label">Avg transcription latency</p>
                <p className="stat-value">{formatSeconds(pipeline.stats.avgTranscriptionLatencySec)}</p>
              </div>
              <div className="metric-card">
                <p className="stat-label">Estimated cost</p>
                <p className="stat-value">{formatUsd(pipeline.stats.estimatedCostUsd)}</p>
                <p className="muted" style={{ marginBottom: 0 }}>
                  assumes ${pipeline.stats.costAssumptions.twilioPerMinuteUsd.toFixed(3)}/min Twilio + $
                  {pipeline.stats.costAssumptions.transcribePerMinuteUsd.toFixed(3)}/min transcription
                </p>
              </div>
            </div>
          </section>

          <section className="panel">
            <p className="stat-label">Failures</p>
            <h3 style={{ marginTop: 0 }}>Grouped by error type</h3>
            {failureEntries.length === 0 ? (
              <p className="muted">No failures in this scope.</p>
            ) : (
              <div style={{ overflowX: "auto" }}>
                <table className="table">
                  <thead>
                    <tr>
                      <th align="left">Failure group</th>
                      <th align="left">Count</th>
                    </tr>
                  </thead>
                  <tbody>
                    {failureEntries.map((entry) => (
                      <tr key={entry.group}>
                        <td>{entry.group}</td>
                        <td>{entry.count}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          <section className="panel">
            <p className="stat-label">In-flight calls</p>
            <h3 style={{ marginTop: 0 }}>Current active pipeline records</h3>
            {inFlightCalls.length === 0 ? (
              <p className="muted">No in-flight calls right now.</p>
            ) : (
              <div style={{ overflowX: "auto" }}>
                <table className="table">
                  <thead>
                    <tr>
                      <th align="left">Requested at</th>
                      <th align="left">Day</th>
                      <th align="left">Status</th>
                      <th align="left">Requested by</th>
                      <th align="left">Call SID</th>
                    </tr>
                  </thead>
                  <tbody>
                    {inFlightCalls.map((call) => (
                      <tr key={call._id} className="call-row-inflight">
                        <td>{call.requestedAtLocal ?? "N/A"}</td>
                        <td>{call.dayKey}</td>
                        <td>{call.status}</td>
                        <td>{call.requestedBy}</td>
                        <td>{call.callSid ?? "--"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          <section className="panel">
            <p className="stat-label">Recent calls</p>
            <h3 style={{ marginTop: 0 }}>Latest {pipeline.calls.length} calls</h3>
            {pipeline.calls.length === 0 ? (
              <p className="muted">No call data available.</p>
            ) : (
              <div style={{ overflowX: "auto" }}>
                <table className="table">
                  <thead>
                    <tr>
                      <th align="left">Requested at</th>
                      <th align="left">Day</th>
                      <th align="left">Status</th>
                      <th align="left">Temp</th>
                      <th align="left">Duration</th>
                      <th align="left">Latency</th>
                      <th align="left">Requested by</th>
                      <th align="left">Call SID</th>
                      <th align="left">Error/Warning</th>
                    </tr>
                  </thead>
                  <tbody>
                    {pipeline.calls.map((call) => (
                      <tr
                        key={call._id}
                        className={call.inFlight ? "call-row-inflight" : call.failureGroup ? "call-row-failed" : ""}
                      >
                        <td>{call.requestedAtLocal ?? "N/A"}</td>
                        <td>{call.dayKey}</td>
                        <td>{call.status}</td>
                        <td>{formatTemp(call.tempF)}</td>
                        <td>{formatSeconds(call.recordingDurationSec)}</td>
                        <td>{formatSeconds(call.transcriptionLatencySec)}</td>
                        <td>{call.requestedBy}</td>
                        <td>{call.callSid ?? "--"}</td>
                        <td className="table-subtle">
                          {call.error ?? call.warning ?? "--"}
                        </td>
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

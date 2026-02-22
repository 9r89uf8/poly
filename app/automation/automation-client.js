"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useAction, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { getChicagoDayKey } from "@/lib/time";
import { resolveConvexSiteUrl } from "@/lib/convex-site";

function formatToggle(value) {
  return value ? "Yes" : "No";
}

function decisionLabel(decision) {
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

function boolBadge(value) {
  return value ? "badge badge-ok" : "badge badge-warn";
}

export default function AutomationClient() {
  const dayKey = useMemo(() => getChicagoDayKey(), []);
  const convexSiteUrl = useMemo(() => resolveConvexSiteUrl(), []);

  const settings = useQuery(api.settings.getSettings, {});
  const health = useQuery(api.dashboard.getHealth, { dayKey });
  const autoState = useQuery(api.autoCall.getAutoCallState, { dayKey });
  const decisions = useQuery(api.autoCall.getRecentDecisions, { dayKey, limit: 100 });
  const latestForecast = useQuery(api.forecast.getLatestForecastSnapshot, { dayKey });

  const evaluateNow = useAction(api.autoCall.evaluateNow);
  const refreshForecastNow = useAction(api.forecast.refreshForecastNow);
  const requestManualAirportCall = useAction(api.airportCalls.requestManualAirportCall);

  const [simulationForm, setSimulationForm] = useState(null);
  const [decisionFilter, setDecisionFilter] = useState("ALL");
  const [actionStatus, setActionStatus] = useState({
    evaluate: "idle",
    refresh: "idle",
    call: "idle",
  });
  const [actionMessage, setActionMessage] = useState(null);

  useEffect(() => {
    if (!settings) {
      return;
    }

    setSimulationForm({
      autoCallEnabled: Boolean(settings.autoCallEnabled),
      autoCallShadowMode: Boolean(settings.autoCallShadowMode),
    });
  }, [settings]);

  const simulationOverrides = useMemo(() => {
    if (!simulationForm) {
      return null;
    }

    return {
      autoCallEnabled: Boolean(simulationForm.autoCallEnabled),
      autoCallShadowMode: Boolean(simulationForm.autoCallShadowMode),
    };
  }, [simulationForm]);

  const simulation = useQuery(
    api.autoCall.simulateCurrentDecision,
    simulationOverrides
      ? {
          dayKey,
          overrides: simulationOverrides,
        }
      : "skip",
  );

  const filteredDecisions = useMemo(() => {
    if (!decisions) {
      return [];
    }

    if (decisionFilter === "ALL") {
      return decisions;
    }

    if (decisionFilter === "CALL") {
      return decisions.filter(
        (item) => item.decision === "CALL" && item.reasonCode !== "CALL_FAILED",
      );
    }

    if (decisionFilter === "WOULD_CALL") {
      return decisions.filter(
        (item) =>
          item.reasonCode === "SKIP_SHADOW_MODE" &&
          Boolean(item.reasonDetail?.wouldCallReason),
      );
    }

    if (decisionFilter === "FAIL") {
      return decisions.filter((item) => item.reasonCode === "CALL_FAILED");
    }

    return decisions.filter((item) => item.decision !== "CALL");
  }, [decisionFilter, decisions]);

  const runAction = async (key, fn) => {
    setActionStatus((prev) => ({ ...prev, [key]: "running" }));
    setActionMessage(null);

    try {
      const result = await fn();
      setActionStatus((prev) => ({ ...prev, [key]: "done" }));
      setActionMessage(JSON.stringify(result ?? { ok: true }));
      setTimeout(() => {
        setActionStatus((prev) => ({ ...prev, [key]: "idle" }));
      }, 1400);
    } catch (error) {
      setActionStatus((prev) => ({ ...prev, [key]: "error" }));
      setActionMessage(error?.message ?? "Action failed.");
    }
  };

  const dayExportUrl = convexSiteUrl
    ? `${convexSiteUrl}/exports/day.csv?dayKey=${encodeURIComponent(dayKey)}`
    : null;

  const onSimulationToggle = (field) => (event) => {
    const value = Boolean(event.target.checked);
    setSimulationForm((prev) => ({ ...prev, [field]: value }));
  };

  return (
    <div className="grid">
      <section className="panel">
        <p className="stat-label">Automation</p>
        <h2 style={{ marginTop: 0 }}>Forecast auto-call tuning and audit</h2>
        <p className="muted" style={{ marginTop: 0 }}>
          Day key: {dayKey}. Edit persistent settings on <Link href="/settings">Settings</Link>.
        </p>
        {dayExportUrl ? (
          <p className="muted" style={{ marginBottom: 0 }}>
            <a href={dayExportUrl} target="_blank" rel="noreferrer">
              Export day CSV
            </a>
          </p>
        ) : null}
      </section>

      <section className="panel">
        <p className="stat-label">Control Actions</p>
        <h3 style={{ marginTop: 0 }}>Manual controls</h3>
        <div className="actions">
          <button
            type="button"
            onClick={() => runAction("evaluate", () => evaluateNow({}))}
            disabled={actionStatus.evaluate === "running"}
          >
            {actionStatus.evaluate === "running" ? "Evaluating..." : "Evaluate decision now"}
          </button>
          <button
            type="button"
            onClick={() => runAction("refresh", () => refreshForecastNow({}))}
            disabled={actionStatus.refresh === "running"}
          >
            {actionStatus.refresh === "running" ? "Refreshing..." : "Refresh forecast now"}
          </button>
          <button
            type="button"
            onClick={() => runAction("call", () => requestManualAirportCall({
              requestedBy: "automation_panel_manual",
            }))}
            disabled={actionStatus.call === "running"}
          >
            {actionStatus.call === "running" ? "Calling..." : "Request call now"}
          </button>
        </div>
        {actionMessage ? (
          <p className="muted" style={{ marginBottom: 0 }}>
            {actionMessage}
          </p>
        ) : null}
      </section>

      <section className="panel">
        <p className="stat-label">Current state</p>
        <div className="metric-cards">
          <div className="metric-card">
            <p className="stat-label">Enabled</p>
            <span className={boolBadge(Boolean(settings?.autoCallEnabled))}>
              {formatToggle(Boolean(settings?.autoCallEnabled))}
            </span>
          </div>
          <div className="metric-card">
            <p className="stat-label">Shadow mode</p>
            <span className={boolBadge(Boolean(settings?.autoCallShadowMode))}>
              {Boolean(settings?.autoCallShadowMode) ? "Shadow" : "Live"}
            </span>
          </div>
          <div className="metric-card">
            <p className="stat-label">Auto calls today</p>
            <p className="stat-value">{autoState?.autoCallsMade ?? 0}</p>
            <p className="muted" style={{ marginBottom: 0 }}>
              Last reason: {autoState?.lastReasonCode ?? "N/A"}
            </p>
          </div>
        </div>
        <div className="grid grid-2" style={{ marginTop: 12 }}>
          <p className="muted" style={{ margin: 0 }}>
            Forecast peak: {latestForecast?.predictedMaxTimeLocal ?? "N/A"}
          </p>
          <p className="muted" style={{ margin: 0 }}>
            Forecast max: {Number.isFinite(Number(latestForecast?.predictedMaxTempF))
              ? `${Number(latestForecast.predictedMaxTempF).toFixed(1)}°F`
              : "N/A"}
          </p>
          <p className="muted" style={{ margin: 0 }}>
            Health stale: {health ? (health.stale ? "Yes" : "No") : "N/A"}
          </p>
          <p className="muted" style={{ margin: 0 }}>
            Last decision: {health?.lastAutoDecisionReason ?? "N/A"}
          </p>
        </div>
      </section>

      <section className="panel">
        <p className="stat-label">Simulation mode</p>
        <h3 style={{ marginTop: 0 }}>Read-only hypothetical decision check</h3>

        {!simulationForm ? (
          <p className="muted">Loading simulation controls...</p>
        ) : (
          <div className="grid">
            <div className="grid grid-2">
              <div className="form-row">
                <label htmlFor="sim-enabled">Enabled</label>
                <input
                  id="sim-enabled"
                  type="checkbox"
                  checked={simulationForm.autoCallEnabled}
                  onChange={onSimulationToggle("autoCallEnabled")}
                />
              </div>
              <div className="form-row">
                <label htmlFor="sim-shadow">Shadow mode</label>
                <input
                  id="sim-shadow"
                  type="checkbox"
                  checked={simulationForm.autoCallShadowMode}
                  onChange={onSimulationToggle("autoCallShadowMode")}
                />
              </div>
            </div>
            <p className="muted" style={{ margin: 0 }}>
              Auto logic is fixed: evaluate each minute, call at 20-minute cadence,
              only inside the hottest forecast 2-hour window.
            </p>
          </div>
        )}

        {simulation === undefined ? (
          <p className="muted">Simulating...</p>
        ) : simulation ? (
          <div className="grid" style={{ marginTop: 12 }}>
            <div className="grid grid-2">
              <p className="muted" style={{ margin: 0 }}>
                Simulated at: {simulation.simulatedAtLocal}
              </p>
              <p className="muted" style={{ margin: 0 }}>
                Window: {simulation.window}
              </p>
              <p className="muted" style={{ margin: 0 }}>
                Decision: {simulation.decision}
              </p>
              <p className="muted" style={{ margin: 0 }}>
                Reason: {simulation.reasonCode}
              </p>
            </div>
            <div className="grid grid-2">
              <p className="muted" style={{ margin: 0 }}>
                Forecast window found: {formatToggle(Boolean(simulation.signals?.hasForecastWindow))}
              </p>
              <p className="muted" style={{ margin: 0 }}>
                In hottest 2-hour window: {formatToggle(Boolean(simulation.signals?.inPeakTwoHourWindow))}
              </p>
              <p className="muted" style={{ margin: 0 }}>
                Window start: {simulation.context?.callWindowStartLocal ?? "N/A"}
              </p>
              <p className="muted" style={{ margin: 0 }}>
                Window end: {simulation.context?.callWindowEndLocal ?? "N/A"}
              </p>
            </div>
          </div>
        ) : null}
      </section>

      <section className="panel">
        <p className="stat-label">Decision history</p>
        <h3 style={{ marginTop: 0 }}>Recent evaluations</h3>

        <div className="form-row" style={{ maxWidth: 280 }}>
          <label htmlFor="decision-filter">Filter</label>
          <select
            id="decision-filter"
            value={decisionFilter}
            onChange={(event) => setDecisionFilter(event.target.value)}
          >
            <option value="ALL">All</option>
            <option value="CALL">Call</option>
            <option value="WOULD_CALL">Would-call</option>
            <option value="FAIL">Call failed</option>
            <option value="SKIP">Skip</option>
          </select>
        </div>

        {decisions === undefined ? (
          <p className="muted">Loading decisions...</p>
        ) : filteredDecisions.length === 0 ? (
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
                  <th align="left">Shadow</th>
                  <th align="left">Call SID</th>
                </tr>
              </thead>
              <tbody>
                {filteredDecisions.map((decision) => (
                  <tr key={decision._id}>
                    <td>{decision.evaluatedAtLocal ?? "N/A"}</td>
                    <td>{decision.window ?? "OUTSIDE"}</td>
                    <td>{decisionLabel(decision)}</td>
                    <td>{decision.reasonCode}</td>
                    <td>{decision.shadowMode ? "Yes" : "No"}</td>
                    <td>{decision.callSid ?? "--"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}

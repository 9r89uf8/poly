"use client";

import { useEffect, useMemo, useState } from "react";
import { useAction, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { getChicagoDayKey } from "@/lib/time";
import { resolveConvexSiteUrl } from "@/lib/convex-site";

const CALL_COOLDOWN_SECONDS = 60;
const DECISION_LOG_LIMIT = 20;

function getChicagoHour(input = Date.now()) {
  const value = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Chicago",
    hour: "2-digit",
    hour12: false,
  }).format(new Date(input));
  return Number(value);
}

function isDiscouragedWindow(input = Date.now()) {
  const hour = getChicagoHour(input);
  return Number.isFinite(hour) && hour >= 7 && hour < 13;
}

function formatRemaining(seconds) {
  const safe = Math.max(0, seconds);
  const mins = Math.floor(safe / 60);
  const secs = safe % 60;
  return `${String(mins).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
}

function getDecisionActionLabel(decision) {
  if (decision?.decision === "CALL") {
    return "CALL";
  }

  if (
    decision?.reasonCode === "SKIP_SHADOW_MODE" &&
    decision?.reasonDetail?.wouldCallReason
  ) {
    return `WOULD_CALL (${decision.reasonDetail.wouldCallReason})`;
  }

  return "SKIP";
}

export default function HealthPanel() {
  const dayKey = getChicagoDayKey();
  const health = useQuery(api.dashboard.getHealth, {
    dayKey,
  });
  const autoDecisions = useQuery(api.autoCall.getRecentDecisions, {
    dayKey,
    limit: DECISION_LOG_LIMIT,
  });
  const latestCall = useQuery(api.calls.getLatestPhoneCall, {
    allDays: true,
  });
  const requestManualAirportCall = useAction(
    api.airportCalls.requestManualAirportCall,
  );

  const [nowMs, setNowMs] = useState(Date.now());
  const [requestStatus, setRequestStatus] = useState("idle");
  const [requestError, setRequestError] = useState(null);
  const [requestSuccess, setRequestSuccess] = useState(null);

  useEffect(() => {
    const interval = setInterval(() => {
      setNowMs(Date.now());
    }, 1000);

    return () => clearInterval(interval);
  }, []);

  const cooldownRemainingSeconds = useMemo(() => {
    if (!latestCall?.requestedAt) {
      return 0;
    }

    const nextAllowedAt = latestCall.requestedAt + (CALL_COOLDOWN_SECONDS * 1000);
    return Math.max(0, Math.ceil((nextAllowedAt - nowMs) / 1000));
  }, [latestCall?.requestedAt, nowMs]);

  const convexSiteUrl = useMemo(() => resolveConvexSiteUrl(), []);
  const latestCallAudioUrl = useMemo(() => {
    if (!convexSiteUrl || !latestCall?.recordingSid || !latestCall?.playbackToken) {
      return null;
    }

    const params = new URLSearchParams({
      recordingSid: latestCall.recordingSid,
      token: latestCall.playbackToken,
      format: "auto",
    });
    return `${convexSiteUrl}/twilio/recording-audio?${params.toString()}`;
  }, [convexSiteUrl, latestCall?.recordingSid, latestCall?.playbackToken]);

  const canRequestCall =
    requestStatus !== "calling" &&
    health !== undefined &&
    latestCall !== undefined &&
    cooldownRemainingSeconds <= 0;

  const onRequestCall = async () => {
    setRequestStatus("calling");
    setRequestError(null);
    setRequestSuccess(null);

    try {
      const result = await requestManualAirportCall({
        requestedBy: "health_panel_manual",
      });
      setRequestStatus("idle");
      setRequestSuccess(result?.requestedAtLocal ?? "Call requested.");
    } catch (error) {
      setRequestStatus("idle");
      setRequestError(error?.message ?? "Failed to request manual call.");
    }
  };

  if (health === undefined) {
    return <p className="muted">Loading health...</p>;
  }

  return (
    <div className="grid">
      <div>
        <p className="stat-label">Cron last run</p>
        <p className="stat-value" style={{ fontSize: "1.2rem" }}>
          {health.lastCronRunLocal ?? "N/A"}
        </p>
      </div>
      <div>
        <p className="stat-label">Last poll success</p>
        <p className="stat-value" style={{ fontSize: "1.2rem" }}>
          {health.lastPollSuccess ?? "N/A"}
        </p>
      </div>
      <div>
        <p className="stat-label">Market set for today</p>
        <span className={`badge ${health.marketSetForToday ? "badge-ok" : "badge-warn"}`}>
          {health.marketSetForToday ? "Yes" : "No"}
        </span>
      </div>
      <div>
        <p className="stat-label">Stale status</p>
        <span className={`badge ${health.stale ? "badge-warn" : "badge-ok"}`}>
          {health.stale ? "STALE" : "OK"}
        </span>
      </div>
      <div>
        <p className="stat-label">Poll stale seconds</p>
        <p className="stat-value" style={{ fontSize: "1.2rem" }}>
          {health.pollStaleSeconds ?? "--"}
        </p>
      </div>
      <div>
        <p className="stat-label">Auto-call enabled</p>
        <span className={`badge ${health.autoCallEnabled ? "badge-ok" : "badge-warn"}`}>
          {health.autoCallEnabled ? "Yes" : "No"}
        </span>
      </div>
      <div>
        <p className="stat-label">Auto-call mode</p>
        <p className="stat-value" style={{ fontSize: "1.2rem" }}>
          {health.autoCallShadowMode ? "SHADOW" : "LIVE"}
        </p>
      </div>
      <div>
        <p className="stat-label">Auto calls today</p>
        <p className="stat-value" style={{ fontSize: "1.2rem" }}>
          {health.autoCallsToday ?? 0}
        </p>
      </div>
      <div>
        <p className="stat-label">Forecast peak time</p>
        <p className="stat-value" style={{ fontSize: "1.2rem" }}>
          {health.predictedMaxTimeLocal ?? "N/A"}
        </p>
      </div>
      <p className="muted">Recent data/failed-source alert count: {health.recentErrorsCount}</p>
      <p className="muted">Last auto decision: {health.lastAutoDecisionReason ?? "N/A"}</p>
      <p className="muted">Last auto decision time: {health.lastAutoDecisionLocal ?? "N/A"}</p>
      <p className="muted">Forecast refreshed: {health.forecastFetchedAtLocal ?? "N/A"}</p>

      <section className="panel">
        <p className="stat-label">Airport phone temperature</p>
        <h3 style={{ marginTop: 0 }}>Manual call control</h3>
        <p className="muted" style={{ marginTop: 0 }}>
          Directional signal only. Phone calls never update settlement/highSoFar.
        </p>

        {isDiscouragedWindow(nowMs) && (
          <p className="muted" style={{ color: "var(--warn)" }}>
            Warning: 07:00-13:00 America/Chicago is sun-heating window.
          </p>
        )}

        <div className="actions">
          <button
            type="button"
            onClick={onRequestCall}
            disabled={!canRequestCall}
          >
            {requestStatus === "calling" ? "Calling..." : "Call airport now"}
          </button>
          {cooldownRemainingSeconds > 0 && (
            <span className="muted">
              Cooldown: {formatRemaining(cooldownRemainingSeconds)}
            </span>
          )}
        </div>

        {requestError && (
          <p className="muted" style={{ color: "var(--warn)" }}>
            {requestError}
          </p>
        )}
        {requestSuccess && (
          <p className="muted" style={{ color: "var(--ok)" }}>
            Manual call requested at {requestSuccess}
          </p>
        )}

        {latestCall === undefined && <p className="muted">Loading latest call...</p>}

        {latestCall && (
          <div className="grid">
            <p className="muted" style={{ marginBottom: 0 }}>
              Last request: {latestCall.requestedAtLocal}
            </p>
            <p className="muted" style={{ margin: 0 }}>
              Status: {latestCall.status}
            </p>
            <p className="muted" style={{ margin: 0 }}>
              Parsed temp: {latestCall.parsedOk ? "Yes" : "No"}
            </p>
            <p className="muted" style={{ margin: 0 }}>
              Latest temp: {latestCall.tempF !== undefined
                ? `${latestCall.tempF.toFixed(1)}°F`
                : "--"}
              {latestCall.tempC !== undefined ? ` (${latestCall.tempC.toFixed(1)}°C)` : ""}
            </p>
            {latestCall.warning && (
              <p className="muted" style={{ color: "var(--warn)", margin: 0 }}>
                {latestCall.warning}
              </p>
            )}
            {latestCall.error && (
              <p className="muted" style={{ color: "var(--warn)", margin: 0 }}>
                Error: {latestCall.error}
              </p>
            )}
            {latestCall.transcript && (
              <details>
                <summary>Transcript</summary>
                <code>{latestCall.transcript}</code>
              </details>
            )}
            {latestCallAudioUrl && (
              <div>
                <p className="muted" style={{ marginTop: 0, marginBottom: 6 }}>
                  Recording
                </p>
                <audio controls preload="none" src={latestCallAudioUrl}>
                  Your browser does not support the audio element.
                </audio>
                <p className="muted" style={{ marginTop: 6, marginBottom: 0 }}>
                  <a href={latestCallAudioUrl} target="_blank" rel="noreferrer">
                    Open recording in new tab
                  </a>
                </p>
              </div>
            )}
          </div>
        )}

        {latestCall !== undefined && !latestCall && (
          <p className="muted">No manual airport calls have been made yet.</p>
        )}
      </section>

      <section className="panel">
        <p className="stat-label">Forecast automation</p>
        <h3 style={{ marginTop: 0 }}>Auto-call decision log</h3>
        <p className="muted" style={{ marginTop: 0 }}>
          Read-only feed of recent decision evaluations.
        </p>

        {autoDecisions === undefined && (
          <p className="muted">Loading decision log...</p>
        )}

        {autoDecisions && autoDecisions.length === 0 && (
          <p className="muted">No auto-call decisions recorded yet.</p>
        )}

        {autoDecisions && autoDecisions.length > 0 && (
          <div className="grid">
            {autoDecisions.map((decision) => (
              <article key={decision._id} className="panel">
                <p className="muted" style={{ marginTop: 0, marginBottom: 6 }}>
                  Decision time: {decision.evaluatedAtLocal ?? "N/A"}
                </p>
                <p className="muted" style={{ margin: 0 }}>
                  Reason code: {decision.reasonCode ?? "N/A"}
                </p>
                <p className="muted" style={{ margin: 0 }}>
                  Window: {decision.window ?? "OUTSIDE"}
                </p>
                <p className="muted" style={{ margin: 0 }}>
                  Would-call vs call: {getDecisionActionLabel(decision)}
                </p>
                <p className="muted" style={{ marginBottom: 0 }}>
                  CallSid: {decision.callSid ?? "--"}
                </p>
              </article>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

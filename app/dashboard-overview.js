"use client";

import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { formatUtcToChicago, getChicagoDayKey } from "@/lib/time";

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

export default function DashboardOverview() {
  const dashboard = useQuery(api.dashboard.getDashboard, {
    dayKey: getChicagoDayKey(),
    observationsLimit: 20,
    alertsLimit: 20,
  });

  if (dashboard === undefined) {
    return <section className="panel">Loading dashboard...</section>;
  }

  const stats = dashboard.dailyStats;
  const latestObservation = dashboard.observations[0];
  const healthy = !stats?.isStale;
  const highLabel =
    stats?.highSoFarWholeF === undefined ? "--" : `${stats.highSoFarWholeF}°F`;
  const currentLabel =
    stats?.currentTempWholeF === undefined ? "--" : `${stats.currentTempWholeF}°F`;
  const latestObservationTime = stats?.lastObservationTimeLocal ??
    (latestObservation
      ? formatUtcToChicago(latestObservation.createdAt, true)
      : "N/A");

  return (
    <div className="grid">
      <section className="panel">
        <div className="dashboard-header">
          <div>
            <p className="stat-label">Today ({dashboard.dayKey})</p>
            <h2 className="dashboard-headline">Oracle Terminal</h2>
          </div>
          <span className={`badge ${healthy ? "badge-ok" : "badge-warn"}`}>
            {healthy ? "OK" : "STALE"}
          </span>
        </div>

        <div className="metric-cards">
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
            <p className="stat-label">Active market</p>
            <p style={{ marginTop: 0, marginBottom: 6, fontWeight: 600 }}>
              {dashboard.activeMarket?.event?.title ?? "No market set for today"}
            </p>
            <p className="muted" style={{ marginBottom: 0 }}>
              End date: {dashboard.activeMarket?.event?.endDate ?? "Unknown"}
            </p>
          </div>
        </div>

        <div className="dashboard-meta">
          <p className="muted">Last successful poll: {stats?.lastSuccessfulPollLocal ?? "N/A"}</p>
          <p className="muted">Last observed: {latestObservationTime}</p>
          <p className="muted">Poll age: {stats?.pollStaleSeconds ?? "--"}s</p>
        </div>
      </section>

      <section className="panel">
        <p className="stat-label">Bin ladder</p>
        {dashboard.bins.length === 0 && (
          <p className="muted">No bins available for {dashboard.dayKey}.</p>
        )}

        {dashboard.bins.length > 0 && (
          <div className="bin-ladder">
            {dashboard.bins.map((bin) => (
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
            ))}
          </div>
        )}
      </section>

      <section className="panel">
        <p className="stat-label">Latest observation</p>
        {!latestObservation && <p className="muted">No observations stored yet.</p>}

        {latestObservation && (
          <>
            <p style={{ marginTop: 0, marginBottom: 6, fontWeight: 600 }}>
              {latestObservation.wuLikeTempWholeF === undefined
                ? "--"
                : `${latestObservation.wuLikeTempWholeF}°F`}
            </p>
            <p className="muted">Source: {latestObservation.source}</p>
            <p className="muted">Time: {latestObservation.obsTimeLocal ?? latestObservationTime}</p>
            <details>
              <summary>Raw METAR</summary>
              <code>{latestObservation.rawMetar}</code>
            </details>
          </>
        )}
      </section>

      <section className="panel">
        <p className="stat-label">Alerts</p>
        {dashboard.alerts.length === 0 && <p className="muted">No alerts yet.</p>}
        {dashboard.alerts.length > 0 && (
          <div className="grid">
            {dashboard.alerts.slice(0, 8).map((alert) => (
              <article key={alert._id} className="panel alert-card">
                <p className="stat-label">{alert.type}</p>
                <p className="muted" style={{ marginTop: 0 }}>
                  {formatUtcToChicago(alert.createdAt, true)}
                </p>
                {alert.payload ? (
                  <pre className="alert-payload">
                    {JSON.stringify(alert.payload, null, 2)}
                  </pre>
                ) : (
                  <p className="muted" style={{ marginBottom: 0 }}>No payload</p>
                )}
              </article>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

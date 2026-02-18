"use client";

import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { getChicagoDayKey } from "@/lib/time";

export default function HealthPanel() {
  const health = useQuery(api.dashboard.getHealth, {
    dayKey: getChicagoDayKey(),
  });

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
      <p className="muted">Recent data/failed-source alert count: {health.recentErrorsCount}</p>
    </div>
  );
}

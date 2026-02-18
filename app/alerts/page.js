"use client";

import { useMemo, useState } from "react";
import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { formatUtcToChicago, getChicagoDayKey } from "@/lib/time";

export default function AlertsPage() {
  const [typeFilter, setTypeFilter] = useState("ALL");
  const [searchFilter, setSearchFilter] = useState("");

  const dashboard = useQuery(api.dashboard.getDashboard, {
    dayKey: getChicagoDayKey(),
    alertsLimit: 200,
    observationsLimit: 1,
  });

  const alertTypes = useMemo(() => {
    if (!dashboard) {
      return [];
    }

    return Array.from(new Set(dashboard.alerts.map((alert) => alert.type))).sort();
  }, [dashboard]);

  const filteredAlerts = useMemo(() => {
    if (!dashboard) {
      return [];
    }

    const needle = searchFilter.trim().toLowerCase();

    return dashboard.alerts.filter((alert) => {
      if (typeFilter !== "ALL" && alert.type !== typeFilter) {
        return false;
      }

      if (!needle) {
        return true;
      }

      const payloadText = alert.payload ? JSON.stringify(alert.payload).toLowerCase() : "";
      return (
        alert.type.toLowerCase().includes(needle) ||
        payloadText.includes(needle)
      );
    });
  }, [dashboard, typeFilter, searchFilter]);

  return (
    <section className="panel">
      <p className="stat-label">Alerts</p>
      <h2 style={{ marginTop: 0 }}>Recent system alerts</h2>

      {dashboard === undefined && <p className="muted">Loading alerts...</p>}

      {dashboard && (
        <div className="grid grid-2" style={{ marginBottom: 12 }}>
          <div className="form-row">
            <label htmlFor="type-filter">Filter by alert type</label>
            <select
              id="type-filter"
              value={typeFilter}
              onChange={(event) => setTypeFilter(event.target.value)}
            >
              <option value="ALL">ALL</option>
              {alertTypes.map((type) => (
                <option key={type} value={type}>
                  {type}
                </option>
              ))}
            </select>
          </div>
          <div className="form-row">
            <label htmlFor="search-filter">Search payload/type</label>
            <input
              id="search-filter"
              placeholder="e.g. DATA_STALE, BIN_ELIMINATED"
              value={searchFilter}
              onChange={(event) => setSearchFilter(event.target.value)}
            />
          </div>
        </div>
      )}

      {dashboard && dashboard.alerts.length === 0 && (
        <p className="muted">No alerts yet.</p>
      )}

      {dashboard && dashboard.alerts.length > 0 && filteredAlerts.length === 0 && (
        <p className="muted">No alerts match the current filter.</p>
      )}

      {dashboard && filteredAlerts.length > 0 && (
        <div className="grid">
          {filteredAlerts.map((alert) => (
            <article key={alert._id} className="panel">
              <p className="stat-label">{alert.type}</p>
              <p className="muted" style={{ margin: 0 }}>
                {formatUtcToChicago(alert.createdAt, true)}
              </p>
              {alert.payload ? (
                <pre style={{ overflowX: "auto", marginBottom: 0 }}>
                  {JSON.stringify(alert.payload, null, 2)}
                </pre>
              ) : (
                <p className="muted">No payload</p>
              )}
            </article>
          ))}
        </div>
      )}
    </section>
  );
}

"use client";

import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { formatUtcToChicago, getChicagoDayKey } from "@/lib/time";

export default function ObservationsPage() {
  const observations = useQuery(api.weather.getLatestObservations, {
    dayKey: getChicagoDayKey(),
    limit: 50,
  });

  return (
    <section className="panel">
      <p className="stat-label">Observations</p>
      <h2 style={{ marginTop: 0 }}>Latest observations</h2>

      {observations === undefined && <p className="muted">Loading observations...</p>}

      {observations && observations.length === 0 && (
        <p className="muted">No observations stored yet.</p>
      )}

      {observations && observations.length > 0 && (
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr>
                <th align="left">Time</th>
                <th align="left">Source</th>
                <th align="left">Temp</th>
                <th align="left">New high</th>
                <th align="left">Raw METAR</th>
              </tr>
            </thead>
            <tbody>
              {observations.map((item) => (
                <tr key={item._id}>
                  <td style={{ padding: "6px 8px 6px 0" }}>
                    {item.obsTimeLocal ?? formatUtcToChicago(item.createdAt, true)}
                  </td>
                  <td>{item.source}</td>
                  <td>{item.wuLikeTempWholeF ?? "--"}</td>
                  <td>
                    {item.isNewHigh ? (
                      <span className="badge badge-ok">Yes</span>
                    ) : (
                      <span className="badge">No</span>
                    )}
                  </td>
                  <td>
                    <code>{item.rawMetar}</code>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

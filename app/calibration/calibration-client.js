"use client";

import { useMemo, useState } from "react";
import { useAction, useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { formatUtcToChicago, getChicagoDayKey } from "@/lib/time";

function toDayKey(date) {
  return date.toISOString().slice(0, 10);
}

function addDays(dayKey, daysToAdd) {
  const [year, month, day] = String(dayKey).split("-").map(Number);
  const next = new Date(Date.UTC(year, month - 1, day + daysToAdd));
  return toDayKey(next);
}

function listDayKeysInclusive(startDayKey, endDayKey) {
  const dayKeys = [];
  let cursor = startDayKey;

  while (cursor <= endDayKey) {
    dayKeys.push(cursor);
    cursor = addDays(cursor, 1);
    if (dayKeys.length > 180) {
      break;
    }
  }

  return dayKeys;
}

function toPercent(value) {
  if (!Number.isFinite(value)) {
    return "--";
  }

  return `${(value * 100).toFixed(1)}%`;
}

function defaultRange() {
  const todayChicago = getChicagoDayKey();
  const endDayKey = addDays(todayChicago, -1);
  const startDayKey = addDays(endDayKey, -6);
  return { startDayKey, endDayKey };
}

function buildRowsForRange(startDayKey, endDayKey, existingRows = []) {
  const byDayKey = new Map(
    existingRows.map((row) => [row.dayKey, row.wuHighWholeF ?? ""]),
  );

  return listDayKeysInclusive(startDayKey, endDayKey).map((dayKey) => ({
    dayKey,
    wuHighWholeF: byDayKey.get(dayKey) ?? "",
  }));
}

export default function CalibrationClient() {
  const rangeDefaults = useMemo(() => defaultRange(), []);
  const [startDayKey, setStartDayKey] = useState(rangeDefaults.startDayKey);
  const [endDayKey, setEndDayKey] = useState(rangeDefaults.endDayKey);
  const [rows, setRows] = useState(
    buildRowsForRange(rangeDefaults.startDayKey, rangeDefaults.endDayKey),
  );
  const [status, setStatus] = useState("idle");
  const [error, setError] = useState(null);
  const [adoptStatus, setAdoptStatus] = useState("idle");
  const [adoptError, setAdoptError] = useState(null);
  const [result, setResult] = useState(null);

  const runCalibration = useAction(api.calibration.runCalibration);
  const upsertSettings = useMutation(api.settings.upsertSettings);
  const recentRuns = useQuery(api.calibration.getRecentCalibrationRuns, {
    limit: 12,
  });

  const regenerateRows = () => {
    if (!startDayKey || !endDayKey) {
      return;
    }

    if (startDayKey > endDayKey) {
      setError("Start date must be before or equal to end date.");
      return;
    }

    setRows((existingRows) =>
      buildRowsForRange(startDayKey, endDayKey, existingRows),
    );
    setError(null);
  };

  const updateRow = (index, field, value) => {
    setRows((currentRows) =>
      currentRows.map((row, rowIndex) =>
        rowIndex === index ? { ...row, [field]: value } : row,
      ),
    );
  };

  const run = async () => {
    setStatus("running");
    setError(null);
    setAdoptStatus("idle");
    setAdoptError(null);

    try {
      if (startDayKey > endDayKey) {
        throw new Error("Start date must be before or equal to end date.");
      }

      const dayKeysInRange = new Set(listDayKeysInclusive(startDayKey, endDayKey));
      const wuValues = rows
        .map((row) => ({
          dayKey: row.dayKey,
          wuHighWholeF: Number(row.wuHighWholeF),
        }))
        .filter((row) => dayKeysInRange.has(row.dayKey));

      if (wuValues.length !== dayKeysInRange.size) {
        throw new Error("Provide a WU high value for every day in the range.");
      }

      const invalid = wuValues.find(
        (row) => !Number.isFinite(row.wuHighWholeF) || !Number.isInteger(row.wuHighWholeF),
      );
      if (invalid) {
        throw new Error(`WU high for ${invalid.dayKey} must be an integer.`);
      }

      const runResult = await runCalibration({
        dateRange: {
          startDayKey,
          endDayKey,
        },
        wuValues,
      });

      setResult(runResult);
      setStatus("done");
    } catch (runError) {
      setStatus("error");
      setError(runError.message ?? "Calibration failed.");
    }
  };

  const adoptBestMethod = async () => {
    if (!result?.chosenMethod) {
      return;
    }

    setAdoptStatus("saving");
    setAdoptError(null);

    try {
      await upsertSettings({
        tempExtraction: result.chosenMethod.tempExtraction,
        rounding: result.chosenMethod.rounding,
      });
      setAdoptStatus("saved");
      setTimeout(() => setAdoptStatus("idle"), 1600);
    } catch (saveError) {
      setAdoptStatus("error");
      setAdoptError(saveError.message ?? "Could not adopt method.");
    }
  };

  return (
    <div className="grid">
      <section className="panel">
        <p className="stat-label">Date range</p>
        <div className="grid grid-2">
          <div className="form-row">
            <label htmlFor="start-day">Start day</label>
            <input
              id="start-day"
              type="date"
              value={startDayKey}
              onChange={(event) => setStartDayKey(event.target.value)}
            />
          </div>
          <div className="form-row">
            <label htmlFor="end-day">End day</label>
            <input
              id="end-day"
              type="date"
              value={endDayKey}
              onChange={(event) => setEndDayKey(event.target.value)}
            />
          </div>
        </div>
        <div className="actions" style={{ marginTop: 10 }}>
          <button type="button" onClick={regenerateRows}>
            Generate rows
          </button>
          <button type="button" onClick={run} disabled={status === "running"}>
            {status === "running" ? "Running..." : "Run calibration"}
          </button>
          {status === "done" && <span className="muted">Run complete.</span>}
          {status === "error" && <span className="muted">{error}</span>}
        </div>
      </section>

      <section className="panel">
        <p className="stat-label">WU final highs</p>
        <p className="muted" style={{ marginTop: 0 }}>
          Enter whole °F values for each day.
        </p>
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr>
                <th align="left">Date</th>
                <th align="left">WU high (°F)</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row, index) => (
                <tr key={row.dayKey}>
                  <td style={{ padding: "6px 8px 6px 0" }}>
                    <input
                      type="date"
                      value={row.dayKey}
                      onChange={(event) =>
                        updateRow(index, "dayKey", event.target.value)
                      }
                    />
                  </td>
                  <td>
                    <input
                      type="number"
                      step="1"
                      value={row.wuHighWholeF}
                      onChange={(event) =>
                        updateRow(index, "wuHighWholeF", event.target.value)
                      }
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {result && (
        <section className="panel">
          <p className="stat-label">Best method</p>
          <h3 style={{ marginTop: 0, marginBottom: 8 }}>{result.chosenMethod.label}</h3>
          <p className="muted" style={{ marginTop: 0 }}>
            Match rate: {toPercent(result.chosenMethod.matchRate)} ({result.chosenMethod.matchedDays}/{result.chosenMethod.totalDays})
          </p>
          <div className="actions">
            <button type="button" onClick={adoptBestMethod} disabled={adoptStatus === "saving"}>
              {adoptStatus === "saving" ? "Adopting..." : "Adopt best method"}
            </button>
            {adoptStatus === "saved" && <span className="muted">Saved to settings.</span>}
            {adoptStatus === "error" && <span className="muted">{adoptError}</span>}
          </div>
        </section>
      )}

      {result && (
        <section className="panel">
          <p className="stat-label">Method match rates</p>
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr>
                  <th align="left">Method</th>
                  <th align="left">Extraction</th>
                  <th align="left">Rounding</th>
                  <th align="left">Matched</th>
                  <th align="left">Match rate</th>
                </tr>
              </thead>
              <tbody>
                {result.methodResults.map((method) => (
                  <tr key={method.methodId}>
                    <td style={{ padding: "6px 8px 6px 0" }}>{method.label}</td>
                    <td>{method.tempExtraction}</td>
                    <td>{method.rounding}</td>
                    <td>{method.matchedDays}/{method.totalDays}</td>
                    <td>{toPercent(method.matchRate)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {result && (
        <section className="panel">
          <p className="stat-label">Mismatched dates (best method)</p>
          {result.chosenMethod.mismatches.length === 0 && (
            <p className="muted">No mismatches.</p>
          )}
          {result.chosenMethod.mismatches.length > 0 && (
            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse" }}>
                <thead>
                  <tr>
                    <th align="left">Date</th>
                    <th align="left">WU high</th>
                    <th align="left">Predicted</th>
                    <th align="left">Obs used</th>
                  </tr>
                </thead>
                <tbody>
                  {result.chosenMethod.mismatches.map((item) => (
                    <tr key={item.dayKey}>
                      <td style={{ padding: "6px 8px 6px 0" }}>{item.dayKey}</td>
                      <td>{item.expectedWuHigh}</td>
                      <td>{item.predictedHigh ?? "N/A"}</td>
                      <td>{item.observationsUsed}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}

      <section className="panel">
        <p className="stat-label">Recent calibration runs</p>
        {recentRuns === undefined && <p className="muted">Loading runs...</p>}
        {recentRuns && recentRuns.length === 0 && (
          <p className="muted">No calibration runs saved yet.</p>
        )}
        {recentRuns && recentRuns.length > 0 && (
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr>
                  <th align="left">When (Chicago)</th>
                  <th align="left">Range</th>
                  <th align="left">Chosen method</th>
                  <th align="left">Match rate</th>
                </tr>
              </thead>
              <tbody>
                {recentRuns.map((run) => (
                  <tr key={run._id}>
                    <td style={{ padding: "6px 8px 6px 0" }}>
                      {formatUtcToChicago(run.createdAt, true)}
                    </td>
                    <td>{run.dateRangeStart} to {run.dateRangeEnd}</td>
                    <td>{run.chosenMethod ?? "N/A"}</td>
                    <td>{toPercent(run.matchRate)}</td>
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

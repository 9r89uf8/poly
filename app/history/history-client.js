"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { getChicagoDayKey } from "@/lib/time";
import { resolveConvexSiteUrl } from "@/lib/convex-site";
import TemperatureTimelineChart from "@/app/components/temperature-timeline-chart";

const DAY_KEY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const RANGE_PRESETS = [
  { key: "TODAY", label: "Today" },
  { key: "YESTERDAY", label: "Yesterday" },
  { key: "LAST_7", label: "Last 7 days" },
  { key: "LAST_30", label: "Last 30 days" },
  { key: "CUSTOM", label: "Custom" },
];

function readSearchParam(searchParams, key) {
  if (!searchParams || typeof searchParams !== "object") {
    return "";
  }

  const value = searchParams[key];
  if (Array.isArray(value)) {
    return String(value[0] ?? "");
  }
  return String(value ?? "");
}

function isValidDayKey(dayKey) {
  return DAY_KEY_PATTERN.test(String(dayKey ?? "").trim());
}

function addDays(dayKey, daysToAdd) {
  const [year, month, day] = String(dayKey).split("-").map(Number);
  const shifted = new Date(Date.UTC(year, month - 1, day + daysToAdd));
  return shifted.toISOString().slice(0, 10);
}

function resolveRangeFromPreset(preset, todayDayKey) {
  if (preset === "TODAY") {
    return { startDayKey: todayDayKey, endDayKey: todayDayKey };
  }

  if (preset === "YESTERDAY") {
    const yesterday = addDays(todayDayKey, -1);
    return { startDayKey: yesterday, endDayKey: yesterday };
  }

  if (preset === "LAST_30") {
    return { startDayKey: addDays(todayDayKey, -29), endDayKey: todayDayKey };
  }

  return { startDayKey: addDays(todayDayKey, -6), endDayKey: todayDayKey };
}

function formatTemp(value) {
  return Number.isFinite(Number(value)) ? `${Number(value).toFixed(1)}°F` : "--";
}

export default function HistoryClient({ initialSearchParams }) {
  const todayDayKey = useMemo(() => getChicagoDayKey(), []);
  const convexSiteUrl = useMemo(() => resolveConvexSiteUrl(), []);
  const requestedPreset = useMemo(
    () => readSearchParam(initialSearchParams, "preset").trim().toUpperCase(),
    [initialSearchParams],
  );
  const requestedStartDayKey = useMemo(
    () => readSearchParam(initialSearchParams, "startDayKey").trim(),
    [initialSearchParams],
  );
  const requestedEndDayKey = useMemo(
    () => readSearchParam(initialSearchParams, "endDayKey").trim(),
    [initialSearchParams],
  );

  const hasValidRequestedRange =
    isValidDayKey(requestedStartDayKey) &&
    isValidDayKey(requestedEndDayKey) &&
    requestedStartDayKey <= requestedEndDayKey;
  const hasKnownPreset = RANGE_PRESETS.some((item) => item.key === requestedPreset);

  const initialRange = resolveRangeFromPreset("LAST_7", todayDayKey);
  const [preset, setPreset] = useState("LAST_7");
  const [customStartDayKey, setCustomStartDayKey] = useState(initialRange.startDayKey);
  const [customEndDayKey, setCustomEndDayKey] = useState(initialRange.endDayKey);
  const appliedQueryRef = useRef(null);

  useEffect(() => {
    const queryKey = `${todayDayKey}|${requestedPreset}|${requestedStartDayKey}|${requestedEndDayKey}`;
    if (appliedQueryRef.current === queryKey) {
      return;
    }
    appliedQueryRef.current = queryKey;

    if (hasValidRequestedRange) {
      setPreset("CUSTOM");
      setCustomStartDayKey(requestedStartDayKey);
      setCustomEndDayKey(requestedEndDayKey);
      return;
    }

    if (hasKnownPreset) {
      const nextRange = resolveRangeFromPreset(requestedPreset, todayDayKey);
      setPreset(requestedPreset);
      setCustomStartDayKey(nextRange.startDayKey);
      setCustomEndDayKey(nextRange.endDayKey);
    }
  }, [
    hasKnownPreset,
    hasValidRequestedRange,
    requestedEndDayKey,
    requestedPreset,
    requestedStartDayKey,
    todayDayKey,
  ]);

  const resolvedRange = useMemo(() => {
    if (preset === "CUSTOM") {
      return {
        startDayKey: customStartDayKey,
        endDayKey: customEndDayKey,
      };
    }
    return resolveRangeFromPreset(preset, todayDayKey);
  }, [customEndDayKey, customStartDayKey, preset, todayDayKey]);

  const rangeValidationError = useMemo(() => {
    if (!isValidDayKey(resolvedRange.startDayKey)) {
      return "Start day must be in YYYY-MM-DD format.";
    }
    if (!isValidDayKey(resolvedRange.endDayKey)) {
      return "End day must be in YYYY-MM-DD format.";
    }
    if (resolvedRange.startDayKey > resolvedRange.endDayKey) {
      return "Start day cannot be after end day.";
    }
    return null;
  }, [resolvedRange.endDayKey, resolvedRange.startDayKey]);

  const history = useQuery(
    api.proDashboard.getHistoryRange,
    rangeValidationError
      ? "skip"
      : {
          startDayKey: resolvedRange.startDayKey,
          endDayKey: resolvedRange.endDayKey,
        },
  );

  const chartSeries = useMemo(() => {
    if (!history?.phoneTempSeries) {
      return [];
    }

    return [
      {
        key: "phone-calls",
        label: "Phone calls",
        color: "#114fd6",
        showDots: true,
        points: history.phoneTempSeries.map((point) => ({
          t: point.t,
          tempF: point.tempF,
        })),
      },
    ];
  }, [history?.phoneTempSeries]);

  const onPresetClick = (nextPreset) => {
    setPreset(nextPreset);
    if (nextPreset !== "CUSTOM") {
      const nextRange = resolveRangeFromPreset(nextPreset, todayDayKey);
      setCustomStartDayKey(nextRange.startDayKey);
      setCustomEndDayKey(nextRange.endDayKey);
    }
  };

  const historyExportUrl = convexSiteUrl
    ? `${convexSiteUrl}/exports/history.csv?startDayKey=${encodeURIComponent(
        resolvedRange.startDayKey,
      )}&endDayKey=${encodeURIComponent(resolvedRange.endDayKey)}`
    : null;

  return (
    <div className="grid">
      <section className="panel">
        <p className="stat-label">History</p>
        <h2 style={{ marginTop: 0 }}>Past days and call-temperature timeline</h2>
        <p className="muted" style={{ marginTop: 0 }}>
          Ranges are anchored to America/Chicago day keys.
        </p>

        <div className="preset-row">
          {RANGE_PRESETS.map((item) => (
            <button
              key={item.key}
              type="button"
              className={`preset-button ${preset === item.key ? "preset-button-active" : ""}`}
              onClick={() => onPresetClick(item.key)}
            >
              {item.label}
            </button>
          ))}
        </div>

        <div className="grid grid-2" style={{ marginTop: 12 }}>
          <div className="form-row">
            <label htmlFor="history-start-day">Start day (Chicago)</label>
            <input
              id="history-start-day"
              type="date"
              value={customStartDayKey}
              onChange={(event) => {
                setPreset("CUSTOM");
                setCustomStartDayKey(event.target.value);
              }}
            />
          </div>
          <div className="form-row">
            <label htmlFor="history-end-day">End day (Chicago)</label>
            <input
              id="history-end-day"
              type="date"
              value={customEndDayKey}
              onChange={(event) => {
                setPreset("CUSTOM");
                setCustomEndDayKey(event.target.value);
              }}
            />
          </div>
        </div>

        {rangeValidationError ? (
          <p className="muted" style={{ color: "var(--warn)", marginBottom: 0 }}>
            {rangeValidationError}
          </p>
        ) : (
          <>
            <p className="muted" style={{ marginBottom: historyExportUrl ? 6 : 0 }}>
              Range: {resolvedRange.startDayKey} to {resolvedRange.endDayKey}
            </p>
            {historyExportUrl ? (
              <p className="muted" style={{ marginBottom: 0 }}>
                <a href={historyExportUrl} target="_blank" rel="noreferrer">
                  Export range CSV
                </a>
              </p>
            ) : null}
          </>
        )}
      </section>

      <TemperatureTimelineChart
        title="Call Temperature Series"
        subtitle="Directional phone-call values across the selected range."
        series={chartSeries}
        noDataLabel="No parsed phone-call temperatures were found in this range."
      />

      <section className="panel">
        <p className="stat-label">Day Summaries</p>
        <h3 style={{ marginTop: 0 }}>Daily rollup</h3>

        {rangeValidationError ? null : history === undefined ? (
          <p className="muted">Loading history...</p>
        ) : null}

        {history && history.daySummaries.length === 0 && (
          <p className="muted">No day summary data found for this range.</p>
        )}

        {history && history.daySummaries.length > 0 && (
          <div style={{ overflowX: "auto" }}>
            <table className="table">
              <thead>
                <tr>
                  <th align="left">Day</th>
                  <th align="left">METAR high</th>
                  <th align="left">Forecast peak</th>
                  <th align="left">Phone calls</th>
                  <th align="left">Decision outcomes</th>
                  <th align="left">Forecast fetched</th>
                  <th align="left">Details</th>
                </tr>
              </thead>
              <tbody>
                {history.daySummaries.map((summary) => (
                  <tr key={summary.dayKey}>
                    <td>{summary.dayKey}</td>
                    <td>
                      {formatTemp(summary.metarHighF)}
                      <div className="table-subtle">{summary.metarHighTimeLocal ?? "N/A"}</div>
                    </td>
                    <td>
                      {formatTemp(summary.predictedMaxTempF)}
                      <div className="table-subtle">{summary.predictedMaxTimeLocal ?? "N/A"}</div>
                    </td>
                    <td>
                      {summary.phoneCallsTotal} total / {summary.phoneCallsAuto} auto
                      <div className="table-subtle">max: {formatTemp(summary.phoneMaxTempF)}</div>
                    </td>
                    <td>
                      {summary.autoCallDecisionsCall} called / {summary.autoCallDecisionsWouldCall} would-call
                      <div className="table-subtle">{summary.lastReasonCode ?? "No reason code yet"}</div>
                    </td>
                    <td>{summary.forecastFetchedAtLocal ?? "N/A"}</td>
                    <td>
                      <Link href={`/day/${summary.dayKey}`}>Open day</Link>
                    </td>
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


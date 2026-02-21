import { httpAction } from "./_generated/server";
import { api } from "./_generated/api";
import { getChicagoDayKey } from "./lib/time";

const DAY_KEY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

function addDays(dayKey, daysToAdd) {
  const [year, month, day] = String(dayKey).split("-").map(Number);
  const shifted = new Date(Date.UTC(year, month - 1, day + daysToAdd));
  return shifted.toISOString().slice(0, 10);
}

function isDayKey(dayKey) {
  return DAY_KEY_PATTERN.test(String(dayKey ?? "").trim());
}

function csvEscape(value) {
  if (value === null || value === undefined) {
    return "";
  }

  const raw = String(value);
  if (!/[",\n]/.test(raw)) {
    return raw;
  }

  return `"${raw.replaceAll("\"", "\"\"")}"`;
}

function toCsv(headers, rows) {
  const lines = [headers.map(csvEscape).join(",")];
  for (const row of rows) {
    lines.push(row.map(csvEscape).join(","));
  }
  return `${lines.join("\n")}\n`;
}

function csvResponse(filename, csv) {
  return new Response(csv, {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "no-store",
      "Access-Control-Allow-Origin": "*",
    },
  });
}

export const historyCsvExport = httpAction(async (ctx, request) => {
  const url = new URL(request.url);
  const today = getChicagoDayKey();
  const startDayKey = String(
    url.searchParams.get("startDayKey") ?? addDays(today, -6),
  ).trim();
  const endDayKey = String(
    url.searchParams.get("endDayKey") ?? today,
  ).trim();

  if (!isDayKey(startDayKey) || !isDayKey(endDayKey)) {
    return new Response("Invalid day key. Expected YYYY-MM-DD.", { status: 400 });
  }

  if (startDayKey > endDayKey) {
    return new Response("startDayKey must be before or equal to endDayKey.", {
      status: 400,
    });
  }

  const history = await ctx.runQuery(api.proDashboard.getHistoryRange, {
    startDayKey,
    endDayKey,
  });

  const rows = history.daySummaries.map((summary) => ([
    summary.dayKey,
    summary.metarHighF,
    summary.metarHighTimeLocal,
    summary.predictedMaxTempF,
    summary.predictedMaxTimeLocal,
    summary.forecastFetchedAtLocal,
    summary.phoneCallsTotal,
    summary.phoneCallsAuto,
    summary.phoneMaxTempF,
    summary.autoCallDecisionsCall,
    summary.autoCallDecisionsWouldCall,
    summary.autoCallsMade,
    summary.lastReasonCode,
  ]));

  const csv = toCsv(
    [
      "dayKey",
      "metarHighF",
      "metarHighTimeLocal",
      "predictedMaxTempF",
      "predictedMaxTimeLocal",
      "forecastFetchedAtLocal",
      "phoneCallsTotal",
      "phoneCallsAuto",
      "phoneMaxTempF",
      "autoCallDecisionsCall",
      "autoCallDecisionsWouldCall",
      "autoCallsMade",
      "lastReasonCode",
    ],
    rows,
  );

  return csvResponse(`history_${startDayKey}_to_${endDayKey}.csv`, csv);
});

export const dayCsvExport = httpAction(async (ctx, request) => {
  const url = new URL(request.url);
  const dayKey = String(url.searchParams.get("dayKey") ?? getChicagoDayKey()).trim();

  if (!isDayKey(dayKey)) {
    return new Response("Invalid day key. Expected YYYY-MM-DD.", { status: 400 });
  }

  const dayData = await ctx.runQuery(api.proDashboard.getDayForensics, {
    dayKey,
  });

  const rows = [];

  for (const observation of dayData.observations) {
    rows.push([
      "OBSERVATION",
      dayKey,
      observation.obsTimeLocal ?? "",
      observation.t,
      observation.tempF,
      observation.source ?? "",
      "",
      "",
      "",
      "",
      "",
      "",
      "",
    ]);
  }

  for (const call of dayData.calls) {
    rows.push([
      "CALL",
      dayKey,
      call.requestedAtLocal ?? "",
      call.requestedAt,
      call.tempF,
      "",
      call.status,
      call.requestedBy,
      call.callSid ?? "",
      "",
      "",
      "",
      call.error ?? call.warning ?? "",
    ]);
  }

  for (const decision of dayData.decisions) {
    rows.push([
      "DECISION",
      dayKey,
      decision.evaluatedAtLocal ?? "",
      decision.evaluatedAt,
      "",
      "",
      "",
      "",
      decision.callSid ?? "",
      decision.window ?? "",
      decision.decision ?? "",
      decision.reasonCode ?? "",
      decision.predictedMaxTimeLocal ?? "",
    ]);
  }

  for (const snapshot of dayData.forecastSnapshots) {
    rows.push([
      "FORECAST_SNAPSHOT",
      dayKey,
      snapshot.fetchedAtLocal ?? "",
      snapshot.fetchedAt,
      snapshot.predictedMaxTempF,
      "",
      "",
      "",
      "",
      "",
      "",
      "",
      snapshot.predictedMaxTimeLocal ?? "",
    ]);
  }

  rows.sort((a, b) => Number(a[3] ?? 0) - Number(b[3] ?? 0));

  const csv = toCsv(
    [
      "recordType",
      "dayKey",
      "timeLocal",
      "timeMs",
      "tempF",
      "source",
      "callStatus",
      "requestedBy",
      "callSid",
      "decisionWindow",
      "decision",
      "reasonCode",
      "notes",
    ],
    rows,
  );

  return csvResponse(`day_${dayKey}.csv`, csv);
});

"use client";

import { useMemo, useState } from "react";
import { useAction, useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { getChicagoDayKey } from "@/lib/time";

function formatBounds(bin) {
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

  return "Unparsed";
}

export default function MarketClient() {
  const dayKey = useMemo(() => getChicagoDayKey(), []);

  const importEventBySlugOrUrl = useAction(api.polymarket.importEventBySlugOrUrl);
  const refreshBinPriceSnapshotsNow = useAction(api.polymarket.refreshBinPriceSnapshotsNow);
  const upsertEvent = useMutation(api.polymarket.upsertEvent);
  const replaceBinsForDay = useMutation(api.polymarket.replaceBinsForDay);
  const setActiveMarketForDay = useMutation(api.polymarket.setActiveMarketForDay);

  const activeMarket = useQuery(api.polymarket.getActiveMarket, { dayKey });
  const todaysBins = useQuery(api.polymarket.getBins, { dayKey });

  const [inputValue, setInputValue] = useState("");
  const [preview, setPreview] = useState(null);
  const [status, setStatus] = useState("idle");
  const [error, setError] = useState(null);

  const boundsWarnings =
    preview?.bins?.filter((bin) => bin.boundsParsingFailed).length ?? 0;

  const handleImport = async (event) => {
    event.preventDefault();
    setStatus("importing");
    setError(null);

    try {
      const imported = await importEventBySlugOrUrl({
        input: inputValue,
      });
      setPreview(imported);
      setStatus("imported");
    } catch (importError) {
      setStatus("error");
      setError(importError.message ?? "Import failed.");
    }
  };

  const handleSetActive = async () => {
    if (!preview) {
      return;
    }

    setStatus("saving");
    setError(null);

    try {
      await upsertEvent({
        event: preview.event,
      });

      await replaceBinsForDay({
        dayKey,
        eventId: preview.event.eventId,
        bins: preview.bins.map((bin) => ({
          marketId: String(bin.marketId),
          label: String(bin.label),
          lowerBoundF:
            bin.lowerBoundF === null || bin.lowerBoundF === undefined
              ? null
              : Number(bin.lowerBoundF),
          upperBoundF:
            bin.upperBoundF === null || bin.upperBoundF === undefined
              ? null
              : Number(bin.upperBoundF),
          isLowerOpenEnded: Boolean(bin.isLowerOpenEnded),
          isUpperOpenEnded: Boolean(bin.isUpperOpenEnded),
          yesTokenId: bin.yesTokenId ? String(bin.yesTokenId) : null,
          noTokenId: bin.noTokenId ? String(bin.noTokenId) : null,
          orderIndex: Number(bin.orderIndex),
        })),
      });

      await setActiveMarketForDay({
        dayKey,
        eventId: preview.event.eventId,
        slug: preview.event.slug,
      });

      try {
        await refreshBinPriceSnapshotsNow({ dayKey });
      } catch {
        // Price snapshots are best-effort; market activation should still succeed.
      }

      setStatus("saved");
      setTimeout(() => setStatus("idle"), 1500);
    } catch (saveError) {
      setStatus("error");
      setError(saveError.message ?? "Could not set active market.");
    }
  };

  return (
    <div className="grid">
      <section className="panel">
        <p className="stat-label">Today</p>
        <p style={{ marginTop: 0 }}>{dayKey}</p>

        <form className="settings-form" onSubmit={handleImport}>
          <div className="form-row">
            <label htmlFor="market-input">Polymarket event URL or slug</label>
            <input
              id="market-input"
              name="market-input"
              placeholder="e.g. chicago-ohare-high-temp-feb-18"
              value={inputValue}
              onChange={(event) => setInputValue(event.target.value)}
              required
            />
          </div>
          <div className="actions">
            <button type="submit" disabled={status === "importing" || status === "saving"}>
              {status === "importing" ? "Importing..." : "Import"}
            </button>
            {status === "error" && <span className="muted">{error}</span>}
          </div>
        </form>
      </section>

      {preview && (
        <section className="panel">
          <p className="stat-label">Preview</p>
          <h3 style={{ marginTop: 0, marginBottom: 6 }}>{preview.event.title}</h3>
          <p className="muted" style={{ marginTop: 0 }}>
            Slug: {preview.event.slug} | End: {preview.event.endDate ?? "Unknown"}
          </p>
          <p className="muted" style={{ marginTop: 0 }}>
            Bins found: {preview.bins.length}
          </p>

          {boundsWarnings > 0 && (
            <p className="muted" style={{ color: "#9a3d22" }}>
              Warning: {boundsWarnings} bin(s) could not be parsed into numeric bounds.
            </p>
          )}

          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr>
                  <th align="left">Bin</th>
                  <th align="left">Bounds</th>
                  <th align="left">Yes token</th>
                  <th align="left">No token</th>
                </tr>
              </thead>
              <tbody>
                {preview.bins.map((bin) => (
                  <tr key={bin.marketId}>
                    <td style={{ padding: "6px 8px 6px 0" }}>{bin.label}</td>
                    <td>{formatBounds(bin)}</td>
                    <td><code>{bin.yesTokenId ?? "N/A"}</code></td>
                    <td><code>{bin.noTokenId ?? "N/A"}</code></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="actions" style={{ marginTop: 12 }}>
            <button type="button" onClick={handleSetActive} disabled={status === "saving"}>
              {status === "saving" ? "Saving..." : "Set Active for Today"}
            </button>
            {status === "saved" && <span className="muted">Saved for {dayKey}</span>}
          </div>
        </section>
      )}

      <section className="panel">
        <p className="stat-label">Active market for today</p>

        {activeMarket === undefined && <p className="muted">Loading active market...</p>}

        {activeMarket === null && (
          <p className="muted">No active market set for {dayKey}.</p>
        )}

        {activeMarket && (
          <>
            <h3 style={{ marginTop: 0, marginBottom: 6 }}>
              {activeMarket.event?.title ?? activeMarket.day.activeEventSlug}
            </h3>
            <p className="muted" style={{ marginTop: 0 }}>
              Slug: {activeMarket.day.activeEventSlug}
            </p>
          </>
        )}

        {todaysBins === undefined && <p className="muted">Loading bins...</p>}

        {Array.isArray(todaysBins) && todaysBins.length > 0 && (
          <p className="muted">Stored bins for today: {todaysBins.length}</p>
        )}
      </section>
    </div>
  );
}

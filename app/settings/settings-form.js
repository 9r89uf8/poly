"use client";

import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import {
  ROUNDING_METHODS,
  TEMPERATURE_EXTRACTION_METHODS,
  getDefaultSettings,
} from "@/lib/settings";

function toNumber(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export default function SettingsForm() {
  const settings = useQuery(api.settings.getSettings);
  const upsertSettings = useMutation(api.settings.upsertSettings);

  const [form, setForm] = useState(null);
  const [status, setStatus] = useState("idle");
  const [error, setError] = useState(null);

  const defaults = useMemo(() => getDefaultSettings(), []);

  useEffect(() => {
    if (!settings) {
      return;
    }

    setForm({
      station: settings.station,
      timezone: settings.timezone,
      pollIntervalSeconds: String(settings.pollIntervalSeconds),
      stalePollSeconds: String(settings.stalePollSeconds),
      weatherPrimaryUrl: settings.weatherPrimaryUrl,
      weatherBackupUrl: settings.weatherBackupUrl,
      tempExtraction: settings.tempExtraction,
      rounding: settings.rounding,
    });
  }, [settings]);

  if (settings === undefined || !form) {
    return <p className="muted">Loading settings...</p>;
  }

  const onChange = (field) => (event) => {
    const value = event.target.value;
    setForm((prev) => ({ ...prev, [field]: value }));
  };

  const onSubmit = async (event) => {
    event.preventDefault();
    setStatus("saving");
    setError(null);

    try {
      await upsertSettings({
        station: form.station,
        timezone: form.timezone,
        pollIntervalSeconds: toNumber(
          form.pollIntervalSeconds,
          defaults.pollIntervalSeconds,
        ),
        stalePollSeconds: toNumber(
          form.stalePollSeconds,
          defaults.stalePollSeconds,
        ),
        weatherPrimaryUrl: form.weatherPrimaryUrl,
        weatherBackupUrl: form.weatherBackupUrl,
        tempExtraction: form.tempExtraction,
        rounding: form.rounding,
      });
      setStatus("saved");
      setTimeout(() => setStatus("idle"), 1500);
    } catch (submitError) {
      setStatus("error");
      setError(submitError.message ?? "Failed to save settings.");
    }
  };

  return (
    <form className="settings-form" onSubmit={onSubmit}>
      <div className="form-row">
        <label htmlFor="station">Station</label>
        <input
          id="station"
          name="station"
          value={form.station}
          onChange={onChange("station")}
          readOnly
        />
      </div>

      <div className="form-row">
        <label htmlFor="timezone">Timezone</label>
        <input
          id="timezone"
          name="timezone"
          value={form.timezone}
          onChange={onChange("timezone")}
          readOnly
        />
      </div>

      <div className="form-row">
        <label htmlFor="pollIntervalSeconds">Poll interval seconds</label>
        <input
          id="pollIntervalSeconds"
          name="pollIntervalSeconds"
          inputMode="numeric"
          value={form.pollIntervalSeconds}
          onChange={onChange("pollIntervalSeconds")}
        />
      </div>

      <div className="form-row">
        <label htmlFor="stalePollSeconds">Stale threshold seconds</label>
        <input
          id="stalePollSeconds"
          name="stalePollSeconds"
          inputMode="numeric"
          value={form.stalePollSeconds}
          onChange={onChange("stalePollSeconds")}
        />
      </div>

      <div className="form-row">
        <label htmlFor="weatherPrimaryUrl">Primary weather endpoint</label>
        <input
          id="weatherPrimaryUrl"
          name="weatherPrimaryUrl"
          value={form.weatherPrimaryUrl}
          onChange={onChange("weatherPrimaryUrl")}
        />
      </div>

      <div className="form-row">
        <label htmlFor="weatherBackupUrl">Backup weather endpoint</label>
        <input
          id="weatherBackupUrl"
          name="weatherBackupUrl"
          value={form.weatherBackupUrl}
          onChange={onChange("weatherBackupUrl")}
        />
      </div>

      <div className="form-row">
        <label htmlFor="tempExtraction">Temp extraction method</label>
        <select
          id="tempExtraction"
          name="tempExtraction"
          value={form.tempExtraction}
          onChange={onChange("tempExtraction")}
        >
          {TEMPERATURE_EXTRACTION_METHODS.map((method) => (
            <option key={method} value={method}>
              {method}
            </option>
          ))}
        </select>
      </div>

      <div className="form-row">
        <label htmlFor="rounding">Rounding method</label>
        <select
          id="rounding"
          name="rounding"
          value={form.rounding}
          onChange={onChange("rounding")}
        >
          {ROUNDING_METHODS.map((method) => (
            <option key={method} value={method}>
              {method}
            </option>
          ))}
        </select>
      </div>

      <div className="actions">
        <button type="submit" disabled={status === "saving"}>
          {status === "saving" ? "Saving..." : "Save settings"}
        </button>
        {status === "saved" && <span className="muted">Saved</span>}
        {status === "error" && <span className="muted">{error}</span>}
      </div>
    </form>
  );
}

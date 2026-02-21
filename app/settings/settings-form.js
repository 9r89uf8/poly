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
      autoCallEnabled: Boolean(settings.autoCallEnabled),
      autoCallShadowMode: Boolean(settings.autoCallShadowMode),
      autoCallMaxPerDay: String(settings.autoCallMaxPerDay),
      autoCallMinSpacingMinutes: String(settings.autoCallMinSpacingMinutes),
      autoCallEvalEveryMinutes: String(settings.autoCallEvalEveryMinutes),
      autoCallPrePeakLeadMinutes: String(settings.autoCallPrePeakLeadMinutes),
      autoCallPrePeakLagMinutes: String(settings.autoCallPrePeakLagMinutes),
      autoCallPeakLeadMinutes: String(settings.autoCallPeakLeadMinutes),
      autoCallPeakLagMinutes: String(settings.autoCallPeakLagMinutes),
      autoCallPostPeakLeadMinutes: String(settings.autoCallPostPeakLeadMinutes),
      autoCallPostPeakLagMinutes: String(settings.autoCallPostPeakLagMinutes),
      autoCallNearMaxThresholdF: String(settings.autoCallNearMaxThresholdF),
    });
  }, [settings]);

  if (settings === undefined || !form) {
    return <p className="muted">Loading settings...</p>;
  }

  const onChange = (field) => (event) => {
    const value = event.target.value;
    setForm((prev) => ({ ...prev, [field]: value }));
  };

  const onToggle = (field) => (event) => {
    const value = Boolean(event.target.checked);
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
        autoCallEnabled: Boolean(form.autoCallEnabled),
        autoCallShadowMode: Boolean(form.autoCallShadowMode),
        autoCallMaxPerDay: toNumber(
          form.autoCallMaxPerDay,
          defaults.autoCallMaxPerDay,
        ),
        autoCallMinSpacingMinutes: toNumber(
          form.autoCallMinSpacingMinutes,
          defaults.autoCallMinSpacingMinutes,
        ),
        autoCallEvalEveryMinutes: toNumber(
          form.autoCallEvalEveryMinutes,
          defaults.autoCallEvalEveryMinutes,
        ),
        autoCallPrePeakLeadMinutes: toNumber(
          form.autoCallPrePeakLeadMinutes,
          defaults.autoCallPrePeakLeadMinutes,
        ),
        autoCallPrePeakLagMinutes: toNumber(
          form.autoCallPrePeakLagMinutes,
          defaults.autoCallPrePeakLagMinutes,
        ),
        autoCallPeakLeadMinutes: toNumber(
          form.autoCallPeakLeadMinutes,
          defaults.autoCallPeakLeadMinutes,
        ),
        autoCallPeakLagMinutes: toNumber(
          form.autoCallPeakLagMinutes,
          defaults.autoCallPeakLagMinutes,
        ),
        autoCallPostPeakLeadMinutes: toNumber(
          form.autoCallPostPeakLeadMinutes,
          defaults.autoCallPostPeakLeadMinutes,
        ),
        autoCallPostPeakLagMinutes: toNumber(
          form.autoCallPostPeakLagMinutes,
          defaults.autoCallPostPeakLagMinutes,
        ),
        autoCallNearMaxThresholdF: toNumber(
          form.autoCallNearMaxThresholdF,
          defaults.autoCallNearMaxThresholdF,
        ),
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

      <div className="form-row">
        <label htmlFor="autoCallEnabled">Forecast auto-call enabled</label>
        <input
          id="autoCallEnabled"
          name="autoCallEnabled"
          type="checkbox"
          checked={form.autoCallEnabled}
          onChange={onToggle("autoCallEnabled")}
        />
      </div>

      <div className="form-row">
        <label htmlFor="autoCallShadowMode">Shadow mode (no outbound calls)</label>
        <input
          id="autoCallShadowMode"
          name="autoCallShadowMode"
          type="checkbox"
          checked={form.autoCallShadowMode}
          onChange={onToggle("autoCallShadowMode")}
        />
      </div>

      <div className="form-row">
        <label htmlFor="autoCallMaxPerDay">Auto-call max per day</label>
        <input
          id="autoCallMaxPerDay"
          name="autoCallMaxPerDay"
          inputMode="numeric"
          value={form.autoCallMaxPerDay}
          onChange={onChange("autoCallMaxPerDay")}
        />
      </div>

      <div className="form-row">
        <label htmlFor="autoCallMinSpacingMinutes">Min spacing (minutes)</label>
        <input
          id="autoCallMinSpacingMinutes"
          name="autoCallMinSpacingMinutes"
          inputMode="numeric"
          value={form.autoCallMinSpacingMinutes}
          onChange={onChange("autoCallMinSpacingMinutes")}
        />
      </div>

      <div className="form-row">
        <label htmlFor="autoCallEvalEveryMinutes">Evaluation cadence (minutes)</label>
        <input
          id="autoCallEvalEveryMinutes"
          name="autoCallEvalEveryMinutes"
          inputMode="numeric"
          value={form.autoCallEvalEveryMinutes}
          onChange={onChange("autoCallEvalEveryMinutes")}
        />
      </div>

      <div className="form-row">
        <label htmlFor="autoCallPrePeakLeadMinutes">Pre-peak lead (minutes)</label>
        <input
          id="autoCallPrePeakLeadMinutes"
          name="autoCallPrePeakLeadMinutes"
          inputMode="numeric"
          value={form.autoCallPrePeakLeadMinutes}
          onChange={onChange("autoCallPrePeakLeadMinutes")}
        />
      </div>

      <div className="form-row">
        <label htmlFor="autoCallPrePeakLagMinutes">Pre-peak lag (minutes)</label>
        <input
          id="autoCallPrePeakLagMinutes"
          name="autoCallPrePeakLagMinutes"
          inputMode="numeric"
          value={form.autoCallPrePeakLagMinutes}
          onChange={onChange("autoCallPrePeakLagMinutes")}
        />
      </div>

      <div className="form-row">
        <label htmlFor="autoCallPeakLeadMinutes">Peak lead (minutes)</label>
        <input
          id="autoCallPeakLeadMinutes"
          name="autoCallPeakLeadMinutes"
          inputMode="numeric"
          value={form.autoCallPeakLeadMinutes}
          onChange={onChange("autoCallPeakLeadMinutes")}
        />
      </div>

      <div className="form-row">
        <label htmlFor="autoCallPeakLagMinutes">Peak lag (minutes)</label>
        <input
          id="autoCallPeakLagMinutes"
          name="autoCallPeakLagMinutes"
          inputMode="numeric"
          value={form.autoCallPeakLagMinutes}
          onChange={onChange("autoCallPeakLagMinutes")}
        />
      </div>

      <div className="form-row">
        <label htmlFor="autoCallPostPeakLeadMinutes">Post-peak lead (minutes)</label>
        <input
          id="autoCallPostPeakLeadMinutes"
          name="autoCallPostPeakLeadMinutes"
          inputMode="numeric"
          value={form.autoCallPostPeakLeadMinutes}
          onChange={onChange("autoCallPostPeakLeadMinutes")}
        />
      </div>

      <div className="form-row">
        <label htmlFor="autoCallPostPeakLagMinutes">Post-peak lag (minutes)</label>
        <input
          id="autoCallPostPeakLagMinutes"
          name="autoCallPostPeakLagMinutes"
          inputMode="numeric"
          value={form.autoCallPostPeakLagMinutes}
          onChange={onChange("autoCallPostPeakLagMinutes")}
        />
      </div>

      <div className="form-row">
        <label htmlFor="autoCallNearMaxThresholdF">Near-max threshold (F)</label>
        <input
          id="autoCallNearMaxThresholdF"
          name="autoCallNearMaxThresholdF"
          inputMode="numeric"
          value={form.autoCallNearMaxThresholdF}
          onChange={onChange("autoCallNearMaxThresholdF")}
        />
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

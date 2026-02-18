You’re not “only 72% right” because of rounding math — you’re **bucketing the IEM observations into the wrong day**.

### Why 72% happens (and why your mismatches are huge)

In `fetchIemRowsForRange()` you explicitly request:

```js
primaryParams.set("tz", "UTC");
```

IEM’s docs say `tz` controls the **output “valid” timestamp** and also how start/end are interpreted when they aren’t tz-aware. They even recommend setting it to UTC. ([Iowa Environmental Mesonet][1])

Then in `parseIemAsosCsv()` you do:

```js
dayKey: dayKeyFromValid(valid) // first 10 chars of "valid"
```

So you are grouping by **UTC calendar date**.

But Weather Underground’s daily history pages are based on the **local station day** (you can see hourly rows labeled like “12:51 AM, 1:51 AM…” i.e., local time). ([Weather Underground][2])

Result: on “front days” / “non‑diurnal days” (the exact trap you identified earlier), the warmest observation can occur in the UTC crossover window and gets credited to the wrong day. That produces the giant deltas you’re seeing (e.g., **21 vs 35**, **55 vs 28**), which are classic “wrong day boundary” symptoms.

---

# Fix (do this first): compute **dayKey in America/Chicago** from each observation timestamp

You have two clean options:

## Option A (recommended): keep `tz=UTC` (as IEM recommends), but convert each `valid` timestamp → Chicago dayKey

This is robust and matches how your live system will work too (METAR is Zulu, you convert to local day).

### 1) Change `parseIemAsosCsv()` to store a parsed UTC timestamp (don’t precompute dayKey there)

**convex/lib/calibration.js**

```js
function parseIemValidUtcMs(valid) {
  if (typeof valid !== "string") return null;
  const t = valid.trim();

  // Handles: "YYYY-MM-DD HH:MM" or "YYYY-MM-DD HH:MM:SS"
  const m = t.match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?/);
  if (!m) return null;

  const year = Number(m[1]);
  const month = Number(m[2]);
  const day = Number(m[3]);
  const hour = Number(m[4]);
  const minute = Number(m[5]);
  const second = m[6] ? Number(m[6]) : 0;

  if (![year, month, day, hour, minute, second].every(Number.isFinite)) return null;
  return Date.UTC(year, month - 1, day, hour, minute, second);
}
```

Then inside your loop where you currently push rows:

```js
const validUtcMs = parseIemValidUtcMs(valid);

rows.push({
  valid: valid || null,
  validUtcMs,          // <— add this
  rawMetar,
  tmpf,
});
```

And **remove** `dayKey: dayKeyFromValid(valid)` (you won’t use it anymore).

### 2) In `runCalibration`, bucket by Chicago dayKey computed from `validUtcMs`

Add a helper in **convex/calibration.js** (or a shared util):

```js
function dayKeyFromUtcMsInTimeZone(utcMs, timeZone) {
  const date = new Date(utcMs);
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);

  const y = parts.find((p) => p.type === "year")?.value;
  const m = parts.find((p) => p.type === "month")?.value;
  const d = parts.find((p) => p.type === "day")?.value;
  if (!y || !m || !d) throw new Error("Failed to compute dayKey in timezone.");
  return `${y}-${m}-${d}`;
}
```

Then replace this block:

```js
for (const row of rows) {
  if (row.dayKey && observationsByDay.has(row.dayKey)) {
    observationsByDay.get(row.dayKey).push({...});
  }
}
```

with:

```js
const timeZone = String(settings.timezone ?? "America/Chicago");

for (const row of rows) {
  if (!row.validUtcMs) continue;

  const localDayKey = dayKeyFromUtcMsInTimeZone(row.validUtcMs, timeZone);
  if (!observationsByDay.has(localDayKey)) continue;

  observationsByDay.get(localDayKey).push({
    valid: row.valid,
    validUtcMs: row.validUtcMs,
    rawMetar: row.rawMetar,
    tmpf: row.tmpf,
  });
}
```

### 3) Fetch enough range to cover the **last local day**

Right now you fetch `endDayKey + 1 day` at `00:00Z`, which truncates the last local day’s final evening hours (00–06Z next day in winter).

Change this:

```js
addDays(endDayKey, 1)
```

to:

```js
addDays(endDayKey, 2)
```

So the call becomes:

```js
const rows = await fetchIemRowsForRange(
  station,
  startDayKey,
  addDays(endDayKey, 2),
);
```

This costs almost nothing and prevents end-of-range “missing the late night” errors.

**After these 3 changes, rerun calibration.**
I expect:

* the **huge** mismatch days vanish,
* match rate jumps materially (often >90%),
* and remaining mismatches are mostly ±1°F.

---

## Option B (simpler, less robust): request IEM with `tz=America/Chicago`

You *can* do:

```js
primaryParams.set("tz", "America/Chicago");
```

and keep `dayKeyFromValid(valid)` as-is.

But IEM explicitly recommends setting `tz` to UTC to avoid surprises and mentions past defaults/bugs around tz handling. ([Iowa Environmental Mesonet][1])
So I’d stick with Option A.

---

# Second fix (do after day-bucketing): handle corrected reports / duplicates (“COR”)

If, after the dayKey fix, you still see days where you’re *higher* than WU by multiple degrees (e.g., **59 vs 55**), the culprit is often one of these:

* an erroneous spike that later got corrected,
* duplicate timestamps where WU effectively uses the corrected/latest value.

Right now you take `Math.max` over *all* reports, so a single bad report can dominate.

### Patch: dedupe by timestamp and prefer COR (or latest)

In `computePredictedHighForMethod()` (convex/lib/calibration.js), before extracting temps:

```js
// Deduplicate by valid timestamp (prefer COR, otherwise keep latest)
const byTime = new Map();

for (const obs of observations) {
  const key = obs.validUtcMs ?? obs.valid;
  if (!key || !obs?.rawMetar) continue;

  const existing = byTime.get(key);
  if (!existing) {
    byTime.set(key, obs);
    continue;
  }

  const existingIsCor = /\bCOR\b/.test(existing.rawMetar);
  const thisIsCor = /\bCOR\b/.test(obs.rawMetar);

  // Prefer COR over non-COR. If same “COR-ness”, keep the later one (current obs).
  if ((thisIsCor && !existingIsCor) || (thisIsCor === existingIsCor)) {
    byTime.set(key, obs);
  }
}

const deduped = [...byTime.values()];
```

Then iterate over `deduped` instead of `observations`.

This single change often cleans up the “predicted too high” outliers.

---

# Third improvement (optional): test using IEM’s decoded `tmpf` directly

You’re downloading `tmpf` but never using it. If WU’s highs track IEM’s decoded temperature better than parsing METAR text, you should test it.

Add two methods:

* `IEM_TMPF__NEAREST`
* `IEM_TMPF__FLOOR` (etc)

And in `computePredictedHighForMethod()`:

* if method is `IEM_TMPF`, use `obs.tmpf` directly (already °F), then round according to rule.

This gives you an extra lever if WU is using a QC’d/decoded stream instead of raw METAR parsing.

---

# Add a “why did this mismatch?” debug output (high ROI)

For each day, log:

* which observation produced your predicted high,
* its `validUtcMs` and `valid` string,
* and the METAR line.

When you rerun after the dayKey fix, you’ll immediately see if remaining mismatches are:

* a correction issue (COR),
* or a true “WU uses different ingest/QC” issue.

---

## TL;DR

**Your calibration is currently comparing WU’s local‑day high vs a UTC‑day max.**
Fix the dayKey bucketing (Option A), extend the fetch window by 1 extra day, and rerun. That should remove the giant errors and push accuracy way above 72%. ([Iowa Environmental Mesonet][1])

[1]: https://mesonet.agron.iastate.edu/cgi-bin/request/asos.py?help= "Iowa Environmental Mesonet"
[2]: https://wu-next-prod.wunderground.com/history/daily/us/il/schiller-park/KILCHICA851/date/2025-1-3?utm_source=chatgpt.com "Chicago, IL Weather History"

export const STATION_CODE = "KORD";
export const CHICAGO_TIMEZONE = "America/Chicago";

export const TEMPERATURE_EXTRACTION_METHODS = [
  "TGROUP_PREFERRED",
  "METAR_INTEGER_C",
];

export const ROUNDING_METHODS = [
  "NEAREST",
  "FLOOR",
  "CEIL",
  "MAX_OF_ROUNDED",
];

export const DEFAULT_SETTINGS = {
  key: "global",
  station: STATION_CODE,
  timezone: CHICAGO_TIMEZONE,
  pollIntervalSeconds: 60,
  stalePollSeconds: 180,
  weatherPrimaryUrl:
    "https://tgftp.nws.noaa.gov/data/observations/metar/stations/KORD.TXT",
  weatherBackupUrl:
    "https://aviationweather.gov/api/data/metar?ids=KORD&format=json",
  tempExtraction: "TGROUP_PREFERRED",
  rounding: "NEAREST",
  autoCallEnabled: false,
  autoCallShadowMode: true,
  autoCallMaxPerDay: 8,
  autoCallMinSpacingMinutes: 20,
  autoCallEvalEveryMinutes: 20,
  autoCallPrePeakLeadMinutes: 90,
  autoCallPrePeakLagMinutes: 30,
  autoCallPeakLeadMinutes: 15,
  autoCallPeakLagMinutes: 45,
  autoCallPostPeakLeadMinutes: 90,
  autoCallPostPeakLagMinutes: 180,
  autoCallNearMaxThresholdF: 1,
  // Day state resets at local midnight in America/Chicago.
  dayResetRule: "MIDNIGHT_AMERICA_CHICAGO",
};

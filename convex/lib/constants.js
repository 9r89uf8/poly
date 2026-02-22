export const STATION_CODE = "KORD";
export const CHICAGO_TIMEZONE = "America/Chicago";

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
  dayResetRule: "MIDNIGHT_AMERICA_CHICAGO",
};

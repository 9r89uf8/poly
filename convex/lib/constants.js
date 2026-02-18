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
  dayResetRule: "MIDNIGHT_AMERICA_CHICAGO",
};

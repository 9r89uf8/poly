import {
  DEFAULT_SETTINGS,
  ROUNDING_METHODS,
  TEMPERATURE_EXTRACTION_METHODS,
} from "./constants";

export { ROUNDING_METHODS, TEMPERATURE_EXTRACTION_METHODS };

export function getDefaultSettings() {
  return {
    ...DEFAULT_SETTINGS,
  };
}

export function normalizeSettings(raw) {
  return {
    ...DEFAULT_SETTINGS,
    ...(raw ?? {}),
  };
}

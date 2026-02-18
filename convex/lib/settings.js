import { DEFAULT_SETTINGS } from "./constants";

export function normalizeSettings(raw) {
  return {
    ...DEFAULT_SETTINGS,
    ...(raw ?? {}),
  };
}

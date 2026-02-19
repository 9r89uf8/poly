/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as airportCalls from "../airportCalls.js";
import type * as calibration from "../calibration.js";
import type * as calls from "../calls.js";
import type * as crons from "../crons.js";
import type * as dashboard from "../dashboard.js";
import type * as http from "../http.js";
import type * as lib_calibration from "../lib/calibration.js";
import type * as lib_constants from "../lib/constants.js";
import type * as lib_freshness from "../lib/freshness.js";
import type * as lib_settings from "../lib/settings.js";
import type * as lib_time from "../lib/time.js";
import type * as lib_weather from "../lib/weather.js";
import type * as polymarket from "../polymarket.js";
import type * as settings from "../settings.js";
import type * as twilioWebhook from "../twilioWebhook.js";
import type * as weather from "../weather.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  airportCalls: typeof airportCalls;
  calibration: typeof calibration;
  calls: typeof calls;
  crons: typeof crons;
  dashboard: typeof dashboard;
  http: typeof http;
  "lib/calibration": typeof lib_calibration;
  "lib/constants": typeof lib_constants;
  "lib/freshness": typeof lib_freshness;
  "lib/settings": typeof lib_settings;
  "lib/time": typeof lib_time;
  "lib/weather": typeof lib_weather;
  polymarket: typeof polymarket;
  settings: typeof settings;
  twilioWebhook: typeof twilioWebhook;
  weather: typeof weather;
}>;

/**
 * A utility for referencing Convex functions in your app's public API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = api.myModule.myFunction;
 * ```
 */
export declare const api: FilterApi<
  typeof fullApi,
  FunctionReference<any, "public">
>;

/**
 * A utility for referencing Convex functions in your app's internal API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = internal.myModule.myFunction;
 * ```
 */
export declare const internal: FilterApi<
  typeof fullApi,
  FunctionReference<any, "internal">
>;

export declare const components: {};

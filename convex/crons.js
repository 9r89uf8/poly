import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";

const crons = cronJobs();

crons.interval(
  "poll_weather_kord",
  { minutes: 1 },
  internal.weather.pollWeatherAndUpdateState,
);

crons.cron(
  "refresh_forecast_kord_at_11am_chicago",
  "0 16,17 * * *",
  internal.forecast.refreshForecastAtChicagoEleven,
);

crons.cron(
  "evaluate_auto_call_need",
  "* * * * *",
  internal.autoCall.evaluateAndMaybeCall,
);

crons.cron(
  "ensure_active_market_for_today",
  "0 7,8 * * *",
  internal.polymarket.ensureActiveMarketForToday,
);

crons.interval(
  "refresh_polymarket_bin_prices",
  { minutes: 5 },
  internal.polymarket.refreshBinPriceSnapshots,
);

export default crons;

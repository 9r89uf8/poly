import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";

const crons = cronJobs();

crons.interval(
  "poll_weather_kord",
  { minutes: 1 },
  internal.weather.pollWeatherAndUpdateState,
);

crons.interval(
  "refresh_forecast_kord",
  { minutes: 60 },
  internal.forecast.refreshForecastSnapshot,
);

crons.interval(
  "evaluate_auto_call_need",
  { minutes: 5 },
  internal.autoCall.evaluateAndMaybeCall,
);

crons.interval(
  "refresh_polymarket_bin_prices",
  { minutes: 5 },
  internal.polymarket.refreshBinPriceSnapshots,
);

export default crons;

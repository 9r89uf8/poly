import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";

const crons = cronJobs();

crons.interval(
  "poll_weather_kord",
  { minutes: 1 },
  internal.weather.pollWeatherAndUpdateState,
);

export default crons;

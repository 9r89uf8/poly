import { httpRouter } from "convex/server";
import { recordingAudioProxy, recordingWebhook } from "./twilioWebhook";
import { dayCsvExport, historyCsvExport } from "./exports";

const http = httpRouter();

http.route({
  path: "/twilio/recording",
  method: "POST",
  handler: recordingWebhook,
});

http.route({
  path: "/twilio/recording-audio",
  method: "GET",
  handler: recordingAudioProxy,
});

http.route({
  path: "/twilio/recording-audio",
  method: "OPTIONS",
  handler: recordingAudioProxy,
});

http.route({
  path: "/exports/history.csv",
  method: "GET",
  handler: historyCsvExport,
});

http.route({
  path: "/exports/day.csv",
  method: "GET",
  handler: dayCsvExport,
});

export default http;

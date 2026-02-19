import { httpRouter } from "convex/server";
import { recordingAudioProxy, recordingWebhook } from "./twilioWebhook";

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

export default http;

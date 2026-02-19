import { httpRouter } from "convex/server";
import { recordingWebhook } from "./twilioWebhook";

const http = httpRouter();

http.route({
  path: "/twilio/recording",
  method: "POST",
  handler: recordingWebhook,
});

export default http;

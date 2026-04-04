import OpenAI from "openai";

// No singleton caching — Cloudflare Workers don't persist module state between requests.
// Ref: https://github.com/cloudflare/workerd/issues/2328
export function getOpenAI(): OpenAI {
  return new OpenAI({ apiKey: process.env.OPENAI_API_KEY! });
}

export const models = {
  get text() {
    return process.env.OPENAI_MODEL_TEXT || "gpt-4.1-mini";
  },
  get vision() {
    return process.env.OPENAI_MODEL_VISION || "gpt-4.1-mini";
  },
  get transcribe() {
    return process.env.OPENAI_MODEL_TRANSCRIBE || "gpt-4o-mini-transcribe";
  },
};

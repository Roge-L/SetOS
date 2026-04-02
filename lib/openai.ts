import OpenAI from "openai";

let _client: OpenAI | null = null;

export function getOpenAI(): OpenAI {
  if (!_client) {
    _client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY! });
  }
  return _client;
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

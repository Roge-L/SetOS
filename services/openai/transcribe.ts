import { getOpenAI, models } from "@/lib/openai";

export async function transcribeAudio(
  audioBuffer: ArrayBuffer,
  filename: string = "voice.ogg"
): Promise<string> {
  const openai = getOpenAI();

  const file = new File([audioBuffer], filename, {
    type: "audio/ogg",
  });

  const response = await openai.audio.transcriptions.create({
    model: models.transcribe,
    file,
  });

  return response.text;
}

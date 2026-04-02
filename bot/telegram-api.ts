import { createAdminClient } from "@/lib/supabase/admin";

const BOT_TOKEN = () => process.env.TELEGRAM_BOT_TOKEN!;

// Download a file from Telegram by file_id
export async function downloadTelegramFile(
  fileId: string
): Promise<ArrayBuffer> {
  // Get file path
  const res = await fetch(
    `https://api.telegram.org/bot${BOT_TOKEN()}/getFile?file_id=${fileId}`
  );
  const data = await res.json();

  if (!data.ok || !data.result?.file_path) {
    throw new Error(`Failed to get Telegram file: ${JSON.stringify(data)}`);
  }

  // Download file
  const fileRes = await fetch(
    `https://api.telegram.org/file/bot${BOT_TOKEN()}/${data.result.file_path}`
  );
  return fileRes.arrayBuffer();
}

// Upload meal image to Supabase storage and return public URL
export async function uploadMealImage(
  userId: string,
  imageBuffer: ArrayBuffer
): Promise<string> {
  const supabase = createAdminClient();
  const filename = `${userId}/${Date.now()}.jpg`;

  const { error } = await supabase.storage
    .from("meal-images")
    .upload(filename, imageBuffer, {
      contentType: "image/jpeg",
      upsert: false,
    });

  if (error) throw new Error(`Failed to upload image: ${error.message}`);

  const {
    data: { publicUrl },
  } = supabase.storage.from("meal-images").getPublicUrl(filename);

  return publicUrl;
}

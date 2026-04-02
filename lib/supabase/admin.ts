import { createClient } from "@supabase/supabase-js";

// Service role client for server-only trusted operations (bot webhook, etc.)
// Never expose this to the browser.
export function createAdminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

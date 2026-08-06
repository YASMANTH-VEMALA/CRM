import { createClient as createSupabaseClient } from "@supabase/supabase-js";

let client: ReturnType<typeof createSupabaseClient> | null = null;

// Bypasses RLS with the service-role key. Only for backend jobs that run
// outside a request's cookie context (e.g. after() callbacks, one-off scripts).
export function createServiceClient() {
  if (!client) {
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!key) throw new Error("SUPABASE_SERVICE_ROLE_KEY is not set.");
    client = createSupabaseClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, key, {
      auth: { persistSession: false },
    });
  }
  return client;
}

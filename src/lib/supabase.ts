import { createClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

if (!url || !anonKey) {
  throw new Error(
    "Missing NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY. Add them to .env.local.",
  );
}

/**
 * Browser Supabase client.
 *
 * RLS is permissive-for-anon by design (docs/engine-spec.md): this is a
 * two-person household app with no login, just a local identity pick. There
 * is no auth session, so session persistence is turned off to keep
 * localStorage clean.
 */
export const supabase = createClient(url, anonKey, {
  auth: {
    persistSession: false,
    autoRefreshToken: false,
  },
  realtime: {
    params: { eventsPerSecond: 5 },
  },
});

import type { SupabaseClient } from "@supabase/supabase-js";

interface UserListsRow {
  give_text: string;
  want_text: string;
}

/**
 * S-02 (restore-saved-lists): the authenticated user's most recent give/want
 * lists (FR-016). One row per user — `public.user_lists` has UNIQUE(user_id),
 * so each save upserts on that conflict, replacing the previous values.
 *
 * Both functions follow the `counterparties.ts` contract: accept a possibly
 * null client (SUPABASE_URL/SUPABASE_KEY unset → null), throw on null or query
 * error, and preserve the Postgres error code via `cause` for classification.
 */
export async function saveUserLists(
  client: SupabaseClient | null,
  userId: string,
  give: string,
  want: string,
): Promise<void> {
  if (!client) {
    throw new Error("user_lists save unavailable: no Supabase client (SUPABASE_URL/SUPABASE_KEY unset)");
  }

  const { error } = await client
    .from("user_lists")
    .upsert(
      { user_id: userId, give_text: give, want_text: want, saved_at: new Date().toISOString() },
      { onConflict: "user_id" },
    );

  if (error) {
    throw new Error(`user_lists save failed: ${error.message}`, { cause: { code: error.code } });
  }
}

/**
 * Reads the user's saved give/want lists. Returns `null` when the user has no
 * saved row yet (a fresh account that has never run the evaluator) — the caller
 * falls back to placeholder text. Throws on a null client or a query error.
 */
export async function getUserLists(
  client: SupabaseClient | null,
  userId: string,
): Promise<{ give: string; want: string } | null> {
  if (!client) {
    throw new Error("user_lists read unavailable: no Supabase client (SUPABASE_URL/SUPABASE_KEY unset)");
  }

  const { data, error } = await client
    .from("user_lists")
    .select("give_text, want_text")
    .eq("user_id", userId)
    .maybeSingle();

  if (error) {
    throw new Error(`user_lists read failed: ${error.message}`, { cause: { code: error.code } });
  }
  if (!data) {
    return null;
  }

  const row: UserListsRow = data;
  return { give: row.give_text, want: row.want_text };
}

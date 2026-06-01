import type { APIRoute } from "astro";
import { createClient } from "@/lib/supabase";
import { categorizeAuthError } from "@/lib/auth-log";
import { safeRedirectPath } from "@/lib/redirect";

export const POST: APIRoute = async (context) => {
  const log = context.locals.log;
  const form = await context.request.formData();
  const email = form.get("email") as string;
  const password = form.get("password") as string;
  // Where to land on success (default `/`). Sanitized to a local path so a
  // crafted `redirect` field can't turn sign-in into an open redirect.
  const redirect = safeRedirectPath(form.get("redirect") as string | null);

  // Keep the redirect target across the error bounce so a failed attempt
  // doesn't lose where the user was headed.
  const bounce = (error: string) =>
    `/auth/signin?error=${encodeURIComponent(error)}&redirect=${encodeURIComponent(redirect)}`;

  const supabase = createClient(context.request.headers, context.cookies);
  if (!supabase) {
    log.error("auth.signin", { outcome: "failure", reason: "not_configured" });
    return context.redirect(bounce("Supabase is not configured"));
  }
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });

  if (error) {
    log.warn("auth.signin", { outcome: "failure", reason: categorizeAuthError(error.message) });
    return context.redirect(bounce(error.message));
  }

  log.child({ user_id: data.user.id }).info("auth.signin", { outcome: "success" });
  return context.redirect(redirect);
};

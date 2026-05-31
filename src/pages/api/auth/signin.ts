import type { APIRoute } from "astro";
import { createClient } from "@/lib/supabase";
import { categorizeAuthError } from "@/lib/auth-log";

export const POST: APIRoute = async (context) => {
  const log = context.locals.log;
  const form = await context.request.formData();
  const email = form.get("email") as string;
  const password = form.get("password") as string;

  const supabase = createClient(context.request.headers, context.cookies);
  if (!supabase) {
    log.error("auth.signin", { outcome: "failure", reason: "not_configured" });
    return context.redirect(`/auth/signin?error=${encodeURIComponent("Supabase is not configured")}`);
  }
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });

  if (error) {
    log.warn("auth.signin", { outcome: "failure", reason: categorizeAuthError(error.message) });
    return context.redirect(`/auth/signin?error=${encodeURIComponent(error.message)}`);
  }

  log.child({ user_id: data.user.id }).info("auth.signin", { outcome: "success" });
  return context.redirect("/");
};

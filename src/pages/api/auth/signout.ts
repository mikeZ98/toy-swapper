import type { APIRoute } from "astro";
import { createClient } from "@/lib/supabase";

export const POST: APIRoute = async (context) => {
  const log = context.locals.log;
  const supabase = createClient(context.request.headers, context.cookies);
  // user_id is already on locals.log from middleware (the session was still
  // present when the request was resolved).
  try {
    if (supabase) {
      await supabase.auth.signOut();
    }
    log.info("auth.signout", { outcome: "success" });
  } catch (err) {
    log.error("auth.signout", { outcome: "failure", error: err });
  }
  return context.redirect("/");
};

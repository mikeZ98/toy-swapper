import type { APIRoute } from "astro";
import { createClient } from "@/lib/supabase";

export const POST: APIRoute = async (context) => {
  const supabase = createClient(context.request.headers, context.cookies);
  if (supabase) {
    await supabase.auth.signOut();
  }
  // user_id is already on locals.log from middleware (the session was still
  // present when the request was resolved).
  context.locals.log.info("auth.signout", { outcome: "success" });
  return context.redirect("/");
};

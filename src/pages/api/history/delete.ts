import type { APIRoute } from "astro";
import { z } from "zod";

import { createClient } from "@/lib/supabase";
import { deleteEvaluation } from "@/lib/evaluation-history";
import { isRlsDenied } from "@/lib/log";

export const prerender = false;

// Submitted as an HTML form post from /history (progressive enhancement, no JS
// island), so the body is form-encoded, not JSON. The id is a gen_random_uuid().
const RequestSchema = z.object({
  id: z.uuid("id must be a valid evaluation id"),
});

export const POST: APIRoute = async ({ request, cookies, locals, redirect }) => {
  const log = locals.log;

  // Gated by middleware (/api/history is in isGated), so locals.user is present;
  // this guard narrows the type and is a defense-in-depth 401.
  if (!locals.user) {
    return new Response(JSON.stringify({ error: "unauthorized" }), {
      status: 401,
      headers: { "content-type": "application/json" },
    });
  }

  const form = await request.formData();
  const parsed = RequestSchema.safeParse({ id: form.get("id") });
  if (!parsed.success) {
    return new Response(JSON.stringify({ error: "validation failed", issues: parsed.error.issues }), {
      status: 400,
      headers: { "content-type": "application/json" },
    });
  }

  try {
    const supabase = createClient(request.headers, cookies);
    await deleteEvaluation(supabase, locals.user.id, parsed.data.id);
    // Log the outcome only — never the contract contents.
    log.info("evaluation_history.delete", { outcome: "success" });
  } catch (err) {
    const event = isRlsDenied(err) ? "db.rls_denied" : "evaluation_history.delete_failed";
    log.error(event, { outcome: "failure", error: err });
    const message = err instanceof Error ? err.message : String(err);
    return new Response(JSON.stringify({ error: "delete failed", message }), {
      status: 500,
      headers: { "content-type": "application/json" },
    });
  }

  // POST/redirect/GET: send the browser back to the refreshed list.
  return redirect("/history", 303);
};

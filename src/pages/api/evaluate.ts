import type { APIRoute } from "astro";
import { z } from "zod";

import { OPENAI_API_KEY, OPENAI_API_BASE, FAIRNESS_THRESHOLD_PCT } from "astro:env/server";
import { evaluate } from "@/lib/evaluator";
import { createClient } from "@/lib/supabase";
import { getCounterpartyPool } from "@/lib/counterparties";
import { saveUserLists } from "@/lib/user-lists";
import { saveEvaluation } from "@/lib/evaluation-history";
import { isRlsDenied } from "@/lib/log";

export const prerender = false;

const RequestSchema = z.object({
  give: z.string().min(1, "give-list cannot be empty"),
  want: z.string().min(1, "want-list cannot be empty"),
  threshold_pct: z.number().min(1).max(99).optional(),
});

export const POST: APIRoute = async ({ request, cookies, locals }) => {
  const log = locals.log;
  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return new Response(JSON.stringify({ error: "invalid JSON body" }), {
      status: 400,
      headers: { "content-type": "application/json" },
    });
  }

  const parsed = RequestSchema.safeParse(payload);
  if (!parsed.success) {
    return new Response(JSON.stringify({ error: "validation failed", issues: parsed.error.issues }), {
      status: 400,
      headers: { "content-type": "application/json" },
    });
  }

  const thresholdPct = parsed.data.threshold_pct ?? FAIRNESS_THRESHOLD_PCT;

  const t0 = Date.now();
  try {
    const supabase = createClient(request.headers, cookies);
    const pool = await getCounterpartyPool(supabase);
    const result = await evaluate(parsed.data.give, parsed.data.want, pool, {
      apiKey: OPENAI_API_KEY,
      baseURL: OPENAI_API_BASE,
      thresholdPct,
      logger: log,
    });
    // Log the outcome only — never the give/want contents.
    log.info("evaluate.success", { outcome: "success", duration_ms: Date.now() - t0 });

    // Persist the user's lists for pre-fill on return (FR-016). Best-effort:
    // a save failure must never hide the evaluation result the user just got.
    // The route is gated, so locals.user is always present here.
    if (locals.user) {
      try {
        await saveUserLists(supabase, locals.user.id, parsed.data.give, parsed.data.want);
      } catch (saveErr) {
        log.warn("user_lists.save_failed", { outcome: "failure", error: saveErr });
      }

      // Persist this evaluation to the user's history (FR-018). Best-effort and
      // independent of the user_lists save — a history failure must not hide the
      // result either. Records every success, including NO MATCH.
      try {
        await saveEvaluation(supabase, locals.user.id, result);
      } catch (saveErr) {
        log.warn("evaluation_history.save_failed", { outcome: "failure", error: saveErr });
      }
    }

    return new Response(JSON.stringify(result), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  } catch (err) {
    const event = isRlsDenied(err) ? "db.rls_denied" : "evaluate.failure";
    log.error(event, { outcome: "failure", duration_ms: Date.now() - t0, error: err });
    const message = err instanceof Error ? err.message : String(err);
    return new Response(JSON.stringify({ error: "evaluator failed", message }), {
      status: 500,
      headers: { "content-type": "application/json" },
    });
  }
};

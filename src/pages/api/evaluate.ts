import type { APIRoute } from "astro";
import { z } from "zod";

import { OPENAI_API_KEY, OPENAI_API_BASE, FAIRNESS_THRESHOLD_PCT } from "astro:env/server";
import { evaluate } from "@/lib/evaluator";
import { createClient } from "@/lib/supabase";
import { getCounterpartyPool } from "@/lib/counterparties";

export const prerender = false;

const RequestSchema = z.object({
  give: z.string().min(1, "give-list cannot be empty"),
  want: z.string().min(1, "want-list cannot be empty"),
  threshold_pct: z.number().min(1).max(99).optional(),
});

export const POST: APIRoute = async ({ request, cookies }) => {
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

  try {
    const supabase = createClient(request.headers, cookies);
    const pool = await getCounterpartyPool(supabase);
    const result = await evaluate(parsed.data.give, parsed.data.want, pool, {
      apiKey: OPENAI_API_KEY,
      baseURL: OPENAI_API_BASE,
      thresholdPct,
    });
    return new Response(JSON.stringify(result), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return new Response(JSON.stringify({ error: "evaluator failed", message }), {
      status: 500,
      headers: { "content-type": "application/json" },
    });
  }
};

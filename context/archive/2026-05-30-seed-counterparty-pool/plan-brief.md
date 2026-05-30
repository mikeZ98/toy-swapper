# Counterparty Pool Migrated to Seeded Table — Plan Brief

> Full plan: `context/changes/seed-counterparty-pool/plan.md`

## What & Why

Move the hardcoded 5-counterparty `FIXTURE_POOL` into a seeded, RLS-protected `public.counterparties` table, flip the evaluator to read it from Postgres, and delete `src/lib/fixture-pool.ts`. This is F-02, the second v2 foundation: it makes the counterparty pool a real data-layer asset (so S-03 history can reference `counterparty_id`) while preserving the v1 determinism guarantee — same inputs → byte-identical Markdown.

## Starting Point

`evaluate()` is pure and DB-free: it imports `FIXTURE_POOL` directly and the API route calls it with no Supabase client. F-01 already shipped the RLS contract, helpers, pgTAP harness, and CI `db` job; `supabase/README.md` even names "F-02's counterparty pool" as the canonical shared read-only RLS deviation. There is no JS test runner yet.

## Desired End State

Counterparties live in a seeded Postgres table (RLS on, anon+authenticated read, no writes); the evaluator fetches the pool via a new `getCounterpartyPool(client)` and takes it as a parameter; `fixture-pool.ts` is gone; and a vitest determinism suite — wired into CI — locks the contract output byte-for-byte for representative inputs. For any `give`/`want`, output is byte-identical to v1.

## Key Decisions Made

| Decision | Choice | Why (1 sentence) | Source |
| --- | --- | --- | --- |
| Seed location | New migration `INSERT` (not `seed.sql`) | `seed.sql` never runs on `db push`; prod needs the rows, and the migration is the PRD determinism boundary | Plan |
| Row ordering | Explicit `sort_order` column, seeded 1..5 in array order | Reproduces v1's stable-sort tie-breaking → byte-identical output | Plan |
| Determinism test | Add **vitest** + golden fixtures + equivalence assertion | Durable regression gate the roadmap risk demands; stub path runs pure in CI without a DB | Plan |
| DB read failure | Throw → API 500 | The pool is required infra; an empty/failed read is an outage, not a "no match" | Plan |
| Pool seam | Inject `pool` param into `evaluate()` | Clean seam for the equivalence test; keeps the evaluator pure | Plan |
| `id` type | Text slug PK (not uuid) | The slug is embedded verbatim in contract output | Plan |
| NO-MATCH copy | "fixture pool" line kept verbatim | Rewording would break byte-identical determinism for NO-MATCH inputs | Plan |

## Scope

**In scope:** counterparties table + seed migration + shared-read RLS + pgTAP; `counterparties.ts` data-access; evaluator pool injection; API wiring; vitest + determinism fixtures; delete `fixture-pool.ts`; CI test step.

**Out of scope:** auth gating (S-01); any change to matching/valuation/fairness/rendering logic or output copy; per-user counterparty authorship (OQ-6); generated `Database<T>` types; `seed.sql`-based seeding.

## Architecture / Approach

`public.counterparties` (slug PK, `sort_order`, name/give/want) seeded by a migration → `getCounterpartyPool(client)` selects ordered by `sort_order` and throws on failure → API route builds the anon SSR client, fetches the pool, passes it into `evaluate(give, want, pool, opts)`. Determinism is fenced three ways: seed fidelity (byte-level copy), row order (`sort_order`), and untouched output copy — proven by a vitest golden-snapshot suite (pure stub path) plus a pgTAP test tying the DB rows to the same golden fixture.

## Phases at a Glance

| Phase | What it delivers | Key risk |
| --- | --- | --- |
| 1. Table + seed + RLS + pgTAP | Data layer only; `fixture-pool.ts` still live | Seed drift from the v1 array (diacritics/spacing) |
| 2. Gated read flip | `counterparties.ts`, evaluator pool param, API wiring, vitest equivalence | Row order / tie-breaking changing output bytes |
| 3. Delete + CI lock | Remove module, keep golden test, wire vitest into CI | Losing the equivalence anchor once the module is gone |

**Prerequisites:** F-01 (done — archived). Local DB verified via docker-exec `psql` (Colima forward caveat from F-01); CLI paths ride CI.
**Estimated effort:** ~2–3 sessions across 3 phases.

## Open Risks & Assumptions

- Byte-identical determinism is the load-bearing property; mitigated by `sort_order`, verbatim seed, untouched copy, and a vitest gate run before deletion.
- Adding vitest is the repo's first test runner; CI gains a `npm test` step (pure, no DB).
- The evaluator becomes hard-dependent on a reachable DB; local dev now requires `.dev.vars` against the local stack (documented).

## Success Criteria (Summary)

- For any `give`/`want`, the contract Markdown is byte-identical to v1 (vitest golden snapshots green).
- The 5 seeded rows match `fixture-pool.ts` byte-for-byte and are anon-readable, write-denied (pgTAP green).
- `FIXTURE_POOL` is fully removed; `npm test` runs in CI; the migration applies in prod via `db push`.

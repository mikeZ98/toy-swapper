# Restore Saved Lists — Plan Brief

> Full plan: `context/changes/restore-saved-lists/plan.md`

## What & Why

When a signed-in user returns to the evaluator, their last give-list and want-list should already be in the textareas — no re-typing required. This is US-04 / FR-016 from the v2 PRD: persistence that makes the session feel continuous rather than amnesia-prone.

## Starting Point

Today the evaluator is fully gated (S-01 is on `master`), but there is no `user_lists` table and the textareas always reset to hardcoded Polish sample text on every page load. Evaluated lists are computed and returned but never persisted.

## Desired End State

A returning user sees their last-evaluated give and want strings pre-filled in the textareas the moment the page loads. A first-time user (no prior evaluation) still sees the sample text. A different account never sees another account's lists. Clear clears the current session only — the saved row persists until the next successful evaluation overwrites it.

## Key Decisions Made

| Decision | Choice | Why (1 sentence) | Source |
|---|---|---|---|
| Save point (OQ-4) | On successful evaluation only | Fewest DB writes; saved state always corresponds to a contract the user actually saw | Plan |
| Save failure handling | Log silently, still return result | Evaluation is the primary product; a DB hiccup must never hide the contract | Plan |
| Pre-fill interaction | Saved lists replace sample text | Sample text is a placeholder; returning users should see their own context | Plan |
| Pre-fill failure | Silent fallback to sample text + log | Evaluator must never break over a list-load failure | Plan |
| Clear button | Clears form only, not DB | No write needed; save model is eval-triggered only | Plan |
| Table shape | Single upsert row per user, `UNIQUE(user_id)` | FR-016 says "most recent" — one row per user, replaced on each save | Plan |
| Test coverage | pgTAP cross-user isolation + vitest service unit | DB proof for RLS, unit proof for service logic | Plan |

## Scope

**In scope:** `public.user_lists` migration + four RLS policies, `src/lib/user-lists.ts` service (save + load), evaluate-route wiring (silent save after success), `index.astro` SSR pre-fill, pgTAP and vitest tests.

**Out of scope:** Evaluation history (S-03 — separate table, separate change), debounced/keystroke saves, user-visible save status, delete-on-clear, admin or multi-account list management.

## Architecture / Approach

The feature lives entirely in the server path — no client-side JS changes. On POST `/api/evaluate` success, `saveUserLists()` upserts a single row to `public.user_lists` (inside a silent try/catch so failures never block the result). On GET `/`, the `index.astro` frontmatter calls `getUserLists()` and injects the values as textarea defaults before the HTML is sent. RLS ensures each user reads and writes only their own row.

## Phases at a Glance

| Phase | What it delivers | Key risk |
|---|---|---|
| 1. DB migration + pgTAP | `public.user_lists` table, RLS, cross-user isolation proof | Migration timestamp collision with other in-flight work |
| 2. Service + API wiring | Save after eval, `user-lists.ts` service, vitest tests | Silent-save must not swallow the response on error |
| 3. SSR pre-fill | Textareas pre-filled for returning users | Supabase client availability in `.astro` frontmatter |

**Prerequisites:** F-01 (RLS baseline + helpers) ✅, S-01 (auth gate — every page visitor is authenticated) ✅  
**Estimated effort:** ~1-2 sessions across 3 phases

## Open Risks & Assumptions

- Cloudflare Workers edge runtime: `new Date().toISOString()` for `saved_at` is accurate; no clock-skew concern at this scale.
- `Astro.cookies` is accessible in `.astro` page frontmatter (same as in API routes); confirmed by existing auth page patterns.

## Success Criteria (Summary)

- `npm test` and `npm run db:test` pass; `npm run build` and `npm run lint` green.
- Returning user sees their last-entered lists pre-filled without any page interaction.
- A second account never sees the first account's saved lists (verified via Supabase Studio and pgTAP).

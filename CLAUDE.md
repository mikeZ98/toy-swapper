# Rules for AI

This file provides guidance to AI Agent when working with code in this repository.

## ToySwapper — project context (read first)

ToySwapper v1 shipped as a 1-week in-memory MVP and is live in production. v2 (PRD updated 2026-05-28) extends v1 with Supabase auth, RLS-scoped persistence for give/want lists, and per-account evaluation history. The product is locked in @context/foundation/prd.md; the stack is locked in @context/foundation/tech-stack.md; the sequencing is in @context/foundation/roadmap.md. Re-read those before any non-trivial change.

### PRD-locked rules (do not violate)

- **No realtime, no images, no multi-party chains, no real OLX/Vinted scraping** (PRD § Non-Goals — still load-bearing). v2 lifted the v1 "no database, no auth" rules on 2026-05-28; persistence and gating ARE now in scope.
- **RLS is the data-layer contract.** Every user-scoped Postgres table enables Row-Level Security with explicit per-operation, per-role policies (no `using (true)` without an audit comment). The shape and helpers live in @supabase/README.md and @supabase/migrations/20260529120000_rls_baseline.sql; downstream migrations follow the four-policy template. The service-role key is never used from the SSR client.
- **Determinism is binding.** Same `give-list` + `want-list` + same fixture pool must produce byte-identical Markdown output on re-run. Any LLM call runs at `temperature: 0` with a fixed seed, OR is wrapped in a cache keyed on the input, OR falls back to rule-based parsing (PRD § Success Criteria → Guardrails). The v1→v2 determinism guarantee also extends to seeded counterparty data and to persisted historical contracts (PRD §NFR).
- **Migrations are immutable.** Once a `supabase/migrations/<timestamp>_*.sql` filename lands on master, it is never edited — fixes ship as new timestamped migrations. This is the determinism boundary.
- **No silent item drops.** Every input item from both sides must either appear in the contract OR be listed in a `## Couldn't classify` appendix with a one-line reason per item (FR-004).
- **Fairness threshold is relative**, not absolute: verdict `FAIR` when `delta ≤ X% of max(side_A_total, side_B_total)`, otherwise `NEEDS BALANCING`. X is configurable; default set during implementation (FR-009 was explicitly revised away from an absolute threshold — do not reintroduce one).
- **Bilingual (PL + EN), mixed-language inputs are valid.** Output Markdown must be CommonMark only — no inline HTML, no extension syntax, no required external assets. End-to-end response time ≤ 5s for a fixture pool of ≤ 10 counterparties.
- **Match criterion is bidirectional:** a counterparty matches only if its give-list contains at least one item the operator wants AND its want-list contains at least one item the operator gives. Single-direction overlaps do not match (US-01 Given).
- **Single counterparty per run.** Selection criterion: best fairness score, then most items matched (FR-008). No ranked candidate lists in v1 or v2.

### Where the work lives

- `src/lib/fixture-pool.ts` — the hardcoded counterparties (v1 source-of-truth; removed by F-02 when the seeded counterparty table ships).
- `src/lib/evaluator.ts` — the standardize → value → match → fairness → Markdown pipeline.
- `src/pages/api/evaluate.ts` — Vercel AI SDK endpoint (POST). Reads `OPENAI_API_KEY` from `astro:env/server`; falls back to a deterministic stub when the key is absent.
- `src/pages/index.astro` — the give-list/want-list form and contract output area.
- `src/lib/supabase.ts`, `src/middleware.ts`, `src/pages/auth/*`, `src/pages/api/auth/*` — Supabase SSR auth. Wired but not yet gating `/` or `/api/evaluate` — S-01 (gated-evaluator) closes that gap.
- `supabase/migrations/` — schema migrations. Read @supabase/README.md before adding a table.

---

## Commands

- `npm run dev` — start dev server (Cloudflare workerd runtime)
- `npm run build` — production build (SSR via `@astrojs/cloudflare`)
- `npm run preview` — preview production build
- `npm run lint` — ESLint with type-checked rules
- `npm run lint:fix` — auto-fix lint issues
- `npm run format` — Prettier (includes prettier-plugin-astro + prettier-plugin-tailwindcss)

Pre-commit hooks: husky + lint-staged runs `eslint --fix` on `*.{ts,tsx,astro}` and `prettier --write` on `*.{json,css,md}`.

## Architecture

**Astro 6 SSR app** with React 19 islands, Tailwind 4, Supabase auth, and shadcn/ui components. Deployed to Cloudflare Workers.

### Rendering mode

Full server-side rendering (`output: "server"` in astro.config.mjs). All pages are server-rendered by default. API routes must export `const prerender = false`.

### Auth flow

- `src/lib/supabase.ts` — creates a Supabase SSR client using `@supabase/ssr` with cookie-based sessions. Uses `astro:env/server` for `SUPABASE_URL` and `SUPABASE_KEY` (server-only secrets declared in astro.config.mjs `env.schema`).
- `src/middleware.ts` — runs on every request, resolves the current user, attaches to `context.locals.user`. Redirects unauthenticated users away from routes listed in `PROTECTED_ROUTES`.
- API endpoints: `src/pages/api/auth/{signin,signup,signout}.ts`
- Auth pages: `src/pages/auth/{signin,signup,confirm-email}.astro`
- Protected page example: `src/pages/dashboard.astro`

### Key conventions

- **Path alias**: `@/*` maps to `./src/*` (tsconfig paths).
- **Astro components** for static content/layout; **React components** only when interactivity is needed.
- **Tailwind class merging**: use the `cn()` helper from `@/lib/utils` (clsx + tailwind-merge) for conditional/merged class names. Do not concatenate class strings manually.
- **shadcn/ui**: components live in `src/components/ui/`, "new-york" style variant. Install new ones with `npx shadcn@latest add [name]`.
- **API routes**: use uppercase `GET`, `POST` exports; validate input with zod.
- **Supabase migrations**: `supabase/migrations/` using naming format `YYYYMMDDHHmmss_short_description.sql`. Always enable RLS on new tables with granular per-operation, per-role policies.
- **React**: no Next.js directives ("use client" etc.). Extract hooks to `src/components/hooks/`.
- **Services/helpers** go in `src/lib/` (or `src/lib/services/` for extracted business logic).
- **Shared types** (entities, DTOs) go in `src/types.ts`.

### Environment

- Node.js v22.14.0 (see `.nvmrc`)
- Env vars: `SUPABASE_URL`, `SUPABASE_KEY` (copy `.env.example` to `.env` for Node, or `.dev.vars` for Cloudflare local dev)
- Local Supabase: `npx supabase start` (requires Docker)
- Cloudflare local dev: secrets go in `.dev.vars` (gitignored)
- Deploy: `npx wrangler deploy` (requires Cloudflare account + `wrangler` auth)

## CI

GitHub Actions workflow (`.github/workflows/ci.yml`) runs lint + build on every push and PR to master. Requires `SUPABASE_URL` and `SUPABASE_KEY` repository secrets for the build step.

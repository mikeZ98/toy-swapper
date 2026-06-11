# Conventions — shared core for ToySwapper

> Canonical, single source of truth for ToySwapper's repo-wide rules and conventions.
> Referenced by `CLAUDE.md` (auto-imported), `AGENTS.md` (pointer), and the nested
> folder context files (`src/lib/CLAUDE.md`, `src/pages/api/CLAUDE.md`).
> Folder-specific guidance lives in those nested files; the data-layer contract lives in
> `supabase/README.md`. This file holds only what is global.

ToySwapper is an Astro 6 + React 19 + Cloudflare-Workers app that turns two parents' freeform
give/want lists into a Markdown barter contract with an LLM-estimated fairness verdict. v1
shipped as an in-memory MVP and is live; v2 (PRD updated 2026-05-28) adds Supabase auth,
RLS-scoped persistence, and per-account history. The locked product is in
@context/foundation/prd.md; the stack in @context/foundation/tech-stack.md; the sequencing in
@context/foundation/roadmap.md. Re-read those before any non-trivial change.

## PRD-locked rules (do not violate)

- **No realtime, no images, no multi-party chains, no real OLX/Vinted scraping** (PRD § Non-Goals — still load-bearing). v2 lifted the v1 "no database, no auth" rules on 2026-05-28; persistence and gating ARE now in scope.
- **RLS is the data-layer contract.** Every user-scoped Postgres table enables Row-Level Security with explicit per-operation, per-role policies (no `using (true)` without an audit comment). The shape, helpers, and four-policy template live in @supabase/README.md. The service-role key is never used from the SSR client.
- **Determinism is binding.** Same give-list + want-list + same fixture pool must produce byte-identical Markdown output on re-run. Any LLM call runs at `temperature: 0` with a fixed seed, OR is wrapped in a cache keyed on the input, OR falls back to rule-based parsing (PRD § Success Criteria → Guardrails). The v1→v2 determinism guarantee also extends to seeded counterparty data (FR-017 — seeded rows are byte-identical to the v1 `FIXTURE_POOL`) and to persisted historical contracts (FR-018 — stored Markdown stays byte-identical to its original output even after the fixture pool is edited).
- **Migrations are immutable.** Once a `supabase/migrations/<timestamp>_*.sql` filename lands on master, it is never edited — fixes ship as new timestamped migrations. This is the determinism boundary.
- **No silent item drops.** Every input item from both sides must either appear in the contract OR be listed in a `## Couldn't classify` appendix with a one-line reason per item (FR-004).
- **Fairness threshold is relative**, not absolute: verdict `FAIR` when `delta ≤ X% of max(side_A_total, side_B_total)`, otherwise `NEEDS BALANCING`. X is configurable (FR-009); the v1 implementation defaulted to 20% via `FAIRNESS_THRESHOLD_PCT` (PRD OQ-3, provisional). FR-009 was explicitly revised away from an absolute threshold — do not reintroduce one.
- **Match criterion is bidirectional:** a counterparty matches only if its give-list contains at least one item the operator wants AND its want-list contains at least one item the operator gives. Single-direction overlaps do not match (US-01 Given).
- **Single counterparty per run.** Selection criterion: best fairness score, then most items matched (FR-008). No ranked candidate lists in v1 or v2.
- **Bilingual (PL + EN), mixed-language inputs are valid.** Output Markdown must be CommonMark only — no inline HTML, no extension syntax, no required external assets. End-to-end response time ≤ 5s for a fixture pool of ≤ 10 counterparties.

## Commands

- `npm run dev` — Astro dev server on `http://localhost:4321` (Cloudflare workerd runtime).
- `npm run build` — production build (SSR via `@astrojs/cloudflare`).
- `npm run preview` — preview the production build.
- `npm run lint` / `npm run lint:fix` — ESLint with type-checked rules.
- `npm run format` — Prettier (includes prettier-plugin-astro + prettier-plugin-tailwindcss).

Pre-commit: husky + lint-staged runs `eslint --fix` on `*.{ts,tsx,astro}` and `prettier --write` on `*.{json,css,md}`.

## Repo-wide conventions

- **Rendering:** full SSR (`output: "server"` in `astro.config.mjs`); all pages server-rendered by default. API routes must `export const prerender = false`.
- **API routes:** use uppercase `GET` / `POST` exports; validate input with zod. (Folder contract: `src/pages/api/CLAUDE.md`.)
- **Path alias:** `@/*` maps to `./src/*` (tsconfig paths).
- **Shared types** (entities, DTOs) go in `src/types.ts`.
- **Services/helpers** go in `src/lib/` (or `src/lib/services/` once extracted business logic warrants it). (Folder contract: `src/lib/CLAUDE.md`.)
- **shadcn/ui:** components live in `src/components/ui/`, "new-york" style variant. Install new ones with `npx shadcn@latest add <name>`.
- **Tailwind class merging:** use the `cn()` helper from `@/lib/utils` (clsx + tailwind-merge). Do not concatenate class strings manually.
- **Astro vs React:** Astro components for static content/layout; React components only when interactivity is needed. No Next.js directives (`"use client"` etc.). Extract hooks to `src/components/hooks/`.

## Environment

- Node.js v22.14.0 (see `.nvmrc`).
- Env vars: `SUPABASE_URL`, `SUPABASE_KEY` (server-only secrets declared in `astro.config.mjs` `env.schema`). The LLM endpoint reads `OPENAI_API_KEY` via `astro:env/server`; absent the key, the evaluator falls back to a deterministic stub (per the determinism rule). Do not log raw user input/output in production paths.
- Local dev: copy `.env.example` to `.env` (Node) or `.dev.vars` (Cloudflare local dev, gitignored).
- Local Supabase: `npx supabase start` (requires Docker). See @supabase/README.md for the full data-layer workflow.
- Deploy: `npx wrangler deploy` (requires Cloudflare account + `wrangler` auth). v1 is live at `https://toy-swapper.mz-apps.workers.dev`.

## CI

GitHub Actions (`.github/workflows/ci.yml`) runs two parallel jobs on every push and PR to `master`:

- **`ci`** — `lint + build`; needs `SUPABASE_URL` / `SUPABASE_KEY` repository secrets.
- **`db`** — boots local Postgres, runs `supabase db lint` + `supabase test db`. Every new migration file MUST follow @supabase/README.md and ship with a pgTAP test under `supabase/tests/`.

Merge to `master` runs `supabase db push` against prod (needs `SUPABASE_PROJECT_REF` / `SUPABASE_ACCESS_TOKEN` / `SUPABASE_DB_PASSWORD` secrets — see `supabase/README.md` "CI"). Commit style: prefer Conventional Commits.

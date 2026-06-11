# Repository Guidelines

ToySwapper is an Astro 6 + React 19 + Cloudflare-Workers app that turns two parents' freeform give/want lists into a Markdown barter contract with an LLM-estimated fairness verdict. v1 shipped as an in-memory MVP and is live; v2 (PRD updated 2026-05-28) adds Supabase auth, RLS-scoped persistence, and per-account history. See @context/foundation/prd.md, @context/foundation/tech-stack.md, and @context/foundation/roadmap.md for the locked product, stack, and sequencing decisions.

## Shared rules & conventions

The repo-wide rules are maintained in one canonical file — **read it first and treat it as authoritative**:

- **`context/foundation/conventions.md`** — PRD-locked invariants (determinism, RLS, immutable migrations, no silent item drops, relative fairness threshold, bidirectional match, CommonMark output), build/test/dev commands, project-structure conventions, environment, and CI.

## Folder-level context

Read the file for the area you are working in:

- **`src/lib/CLAUDE.md`** — services, helpers, the evaluator pipeline, and a module map.
- **`src/pages/api/CLAUDE.md`** — the API route contract (uppercase exports, `prerender = false`, zod validation, auth gating, structured logging) and route map.
- **`supabase/README.md`** — the data-layer / RLS contract, helper functions, and the four-policy table template. Read before authoring any migration.
- **`CLAUDE.md`** (repo root) — the auth-flow architecture map spanning middleware, the SSR client, and the auth pages/endpoints.

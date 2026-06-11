# Rules for AI

This file provides guidance to AI Agent when working with code in this repository.

## ToySwapper — project context (read first)

ToySwapper v1 shipped as a 1-week in-memory MVP and is live in production. v2 (PRD updated 2026-05-28) extends v1 with Supabase auth, RLS-scoped persistence for give/want lists, and per-account evaluation history. The product is locked in @context/foundation/prd.md; the stack is locked in @context/foundation/tech-stack.md; the sequencing is in @context/foundation/roadmap.md. Re-read those before any non-trivial change.

The shared, repo-wide rules — PRD-locked invariants, commands, conventions, environment, and CI — live in the canonical conventions file. It is the single source of truth; read it first:

@context/foundation/conventions.md

Folder-level context (read when working in that area):

- `src/lib/CLAUDE.md` — services, helpers, the evaluator pipeline, module map.
- `src/pages/api/CLAUDE.md` — API route contract and route map.
- `supabase/README.md` — the data-layer / RLS contract.

## Architecture & auth flow

**Astro 6 SSR app** with React 19 islands, Tailwind 4, Supabase auth, and shadcn/ui components, deployed to Cloudflare Workers. (Rendering mode and conventions: see `context/foundation/conventions.md`.) The auth wiring spans several folders, so it is mapped here rather than in a single folder file:

- `src/lib/supabase.ts` — Supabase SSR client (`@supabase/ssr`, cookie-based sessions); reads `SUPABASE_URL` / `SUPABASE_KEY` via `astro:env/server`.
- `src/middleware.ts` — runs on every request, resolves the current user onto `context.locals.user`, and redirects unauthenticated users away from routes in `PROTECTED_ROUTES`.
- API endpoints: `src/pages/api/auth/{signin,signup,signout}.ts` (contract: `src/pages/api/CLAUDE.md`).
- Auth pages: `src/pages/auth/{signin,signup,confirm-email}.astro`.
- Protected page example: `src/pages/dashboard.astro`.

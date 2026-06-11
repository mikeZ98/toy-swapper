# Artifact 2 — Structural Discovery (import graph, cycles, coupling)

> Module 4 · Lesson 2: Project Mapping
> Generated: 2026-06-11 · Repo: ToySwapper · Branch: master
> Method: hand-rolled static import-graph analysis (no dependency added) parsing
> `import`/`export … from`/`import()` across `.ts`/`.tsx`/`.astro`, resolving the
> `@/` alias → `src/` and relative paths. Cycles via DFS gray/black coloring.

## Scope notes (why this shape)

- **Target is `src/` only.** `supabase/` holds **no JS/TS** — 4 SQL migrations, 4 pgTAP
  `.sql` tests, and `config.toml`. An import-graph tool has nothing to crawl there; the
  Supabase _integration boundary_ is a `src/` concern and is analyzed from that side below.
- **dependency-cruiser was not used** — it isn't installed, and it does not parse `.astro`
  frontmatter imports without a plugin, which would have silently dropped `index.astro`
  (the #2 hot file) and every other page. The hand-rolled pass covers `.astro` uniformly.
- **External specifiers** (`astro:*` virtual modules, npm packages) are excluded from the
  internal graph but tracked for the Supabase boundary section.

## Headline

| Metric                        | Value                            |
| ----------------------------- | -------------------------------- |
| Internal nodes (files)        | 36                               |
| Internal edges                | 55                               |
| **Circular dependencies**     | **0 — the graph is a clean DAG** |
| Entry points (fan-in 0)       | 14                               |
| Orphan components (dead code) | 2                                |

## 1. Circular dependencies

**None.** A full DFS found zero back-edges; `src/` is an acyclic dependency graph. A
`no-circular` rule would pass with no violations. This is the healthiest possible result for
this check and means no module-init ordering hazards exist today.

## 2. Compilation centers (fan-in / most depended-upon)

The modules whose change ripples furthest. Fan-in = number of internal files importing it.

| Fan-in | Module                        | Role                        | Note                                                                        |
| ------ | ----------------------------- | --------------------------- | --------------------------------------------------------------------------- |
| 7      | `src/lib/supabase.ts`         | SSR Supabase client wrapper | **Keystone.** Internally a pure leaf (fan-out 0) — ideal stable dependency. |
| 6      | `src/layouts/Layout.astro`    | Page shell                  | Every page wraps in it; presentational keystone.                            |
| 4      | `src/lib/log.ts`              | Structured logger           | Cross-cutting; expected high fan-in.                                        |
| 4      | `src/lib/utils.ts`            | `cn()` + helpers            | Cross-cutting UI util.                                                      |
| 4      | `src/types.ts`                | Shared types                | **Pure sink** (fan-out 0) — correct per the `types.ts` convention.          |
| 3      | `src/components/Topbar.astro` | Nav                         | Shared chrome.                                                              |
| 3      | `src/lib/redirect.ts`         | Post-sign-in redirect       | Shared by middleware + auth routes.                                         |

**Read:** the two real "centers of gravity" are `lib/supabase.ts` (data/auth keystone) and
`Layout.astro` (presentation keystone). Both are stable dependencies (high fan-in, low/zero
fan-out), which is exactly where you want your churn-sensitive code to sit.

## 3. Entry points (fan-in 0 — graph roots)

All 14 roots are SSR pages, API routes, the middleware, or ambient/dead files — no
application module is an accidental root. This matches an Astro SSR app precisely (pages and
routes are invoked by the framework, not imported).

| Category                 | Entry points                                                                                                            |
| ------------------------ | ----------------------------------------------------------------------------------------------------------------------- |
| Pages (`.astro`)         | `index.astro`, `history.astro`, `dashboard.astro`, `auth/signin.astro`, `auth/signup.astro`, `auth/confirm-email.astro` |
| API routes               | `api/evaluate.ts`, `api/auth/{signin,signup,signout}.ts`                                                                |
| Framework hook           | `middleware.ts`                                                                                                         |
| Ambient                  | `env.d.ts`                                                                                                              |
| **Orphans (unexpected)** | `components/Welcome.astro`, `components/ui/LibBadge.astro`                                                              |

## 4. Tight coupling / fan-out (most-coupling modules)

Fan-out = number of internal modules a file imports. High fan-out = a hub that breaks if any
dependency shifts.

| Fan-out | Module                                                | What it pulls                                                            |
| ------- | ----------------------------------------------------- | ------------------------------------------------------------------------ |
| 7       | `src/pages/index.astro`                               | Layout, Topbar, button, skeleton, utils, supabase, user-lists            |
| **6**   | **`src/pages/api/evaluate.ts`**                       | evaluator, supabase, counterparties, user-lists, evaluation-history, log |
| 5       | `src/pages/history.astro`                             | Layout, Topbar, supabase, evaluation-history, types                      |
| 4       | `SignInForm.tsx` / `SignUpForm.tsx`                   | FormField, PasswordToggle, SubmitButton, ServerError                     |
| 3       | `Layout.astro`, `middleware.ts`, `api/auth/signin.ts` | —                                                                        |

### Core-service fan-out matrix (`src/lib/*` → internal targets)

The data/business layer is **loosely coupled** — every lib service depends only on `types.ts`
and/or `log.ts`; none depends on another domain service.

| Service                                                 | → types.ts | → log.ts | → other lib | External SDK  |
| ------------------------------------------------------- | :--------: | :------: | ----------- | ------------- |
| `evaluator.ts`                                          |     ✓      |    ✓     | —           | —             |
| `counterparties.ts`                                     |     ✓      |    —     | —           | `@supabase/*` |
| `evaluation-history.ts`                                 |     ✓      |    —     | —           | `@supabase/*` |
| `user-lists.ts`                                         |     —      |    —     | —           | `@supabase/*` |
| `supabase.ts`                                           |     —      |    —     | —           | `@supabase/*` |
| `auth-log.ts`                                           |     —      |    —     | —           | —             |
| `log.ts`, `redirect.ts`, `config-status.ts`, `utils.ts` |     —      |    —     | —           | —             |

**Read:** coupling is concentrated at the **`evaluate.ts` API endpoint** (fan-out 6), which
orchestrates five lib services. This is the structural twin of Territory Artifact 1's hot-path
finding — `evaluate.ts` is both high-churn and high-coupling, so it's the highest-blast-radius
file in the codebase. The lib layer beneath it stays flat and independent.

## 5. Layer boundary verification

| Boundary                                            | Verdict            | Evidence                                                                                                                                           |
| --------------------------------------------------- | ------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| `lib` never imports "up" (pages/components/layouts) | ✅ clean           | grep for upward imports in `src/lib` → none.                                                                                                       |
| `types.ts` is a pure sink                           | ✅                 | fan-in 4, fan-out 0.                                                                                                                               |
| Direction of flow                                   | ✅ layered         | pages/api → lib → types/log; no reverse edges.                                                                                                     |
| Supabase client funnel                              | ✅ mostly funneled | routes/pages obtain the client only via `@/lib/supabase` (wrapper); lib data helpers receive a client and import `@supabase/*` for **types** only. |

### Supabase integration boundary

| Reaches Supabase via                      | Files                                                                                                                         |
| ----------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| `@/lib/supabase` wrapper (correct funnel) | `middleware.ts`, `api/evaluate.ts`, `api/auth/{signin,signup,signout}.ts`, `index.astro`, `history.astro`                     |
| `@supabase/*` SDK directly                | `lib/supabase.ts` (the wrapper itself), `lib/counterparties.ts`, `lib/evaluation-history.ts`, `lib/user-lists.ts`, `env.d.ts` |

The client **constructor** is funneled through one module; the direct `@supabase/*` imports in
the three data helpers are type-level (they operate on a passed-in client). The PRD rule
"service-role key never used from the SSR client" is an import-invisible runtime concern — not
contradicted by the graph, but **not provable from imports alone** (flagged in risks).

## Aggregated structural risks

| #   | Risk                                   | Severity           | Detail                                                                                                                                                                                                                                                                     |
| --- | -------------------------------------- | ------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| R1  | **`evaluate.ts` coupling hub**         | Medium             | Fan-out 6, orchestrates evaluator + 3 persistence helpers + supabase + log. Highest blast radius; also the hottest code file (Artifact 1). Any signature change here fans out widely. Mitigation: keep orchestration thin, push logic into the (independent) lib services. |
| R2  | **2 orphan components (dead code)**    | Low                | `components/Welcome.astro` (imports Topbar, imported by nobody — the `dashboard.astro` "Welcome," is plain text) and `components/ui/LibBadge.astro` (fully isolated, May-21 starter leftover). Safe to delete; they inflate the surface and mislead readers.               |
| R3  | **`lib/supabase.ts` keystone**         | Low (by design)    | Fan-in 7 — a change ripples to middleware, all auth routes, evaluate, and 2 pages. Acceptable because it's a stable leaf (fan-out 0), but it is the single highest-impact module.                                                                                          |
| R4  | **SDK type-imports spread across lib** | Low                | `@supabase/*` is imported directly by 3 data helpers (for types). Not a layering violation, but it means the SDK is a cross-cutting lib dependency rather than re-exported from one place. Optional: re-export needed types from `lib/supabase.ts`.                        |
| R5  | **`env.d.ts` → `lib/log.ts` edge**     | Low                | An ambient declaration file importing a runtime module is unusual; worth confirming it's an intentional type augmentation and not an accidental value import.                                                                                                              |
| —   | RLS / service-role-key boundary        | n/a (out of graph) | Import analysis cannot see runtime key usage; verify via `supabase/README.md` + pgTAP, not this artifact.                                                                                                                                                                  |

## Overall verdict

Structurally **healthy**: acyclic, layered top-down, with two clear and appropriate keystones
(`lib/supabase.ts`, `Layout.astro`) and an independent, loosely-coupled service layer. The one
thing to watch is `evaluate.ts` as a coupling+churn hot spot; the one easy win is deleting the
two orphan components.

## Reproduction

A throwaway Node analyzer (`.tmp-import-graph.mjs`, not committed) produced this. Core logic:
walk `src/` for `.ts/.tsx/.astro`; extract specifiers via
`/(?:import|export)[\s\S]*?from\s*["']([^"']+)["']/g` (+ bare and dynamic-import variants);
resolve `@/`→`src/` and relative paths against extensions `[.ts,.tsx,.astro,/index.*]`;
build the edge map; DFS for cycles; tally fan-in/fan-out. SVG generation intentionally
deferred per the lesson plan — tabular data secured first.

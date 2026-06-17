---
title: "10xArchitect Certification Report — ToySwapper"
author: "Michał Zasiadczuk (architect) with Claude (agent)"
module: "Module 4 — Working with Legacy & Large Codebases (L2–L5)"
date: 2026-06-17
constraint: "Two-pager. No production code modified across any lesson."
---

# 10xArchitect Certification Report — ToySwapper

## 1. Described project

**ToySwapper** — an Astro 6 SSR app (React 19 islands, Tailwind 4, shadcn/ui) on Cloudflare
Workers that turns two parents' freeform give/want toy lists into a deterministic CommonMark barter
contract with an LLM-estimated fairness verdict, gated behind Supabase auth with RLS-scoped
persistence. **Scale:** 36 source files, 55 internal import edges, **0 cycles**, **0 layer
breaches**; data layer = 4 SQL migrations + 4 pgTAP tests; **bus factor 1** (one human maintainer,
AI-paired). v1 shipped as a 1-week in-memory MVP (live); v2 (PRD 2026-05-28) added auth +
persistence + history. **Lessons applied:** L2 Repo Map · L3 Feature Deep-Focus · L4 Refactor
Opportunities · L5 Domain Modeling (DDD). Env for all four: Colima + local Supabase on an external
SSD, `edge_runtime`/`vector`/`logflare` excluded — re-verified GREEN each lesson.

## 2. Repository Map findings (L2)

- **Strictly layered, genuinely loose.** pages/API → `src/lib` services → `src/types.ts`; 0 import
  cycles, 0 layer breaches (verified by DFS + grep). The repo's problems are **not** tangling.
- **Two keystones:** `supabase.ts` (data/auth client, fan-in 7) and `Layout.astro` (page shell,
  fan-in 6) — one edit ripples widely.
- **Single hottest file:** `src/pages/api/evaluate.ts` — top churn **and** top fan-out (6). Risk
  zone Z1.
- **Risk zones:** Z1 evaluate pipeline · Z2 supabase keystone · Z3 RLS contract (SQL-only,
  import-invisible) · Z4 determinism boundary · Z5 bus-factor-1 · Z6 dead components (`Welcome.astro`,
  `ui/LibBadge.astro`, fan-in 0).
- **Unknowns:** runtime SQL/RLS edges, `astro:env` virtual modules, and Workers bindings are
  invisible to the static import graph; `supabase/` correctness is pgTAP's job, not the map's.

## 3. Feature Deep-Focus analysis (L3)

Traced the core action end-to-end: `POST /api/evaluate` → middleware auth gate (401 if anon) →
JSON+zod validation → load counterparty pool → `evaluate()` engine
(**standardize → value → match → fairness → render**) → best-effort persist (lists + history) →
200 Markdown. **Three processing strategies:** LLM (`gpt-4o-mini`, `temperature:0`, `seed:42`),
deterministic stub, and LLM-failed-fallback. **Technical debt verified:** the engine
(`evaluator.ts`) and handler co-change 100% on the engine side; `EvaluateResponse` shape is a
high-blast-radius contract (engine→history→`/history`). **Correction to the L3 archive:** the
LLM/fallback path is _no longer untested_ — `test/evaluator-llm.test.ts` (147 lines, 4 cases) now
covers `source:"llm"`, the `temperature:0/seed:42` assertion, FR-004 no-drop, and the fallback
branch. Determinism is pinned by a golden snapshot (`determinism.test.ts.snap`).

## 4. Refactoring plan overview (L4)

**Verified hotspots** (ast-grep 0.43.0 ⇄ grep ⇄ git, all cross-checked): `evaluator.ts` holds
**16 function declarations across 7 responsibilities in 416 lines** — and git proved it was **born
at 409 lines / 16 functions** in the v2 baseline commit, i.e. the v1 MVP engine ported whole
(**accidental complexity inherited**, not a deliberate constraint). The **pricing catalog is
duplicated**: 16 structured `base_pln` entries _and_ the identical prices re-typed as prose in the
LLM prompt (line 129) — invisible to the type-checker.

**Selected, ranked, with target archetypes:**

1. **Catalog → single source of truth** (Transaction Script's inline data → **Table Module**). Lowest
   cost, highest protection; do first.
2. **Split the evaluator god-module** (**Transaction Script** → modular Transaction Script trending
   to a thin **Domain Model**; fan-in 1, snapshot-guarded).
3. **Extract persistence from the handler** (mixed-concern script → **clean Transaction Script** +
   `persistEvaluation` service).

**What we are explicitly NOT doing:** no full Domain Model with rich entity graphs (over-engineering
at this scale); no change to the public `evaluate()` signature; no migration edits (immutable); no
production code touched in any lesson; byte-identical output is the non-negotiable success gate.

## 5. Domain modeling via DDD (L5)

**Ubiquitous-language mismatches:** the **Pricing Catalog has no name and no home** → it drifted
into duplication (the L4/C2 defect is, at root, a _missing-language_ failure); **one pool, three
names** (fixture/counterparty/valuation); the **Operator is anonymous** (a bare `userId: string`
across 4 call sites); `ProcessedList` is **anemic**; the `Source` union is defined twice.
**Subdomains:** Core = the standardize→match→fairness pipeline; Supporting = catalog + persistence;
Generic = auth, Markdown mechanics, LLM SDK.

**Invariant #1 — "No silent item drops" (FR-004):** highest-value, least-enforced _structurally_ —
enforced today by two uncoordinated procedures plus a prompt sentence, with nothing in the type
system tying `items ∪ unclassified` back to the input. **Guardian:** a `ListValuation` aggregate
whose sole factory `fromSegments(...)` makes conservation true _by construction_, with domain errors
(`ItemConservationError`) and value objects (`Pln`, `CategorySlug`); the persisted `Evaluation`
aggregate gets an **insert-only repository port** to make historical immutability (FR-018) structural.

**ACL boundary isolation:** the Generic LLM SDK leaks into Core — `ai`/`@ai-sdk/openai` appear in
**1 file** (evaluator.ts:1-2) and `SupabaseClient` in **3** data helpers. Blueprint: a domain
`ListProcessor` **port** with `OpenAiListProcessor` / `StubListProcessor` / `FallbackListProcessor`
**adapters** (the only SDK importers), foreign LLM shapes mapped to domain at the seam, and Supabase
**repository ports**. **Zero-leak gate:** `grep -rnE 'from "(ai|@ai-sdk/openai)"' src/` outside the
adapter allow-list must return 0 (baseline today: fails by 2 + 3).

## 6. Decisions that belong to me

I owned the **judgment calls**; the agent owned **enumeration and verification**. I ranked the
catalog single-source fix _above_ the larger god-module split, because it defends the PRD-locked
determinism invariant at the lowest cost and de-risks everything downstream — the agent surfaced
both but did not weight them. I deliberately **capped the target archetype short of a full Domain
Model**: for a bus-factor-1 MVP, a modular Transaction Script plus one aggregate guardian is the
honest altitude, and a rich object graph would be resume-driven over-engineering. I chose **INV-1
("no silent drops") over the strictly-less-enforced INV-3 (pricing single-source)** as the aggregate
blueprint, because INV-1 yields a clean guardian while INV-3 is properly a Table-Module/ACL concern —
a sequencing decision, not a correctness one. Finally, I accepted the agent's ACL design but **scoped
the Supabase repository ports as a follow-on** rather than first-wave work, since the 🔴 LLM-into-Core
leak is the only one that touches the determinism-critical path. The agent's discipline I relied on:
every structural claim was run twice (ast-grep + grep) and against git history before I trusted it.

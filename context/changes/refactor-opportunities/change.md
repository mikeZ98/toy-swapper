---
change_id: refactor-opportunities
title: Rank structural refactoring opportunities with environment pre-check
status: new
created: 2026-06-17
updated: 2026-06-17
archived_at: null
---

## Notes

Exploration and ranking of structural refactoring opportunities with environment pre-check.

Goal: extract structural problems into concrete refactoring opportunities, verify them
against git history, and produce a ranking based on architectural archetypes (Transaction
Script / Table Module / Domain Model).

Protocol:

- STEP 0 — environment & isolation sanity check (Colima on external SSD, local Supabase
  healthy with edge_runtime/vector/logflare excluded, no `~/.colima` / `~/.ollama` host-drive
  shadows). Completed green on 2026-06-17 (✅ Colima + Supabase; ⚠️ pre-existing 140K
  `~/.ollama` unrelated to this stack).
- Step 1 — read `context/map/repo-map.md` + archived findings
  `context/archive/2026-06-11-evaluate-flow-analysis/research.md`.
- Step 2 — enumerate structural bottlenecks; classify CANDIDATE (needs restructuring) vs
  INPUT (test/doc gap). Per candidate: current shape (file:line + EVIDENCE/INFERENCE/UNKNOWN),
  history & intentionality (git log -L → deliberate constraint vs accidental complexity),
  migration feasibility (blast radius, test safety nets, characterization-test protocol).
- Step 3 — semantic verification with ast-grep (fall back to grep on zero matches).
- Step 4 — synthesize into `research.md` ending with a ranked "Refactor opportunities"
  section mapping Current → Target Archetype.

Constraint: exploration only — do NOT write or modify production code.

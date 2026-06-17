---
change_id: domain-modeling
title: Strategic domain distillation and invariant identification via DDD
status: archived
created: 2026-06-17
updated: 2026-06-17
archived_at: 2026-06-17T20:30:03Z
---

## Notes

Strategic domain distillation and invariant identification via DDD (Module 4 · Lesson 5 —
Modernizing Legacy with DDD). Act as a DDD specialist to extract the Ubiquitous Language,
uncover business invariants, map an Anti-Corruption Layer (ACL) for external SDK dependencies,
and synthesize a final certification report.

- STEP 0 — env & isolation re-check (Colima on SSD, Supabase healthy, edge_runtime/vector/
  logflare excluded) + recall `context/map/repo-map.md` and the archived refactor analysis.
- STEP 1 — Ubiquitous Language matrix → `context/domain/01-domain-distillation.md`
  (concept · definition · code location · EVIDENCE/INFERENCE/UNKNOWN; Core/Supporting/Generic).
- STEP 2 — business invariants + Aggregate-Root guardian blueprint →
  `context/domain/02-invariant-aggregate-refactor.md`.
- STEP 3 — Anti-Corruption Layer (Port/Adapter, Value Object, zero-leak grep rule) →
  `context/domain/03-anti-corruption-layer.md`.
- STEP 4 — two-pager 10xArchitect certification report → `context/architect-report.md`
  (synthesises L2 repo-map, L3 feature research, L4 refactor-opportunities, L5 domain notes).

Constraint: exploration/design only — do NOT write or modify production code.
Builds on archived analyses: `context/archive/2026-06-11-evaluate-flow-analysis/` and
`context/archive/2026-06-17-refactor-opportunities/`.

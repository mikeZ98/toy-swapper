---
change_id: postgres-rls-baseline
roadmap_id: F-01
title: Postgres + RLS baseline
status: archived
created: 2026-05-29
updated: 2026-05-30
archived_at: 2026-05-30T20:26:47Z
prd_refs:
  - NFR (RLS: per-operation, per-role policies, no `using (true)` bypass)
  - FR-016
  - FR-018
  - §Access Control
unlocks:
  - F-02 (seed-counterparty-pool)
  - S-02 (restore-saved-lists)
  - S-03 (evaluation-history)
---

# Postgres + RLS baseline

Foundation change for ToySwapper v2: makes Postgres reachable from the Cloudflare Workers runtime, ships `supabase/migrations/` with the first migration (cross-cutting RLS helpers + policy template — no app tables), proves the RLS contract with an automated pgTAP test, and wires migrations into the CI/CD pipeline.

- Plan brief: `plan-brief.md`
- Full plan: `plan.md`
- Roadmap entry: `context/foundation/roadmap.md#f-01-postgres--rls-baseline`

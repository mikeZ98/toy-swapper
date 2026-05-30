---
change_id: seed-counterparty-pool
roadmap_id: F-02
title: Counterparty pool migrated to seeded table
status: archived
created: 2026-05-30
updated: 2026-05-30
archived_at: 2026-05-30T21:25:03Z
prd_refs:
  - FR-007
  - FR-017
  - NFR (determinism preserved across v1→v2; seeded-counterparty migrations are determinism boundaries)
prerequisites:
  - F-01 (postgres-rls-baseline) — done
unlocks:
  - S-03 (evaluation-history)
---

# Counterparty pool migrated to seeded table

Second foundation change for ToySwapper v2: move the hardcoded `FIXTURE_POOL`
(`src/lib/fixture-pool.ts`) into a seeded, RLS-protected `public.counterparties`
table, flip the evaluator to read counterparties from Postgres, and delete the
module — all while preserving v1 determinism byte-identically, gated by a
regression test.

- Plan brief: `plan-brief.md`
- Full plan: `plan.md`
- Roadmap entry: `context/foundation/roadmap.md#f-02-counterparty-pool-migrated-to-seeded-table`

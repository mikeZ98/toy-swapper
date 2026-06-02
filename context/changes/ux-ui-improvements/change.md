---
change_id: ux-ui-improvements
title: Polish the evaluator UI — consistent Tailwind v4 styling, loading states, refined layout
status: implementing
created: 2026-06-02
updated: 2026-06-02
archived_at: null
---

## Notes

S-06 from @context/foundation/roadmap.md. Presentational slice only — no changes to the evaluate or persistence code paths.

Outcome: polished evaluator UI with consistent Tailwind v4 styling across the give/want form and contract output, explicit loading states while an evaluation is in flight, and refined page layout/spacing. Prereq F-01 (done); runs in parallel with S-07. Scope strictly to presentational changes; use the `cn()` helper plus existing shadcn/ui primitives rather than hand-rolled class strings.

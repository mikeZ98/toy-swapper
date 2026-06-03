# UX/UI Improvements — Evaluator Polish (S-06) — Plan Brief

> Full plan: `context/changes/ux-ui-improvements/plan.md`

## What & Why

The evaluator at `/` works but looks unfinished and visually disconnected from the rest of the app: it's a light playful theme while the auth pages are dark, its styling is hand-rolled inline Tailwind (against the project's `cn()` + shadcn convention), and it gives almost no feedback while an evaluation runs. S-06 polishes the evaluator into a finished, consistent presentation — without touching any evaluate, persistence, or auth logic.

## Starting Point

Everything lives in `src/pages/index.astro`: a light-gradient shell with a hand-rolled email/signout bar, a glass form card with two textareas, and an inline `<script>` that POSTs to `/api/evaluate` and renders the contract. The shadcn `Button`, the `cn()` helper, a dark `bg-cosmic` utility, and a dark `Topbar.astro` all already exist but go unused on this page. Loading feedback today is just a disabled button + an "Evaluating…" text line.

## Desired End State

The evaluator renders on the same dark `bg-cosmic` theme as the auth views, with the shared Topbar (email + Dashboard + Sign out) at the top. Submitting shows an inline button spinner + disabled styling and a skeleton placeholder in the result area; when the response lands, the skeleton is replaced by the contract, with verdict/source/delta pills and the Markdown all legible on the dark surface. `npm run lint` and `npm run build` pass; evaluate/persistence/auth behavior is unchanged.

## Key Decisions Made

| Decision | Choice | Why (1 sentence) | Source |
| --- | --- | --- | --- |
| Visual consistency direction | Adopt the dark `bg-cosmic` theme to match auth | One unified look across the whole app today | Plan |
| Loading-state mechanism | Keep the inline `<script>`; toggle classes/markup | Smallest diff, honors "no functional change" to the evaluate flow | Plan |
| Loading UX | Spinner-in-button + skeleton result card | Best perceived performance, mirrors the existing `SubmitButton` pattern | Plan |
| Top bar | Replace hand-rolled bar with `<Topbar />` | Removes duplicated chrome; already dark-themed, single source of truth | Plan |
| Component extraction | Add shadcn `Skeleton`; keep pills/result inline | One reusable primitive where it pays off, minimal churn | Plan |
| Verification & scope freeze | Lint+build + manual visual check; freeze evaluate/auth | Right gate for a no-logic-change visual slice; protects parallel S-07 | Plan |

## Scope

**In scope:**
- Re-skin `src/pages/index.astro` onto `bg-cosmic` (background, hero, form card, spacing).
- Swap the inline top bar for `Topbar.astro`.
- Route real buttons through shadcn `Button` / `buttonVariants` + `cn()`.
- Add shadcn `Skeleton`; spinner-in-button + skeleton result card via inline-script UI toggles.
- Restyle script-driven pills + contract `<pre>` for dark legibility.

**Out of scope:**
- Any edit to `/api/evaluate`, `src/lib/evaluator.ts`, persistence (`user-lists.ts`), or the page frontmatter.
- Any edit to `/auth/*` (owned by parallel slice S-07).
- Converting the evaluator to a React island; new validation/behavior; automated visual/Playwright tests.

## Architecture / Approach

Single-surface change to `index.astro`, in two passes. Pass 1 restyles static markup (theme, layout, shared Topbar, shadcn buttons) — verifiable by eye with zero behavior change. Pass 2 layers dynamic states onto the existing inline script: it adds UI-toggle lines around the *unchanged* `fetch` (show spinner + skeleton, then restore + render) and recolors the script's pill/contract class strings for the dark theme. The fetch/response logic stays byte-for-byte identical, preserving determinism and the evaluate contract.

## Phases at a Glance

| Phase | What it delivers | Key risk |
| --- | --- | --- |
| 1. Dark re-skin, layout & Topbar | Evaluator on dark theme, shared Topbar, shadcn buttons | Re-skinning a working page can regress layout/contrast |
| 2. Loading & result states | Skeleton primitive, button spinner, dark-legible pills/contract | Inline-script edits must not alter fetch/response logic |

**Prerequisites:** F-01 (done). Parallel with S-07 — do not touch `/auth/*`.
**Estimated effort:** ~1 session across 2 phases.

## Open Risks & Assumptions

- Dark-theme contrast: verdict pills move from light `*-100/*-800` pairings to translucent dark-friendly ones; the contract Markdown must stay readable — caught by the manual visual check, not the build.
- shadcn `Button`/`Skeleton` are React components in an Astro page; the plan permits the sanctioned fallback of a native element styled via `cn(buttonVariants(...))` to avoid adding a hydration island purely for styling.
- No automated visual regression exists, so correctness of the look rests on the manual checkpoint at each phase.

## Success Criteria (Summary)

- The evaluator looks consistent with the auth views (dark cosmic) and uses the shared Topbar.
- Evaluation shows a clear in-flight state (button spinner + skeleton) and a legible result on the dark theme.
- `npm run lint` + `npm run build` pass; evaluate, persistence, and auth behavior are unchanged.

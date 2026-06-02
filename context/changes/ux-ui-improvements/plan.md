# UX/UI Improvements — Evaluator Polish (S-06) Implementation Plan

## Overview

Polish the ToySwapper evaluator UI so it presents as a finished product: re-skin the page onto the dark `bg-cosmic` theme already used by the auth views (one consistent app-wide look), replace the page's hand-rolled top bar with the shared `Topbar.astro` component, route real buttons through the shadcn `Button` + `cn()` conventions, and add explicit loading states — a spinner-in-button and a shadcn `Skeleton` result card — while an evaluation is in flight.

This is a **presentational slice only**. The evaluate flow (`src/pages/api/evaluate.ts`, `src/lib/evaluator.ts`), the persistence flow (`src/lib/user-lists.ts`), and the auth views (`src/pages/auth/*`, owned by the parallel slice S-07) are frozen. The inline `<script>` in `index.astro` keeps its fetch/response logic byte-for-byte; only UI-toggle lines and class strings change.

## Current State Analysis

The evaluator is a single Astro page, `src/pages/index.astro`, with three parts:

- **Astro frontmatter** (lines 1–26): resolves `Astro.locals.user`, best-effort-loads the user's saved give/want lists via `getUserLists`, falls back to sample text. **Frozen — no changes.**
- **Markup** (lines 28–151): a light-themed shell — `bg-gradient-to-tr from-pink-50 via-indigo-50 to-amber-50` with three blurred color blobs, a hand-rolled email/signout bar, an "AI Engine Active" pill, a gradient `<h1>`, a glass form card with two textareas + submit + clear, and a hidden result `<section>` with verdict/source/delta pills and a `<pre>` contract.
- **Inline `<script is:inline>`** (lines 153–245): wires submit → `fetch("/api/evaluate")` → render. Loading state today is minimal: `runBtn.disabled = true` + a `setStatus("Evaluating…")` text line. No spinner, no disabled styling, no result placeholder.

Key constraints discovered:

- **Styling is all hand-rolled inline Tailwind.** The shadcn `Button` (`src/components/ui/button.tsx`) and the `cn()` helper (`src/lib/utils.ts`) exist but are unused on this page. CLAUDE.md § Key conventions mandates `cn()` + shadcn primitives over concatenated class strings.
- **The app is visually split.** Auth pages (`src/pages/auth/signin.astro:11`) use `bg-cosmic` (defined in `src/styles/global.css:113` as a dark vertical gradient) with `bg-white/10` glass + `backdrop-blur-xl`. The evaluator uses a light theme. S-06's outcome is "consistent Tailwind v4 styling."
- **`Topbar.astro` already exists and is dark-themed** (`src/components/Topbar.astro`) — `bg-white/5`, `text-white/80`, blue/purple links, with signed-in (email + Dashboard + Sign out) and signed-out branches. It drops straight into a dark theme; the evaluator currently duplicates a worse version of it inline.
- **The established loading pattern** is `src/components/auth/SubmitButton.tsx:20-24`: an inline `<span class="size-4 animate-spin rounded-full border-2 border-white/30 border-t-white" />` spinner beside pending text. We mirror this look in the inline script (this page is not React, so we can't reuse the component directly).
- **shadcn is configured** ("new-york" variant, `src/components/ui/`). New primitives install with `npx shadcn@latest add skeleton`.

## Desired End State

A signed-in user visiting `/` sees the evaluator on the same dark cosmic theme as the auth pages, with a shared top bar (email + Dashboard + Sign out). Submitting an evaluation disables the submit button and shows an inline spinner with Polish pending text; the result area immediately reveals a skeleton placeholder that is replaced by the real contract + verdict/source/delta pills when the response arrives. The contract Markdown and all pills are legible against the dark background. `npm run lint` and `npm run build` pass; the evaluate/persistence/auth behavior is unchanged.

### Key Discoveries:

- Inline script lifecycle to hook: `form` submit handler at `src/pages/index.astro:186` (show spinner + skeleton before `fetch`, hide skeleton on success/error in the existing `try/finally`).
- Pill class strings to restyle live in the script, not just markup: `PILL_BASE` (`index.astro:166`), `renderVerdict` (`:173`), and the `sourcePill`/`deltaPill` className assignments (`:216`, `:218`). These are presentational strings — editing them is in scope; the values they display (`json.verdict`, `json.source`, `json.delta_pln`) are not touched.
- `Topbar.astro` renders its own `<form action="/api/auth/signout">`, so swapping it in preserves the existing sign-out affordance (no functional regression).
- `bg-cosmic` is a custom `@utility` in `global.css:113` — already available as a class, no new CSS needed.

## What We're NOT Doing

- **No edits to the evaluate code path:** `src/pages/api/evaluate.ts`, `src/lib/evaluator.ts`, `src/lib/counterparties.ts`. The byte-identical-output determinism guarantee is untouched.
- **No edits to the persistence path:** `src/lib/user-lists.ts` and the `index.astro` frontmatter that calls `getUserLists`.
- **No edits to the auth views** `src/pages/auth/*` or auth components — that surface belongs to the parallel slice S-07 (`auth-frontend-views`). We reuse `Topbar.astro` but do not modify it (unless a dark-theme tweak is strictly required; see Phase 1).
- **No framework conversion** of the evaluator to a React island — the inline script stays; only UI-toggle lines are added.
- **No new behavior:** no validation changes, no new request fields, no analytics, no automated visual-regression/Playwright harness (none exists; introducing one is its own slice).
- **No light/dark toggle** — we commit to the dark cosmic theme to match auth.

## Implementation Approach

Two phases, each ending in a manual visual checkpoint. Phase 1 is a pure restyle of static markup (theme, layout, shared Topbar, shadcn Button) — verifiable by eye with no behavior change. Phase 2 layers the dynamic loading/result states onto the inline script and restyles the script-driven pills + contract block for dark legibility. Throughout, prefer `cn()` + existing shadcn primitives over hand-rolled class strings, and keep the fetch/response logic in the inline script identical.

## Critical Implementation Details

- **Inline-script edit boundary.** In `index.astro`'s `<script>`, the only permitted changes are: (a) class-string values for pills/status, and (b) added lines that toggle the spinner/disabled state and show/hide the skeleton around the *existing* `fetch`. The `fetch` call, request body, status-code handling (`401` redirect), JSON parsing, and the `json.*` field reads must remain unchanged. Keep the existing `try/finally` so `runBtn` is always re-enabled.
- **Dark-theme contrast.** Verdict pills currently use `*-100/*-800` (light-bg) pairings. On `bg-cosmic` switch to translucent dark-friendly pairings (e.g. `bg-emerald-500/15 text-emerald-200`, amber/rose/indigo/slate equivalents) so they read on the dark card. The contract `<pre>` moves from `bg-slate-50/80` to a dark surface (e.g. `bg-white/5` + light text) — the Markdown must stay readable (it is plain CommonMark text).

## Phase 1: Dark Re-skin, Layout & Shared Topbar

### Overview

Restyle the static shell of `index.astro` onto `bg-cosmic`, replace the hand-rolled email/signout row with `<Topbar />`, and convert the real buttons to the shadcn `Button` + `cn()` convention. No script/behavior change in this phase.

### Changes Required:

#### 1. Page shell + background

**File**: `src/pages/index.astro` (markup, lines ~28–46)

**Intent**: Move the outer wrapper from the light tri-color gradient to the app's dark `bg-cosmic` theme so the evaluator matches the auth views. Re-tune or recolor the decorative blur blobs (or drop them) so they read on a dark background instead of fighting it.

**Contract**: Root wrapper uses the `bg-cosmic` utility (from `global.css:113`) with `min-h-screen`. Decorative blobs, if kept, use dark-appropriate hues/opacity. The `<main>` container keeps `max-w-3xl` and its padding rhythm.

#### 2. Top bar → shared component

**File**: `src/pages/index.astro` (markup, lines ~47–57)

**Intent**: Delete the bespoke email + "Wyloguj" signout row and render the shared `Topbar.astro` instead, removing duplicated chrome and gaining the Dashboard link.

**Contract**: `import Topbar from "@/components/Topbar.astro"` in the frontmatter; render `<Topbar />` at the top of `<main>`. Topbar reads `Astro.locals.user` itself — no props. The existing sign-out form is preserved by Topbar's own `<form action="/api/auth/signout">`.

#### 3. Hero, status pill & form card re-skin

**File**: `src/pages/index.astro` (markup, lines ~59–125)

**Intent**: Restyle the "AI Engine Active" pill, the gradient `<h1>`, the lede paragraph, the glass form card, the two textareas, and the clear/status row for the dark theme — using the auth pages' glass idiom (`bg-white/10`/`bg-white/5` + `border-white/10` + `backdrop-blur-xl`) so contrast and spacing are consistent. Regularize radii and spacing.

**Contract**: Card and inputs use translucent-on-dark surfaces with light text (`text-white`/`text-blue-100/*`), readable placeholders, and visible focus rings. Textarea `id`/`name` (`give`, `want`), `rows`, and the `{initialGive}`/`{initialWant}` bindings are unchanged (SSR pre-fill contract preserved). Spacing follows a consistent scale (e.g. `space-y-6`, card padding) rather than ad-hoc values.

#### 4. Buttons via shadcn `Button` + `cn()`

**File**: `src/pages/index.astro` (submit button ~110–116, clear/copy buttons)

**Intent**: Replace hand-rolled `<button class="...">` strings for the primary submit and the secondary clear/copy actions with the shadcn `Button` component (appropriate `variant`/`size`), merging any bespoke classes through `cn()` per the CLAUDE.md convention.

**Contract**: Buttons keep their existing `id`s (`run-btn`, `clear-btn`, `copy-btn`) and `type` attributes so the inline script's `getElementById` wiring still resolves. `Button` is a React component used in an Astro file — render it with the appropriate client/static strategy (static render is fine; these are styled buttons driven by the existing vanilla script, so no `client:*` directive is needed — confirm the shadcn `Button` renders server-side without hydration, otherwise keep a styled native `<button>` carrying `buttonVariants({...})` via `cn()`). Whichever path, the `id`s and DOM shape the script depends on are preserved.

> Note for implementer: the inline `<script>` selects these buttons by `id` and toggles `disabled`. If rendering shadcn `Button` SSR-only is awkward, the sanctioned fallback is a native `<button>` whose `class` is `cn(buttonVariants({ variant, size }), "…overrides")` — this still satisfies "use `cn()` + shadcn primitives" without introducing hydration. Pick the simpler of the two; do not add a React island just for styling.

### Success Criteria:

#### Automated Verification:

- Linting passes: `npm run lint`
- Production build succeeds: `npm run build`

#### Manual Verification:

- The evaluator renders on the dark `bg-cosmic` theme, visually consistent with `/auth/signin`.
- The shared Topbar shows the user's email, a Dashboard link, and a working Sign out.
- Hero, form card, textareas, and buttons are legible with good contrast; focus states are visible.
- The give/want textareas are still pre-filled with saved lists (or sample text) on load — no regression in SSR pre-fill.

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase.

---

## Phase 2: Loading & Result States

### Overview

Add the shadcn `Skeleton` primitive, wire a spinner + disabled styling into the submit button during evaluation, reveal a skeleton placeholder in the result area while the request is in flight, and restyle the script-driven verdict/source/delta pills and the contract `<pre>` for dark-theme legibility.

### Changes Required:

#### 1. Install the Skeleton primitive

**File**: `src/components/ui/skeleton.tsx` (new, via CLI)

**Intent**: Add shadcn's `Skeleton` component to provide the loading placeholder, satisfying the "use shadcn primitives" convention rather than hand-rolling.

**Contract**: Run `npx shadcn@latest add skeleton`. Produces `src/components/ui/skeleton.tsx` (a `div` with `animate-pulse rounded-md bg-accent` styled via `cn()`). No other files change.

#### 2. Result-area skeleton placeholder

**File**: `src/pages/index.astro` (result `<section>` markup ~127–149)

**Intent**: Add a skeleton layout inside the result card that mirrors the contract's shape (a row of pill placeholders + several text-line bars), shown while evaluating and hidden once the real contract renders. Restyle the result card itself for the dark theme.

**Contract**: A skeleton block (using `Skeleton`, or native `div`s carrying the skeleton classes via `cn()` if SSR-only rendering is cleaner) lives alongside the existing pill row + `<pre id="contract-md">`, toggled via a stable `id`/`hidden` attribute the script controls. The result `<section>` retains `id="result"` and its `hidden` initial state. Card surface moves to dark glass.

#### 3. Spinner + disabled styling on submit

**File**: `src/pages/index.astro` (`<script>` submit handler ~186–227)

**Intent**: While the request is in flight, swap the submit button's label for an inline spinner + Polish pending text (e.g. "Sprawdzam…") mirroring `SubmitButton.tsx`, apply disabled styling, reveal the result section showing the skeleton, then restore the button and replace the skeleton with the real content on completion.

**Contract**: Add UI-toggle lines inside the existing handler: before `fetch`, set the button to its pending appearance and show the result section + skeleton; in the existing `try`, on success hide the skeleton and render content; in the existing `finally`, restore the button label/enabled state. The spinner markup mirrors `SubmitButton.tsx:22`. **The `fetch` call, request body, `401` handling, JSON parse, and `json.*` reads are unchanged.** Keep the existing `setStatus` timing message.

#### 4. Dark-legible pills & contract block

**File**: `src/pages/index.astro` (`<script>` `PILL_BASE` ~166, `renderVerdict` ~173, source/delta pills ~216–218; `<pre>` markup ~146–148)

**Intent**: Recolor the verdict (FAIR/NEEDS BALANCING/NO MATCH), source, and delta pills to dark-friendly translucent pairings, and move the contract `<pre>` from a light surface to a dark one with light text, keeping the Markdown readable.

**Contract**: Pill class strings change value only (e.g. `bg-emerald-500/15 text-emerald-200`, amber/rose/indigo/slate equivalents); the verdict→label/branch logic in `renderVerdict` is unchanged. `<pre id="contract-md">` keeps its `id`, `whitespace-pre-wrap`, and monospace; surface becomes dark (`bg-white/5` or similar) with light text.

### Success Criteria:

#### Automated Verification:

- Linting passes: `npm run lint`
- Production build succeeds: `npm run build`

#### Manual Verification:

- Submitting an evaluation disables the button and shows an inline spinner + pending text; the result area shows a skeleton during the wait.
- On response, the skeleton is replaced by the real contract; verdict/source/delta pills are legible on the dark card for FAIR, NEEDS BALANCING, and NO MATCH cases.
- The contract Markdown is fully readable against the dark `<pre>` surface.
- Clear button resets inputs and hides the result; Copy Markdown still copies the contract; the 401-expiry redirect still works (evaluate behavior unchanged).
- End-to-end evaluate still returns within the ≤5s budget (no perceived regression from the UI changes).

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding.

---

## Testing Strategy

### Unit Tests:

- None added — this is a presentational slice with no testable logic change, and no unit-test harness currently exists for the page. (Adding one is explicitly out of scope.)

### Integration Tests:

- None added (no harness exists; see "What We're NOT Doing").

### Manual Testing Steps:

1. `npm run dev`, sign in, visit `/`. Confirm the dark cosmic theme matches `/auth/signin`.
2. Confirm Topbar shows email + Dashboard + Sign out, and Sign out works.
3. Confirm textareas are pre-filled (saved lists or sample text).
4. Submit an evaluation: verify the button spinner + disabled state and the skeleton placeholder appear during the wait.
5. Verify the skeleton is replaced by the real contract; check pill legibility across a FAIR, a NEEDS BALANCING, and a NO MATCH result.
6. Verify Clear resets and hides the result, and Copy Markdown copies the contract.
7. Spot-check contrast/readability of the contract `<pre>` and all text on the dark background.

## Performance Considerations

No performance impact expected — changes are CSS/markup plus a few imperative UI-toggle lines. The skeleton improves *perceived* performance during the existing fetch. The ≤5s evaluate budget is unaffected since the fetch path is untouched.

## Migration Notes

None — no data, schema, or persisted-contract changes.

## References

- Roadmap slice: `context/foundation/roadmap.md` § S-06 (lines ~144–154)
- Change identity: `context/changes/ux-ui-improvements/change.md`
- Dark theme to match: `src/pages/auth/signin.astro:11`, `src/styles/global.css:113` (`bg-cosmic`)
- Loading-spinner pattern to mirror: `src/components/auth/SubmitButton.tsx:20-24`
- Shared top bar: `src/components/Topbar.astro`
- Conventions: `CLAUDE.md` § Key conventions (`cn()`, shadcn/ui), `src/components/ui/button.tsx`, `src/lib/utils.ts`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Dark Re-skin, Layout & Shared Topbar

#### Automated

- [x] 1.1 Linting passes: `npm run lint` — 4157646
- [x] 1.2 Production build succeeds: `npm run build` — 4157646

#### Manual

- [x] 1.3 Evaluator renders on dark `bg-cosmic`, consistent with `/auth/signin` — 4157646
- [x] 1.4 Shared Topbar shows email + Dashboard + working Sign out — 4157646
- [x] 1.5 Hero, card, textareas, buttons legible with visible focus states — 4157646
- [x] 1.6 Give/want textareas still pre-filled on load (SSR pre-fill intact) — 4157646

### Phase 2: Loading & Result States

#### Automated

- [x] 2.1 Linting passes: `npm run lint`
- [x] 2.2 Production build succeeds: `npm run build`

#### Manual

- [x] 2.3 Submit shows button spinner + disabled state and a skeleton in the result area
- [x] 2.4 Skeleton replaced by real contract; pills legible for FAIR / NEEDS BALANCING / NO MATCH
- [x] 2.5 Contract Markdown fully readable on the dark `<pre>` surface
- [x] 2.6 Clear resets + hides result; Copy works; 401-expiry redirect still works
- [x] 2.7 Evaluate still returns within ≤5s (no perceived regression)

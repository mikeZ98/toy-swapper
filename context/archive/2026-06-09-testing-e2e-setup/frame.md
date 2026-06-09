# Frame Brief: e2e (browser) test setup

> Framing step before /10x-plan. This document captures what is *actually*
> at issue, separated from what was initially assumed.

## Reported Observation

ToySwapper has no end-to-end (browser) test layer. `test-plan.md` §4 lists e2e
as `none`, and there is no Playwright/Cypress config or dependency in the repo.

## Initial Framing (preserved)

- **User's stated cause or approach**: The absence of an e2e layer is a gap that should be filled by standing up e2e test infrastructure.
- **User's proposed direction**: Set up an e2e testing setup as its own change (`testing-e2e-setup`).
- **Pre-dispatch narrowing**: Driver is an **external requirement** — a course / stakeholder / learning goal where the goal is *the e2e setup itself*, not closing a specific product risk. (The user explicitly chose this over "a specific risk needs a browser" and over "general coverage confidence.")

## Dimension Map

Where the "we need e2e" could actually originate:

1. **A risk-map risk (R1–R5) that is only browser-provable** — would justify e2e on the test-plan's own cost×signal grounds.
2. **An untested browser-only client surface** — interactive client JS that no cheaper layer (unit / pgTAP / endpoint integration / jsdom component) can structurally reach.  ← strongest *technical* anchor
3. **External / learning requirement** — the setup is the deliverable; the motivation is outside the risk calculus.  ← user's confirmed driver
4. **Strategy drift ("real apps have e2e")** — promotion to e2e because it "feels safer," which `test-plan.md` §1 explicitly warns against.

## Hypothesis Investigation

| Hypothesis | Evidence | Verdict |
| --- | --- | --- |
| 1. A risk needs a browser | All five risks are already provable below the browser: R1/R5 → pgTAP; R2 → pgTAP negative controls; R3 → `test/middleware.test.ts`; R4 → `test/auth-{signin,signup}.test.ts` + `test/SignInForm/SignUpForm.test.tsx`. `test-plan.md` §1/§2 + the two archived testing phases confirm. User also confirmed the driver is **not** a risk. | NONE |
| 2. Untested browser-only surface | `src/pages/index.astro:168-279` is a `<script is:inline>` (vanilla JS, **not** a React island) driving: form submit → `fetch('/api/evaluate')`, verdict/source/delta pill + contract Markdown rendering, skeleton swap, the 401→`window.location='/auth/signin?redirect=/'` bounce (`:232-235`), clear, copy-to-clipboard. jsdom component tests cover only the two React auth islands (`client:load` at `signin.astro:23`, `signup.astro:21`); nothing covers this inline script, which needs a real browser + fetch + running server. | STRONG |
| 3. External / learning requirement | User stated it directly as the driver. The PRD and roadmap never mention e2e/Playwright/browser testing ("end-to-end" there means the product flow or the ≤5s NFR, `prd.md:175,189`; "end-to-end slice" in `roadmap.md`), so there is no product-level mandate — it is external to the product docs. | STRONG (user-confirmed) |
| 4. Strategy drift / "feels safer" | User explicitly chose "external requirement" over "general coverage confidence," so drift is not the driver. Residual hazard: an externally-motivated e2e layer could later be *misread* as risk-driven, corrupting §1's cost×signal record. | WEAK (as driver); a documentation hazard to guard against |

## Narrowing Signals

- The driver is external, not risk-driven → the test-plan §1 cost×signal argument (which governs *which layer best proves a risk*) does not apply here; it neither blocks nor justifies the work.
- There is exactly one genuinely browser-only, otherwise-unreachable surface — the `index.astro` inline evaluator script (and the real auth cookie round-trip) — so the externally-mandated setup can target something honest instead of a title-only smoke test.

## Cross-System Convention

`test-plan.md` §1 mandates cost×signal: the cheapest layer that proves a risk wins, and e2e is not promoted because it "feels safer." That convention assumes a *risk-driven* decision. An external/learning requirement is a different axis the convention does not cover — it is legitimate, but it must be recorded as such so it does not look like a silent reversal of §1/§4/§7.

## Reframed (or Confirmed) Problem Statement

> **The actual problem to plan is**: not "fill a testing gap," but "satisfy an external requirement to stand up an e2e layer — pointed at the one surface no cheaper layer can reach (the `index.astro` inline evaluator script, and the real signin→cookie→gate→redirect round-trip) — and recorded in `test-plan.md` §4/§7 as externally-motivated, so it is not mistaken for a reversal of the cost×signal strategy."

The initial framing ("e2e is a gap to fill") was partly wrong: by the risk map, e2e is *not* a gap — every risk is already covered more cheaply, which is why §4 excluded it. But the framing is partly right by accident: there is a real, untested browser-only surface (the inline evaluator script), so an externally-mandated e2e layer can be aimed at genuine coverage rather than theater. Addressing it as a *documented external requirement targeting the inline-script + auth round-trip* keeps both the course/stakeholder goal and the integrity of the test strategy intact.

## Confidence

**HIGH** — strong, file-grounded evidence (the inline script at `index.astro:168-279`; the already-covered risk map); a decisive user-confirmed driver (external, not risk); and a clear convention boundary (§1 governs risk-driven choices, not external mandates).

## What Changes for /10x-plan

- Scope the plan as a **minimal, honest e2e setup** — a runner (Playwright is the conventional fit) plus one or two specs — not a broad e2e suite. Frame it explicitly as externally-motivated, not risk-driven.
- Target the genuinely browser-only behavior: the `index.astro` inline evaluator flow (submit → fetch → pill/contract render, the 401 bounce, clear/copy) and optionally the real auth round-trip against local Supabase. Avoid title-only/theater specs (the §1 anti-pattern).
- Pin determinism: the e2e must run against the deterministic stub path (no live `OPENAI_API_KEY` in CI) so the contract output is reproducible (PRD determinism NFR; `src/pages/api/evaluate.ts` stub fallback).
- Update `test-plan.md` §4 (e2e row → present, with an "externally-motivated / learning requirement" note + `checked:` date) and §7 (state the boundary: e2e exists for the requirement and the inline-script surface, *not* because R1–R5 moved cheaper-layer). This preserves the strategy record.

## References

- Source files: `src/pages/index.astro:168-279` (inline evaluator script), `:232-235` (401 bounce); `src/pages/auth/signin.astro:23`, `src/pages/auth/signup.astro:21` (the only React islands); `src/pages/api/evaluate.ts` (stub fallback)
- Strategy: `context/foundation/test-plan.md` §1 (cost×signal), §2 (risk map), §4 (e2e excluded), §7 (deliberate exclusions)
- Product docs (no e2e mandate): `context/foundation/prd.md:175,189`, `context/foundation/roadmap.md`
- Investigation: inline (no sub-agents — small, familiar surface already read this session)

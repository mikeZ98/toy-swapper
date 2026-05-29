---
project: toy-swapper
researched_at: 2026-05-23
recommended_platform: Cloudflare Workers + Pages
runner_up: Netlify
context_type: mvp
tech_stack:
  language: TypeScript
  framework: Astro 6.3.1 + React 19
  runtime: Cloudflare Workers (workerd) via @astrojs/cloudflare 13.5.0
---

## Recommendation

**Deploy on Cloudflare Workers + Pages.** The starter ships `@astrojs/cloudflare` v13 already pinned and `wrangler` v4 installed; the deploy command is a single `npx wrangler deploy` after `astro build`. Cost is $0 for the MVP's expected traffic — 100K req/day free tier with no commercial restriction. The interview answers (cost-first, Cloudflare-familiar, single-region OK, stateless, no co-location needed) and the PRD constraints (no DB, no auth, no realtime, ≤ 5 s response, byte-identical re-runs) line up directly with what Workers does well. Cloudflare also publishes `developers.cloudflare.com/llms.txt` and ships official MCP servers across docs / Workers / observability — both meaningful when an AI agent is the primary maintainer.

## Platform Comparison

| Platform | CLI-first | Managed | Agent-readable docs | Stable deploy API | MCP / Integration | Cost (10K–100K req/mo) |
|---|---|---|---|---|---|---|
| **Cloudflare Workers + Pages** | Pass | Pass | Pass (`llms.txt` confirmed) | Pass | Pass | $0 |
| Netlify | Pass | Pass | Fail (no `llms.txt`) | Pass | Pass (Netlify MCP shipped) | $0 (~20 of 300 free credits) |
| Vercel | Pass | Pass | Partial (MDX, no `llms.txt`) | Pass | Pass (`mcp.vercel.com`, OAuth, preview) | $0 BUT Hobby = no commercial use |
| Fly.io | Pass | Partial (containers) | Partial | Pass | Fail | ~$2–5/mo (free tier removed 2024) |
| Railway | Pass | Pass | Partial | Pass | Fail (community only) | $5/mo (Hobby minimum) |
| Render | Partial | Pass | Fail | Partial (deploy hooks) | Fail | $0 free w/ 50 s sleep (breaks PRD ≤ 5 s NFR) |

### Shortlisted Platforms

#### 1. Cloudflare Workers + Pages (Recommended)

Adapter (`@astrojs/cloudflare` v13.5.0) and `wrangler` v4.90.0 already in `package.json`; no toolchain switch needed. Free tier is 100,000 requests/day, 10 ms CPU per invocation — comfortably covers an MVP and explicitly allows commercial use today. Paid plan kicks in at $5/month (10 M req included). `developers.cloudflare.com/llms.txt` exists as an agent-readable index of the dev platform; MCP servers are published across docs, Workers, and observability. `wrangler deploy` is the canonical one-shot deploy; `wrangler rollback` and `wrangler tail` cover the rest of the agent-facing operational loop.

#### 2. Netlify

Strongest runner-up. Official `@astrojs/netlify` adapter, mature `netlify` CLI, and an official Netlify MCP Server (under Build-with-AI, shipped — no formal GA banner). Credit-based pricing (since Sept 2025): 300 free credits/month, where 100K req costs ~20 credits and 1 GB bandwidth costs 20 credits — well within Free for our scale. Functions on AWS Lambda (60 s sync, **15 min background**) — more generous than Workers' 30 s. Downsides: no `llms.txt` published, AWS Lambda cold starts vs Workers' near-zero cold start, and adapter swap required (one-day refactor).

#### 3. Vercel

First-party Astro support via `@astrojs/vercel`. Fluid Compute (default since 2025-04) lifts function defaults to 300 s on Hobby. Vercel MCP at `mcp.vercel.com` is OAuth-backed (preview, checked 2026-05-23). The blocker: **Hobby tier ToS explicitly prohibits commercial use** — including donations and ads — so the moment ToySwapper monetizes, you're in violation. Pro is $20/seat/month. Sensible only if the project commits to Pro before any monetization, or stays strictly personal.

## Anti-Bias Cross-Check: Cloudflare Workers + Pages

### Devil's Advocate — Weaknesses

1. **workerd ≠ Node.js.** Subset of Node APIs; new deps may crash in production despite working in `astro dev`. Requires `nodejs_compat` flag and per-dep audit.
2. **30 s wall-clock response timeout.** OpenAI calls during model slowdowns can be cut off mid-stream; users see truncated contracts. Need explicit `AbortSignal.timeout()` and graceful stub fallback (already shipped).
3. **3 MB compressed bundle limit on free tier** (10 MB paid). Astro 6 + React 19 + `ai` + `@ai-sdk/openai` + zod is realistic territory at 895 packages installed. Must measure after `astro build`.
4. **`astro dev` vs `wrangler dev` parity drift.** Local dev uses Vite + Astro's server, NOT workerd. Workers cache API, Request body re-read, and fetch redirect semantics differ between dev and prod.
5. **Mild lock-in.** Migration off requires swapping `@astrojs/cloudflare`, rewriting `wrangler.jsonc` + `.dev.vars`, and rebuilding any KV/R2/D1 references (we use none today).

### Pre-Mortem — How This Could Fail

Team deploys ToySwapper on Cloudflare on May 25, 2026 — $0 bill, instant deploys. Two months in, a Polish parent-blogger mention brings ~3K daily users. The team enables real OpenAI in production. The LLM call occasionally hits Workers' 30 s response timeout when OpenAI is slow; users see partial contracts. The team had assumed `temperature: 0` plus a seed was deterministic, but OpenAI's responses still vary ~5–10% across runs, breaking PRD's byte-identical guarantee. They add Workers KV cache to compensate — but KV's eventual-consistency window (~60 s globally) means dedup is racy. They reach for Durable Objects for stronger consistency; DOs' local dev story is rougher than expected and slows iteration. Six months later, they've spent more on Cloudflare engineering hours than they'd have spent on a $7/mo Render container with native Node. Lesson: edge wasn't the right primitive once determinism mattered.

### Unknown Unknowns

- **`.dev.vars` vs `.env` precedence.** `process.env` (shell) > `.env` (Vite/Astro) > `.dev.vars` (wrangler). We already hit this with the `OPENAI_API_KEY` collision during M1L4 — the starter README hand-waves it; the project must document the precedence explicitly so future agents don't repeat the mistake.
- **Pages → Workers Static Assets rename.** In 2024 Cloudflare folded Pages into Workers via "Static Assets." Adapter v13 still works, but new official docs increasingly point at Workers Static Assets rather than Pages — `wrangler.jsonc` shape may shift on the next adapter major.
- **`nodejs_compat` is not free.** Pulling the flag in costs ~50 ms cold-start and a sizable polyfill bundle; may tip the build over the 3 MB free-tier ceiling.
- **The "Enabling image processing" warning in `astro dev` is misleading.** It announces a paid feature (Cloudflare Images) that we don't use. The PRD excludes images, so it's noise — but worth knowing the warning does NOT imply anything is enabled or billed.
- **Edge isn't free latency.** Workers POPs are global but the dominant latency for ToySwapper is the OpenAI roundtrip, not the edge-to-user leg. Polish users on Warsaw/Frankfurt POPs gain little from edge over a single-region Node host in EU.

## Operational Story

- **Preview deploys**: `wrangler deploy --env preview` produces a `*.workers.dev` preview URL; branch deploys via Cloudflare Pages auto-build per PR (`<branch>.<project>.pages.dev`). Fork PRs do NOT receive secrets by default. Cloudflare Access can gate preview URLs behind an email allowlist if needed.
- **Secrets**: `npx wrangler secret put OPENAI_API_KEY` writes to Cloudflare's Workers Secrets vault (encrypted at rest, never logged). Local development reads from `.dev.vars` (gitignored) — different file from `.env`. Rotation: re-run `wrangler secret put OPENAI_API_KEY` (overwrites). Wrangler API token itself lives in GitHub Actions repo secrets.
- **Rollback**: `npx wrangler rollback` (interactive) or `npx wrangler rollback --version-id <id>`. Time-to-revert: under 30 seconds, no DNS warmup. No data caveats — ToySwapper carries no DB to migrate.
- **Approval**: Production deploy requires either a merged PR (CI auto-deploy) or an explicit `npx wrangler deploy --env production` from a developer. Secret rotation is human-only. An agent may run preview deploys, tail logs, and read deployment history unattended.
- **Logs**: `npx wrangler tail` streams real-time invocation logs to terminal (filterable by status, method, route). `npx wrangler deployments list` shows recent deploys. The Cloudflare observability MCP server provides typed, read-only access to logs and metrics from an agent.

## Risk Register

| Risk | Source | Likelihood | Impact | Mitigation |
|---|---|---|---|---|
| LLM call exceeds 30 s response timeout | Devil's advocate #2 | M | M | Wrap LLM calls in `AbortSignal.timeout(20_000)`; existing stub fallback in `src/lib/evaluator.ts` already covers the failure path. |
| Bundle exceeds 3 MB free-tier limit | Devil's advocate #3 | M | L | Run `npx wrangler deploy --dry-run` after `astro build`; switch to paid Workers ($5/mo) if needed. Measure baseline before launch. |
| `astro dev` masks workerd-only bugs | Devil's advocate #4 | M | M | Run `npx wrangler dev` against `dist/` at least once per non-trivial PR; gate prod deploy on `wrangler dev` smoke test in CI. |
| OpenAI response drift breaks PRD determinism | Pre-mortem | H | H | Keep `processedCache` keyed on input text (already in `src/lib/evaluator.ts`); accept first LLM response and cache for the session; document that determinism on cold cache depends on `temperature: 0` + provider's seed honor — verify per provider version. |
| Workers KV eventual consistency for cache dedup | Pre-mortem | L (MVP), M (post-scale) | M | Defer KV adoption until MVP outgrows the in-process cache; if added, key cache on a content hash and accept stale-but-deterministic reads. |
| `.dev.vars` vs `.env` vs shell `process.env` confusion | Unknown unknown #1 | H | M | Documented in `CLAUDE.md` and `AGENTS.md`; canonical precedence: `process.env` > `.env` > `.dev.vars`. Use `env -u OPENAI_API_KEY npm run dev` to force a clean baseline. |
| Pages → Workers Static Assets migration churn | Unknown unknown #2 | M (12-month) | L | Pin `@astrojs/cloudflare` and `wrangler` in `package.json`; review release notes before any adapter major bump. |
| `nodejs_compat` tips bundle over free-tier limit | Unknown unknown #3 | L | L | Audit deps for raw Node API usage; prefer Web Crypto over `crypto` and `Headers`/`Request` over `http`. |
| Vendor lock-in via adapter and wrangler config | Devil's advocate #5 | L (MVP), M (post-scale) | M | Keep all Cloudflare-specific code under `astro.config.mjs` adapter block and `wrangler.jsonc`; do not sprinkle KV / R2 / D1 references into business logic if avoidable. |

## Getting Started

Commands validated against the starter's pinned versions (`@astrojs/cloudflare@^13.5.0`, `wrangler@^4.90.0`, `astro@^6.3.1`):

1. **Verify build output.** `npm run build` produces a Cloudflare-targeted bundle in `./dist`. The starter's `wrangler.jsonc` is already configured to serve it.
2. **Authenticate wrangler.** `npx wrangler login` (one-time per machine; opens a browser tab; uses an OAuth token stored in `~/.wrangler/config/`).
3. **Configure prod secrets.** `npx wrangler secret put OPENAI_API_KEY` (paste the real key when prompted). Optionally `npx wrangler secret put FAIRNESS_THRESHOLD_PCT` if you want to override the 20% default per-environment.
4. **First deploy.** `npx wrangler deploy`. Wrangler prints the deployed `*.workers.dev` URL; visit it to confirm `/api/evaluate` responds and the index form renders.
5. **(Optional) Wire CI.** Add a `.github/workflows/deploy.yml` job: `npm ci && npm run build && npx wrangler deploy` on push to `master`. Requires `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` repository secrets (create the token via Cloudflare dashboard → My Profile → API Tokens → "Edit Cloudflare Workers" template).

Notes specific to this stack's pinned versions:

- **Local dev stays `npm run dev`**, which runs `astro dev` (Vite + Astro server) — NOT workerd. Use `npx wrangler dev` against `./dist` only for workerd-fidelity smoke tests, not as the daily dev loop. Adapter v13's `astro dev` already covers most behaviors.
- **`.dev.vars` overrides `.env` for `wrangler dev` only**. For `astro dev`, `.env` is what gets read (via Vite). Keep both files in sync or use `wrangler types` to generate matching `Env` definitions.

## Out of Scope

The following were not evaluated in this research:

- Docker image configuration (not applicable — Workers is bundle-based).
- CI/CD pipeline file authoring (high-level shape suggested in Getting Started step 5; full workflow YAML deferred to implementation).
- Production-scale architecture: multi-region failover, SLA commitments, observability beyond `wrangler tail`, custom-domain TLS configuration past the default `*.workers.dev` subdomain.
- Database / persistence layer — PRD Non-Goal; revisit only if v2 scope drops the in-memory constraint.

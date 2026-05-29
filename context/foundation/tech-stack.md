---
starter_id: 10x-astro-starter
package_manager: npm
project_name: toy-swapper
hints:
  language_family: js
  team_size: solo
  deployment_target: cloudflare-pages
  ci_provider: github-actions
  ci_default_flow: auto-deploy-on-merge
  bootstrapper_confidence: first-class
  path_taken: standard
  quality_override: false
  self_check_answers: null
  has_auth: false
  has_payments: false
  has_realtime: false
  has_ai: true
  has_background_jobs: false
---

## Why this stack

Solo builder shipping ToySwapper as a 1-week after-hours MVP with a hard
deadline of 2026-05-26. The product is a web-app in JS/TS with one
load-bearing AI step (LLM-based standardization and valuation in FR-003 and
FR-005) and explicit Non-Goals against database, authentication, realtime
chat, and image input. 10x-astro-starter is the recommended default for
`(web, js)` and clears all four agent-friendly gates — TypeScript-first,
convention-based, popular in training data, well-documented — which matters
because most build time will be after-hours with agent assistance. Astro 6
plus React 19 plus Tailwind 4 on Cloudflare Pages/Workers gives the fastest
path from scaffold to first deploy; the starter's bundled Supabase is
installed but unused since the PRD pins state in memory over a hardcoded
fixture pool. CI runs on GitHub Actions with auto-deploy-on-merge — the
starter's default shape and the lowest-friction choice for a solo
1-week build. Bootstrapper confidence is first-class.

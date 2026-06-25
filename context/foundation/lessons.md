# Lessons Learned

> Append-only register of recurring rules and patterns. Re-read at start by /10x-frame, /10x-research, /10x-plan, /10x-plan-review, /10x-implement, /10x-impl-review.

## Treat Actions `startup_failure` with 0 provisioned jobs as account billing, not a workflow bug

- **Context**: GitHub Actions CI on this (private) repo — any run that ends in `startup_failure` at ~0s with **0 jobs provisioned** (check `gh run view <id> --json jobs --jq '.jobs|length'`).
- **Problem**: We burned several cycles editing workflow YAML, toggling "Read and write" workflow token permissions, and pushing empty trigger commits to "fix" CI — when no runner ever provisioned. GitHub's UI message ("This run likely failed because of a workflow file issue") is a misleading generic guess. Confirmed root cause: private-repo Actions minutes / spending limit; the moment a payment method was verified, runs went `startup_failure → in_progress → success` with no code change.
- **Rule**: When a run is `startup_failure` with 0 jobs, stop touching workflows and stop pushing trigger commits. Verify it via `gh`: valid YAML + `actions/permissions` enabled + 0 jobs ⇒ it is account-level infrastructure. Fix by adding a payment method / raising the spending limit, **or** switching repository visibility to Public (free unlimited Actions). Validate code locally meanwhile (`npm test`, `npx supabase test db`, `npm run lint`, `npm run build`).
- **Applies to**: implement, all

## Guard a workflow step on a secret via job-level `env:`, never `secrets`/step-`env` in `if:`

- **Context**: GitHub Actions step-level `if:` conditionals that gate on whether a secret is present (e.g. the `db` job's "Push migrations to production" step in `.github/workflows/ci.yml`).
- **Problem**: The `secrets` context and a step's own `env:` block are **not available** to that same step's `if:` (per GitHub's context-availability table). Writing `if: secrets.FOO != ''` — or referencing the step's own `env:` — silently evaluates to empty, so the step skips **always**, even when the secret is set. Conversely, leaving the step unguarded red-fails the whole job when the secret is absent (`supabase link --project-ref ""` → "Cannot find project ref").
- **Rule**: Expose the secret at the **job-level** `env:` block (`env: { FOO: ${{ secrets.FOO }} }`), then guard the step with `if: ... && env.FOO != ''`. The job `env` IS visible to a step `if`; the step's own `env` and the `secrets` context are not. This makes the step skip cleanly when unconfigured and auto-resume once the secret is set. See `context/foundation/conventions.md` § CI for the concrete `ci.yml` instance.
- **Applies to**: implement, plan

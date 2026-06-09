import { defineConfig, devices } from "@playwright/test";

// E2E layer (externally-motivated — see context/changes/testing-e2e-setup/frame.md).
// Boots the production-built Cloudflare worker via `build` + `preview` (port 4321,
// reads dist/server/.dev.vars for Supabase). Phases 2–3 require a local Supabase
// stack (`supabase start`) and OPENAI_API_KEY unset so the evaluator stays on its
// deterministic stub path. Local-only for now — not wired into CI.
const PORT = 4321;
const BASE_URL = `http://localhost:${PORT}`;

export default defineConfig({
  testDir: "e2e",
  // Seeds the e2e test user once (sequentially) before any project — avoids
  // concurrent signUp races across the setup project and the form specs.
  globalSetup: "./e2e/global-setup.ts",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  reporter: "list",
  use: {
    baseURL: BASE_URL,
    trace: "on-first-retry",
  },
  projects: [
    // Seeds the test user + captures authenticated storageState once.
    { name: "setup", testMatch: /.*\.setup\.ts/ },
    // Logged-out specs (gate redirect + the signin form round-trip). No
    // storageState; no dependency on setup so the gate smoke stays runnable
    // even without the seed step (the form spec seeds its own user).
    {
      name: "chromium",
      testIgnore: [/.*\.setup\.ts/, /evaluate\.spec\.ts/],
      use: { ...devices["Desktop Chrome"] },
    },
    // Authenticated specs reuse the captured session (Phase 3: evaluate.spec.ts).
    {
      name: "chromium-auth",
      testMatch: /evaluate\.spec\.ts/,
      use: { ...devices["Desktop Chrome"], storageState: "e2e/.auth/user.json" },
      dependencies: ["setup"],
    },
  ],
  webServer: {
    command: "npm run build && npm run preview",
    // The signin page returns 200 without a session; use it as the readiness
    // probe (the root `/` 302-redirects when anonymous).
    url: `${BASE_URL}/auth/signin`,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});

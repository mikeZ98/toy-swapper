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
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  reporter: "list",
  use: {
    baseURL: BASE_URL,
    trace: "on-first-retry",
  },
  projects: [
    // storageState / authenticated projects are added in Phase 2; the gate
    // smoke runs anonymous so it asserts the unauthenticated redirect.
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
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

import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
import { type Page } from "@playwright/test";

// Shared e2e helpers. The test process reads the SAME local Supabase creds the
// app uses (from .dev.vars) so seeding and the app's own auth target one stack.

export const AUTH_FILE = "e2e/.auth/user.json";

export const TEST_USER = {
  email: "e2e@toyswapper.test",
  password: "e2e-password-123456", // ≥ 6 chars (signup minimum)
};

/** Read a KEY=VALUE entry from .dev.vars (the gitignored local secrets file). */
export function readDevVar(name: string): string {
  const content = readFileSync(".dev.vars", "utf8");
  const line = content.split("\n").find((l) => l.startsWith(`${name}=`));
  if (!line) throw new Error(`${name} not found in .dev.vars`);
  return line.slice(name.length + 1).trim();
}

/**
 * Open the signin page and wait for the `client:load` React island to hydrate
 * before any fill. Filling a controlled React input before hydration loses the
 * value when React mounts with its empty initial state — `networkidle` ensures
 * the hydration bundle has loaded and run first.
 */
export async function openSignin(page: Page): Promise<void> {
  await page.goto("/auth/signin", { waitUntil: "networkidle" });
}

/**
 * Idempotently ensure the e2e test user exists in the local stack. Local Supabase
 * has email confirmations off (supabase/config.toml), so the user is immediately
 * usable. A repeat run hits "already registered", which is tolerated.
 */
export async function ensureTestUser(): Promise<void> {
  const supabase = createClient(readDevVar("SUPABASE_URL"), readDevVar("SUPABASE_KEY"));
  const { error } = await supabase.auth.signUp(TEST_USER);
  if (error && !/already registered|already exists/i.test(error.message)) {
    throw error;
  }
}

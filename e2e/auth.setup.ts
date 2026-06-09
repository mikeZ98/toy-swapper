import { test as setup, expect } from "@playwright/test";
import { AUTH_FILE, TEST_USER, openSignin } from "./support";

// Setup project: sign in through the REAL form once and persist the authenticated
// browser state for the evaluator specs to reuse. The test user is seeded by the
// config-level globalSetup before this runs.
setup("authenticate", async ({ page }) => {
  await openSignin(page);
  await page.getByLabel(/email/i).fill(TEST_USER.email);
  await page.getByLabel(/^password$/i).fill(TEST_USER.password);
  await page.getByRole("button", { name: /sign in/i }).click();

  // Success crosses the gate and lands on the root evaluator page.
  await expect(page).toHaveURL("/");

  await page.context().storageState({ path: AUTH_FILE });
});

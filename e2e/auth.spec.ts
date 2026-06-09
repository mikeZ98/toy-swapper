import { test, expect } from "@playwright/test";
import { TEST_USER, openSignin } from "./support";

// The signin form round-trip in a real browser — the coverage that justifies an
// e2e layer (no cheaper layer drives the form → cookie → gate → redirect chain).
// Runs logged-out (no storageState). The test user is seeded by globalSetup.
test.describe("signin form round-trip", () => {
  test("bad credentials surface an inline error and stay on the signin page", async ({ page }) => {
    await openSignin(page);
    await page.getByLabel(/email/i).fill("nobody@example.com");
    await page.getByLabel(/^password$/i).fill("wrong-password");
    await page.getByRole("button", { name: /sign in/i }).click();

    await expect(page).toHaveURL(/\/auth\/signin/);
    await expect(page.getByText(/invalid login credentials/i)).toBeVisible();
  });

  test("valid credentials land on the gated home page", async ({ page }) => {
    await openSignin(page);
    await page.getByLabel(/email/i).fill(TEST_USER.email);
    await page.getByLabel(/^password$/i).fill(TEST_USER.password);
    await page.getByRole("button", { name: /sign in/i }).click();

    await expect(page).toHaveURL("/");
  });
});

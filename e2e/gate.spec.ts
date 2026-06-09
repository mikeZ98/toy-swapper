import { test, expect } from "@playwright/test";

// Unauthenticated smoke (no Supabase session required): proves the harness boots
// the production-built worker and the middleware gate redirects an anonymous
// visitor away from the gated root in a real browser.
test("anonymous visit to / is redirected to the signin page", async ({ page }) => {
  await page.goto("/");
  await expect(page).toHaveURL(/\/auth\/signin/);
});

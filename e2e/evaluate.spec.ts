import { test, expect } from "@playwright/test";

// The genuinely browser-only surface: the index.astro `<script is:inline>` that
// wires the evaluator form → fetch(/api/evaluate) → pill + contract rendering.
// Runs authenticated (storageState, chromium-auth project). Determinism is pinned
// by the stub path — with OPENAI_API_KEY unset the evaluator returns source:stub,
// asserted below; a leaked key would flip the source and fail the test loudly.
test("authenticated operator runs an evaluation and sees the rendered contract", async ({ page }) => {
  await page.goto("/");

  await page.locator("#give").fill("klocki LEGO Duplo dobry stan; bluza H&M rozmiar 92");
  await page.locator("#want").fill("lalka Barbie z domkiem; kredki 24 szt");
  await page.locator("#run-btn").click();

  const result = page.locator("#result");
  await expect(result).toBeVisible();

  // Determinism guard: the deterministic stub path is the only acceptable source.
  await expect(page.locator("#source-pill")).toHaveText(/stub/);
  // Verdict + contract are populated by the inline script from the JSON response.
  await expect(page.locator("#verdict-pill")).not.toBeEmpty();
  await expect(page.locator("#contract-md")).not.toBeEmpty();
});

test("the clear button resets the form and hides the result", async ({ page }) => {
  await page.goto("/");

  await page.locator("#give").fill("klocki LEGO Duplo");
  await page.locator("#want").fill("lalka Barbie");
  await page.locator("#run-btn").click();
  await expect(page.locator("#result")).toBeVisible();

  await page.locator("#clear-btn").click();

  await expect(page.locator("#give")).toHaveValue("");
  await expect(page.locator("#want")).toHaveValue("");
  await expect(page.locator("#result")).toBeHidden();
});

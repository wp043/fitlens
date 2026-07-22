import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

test("captures candidates and promotes a shortlist without a model request", async ({ page }) => {
  await page.goto("/?lang=en");
  await expect(page.getByRole("heading", { name: /Capture first/i })).toBeVisible();

  const inbox = page.locator(".candidate-inbox");
  await inbox.locator("textarea").fill("https://alpha.example\nhttps://beta.example");
  await inbox.getByRole("button", { name: /Add to inbox/i }).click();
  await expect(inbox.locator(".candidate-inbox-grid > article")).toHaveCount(2);
  await inbox.locator(".candidate-select input").nth(0).check();
  await inbox.locator(".candidate-select input").nth(1).check();
  await inbox.getByRole("button", { name: /Compare selected products/i }).click();

  await expect(page.locator(".url-field input").nth(0)).toHaveValue("https://alpha.example/");
  await expect(page.locator(".url-field input").nth(1)).toHaveValue("https://beta.example/");
});

test("reviews evidence in the bundled report", async ({ page }) => {
  await page.goto("/examples/cmux-vs-otty?lang=en");
  const firstEvidence = page.locator(".evidence-review-item").first();
  await firstEvidence.getByRole("button", { name: /Accept/i }).click();
  await expect(firstEvidence.locator(".review-status")).toHaveText("Accepted");
  const reviewNote = firstEvidence.getByLabel(/Review note/i);
  await reviewNote.fill("Verified during E2E.");
  await reviewNote.blur();
  await expect(firstEvidence).toHaveClass(/accepted/);
});

test("home and report have no automatically detectable WCAG violations", async ({ page }) => {
  for (const path of ["/?lang=en", "/examples/cmux-vs-otty?lang=en"]) {
    await page.goto(path);
    await expect(page.locator("html")).toHaveAttribute("lang", "en");
    const results = await new AxeBuilder({ page }).analyze();
    const violations = results.violations.map((violation) => ({
      id: violation.id,
      targets: violation.nodes.map((node) => node.target),
    }));
    expect(violations, path).toEqual([]);
  }
});

test("home visual contract", async ({ page }) => {
  await page.goto("/?lang=en");
  await expect(page.locator("html")).toHaveAttribute("lang", "en");
  await page.evaluate(() => document.fonts.ready);
  await expect(page).toHaveScreenshot("home.png", {
    animations: "disabled",
    fullPage: true,
    maxDiffPixelRatio: 0.02,
  });
});

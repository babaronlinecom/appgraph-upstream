import { expect, test } from "@playwright/test";

test("landing explains the product and starts an analysis", async ({ page }) => {
  await page.goto("/");

  await expect(page.getByRole("heading", { level: 1 })).toContainText("See your software");
  await expect(page.getByText("not your folders.")).toBeVisible();

  const input = page.getByLabel("Public GitHub repository URL");
  await expect(input).toBeVisible();
  await expect(page.getByRole("button", { name: /Generate graph/i })).toBeVisible();

  // The demo preview renders semantic nodes on the landing page.
  await expect(page.locator(".react-flow__node", { hasText: "Dashboard" }).first()).toBeVisible();
  await expect(page.locator(".react-flow__node", { hasText: "Stripe" }).first()).toBeVisible();

  await input.fill("github.com/fixture/sample-nextjs");
  await page.getByRole("button", { name: /Generate graph/i }).click();
  await expect(page).toHaveURL(/\/github\/fixture\/sample-nextjs/);
});

test("landing rejects unsupported hosts", async ({ page }) => {
  await page.goto("/");
  const input = page.getByLabel("Public GitHub repository URL");
  await input.fill("https://gitlab.com/owner/repo");
  await page.getByRole("button", { name: /Generate graph/i }).click();
  await expect(page.locator('p[role="alert"]')).toContainText("github.com");
  await expect(page).toHaveURL(/\/$/);
});

import { expect, test } from "@playwright/test";

test.describe("mobile experience", () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test("canvas loads and sidebars become sheets", async ({ page }) => {
    await page.goto("/github/fixture/sample-nextjs");

    const dashboardNode = page.locator(".react-flow__node", { hasText: "Dashboard" }).first();
    await expect(dashboardNode).toBeVisible({ timeout: 90_000 });

    const explorer = page.locator('aside[aria-label="Explorer"]');
    const inspector = page.locator('aside[aria-label="Inspector"]');

    // Explorer starts off-canvas and opens as a sheet.
    await expect(explorer).not.toBeInViewport();
    await page.getByRole("button", { name: "Toggle explorer" }).click();
    await expect(explorer).toBeInViewport();
    await expect(explorer.getByText("Granularity")).toBeVisible();
    await page.getByRole("button", { name: "Close explorer" }).click();
    await expect(explorer).not.toBeInViewport();

    // Selecting a node opens the inspector sheet.
    await dashboardNode.click();
    await expect(inspector).toBeInViewport();
    await expect(inspector).toContainText("src/app/dashboard/page.tsx");
    await page.getByRole("button", { name: "Close inspector" }).click();
    await expect(inspector).not.toBeInViewport();
  });
});

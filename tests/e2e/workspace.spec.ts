import { expect, test } from "@playwright/test";

test.describe("analysis workspace", () => {
  test("loads a graph, searches, inspects and navigates", async ({ page }) => {
    await page.goto("/github/fixture/sample-nextjs");

    // Graph nodes appear after analysis (architecture granularity by default).
    const dashboardNode = page.locator(".react-flow__node", { hasText: "Dashboard" }).first();
    await expect(dashboardNode).toBeVisible({ timeout: 90_000 });
    await expect(page.locator(".react-flow__node", { hasText: "GET /api/projects" }).first()).toBeVisible();
    await expect(page.locator(".react-flow__node", { hasText: "PostgreSQL" }).first()).toBeVisible();
    await expect(page.locator(".react-flow__node", { hasText: "Stripe" }).first()).toBeVisible();

    // Status bar reports analysis statistics.
    await expect(page.getByText(/\d+ entities/)).toBeVisible();

    // Command palette search and selection.
    await page.keyboard.press("Control+k");
    const paletteInput = page.getByLabel("Command palette search");
    await expect(paletteInput).toBeVisible();
    await paletteInput.fill("stripe");
    const stripeResult = page
      .getByRole("dialog")
      .getByRole("button", { name: /Stripe/ })
      .first();
    await expect(stripeResult).toBeVisible();
    await stripeResult.click();

    const inspector = page.locator('aside[aria-label="Inspector"]');
    await expect(inspector).toContainText("Stripe");
    await expect(inspector).toContainText("External");
    await expect(inspector).toContainText("Payments");

    // Selecting a node shows its deterministic description and source path.
    await page.keyboard.press("Escape");
    await page.keyboard.press("f");
    await dashboardNode.click();
    await expect(inspector).toContainText("Dashboard");
    await expect(inspector).toContainText("/dashboard");
    await expect(inspector).toContainText("src/app/dashboard/page.tsx");

    // Evidence panel explains why relationships exist.
    await expect(inspector.getByText("Evidence", { exact: true })).toBeVisible();
    await expect(inspector).toContainText("typescript-ast");

    // GitHub source link is pinned to the analyzed commit.
    await expect(inspector.getByRole("link", { name: /Open on GitHub/ })).toHaveAttribute(
      "href",
      /github\.com\/fixture\/sample-nextjs\/blob\/fixture-commit-0001\/src\/app\/dashboard\/page\.tsx/,
    );

    // Granularity switch reveals files-level entities (unused Button component).
    await page.getByRole("button", { name: "File", exact: true }).click();
    await expect(page.locator(".react-flow__node", { hasText: "Button" }).first()).toBeVisible();

    // Fit and reset shortcuts work without errors.
    await page.keyboard.press("f");
    await page.keyboard.press("r");
    await expect(page.locator(".react-flow__node", { hasText: "Button" }).first()).toBeVisible();

    // Group lanes collapse and expand.
    const frontendGroup = page.getByRole("button", { name: /Collapse Frontend group/ });
    await expect(frontendGroup).toBeVisible();
    await frontendGroup.click();
    await expect(page.getByRole("button", { name: /Expand Frontend group/ })).toBeVisible();
  });
});

import path from "node:path";
import { expect, test } from "@playwright/test";

const outputDir = path.join(process.cwd(), "docs", "screenshots");

test("captures product screenshots", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator(".react-flow__node", { hasText: "Dashboard" }).first()).toBeVisible();
  await page.waitForTimeout(500);
  await page.screenshot({ path: path.join(outputDir, "landing.png") });

  await page.goto("/github/fixture/sample-nextjs");
  const dashboardNode = page.locator(".react-flow__node", { hasText: "Dashboard" }).first();
  await expect(dashboardNode).toBeVisible({ timeout: 90_000 });
  await page.waitForTimeout(900);
  await page.screenshot({ path: path.join(outputDir, "workspace-architecture.png") });

  await dashboardNode.click();
  await expect(page.locator('aside[aria-label="Inspector"]')).toContainText("Dashboard");
  await page.waitForTimeout(700);
  await page.screenshot({ path: path.join(outputDir, "workspace-inspector.png") });

  // Trace mode with the flow player.
  await page.keyboard.press("t");
  await expect(page.getByText("Flow from Dashboard")).toBeVisible();
  await page.waitForTimeout(1_600);
  await page.screenshot({ path: path.join(outputDir, "workspace-trace.png") });
  await page.getByRole("button", { name: "Exit trace" }).click();

  // Hover card with instant relationship context.
  await page.keyboard.press("f");
  await page.waitForTimeout(600);
  await dashboardNode.hover();
  await expect(page.getByRole("tooltip")).toBeVisible();
  await page.waitForTimeout(300);
  await page.screenshot({ path: path.join(outputDir, "workspace-hover.png") });

  // Insights panel with detected flows.
  await page.getByRole("button", { name: "insights" }).click();
  await page.waitForTimeout(500);
  await page.screenshot({ path: path.join(outputDir, "workspace-insights.png") });

  // Analytics panel with charts, health and cycles.
  await page.getByRole("button", { name: "analytics" }).click();
  await page.waitForTimeout(500);
  await page.screenshot({ path: path.join(outputDir, "workspace-analytics.png") });

  await page.getByRole("button", { name: "nodes", exact: true }).click();
  await page.waitForTimeout(300);

  // Symbols granularity with resolved symbol graph.
  await page.getByRole("button", { name: "Symb", exact: true }).click();
  await page.waitForTimeout(900);
  await page.screenshot({ path: path.join(outputDir, "workspace-symbols.png") });
  await page.getByRole("button", { name: "Arch", exact: true }).click();
  await page.waitForTimeout(400);

  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "Modu", exact: true }).click();
  await page.waitForTimeout(900);
  await page.screenshot({ path: path.join(outputDir, "workspace-modules.png") });
});

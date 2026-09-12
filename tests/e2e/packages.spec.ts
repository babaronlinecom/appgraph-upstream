import path from "node:path";
import { expect, test } from "@playwright/test";

const outputDir = path.join(process.cwd(), "docs", "screenshots");

test("monorepo packages view exposes workspace graph", async ({ page }) => {
  await page.goto("/github/fixture/sample-monorepo");

  // Package nodes are part of the architecture graph.
  const packageNode = page.locator(".react-flow__node", { hasText: "@acme/ui" }).first();
  await expect(packageNode).toBeVisible({ timeout: 90_000 });

  // Packages tab lists workspace packages with tooling evidence.
  await page.getByRole("button", { name: "Pkgs", exact: true }).click();
  await expect(page.getByText("turbo", { exact: true })).toBeVisible();
  await expect(page.getByText("@acme/ui").first()).toBeVisible();
  await expect(page.getByText("app", { exact: true }).first()).toBeVisible();
  await expect(page.getByText("library", { exact: true }).first()).toBeVisible();

  // Dependency chips navigate to the referenced package.
  await page.getByRole("button", { name: "@acme/db", exact: true }).first().click();

  // Impact works on a package through real dependency edges.
  await page.getByRole("button", { name: "Impact of @acme/ui" }).click();
  await expect(page.getByText("Impact of @acme/ui")).toBeVisible();
  await page.getByRole("button", { name: "Exit trace" }).click();

  await page.waitForTimeout(400);
  await page.screenshot({ path: path.join(outputDir, "workspace-packages.png") });
});

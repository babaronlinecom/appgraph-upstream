import { expect, test } from "@playwright/test";

test.describe("advanced exploration", () => {
  test("analytics charts, exports and clean explorer", async ({ page }) => {
    await page.goto("/github/fixture/sample-nextjs");
    const dashboard = page.locator(".react-flow__node", { hasText: "Dashboard" }).first();
    await expect(dashboard).toBeVisible({ timeout: 90_000 });

    const explorer = page.getByRole("complementary", { name: "Explorer" });

    // Product view hides groups without entities (no empty placeholders).
    await page.getByRole("button", { name: "Prod", exact: true }).click();
    await expect(explorer.getByText("None at this level")).toHaveCount(0);
    await expect(explorer.getByText("Configuration", { exact: true })).toHaveCount(0);
    await expect(explorer.getByText("External Services", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Arch", exact: true }).click();

    // Analytics tab: charts, metrics and cycles.
    await page.getByRole("button", { name: "analytics" }).click();
    await expect(page.getByText("Entities by type")).toBeVisible();
    await expect(page.getByText("Relationships by type")).toBeVisible();
    await expect(page.getByText(/Circular dependencies/)).toBeVisible();
    await expect(page.getByText("Layers", { exact: true })).toBeVisible();
    await expect(page.getByText("Avg links")).toBeVisible();

    // Export tool downloads a real JSON artifact.
    const downloadPromise = page.waitForEvent("download");
    await page.getByRole("button", { name: /Download JSON/ }).click();
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toMatch(/\.appgraph\.json$/);

    // Copy Mermaid command from the palette.
    await page.keyboard.press("Control+k");
    await page.getByLabel("Command palette search").fill("mermaid");
    await page.getByRole("dialog").getByRole("button", { name: /Copy Mermaid diagram/ }).click();
    await expect(page.getByText(/Mermaid diagram copied|clipboard/)).toBeVisible();
  });

  test("symbol granularity exposes resolved symbols and their calls", async ({ page }) => {
    await page.goto("/github/fixture/sample-nextjs");
    const dashboard = page.locator(".react-flow__node", { hasText: "Dashboard" }).first();
    await expect(dashboard).toBeVisible({ timeout: 90_000 });

    await page.getByRole("button", { name: "Symb", exact: true }).click();
    const symbolNode = page.locator(".react-flow__node", { hasText: "DashboardPage" }).first();
    await expect(symbolNode).toBeVisible();

    // Symbol node carries resolved relationships from real imports/JSX.
    await symbolNode.click();
    const inspector = page.locator('aside[aria-label="Inspector"]');
    await expect(inspector).toContainText("Symbol");
    await expect(inspector).toContainText("bound to src/components/ProjectList.tsx");

    // Tracing works on symbol-level nodes too.
    await page.keyboard.press("t");
    await expect(page.getByText("Flow from DashboardPage")).toBeVisible();
    await page.getByRole("button", { name: "Exit trace" }).click();
    await page.getByRole("button", { name: "Arch", exact: true }).click();
  });

  test("data tab renders parsed schema with fields and relations", async ({ page }) => {
    await page.goto("/github/fixture/sample-nextjs");
    const dashboard = page.locator(".react-flow__node", { hasText: "Dashboard" }).first();
    await expect(dashboard).toBeVisible({ timeout: 90_000 });

    await page.getByRole("button", { name: "data", exact: true }).click();
    const projectCard = page.getByRole("button", { name: /Project/ }).first();
    await expect(projectCard).toBeVisible();
    await expect(page.getByText(/2 models · 1 enums/)).toBeVisible();

    // Expand the model and verify fields/keys come from the Prisma schema.
    await projectCard.click();
    await expect(page.getByText("status", { exact: true }).first()).toBeVisible();
    await expect(page.getByText("ProjectStatus", { exact: true }).first()).toBeVisible();
    await expect(page.getByText("pk", { exact: true }).first()).toBeVisible();

    // Relation chips link to the referenced model.
    await expect(page.getByRole("button", { name: /→ Task/ }).first()).toBeVisible();

    // Impact action works on a data model.
    await page.getByRole("button", { name: "Impact of Project" }).click();
    await expect(page.getByText("Impact of Project")).toBeVisible();
    await page.getByRole("button", { name: "Exit trace" }).click();
    await page.getByRole("button", { name: "nodes", exact: true }).click();
  });

  test("hover card, legend and context menu", async ({ page }) => {
    await page.goto("/github/fixture/sample-nextjs");
    const dashboard = page.locator(".react-flow__node", { hasText: "Dashboard" }).first();
    await expect(dashboard).toBeVisible({ timeout: 90_000 });

    // Hover card instantly summarizes relationships.
    await dashboard.hover();
    const card = page.getByRole("tooltip");
    await expect(card).toBeVisible();
    await expect(card).toContainText("Dashboard");
    await expect(card).toContainText("Leads to");
    await expect(card).toContainText("ProjectList");

    // Legend overlay.
    await page.getByRole("button", { name: "Show legend" }).click();
    await expect(page.getByText("Map legend")).toBeVisible();
    await expect(page.getByText("Requests an internal API route")).toBeVisible();
    await page.getByRole("button", { name: "Hide legend" }).click();
    await expect(page.getByText("Map legend")).not.toBeVisible();

    // Right-click context menu.
    await dashboard.click({ button: "right" });
    await expect(page.getByRole("menu")).toBeVisible();
    await expect(page.getByRole("menuitem", { name: /Trace flow/ })).toBeVisible();
    await expect(page.getByRole("menuitem", { name: /Impact analysis/ })).toBeVisible();
    await page.getByRole("menuitem", { name: /Trace flow/ }).click();
    await expect(page.getByText("Flow from Dashboard")).toBeVisible();
    await page.getByRole("button", { name: "Exit trace" }).click();
  });

  test("traces flows, analyzes impact, finds paths and plays the tour", async ({ page }) => {
    await page.goto("/github/fixture/sample-nextjs");
    const dashboard = page.locator(".react-flow__node", { hasText: "Dashboard" }).first();
    await expect(dashboard).toBeVisible({ timeout: 90_000 });
    await expect(page.locator(".react-flow__node", { hasText: "PostgreSQL" }).first()).toBeVisible();

    // Trace downstream with the keyboard shortcut.
    await dashboard.click();
    await page.keyboard.press("t");
    await expect(page.getByText("Flow from Dashboard")).toBeVisible();
    await expect(page.getByRole("button", { name: "Exit trace" })).toBeVisible();
    await page.getByRole("button", { name: "Next trace step" }).click();
    await page.getByRole("button", { name: "Next trace step" }).click();
    await page.keyboard.press("Escape");
    await expect(page.getByText("Flow from Dashboard")).not.toBeVisible();

    // Impact analysis via the keyboard shortcut (PostgreSQL has dependents).
    await page.keyboard.press("Control+k");
    const impactPalette = page.getByLabel("Command palette search");
    await impactPalette.fill("PostgreSQL");
    await page.getByRole("dialog").getByRole("button", { name: /PostgreSQL/ }).first().click();
    await page.keyboard.press("i");
    await expect(page.getByText("Impact of PostgreSQL")).toBeVisible();
    await page.getByRole("button", { name: "Exit trace" }).click();

    // Path finding: pick a source, then choose a destination from the palette.
    await page.keyboard.press("Control+k");
    await page.getByLabel("Command palette search").fill("Dashboard");
    await page.getByRole("dialog").getByRole("button", { name: /Dashboard/ }).first().click();
    await page.keyboard.press("p");
    await page.keyboard.press("Control+k");
    const paletteInput = page.getByLabel("Command palette search");
    await paletteInput.fill("PostgreSQL");
    await page.getByRole("dialog").getByRole("button", { name: /PostgreSQL/ }).first().click();
    await expect(page.getByText("Relationship path")).toBeVisible();
    await page.getByRole("button", { name: "Exit trace" }).click();

    // Edge tooltip appears on hover (move to a point lying on the SVG path).
    await page.keyboard.press("f");
    await page.waitForTimeout(700);
    const edge = page.locator(".react-flow__edge").first();
    const point = await edge.evaluate((element) => {
      const path = element.querySelector("path") as SVGPathElement | null;
      if (!path) return null;
      const position = path.getPointAtLength(path.getTotalLength() / 2);
      const matrix = path.getScreenCTM();
      if (!matrix) return null;
      return {
        x: position.x * matrix.a + position.y * matrix.c + matrix.e,
        y: position.x * matrix.b + position.y * matrix.d + matrix.f,
      };
    });
    expect(point).not.toBeNull();
    await page.mouse.move(point!.x, point!.y);
    await expect(page.getByText(/Click the edge to trace this connection/)).toBeVisible();

    // Insights tab exposes detected flows and the guided tour.
    await page.getByRole("button", { name: "insights" }).click();
    await expect(page.getByText("Most connected")).toBeVisible();
    await expect(page.getByText(/Flows ·/)).toBeVisible();
    await page.getByRole("button", { name: /Play tour/ }).click();
    await expect(page.getByText(/tour 1\//)).toBeVisible();
    await page.getByRole("button", { name: "Exit trace" }).click();
    await page.getByRole("button", { name: "nodes", exact: true }).click();
    await expect(
      page.getByRole("complementary", { name: "Explorer" }).getByText("Granularity"),
    ).toBeVisible();
  });
});

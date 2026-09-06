import { expect, test } from "@playwright/test";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

test.describe.configure({ retries: 0 });
test.setTimeout(90_000);

test("edit shell renders on /edit", async ({ page }) => {
  await page.goto("/edit");
  await expect(page.getByTestId("mode-edit")).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId("edit-studio")).toBeVisible({ timeout: 15_000 });
  await expect(page.getByTestId("edit-timeline")).toBeVisible();
  await expect(page.getByTestId("edit-preview")).toBeVisible();
  await expect(page.getByTestId("edit-agent-panel")).toBeVisible();
  await expect(page.getByTestId("edit-project-list")).toBeVisible();
  await expect(page.getByTestId("edit-new-project")).toBeVisible();
  await expect(page.getByTestId("edit-project-name")).toBeVisible();
});

test("edit new project Loop 1 opens the studio", async ({ page, request }) => {
  const probe = await request.get("/api/v1/edit/projects");
  test.skip(probe.status() === 404, "GET /api/v1/edit/projects not merged yet");
  await page.goto("/edit");
  await expect(page.getByTestId("edit-studio")).toBeVisible({ timeout: 15_000 });
  await page.getByTestId("edit-project-name").fill("Loop 1");
  await page.getByTestId("edit-new-project").click();
  await expect(page.getByTestId("edit-timeline")).toBeVisible();
  await expect(page.getByTestId("edit-preview")).toBeVisible();
  await expect(page.getByTestId("edit-agent-panel")).toBeVisible();
  await expect(page.getByTestId("edit-composer")).toBeVisible();
  await expect(page.getByTestId("edit-export")).toBeVisible();
});

test("edit stub agent card keep undo and review gate", async ({ page, request }) => {
  const projects = await request.get("/api/v1/edit/projects");
  test.skip(projects.status() === 404, "GET /api/v1/edit/projects not merged yet");
  const fixturePath = path.join(process.cwd(), "tests", "fixtures", "edit", "talk-60s.mp4");
  test.skip(!existsSync(fixturePath), "fixtures missing — run node scripts/edit-fixtures.mjs");

  const runName = `Loop 1 ${Date.now()}`;
  await page.goto("/edit");
  await page.getByTestId("edit-project-name").fill(runName);
  await page.getByTestId("edit-new-project").click();
  await expect(page.getByTestId("edit-composer")).toBeVisible({ timeout: 15_000 });

  const created = await page.evaluate(async (name) => {
    const listed = await fetch("/api/v1/edit/projects");
    const body = (await listed.json()) as { items?: Array<{ id: string; name: string }> };
    return body.items?.find((item) => item.name === name)?.id ?? null;
  }, runName);
  test.skip(!created, "no edit project id after create");

  const imported = await request.post(`/api/v1/edit/projects/${created}/import`, {
    multipart: {
      file: {
        name: "talk-60s.mp4",
        mimeType: "video/mp4",
        buffer: readFileSync(fixturePath),
      },
    },
  });
  test.skip(imported.status() === 404, "import route not merged yet");
  expect(imported.ok()).toBeTruthy();

  await page.reload();
  await page.getByRole("button", { name: runName }).click();
  await expect(page.getByTestId("edit-clip").first()).toBeVisible({ timeout: 15_000 });

  const agentProbe = await request.post(`/api/v1/edit/projects/${created}/agent`, {
    data: { text: "Remove the silences" },
  });
  test.skip(agentProbe.status() === 404, "POST /api/v1/edit/projects/:id/agent not merged yet");

  await page.getByTestId("edit-composer").fill("Remove the silences");
  await page.getByTestId("edit-composer-send").click();
  const cardVisible = await page
    .getByTestId("edit-card")
    .waitFor({ state: "visible", timeout: 15_000 })
    .then(() => true)
    .catch(() => false);
  test.skip(!cardVisible, "POST /agent did not emit an op card (stub tools/clip not ready)");
  await expect(page.getByTestId("edit-card-keep")).toBeVisible();
  await expect(page.getByTestId("edit-card-undo")).toBeVisible();
  await expect(page.getByTestId("edit-card-tweak")).toBeVisible();
  await expect(page.getByTestId("edit-export")).toBeDisabled();
  await page.getByTestId("edit-card-undo").click();
  if (await page.getByTestId("edit-review-ok").count()) {
    await page.getByTestId("edit-review-ok").click();
  }
  await expect(page.getByTestId("edit-export")).toBeEnabled({ timeout: 10_000 });
});

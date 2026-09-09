import { expect, test } from "@playwright/test";

test.describe.configure({ retries: 0 });

test.setTimeout(180_000);

test("chat and workspaces work without an account", async ({ page }) => {
  const runId = Date.now().toString(36);
  const promptOne = `E2E one ${runId}: What is 2 + 3?`;
  const promptTwo = `E2E two ${runId}: Session two check`;
  const deskName = `Legal desk ${runId}`;

  await page.goto("/chat");
  await expect(page.getByTestId("model-picker")).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId("composer")).toBeVisible();
  await expect(page.getByTestId("chat-empty")).toContainText("Ask anything");
  await expect(page.getByTestId("mode-chat")).toBeVisible();
  await expect(page.getByTestId("mode-documents")).toBeVisible();
  await expect(page.getByTestId("mode-research")).toBeVisible();
  await expect(page.getByTestId("mode-finance")).toBeVisible();
  await expect(page.getByTestId("mode-data")).toBeVisible();
  await expect(page.getByTestId("mode-market")).toBeVisible();
  await expect(page.getByTestId("mode-images")).toBeVisible();
  await expect(page.getByTestId("mode-videos")).toBeVisible();
  await expect(page.getByTestId("mode-edit")).toBeVisible();
  await expect(page.getByTestId("mode-presentations")).toBeVisible();
  await expect(page.getByTestId("mode-knowledge")).toBeVisible();
  await expect(page.getByTestId("mode-agents")).toHaveCount(0);
  await expect(page.getByTestId("workspaces-switcher")).toBeVisible();
  await expect(page.getByTestId("workspaces-link")).toBeVisible();

  await page.getByTestId("composer-text").fill(promptOne);
  await page.getByTestId("composer-send").click();
  await expect(page.getByTestId("message-list")).toContainText(promptOne, { timeout: 20_000 });
  await expect(page.getByTestId("composer-send")).toHaveText("Send", { timeout: 30_000 });
  await expect(page.getByTestId("thread-list")).toContainText(promptOne);

  await page.getByTestId("new-chat").click();
  await expect(page.getByTestId("chat-empty")).toContainText("Ask anything", { timeout: 10_000 });
  await page.getByTestId("composer-text").fill(promptTwo);
  await page.getByTestId("composer-send").click();
  await expect(page.getByTestId("message-list")).toContainText(promptTwo, { timeout: 20_000 });
  await expect(page.getByTestId("composer-send")).toHaveText("Send", { timeout: 30_000 });
  await expect(page.getByTestId("thread-list")).toContainText(promptTwo);
  await page.getByTestId("thread-item").filter({ hasText: promptOne }).click();
  await expect(page.getByTestId("message-list")).toContainText(promptOne);

  await page.getByTestId("settings-link").click();
  await expect(page).toHaveURL(/\/settings/, { timeout: 30_000 });
  await expect(page.getByTestId("settings-form")).toBeVisible({ timeout: 15_000 });
  await expect(page.getByTestId("privacy-note")).toBeVisible();
  await expect(page.getByTestId("key-fingerprint")).toHaveCount(0);
  await expect(page.getByTestId("runtime-status")).toContainText("Offline demo", { timeout: 15_000 });
  await expect(page.getByTestId("usage-this-key")).toContainText("Paste a gateway key");
  await expect(page.getByTestId("usage-open")).toBeVisible();
  await expect(page.getByTestId("usage-by-model")).toHaveCount(0);
  await expect(page.getByTestId("usage-desk-estimate")).toHaveCount(0);
  await expect(page.getByTestId("settings-tab-simple")).toHaveCount(0);
  await expect(page.getByTestId("settings-tab-advanced")).toHaveCount(0);
  await expect(page.getByTestId("settings-build-link")).toHaveCount(0);
  await expect(page.getByTestId("openai-base-url")).toHaveCount(0);
  await expect(page.getByTestId("injection-guard-bypass")).toHaveCount(0);

  await expect(page.getByTestId("usage-link")).toBeVisible();
  await page.getByTestId("usage-open").click();
  await expect(page).toHaveURL(/\/usage/, { timeout: 30_000 });
  await expect(page.getByTestId("usage-range")).toBeVisible({ timeout: 15_000 });
  await expect(page.getByTestId("usage-this-key")).toContainText("Paste a gateway key");
  await expect(
    page.getByTestId("usage-range-empty").or(page.getByTestId("usage-range-chart")),
  ).toBeVisible({ timeout: 15_000 });

  await page.getByTestId("mode-images").click();
  await expect(page).toHaveURL(/\/images/, { timeout: 15_000 });
  await expect(page.getByTestId("images-studio")).toBeVisible({ timeout: 15_000 });

  await page.getByTestId("mode-videos").click();
  await expect(page).toHaveURL(/\/videos/, { timeout: 15_000 });
  await expect(page.getByTestId("videos-studio")).toBeVisible({ timeout: 15_000 });
  await expect(page.getByTestId("videos-studio-needs-key")).toBeVisible();

  await page.getByTestId("mode-presentations").click();
  await expect(page).toHaveURL(/\/presentations/, { timeout: 15_000 });
  await expect(page.getByTestId("presentations-studio")).toBeVisible({ timeout: 15_000 });
  await expect(page.getByTestId("presentations-studio-model")).toBeVisible();
  await expect(page.getByTestId("presentations-starter")).toHaveCount(2);
  await page.getByTestId("presentations-starter").first().click();
  await expect(page.getByTestId("presentations-preview")).toBeVisible();
  await expect(page.getByTestId("presentations-regen").first()).toBeVisible();
  await page.getByTestId("presentations-regen").first().click();
  await expect(page.getByTestId("presentations-regen-panel")).toBeVisible();
  await expect(page.getByTestId("presentations-regen-prompt")).toBeVisible();
  await expect(page.getByTestId("presentations-regen-model")).toBeVisible();
  await expect(page.getByTestId("presentations-regen-attach")).toBeVisible();
  await page.getByTestId("presentations-regen-submit").click();
  await expect(page.getByTestId("presentations-error")).toContainText(/gateway|Settings|API key/i, { timeout: 15_000 });

  await page.getByTestId("mode-documents").click();
  await expect(page).toHaveURL(/\/documents/, { timeout: 15_000 });
  await expect(page.getByTestId("documents-studio")).toBeVisible({ timeout: 15_000 });
  await expect(page.getByTestId("documents-studio-model")).toBeVisible();
  await expect(page.getByTestId("documents-starter")).toHaveCount(2);
  await page.getByTestId("documents-starter").first().click();
  await expect(page.getByTestId("documents-preview")).toBeVisible();
  await expect(page.getByTestId("documents-regen").first()).toBeVisible();
  await page.getByTestId("documents-regen").first().click();
  await expect(page.getByTestId("documents-regen-panel")).toBeVisible();
  await expect(page.getByTestId("documents-regen-prompt")).toBeVisible();
  await expect(page.getByTestId("documents-regen-model")).toBeVisible();
  await expect(page.getByTestId("documents-regen-attach")).toBeVisible();
  await page.getByTestId("documents-regen-submit").click();
  await expect(page.getByTestId("documents-error")).toContainText(/gateway|Settings|API key/i, { timeout: 15_000 });

  await page.getByTestId("workspaces-link").click();
  await expect(page).toHaveURL(/\/workspaces/, { timeout: 15_000 });
  await expect(page.getByTestId("create-new-workspace")).toBeVisible();
  await expect(page.getByTestId("workspace-template-picker")).toHaveCount(0);
  await page.getByTestId("create-new-workspace").click();
  await expect(page.getByTestId("workspace-template-picker")).toBeVisible();
  await page.getByTestId("workspace-template-legal").click();
  await page.getByTestId("workspace-name").fill(deskName);
  await page.getByTestId("create-workspace").click();
  await expect(page).toHaveURL(/\/chat/, { timeout: 15_000 });
  await expect(page.getByTestId("mode-chat")).toBeVisible();
  await expect(page.getByTestId("mode-documents")).toBeVisible();
  await expect(page.getByTestId("mode-research")).toBeVisible();
  await expect(page.getByTestId("mode-presentations")).toBeVisible();
  await expect(page.getByTestId("mode-images")).toHaveCount(0);
  await expect(page.getByTestId("mode-videos")).toHaveCount(0);
  await expect(page.getByTestId("mode-edit")).toHaveCount(0);
  await expect(page.getByTestId("mode-finance")).toHaveCount(0);
  await expect(page.getByTestId("mode-data")).toHaveCount(0);
  await expect(page.getByTestId("mode-market")).toHaveCount(0);
  await expect(page.getByTestId("mode-knowledge")).toBeVisible();
  await expect(page.getByTestId("mode-agents")).toHaveCount(0);
});

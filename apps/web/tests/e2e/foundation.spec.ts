import { expect, test } from "@playwright/test";

test.describe.configure({ retries: 0 });

test.setTimeout(180_000);

test("chat and build work without an account", async ({ page }) => {
  const runId = Date.now().toString(36);
  const promptOne = `E2E one ${runId}: What is 2 + 3?`;
  const promptTwo = `E2E two ${runId}: Session two check`;
  const promptAgent = `E2E agent ${runId}: What is 4 + 1?`;

  await page.goto("/chat");
  await expect(page.getByTestId("model-picker")).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId("composer")).toBeVisible();
  await expect(page.getByTestId("chat-empty")).toContainText("Ask anything");
  await expect(page.getByTestId("mode-chat")).toBeVisible();
  await expect(page.getByTestId("mode-agents")).toBeVisible();
  await expect(page.getByTestId("mode-documents")).toHaveCount(0);
  await expect(page.getByTestId("mode-research")).toHaveCount(0);
  await expect(page.getByTestId("mode-images")).toHaveCount(0);
  await expect(page.getByTestId("mode-videos")).toHaveCount(0);
  await expect(page.getByTestId("mode-presentations")).toHaveCount(0);

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
  await expect(page.getByTestId("openai-base-url")).toBeVisible();
  await expect(page.getByTestId("openai-base-url")).toHaveAttribute(
    "placeholder",
    "https://api.tokotokenai.com/v1",
  );
  await expect(page.getByTestId("runtime-status")).toContainText("stub", { timeout: 15_000 });
  await expect(page.getByTestId("settings-build-link")).toBeVisible();
  await page.getByText("Extras", { exact: true }).click();
  await expect(page.getByTestId("anthropic-key")).toBeVisible();
  await expect(page.getByTestId("volcengine-key")).toBeVisible();
  await expect(page.getByTestId("fal-key")).toBeVisible();
  await expect(page.getByTestId("image_gen-backend")).toBeVisible();
  await expect(page.getByTestId("video_gen-backend")).toBeVisible();

  await page.getByTestId("mode-agents").click();
  await page.getByTestId("new-agent-link").click();
  await expect(page).toHaveURL(/\/studio\/new/, { timeout: 30_000 });
  await expect(page.getByTestId("create-agent")).toBeEnabled({ timeout: 30_000 });
  await expect(page.getByTestId("template-blank")).toBeVisible();
  await expect(page.getByTestId("template-default")).toBeVisible();
  await expect(page.getByTestId("template-students")).toBeVisible();
  await expect(page.getByTestId("template-marketing")).toBeVisible();
  await expect(page.getByTestId("template-legal")).toBeVisible();
  await expect(page.getByTestId("tool-course_catalog.search")).toHaveCount(0);
  await expect(page.getByTestId("agent-name")).toHaveValue("Assistant");
  await page.getByTestId("create-agent").click();
  await page.waitForURL(/\/studio\/[0-9a-f-]{36}/i, { timeout: 60_000 });
  await expect(page.getByTestId("studio-agent-name")).toHaveText("Assistant", { timeout: 30_000 });
  await expect(page.getByTestId("mode-images")).toBeVisible({ timeout: 15_000 });
  await expect(page.getByTestId("mode-videos")).toBeVisible();
  await expect(page.getByTestId("mode-presentations")).toBeVisible();
  await expect(page.getByTestId("mode-documents")).toHaveCount(0);
  await expect(page.getByTestId("mode-research")).toHaveCount(0);

  await page.getByTestId("share-workspace").click();
  await expect(page.getByTestId("visibility")).toContainText("workspace", { timeout: 15_000 });

  await page.getByRole("link", { name: "Open chat" }).click();
  await page.waitForURL(/\/agents\/[0-9a-f-]{36}/i, { timeout: 30_000 });
  await expect(page.getByTestId("composer")).toBeVisible({ timeout: 15_000 });
  await expect(page.getByTestId("model-picker")).not.toHaveText("Model", { timeout: 15_000 });
  await page.getByTestId("composer-text").fill(promptAgent);
  await page.getByTestId("composer-send").click();
  await expect(page.getByTestId("message-list")).toContainText(promptAgent, { timeout: 30_000 });
  await expect(page.getByTestId("composer-send")).toHaveText("Send", { timeout: 30_000 });

  await page.getByTestId("mode-images").click();
  await expect(page).toHaveURL(/\/images/, { timeout: 15_000 });
  await expect(page.getByTestId("images-studio")).toBeVisible({ timeout: 15_000 });

  await page.getByTestId("mode-videos").click();
  await expect(page).toHaveURL(/\/videos/, { timeout: 15_000 });
  await expect(page.getByTestId("videos-studio")).toBeVisible({ timeout: 15_000 });

  await page.getByTestId("mode-presentations").click();
  await expect(page).toHaveURL(/\/presentations/, { timeout: 15_000 });
  await expect(page.getByTestId("presentations-studio")).toBeVisible({ timeout: 15_000 });
});

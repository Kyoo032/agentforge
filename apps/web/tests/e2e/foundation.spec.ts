import { expect, test } from "@playwright/test";

test.setTimeout(90_000);

test("chat and build work without an account", async ({ page }) => {
  await page.goto("/chat");
  await expect(page.getByTestId("model-picker")).toBeVisible();
  await expect(page.getByTestId("composer")).toBeVisible();
  await expect(page.getByTestId("chat-empty")).toContainText("Ask anything");

  await page.getByTestId("composer-text").fill("What is 2 + 3?");
  await page.getByTestId("composer-send").click();
  await expect(page.getByTestId("message-list")).toContainText("2 + 3", { timeout: 20_000 });
  await expect(page.getByTestId("thread-list")).toContainText("2 + 3");

  await page.getByTestId("new-chat").click();
  await expect(page.getByTestId("chat-empty")).toContainText("Ask anything");
  await page.getByTestId("composer-text").fill("Session two check");
  await page.getByTestId("composer-send").click();
  await expect(page.getByTestId("message-list")).toContainText("Session two check", { timeout: 20_000 });
  await expect(page.getByTestId("thread-list")).toContainText("Session two check");
  await page.getByTestId("thread-item").filter({ hasText: "2 + 3" }).click();
  await expect(page.getByTestId("message-list")).toContainText("2 + 3");

  await page.getByTestId("settings-link").click();
  await expect(page.getByTestId("settings-form")).toBeVisible();
  await expect(page.getByTestId("privacy-note")).toBeVisible();
  await expect(page.getByTestId("openai-base-url")).toBeVisible();
  await expect(page.getByTestId("openai-base-url")).toHaveValue("https://api.tokotokenai.com/v1");
  await page.getByText("Extras", { exact: true }).click();
  await expect(page.getByTestId("anthropic-key")).toBeVisible();
  await expect(page.getByTestId("volcengine-key")).toBeVisible();
  await expect(page.getByTestId("fal-key")).toBeVisible();
  await expect(page.getByTestId("image_gen-backend")).toBeVisible();
  await expect(page.getByTestId("video_gen-backend")).toBeVisible();
  await expect(page.getByTestId("runtime-status")).toContainText("stub");

  await page.getByTestId("new-agent-link").click();
  await expect(page.getByTestId("create-agent")).toBeEnabled();
  await expect(page.getByTestId("template-blank")).toBeVisible();
  await expect(page.getByTestId("template-default")).toBeVisible();
  await expect(page.getByTestId("tool-course_catalog.search")).toHaveCount(0);
  await expect(page.getByTestId("agent-name")).toHaveValue("Assistant");
  await page.getByTestId("create-agent").click();
  await page.waitForURL(/\/studio\/[0-9a-f-]{36}/i);
  await expect(page.getByTestId("studio-agent-name")).toHaveText("Assistant");

  await page.getByTestId("share-workspace").click();
  await expect(page.getByTestId("visibility")).toContainText("workspace");

  await page.getByRole("link", { name: "Open chat" }).click();
  await page.getByTestId("composer-text").fill("What is 4 + 1?");
  await page.getByTestId("composer-send").click();
  await expect(page.getByTestId("message-list")).toContainText("4 + 1", { timeout: 20_000 });
});

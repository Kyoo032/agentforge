import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const web = join(dirname(fileURLToPath(import.meta.url)), "..");

describe("finance chooser mascot", () => {
  it("mounts the finance mascot on /finance with no task, before the chooser", () => {
    const studio = readFileSync(join(web, "components/finance-studio.tsx"), "utf8");
    const view = readFileSync(join(web, "components/finance-studio-view.tsx"), "utf8");
    expect(studio).toContain('const showChooser = onFinance && (taskQuery == null || taskQuery.trim() === "");');
    const branch = view.slice(view.indexOf("showChooser ? ("), view.indexOf(") : ("));
    expect(branch).toContain('<ModeIllustration mode="finance" />');
    expect(branch.indexOf('<ModeIllustration mode="finance" />')).toBeLessThan(branch.indexOf("<FinanceChooser"));
  });
});

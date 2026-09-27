import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { editCardOffersKeep, editCardOffersRevert } from "./edit-card-actions";

const web = join(dirname(fileURLToPath(import.meta.url)), "..");

describe("edit card actions", () => {
  it("hides Keep once the clip is already on the timeline", () => {
    expect(editCardOffersKeep("proposed")).toBe(true);
    expect(editCardOffersKeep("applied")).toBe(false);
    expect(editCardOffersKeep("kept")).toBe(false);
    expect(editCardOffersRevert("applied")).toBe(true);
    expect(editCardOffersRevert("undone")).toBe(false);
  });

  it("names a new project from the catalog, not Loop 1", () => {
    const studio = readFileSync(join(web, "components/edit-studio.tsx"), "utf8");
    const en = JSON.parse(readFileSync(join(web, "locales/en/edit.json"), "utf8")) as {
      defaultProjectName: string;
    };
    const id = JSON.parse(readFileSync(join(web, "locales/id/edit.json"), "utf8")) as {
      defaultProjectName: string;
    };
    expect(studio).toContain('useState(() => t("edit.defaultProjectName"))');
    expect(studio).not.toContain('useState("Loop 1")');
    expect(studio).not.toContain('"Untitled"');
    expect(en.defaultProjectName).not.toBe("Loop 1");
    expect(id.defaultProjectName).not.toBe("Loop 1");
    expect(id.defaultProjectName).not.toBe(en.defaultProjectName);
  });
});

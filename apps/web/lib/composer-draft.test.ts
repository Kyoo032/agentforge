import { describe, expect, it, beforeEach } from "vitest";
import { readComposerDraft, resetComposerDraftForTests, writeComposerDraft } from "./composer-draft";

const file = new File(["hello"], "notes.txt", { type: "text/plain" });

describe("composer draft stash", () => {
  beforeEach(() => {
    resetComposerDraftForTests();
  });

  it("keeps an unsent attachment when the boot desk id arrives", () => {
    writeComposerDraft(null, { text: "hold", files: [{ id: "1", file, kind: "text" }] });
    const next = readComposerDraft("desk-1");
    expect(next.text).toBe("hold");
    expect(next.files.map((item) => item.file.name)).toEqual(["notes.txt"]);
    expect(readComposerDraft("desk-1").files).toHaveLength(1);
  });

  it("drops the draft when the owner switches desks", () => {
    writeComposerDraft("desk-1", { text: "hold", files: [{ id: "1", file, kind: "text" }] });
    const next = readComposerDraft("desk-2");
    expect(next.text).toBe("");
    expect(next.files).toEqual([]);
  });
});

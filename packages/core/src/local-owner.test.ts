import { describe, expect, it } from "vitest";
import { pickWorkspaceId, slugifyWorkspace } from "./local-owner";

describe("pickWorkspaceId", () => {
  const workspaces = [
    { id: "ws-notes", slug: "notes" },
    { id: "ws-home", slug: "home" },
  ];

  it("uses the preferred workspace when it belongs to the owner", () => {
    expect(pickWorkspaceId(workspaces, "ws-notes")).toBe("ws-notes");
  });

  it("falls back to home, then first workspace", () => {
    expect(pickWorkspaceId(workspaces, "missing")).toBe("ws-home");
    expect(pickWorkspaceId([{ id: "only", slug: "lab" }], null)).toBe("only");
  });
});

describe("slugifyWorkspace", () => {
  it("builds a stable slug", () => {
    expect(slugifyWorkspace("Thesis Lab")).toBe("thesis-lab");
  });
});

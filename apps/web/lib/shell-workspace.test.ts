/**
 * The desk the shell shows comes from `GET /api/v1/workspaces`, and every work mode is keyed on it
 * (`WorkModeKeepAlive`): a different id — including `null` — unmounts and remounts all of them,
 * which ends a live Meeting recording and every job pane's in-flight state.
 *
 * The shell re-reads it on every navigation, and it used to take the body without looking at the
 * status: a refusal (a 401 as a session lapsed, a 5xx, a proxy's error page) read as "no desks",
 * nulled the id and remounted everything. These cases pin the rule that replaced it: only an answer
 * that names a desk changes the shell; anything else leaves it where it was.
 */
import { describe, expect, it } from "vitest";
import { shellWorkspaceFrom } from "@/src/App";

const PAYLOAD = {
  currentWorkspaceId: "ws_legal",
  workspaces: [
    { id: "ws_home", name: "Default", productModes: ["chat"] },
    { id: "ws_legal", name: "Legal", productModes: ["chat", "legal"] },
  ],
};

describe("shellWorkspaceFrom", () => {
  it("shows the desk the host says is current", () => {
    expect(shellWorkspaceFrom(true, PAYLOAD)).toEqual({
      id: "ws_legal",
      name: "Legal",
      productModes: ["chat", "legal"],
    });
  });

  it("falls back to the first desk when the current one is not in the list", () => {
    expect(shellWorkspaceFrom(true, { ...PAYLOAD, currentWorkspaceId: "ws_gone" })?.id).toBe("ws_home");
  });

  it("leaves the shell alone on a refusal, whatever the body says", () => {
    expect(shellWorkspaceFrom(false, PAYLOAD)).toBeNull();
    expect(shellWorkspaceFrom(false, { error: { code: "session_required", message: "Sign in" } })).toBeNull();
  });

  it("leaves the shell alone when a 2xx names no desk", () => {
    expect(shellWorkspaceFrom(true, null)).toBeNull();
    expect(shellWorkspaceFrom(true, {})).toBeNull();
    expect(shellWorkspaceFrom(true, { workspaces: [] })).toBeNull();
    expect(shellWorkspaceFrom(true, "<html>")).toBeNull();
  });

  it("skips rows it cannot use rather than naming a desk with no id", () => {
    const payload = { currentWorkspaceId: "x", workspaces: [{ name: "No id" }, { id: "ws_home", name: "Default" }] };
    expect(shellWorkspaceFrom(true, payload)).toEqual({ id: "ws_home", name: "Default", productModes: undefined });
  });
});

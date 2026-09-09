import { describe, expect, it } from "vitest";
import {
  isInstallAction,
  normalizeUpdateSnapshot,
  shortUpdateMessage,
  SUPPORTED_IDLE_STATUS_LINE,
  UNSUPPORTED_STATUS_LINE,
  type UpdateState,
  updateBadge,
  updateButtonTitle,
  updateStatusLine,
  updateVersionLine,
} from "./app-updates-copy";

const ELECTRON_UPDATER_DUMP = [
  "404 Not Found",
  '"method: GET url: https://github.com/Kyoo032/agentforge/releases.atom',
  "",
  "Please double check that your authentication token is correct. Due to security reasons, actual status maybe not reported, but 404.",
  '"',
  "Headers: {",
  '  "date": "Mon, 07 Sep 2026 03:00:00 GMT",',
  '  "content-type": "text/plain; charset=utf-8",',
  '  "set-cookie": [ "_gh_sess=abc; path=/; HttpOnly; secure" ]',
  "}",
].join("\n");

function state(partial: Partial<UpdateState>): UpdateState {
  return { supported: true, status: "idle", ...partial };
}

describe("shortUpdateMessage", () => {
  it("reduces the electron-updater 404 dump to the HTTP status line", () => {
    expect(shortUpdateMessage(ELECTRON_UPDATER_DUMP, "x")).toBe("404 Not Found");
  });

  it("reduces the dump when wrapped in an Error", () => {
    expect(shortUpdateMessage(new Error(ELECTRON_UPDATER_DUMP), "x")).toBe("404 Not Found");
  });

  it("handles a status line and quoted body on a single line", () => {
    expect(shortUpdateMessage('403 Forbidden "method: GET url: https://example.test"', "x")).toBe("403 Forbidden");
  });

  it("keeps a status line when only Headers: marks the dump", () => {
    expect(shortUpdateMessage("500 Internal Server Error\nHeaders: {}", "x")).toBe("500 Internal Server Error");
  });

  it("returns the first non-empty line of a multi-line message", () => {
    expect(shortUpdateMessage("\n\n  net::ERR_INTERNET_DISCONNECTED  \nmore detail", "x")).toBe(
      "net::ERR_INTERNET_DISCONNECTED",
    );
  });

  it("uses Error.message for errors", () => {
    expect(shortUpdateMessage(new Error("Cannot find latest.yml"), "x")).toBe("Cannot find latest.yml");
  });

  it("uses message-like objects that lost their Error prototype over IPC", () => {
    expect(shortUpdateMessage({ message: "Signature check failed" }, "x")).toBe("Signature check failed");
  });

  it("returns a trimmed plain string", () => {
    expect(shortUpdateMessage("  Update server unreachable.  ", "x")).toBe("Update server unreachable.");
  });

  it("falls back for empty, whitespace, undefined, null, and non-message values", () => {
    expect(shortUpdateMessage("", "Update check failed.")).toBe("Update check failed.");
    expect(shortUpdateMessage("   \n  ", "Update check failed.")).toBe("Update check failed.");
    expect(shortUpdateMessage(undefined, "Update check failed.")).toBe("Update check failed.");
    expect(shortUpdateMessage(null, "Update check failed.")).toBe("Update check failed.");
    expect(shortUpdateMessage(42, "Update check failed.")).toBe("Update check failed.");
    expect(shortUpdateMessage(new Error(""), "Update check failed.")).toBe("Update check failed.");
  });

  it("caps an over-long single line at 160 characters with an ellipsis", () => {
    const long = "x".repeat(400);
    const result = shortUpdateMessage(long, "x");
    expect(result).toHaveLength(160);
    expect(result.endsWith("…")).toBe(true);
    expect(result.startsWith("x".repeat(159))).toBe(true);
  });

  it("does not add an ellipsis to a line of exactly 160 characters", () => {
    const exact = "y".repeat(160);
    expect(shortUpdateMessage(exact, "x")).toBe(exact);
  });
});

describe("updateStatusLine", () => {
  it("describes checking", () => {
    expect(updateStatusLine(state({ status: "checking" }), true)).toBe("Checking GitHub Releases…");
  });

  it("describes current", () => {
    expect(updateStatusLine(state({ status: "current" }), true)).toBe("You are on the latest DPSBuddy.");
  });

  it("describes available with and without a version", () => {
    expect(updateStatusLine(state({ status: "available", version: "0.14.2" }), true)).toBe(
      "Version 0.14.2 is ready to download.",
    );
    expect(updateStatusLine(state({ status: "available" }), true)).toBe("Version  is ready to download.");
  });

  it("describes downloading with a rounded percent or an ellipsis", () => {
    expect(updateStatusLine(state({ status: "downloading", percent: 42.6 }), true)).toBe("Downloading 43%");
    expect(updateStatusLine(state({ status: "downloading" }), true)).toBe("Downloading…");
  });

  it("describes ready", () => {
    expect(updateStatusLine(state({ status: "ready", version: "0.14.2" }), true)).toBe(
      "Version 0.14.2 is downloaded. Restart to finish.",
    );
  });

  it("shortens the error message and falls back when missing", () => {
    expect(updateStatusLine(state({ status: "error", message: ELECTRON_UPDATER_DUMP }), true)).toBe("404 Not Found");
    expect(updateStatusLine(state({ status: "error" }), true)).toBe("Update check failed.");
    expect(updateStatusLine(state({ status: "error", message: "  " }), true)).toBe("Update check failed.");
  });

  it("describes idle and unavailable based on support", () => {
    expect(updateStatusLine(state({ status: "idle" }), true)).toBe(
      "New GitHub releases download here, then DPSBuddy restarts.",
    );
    expect(updateStatusLine(state({ status: "idle" }), false)).toBe(
      "Available in the installed DPSBuddy app. New GitHub releases download and restart the app.",
    );
    expect(updateStatusLine(state({ status: "unavailable" }), false)).toBe(
      "Available in the installed DPSBuddy app. New GitHub releases download and restart the app.",
    );
  });

  it("shows the shell's own reason when updates are unsupported, never when supported", () => {
    const macReason = "Updates on macOS are manual for now. Download the new .dmg from GitHub Releases.";
    expect(updateStatusLine(state({ status: "unavailable", message: macReason }), false)).toBe(macReason);
    expect(updateStatusLine(state({ status: "unavailable", message: "   " }), false)).toBe(
      "Available in the installed DPSBuddy app. New GitHub releases download and restart the app.",
    );
    expect(updateStatusLine(state({ status: "idle", message: macReason }), true)).toBe(
      "New GitHub releases download here, then DPSBuddy restarts.",
    );
  });
});

describe("updateVersionLine", () => {
  it("names the installed version", () => {
    expect(updateVersionLine("0.14.1")).toBe("This install is 0.14.1.");
  });

  it("returns an empty string when the version is unknown", () => {
    expect(updateVersionLine(undefined)).toBe("");
    expect(updateVersionLine("")).toBe("");
  });
});

describe("normalizeUpdateSnapshot", () => {
  it("keeps a known status", () => {
    expect(normalizeUpdateSnapshot({ supported: true, status: "ready", version: "0.14.2" }, "idle")).toEqual({
      supported: true,
      status: "ready",
      version: "0.14.2",
    });
  });

  it("replaces an unknown or missing status with the fallback", () => {
    expect(normalizeUpdateSnapshot({ supported: true, status: "exploded" }, "error")).toEqual({
      supported: true,
      status: "error",
    });
    expect(normalizeUpdateSnapshot({ supported: false }, "unavailable")).toEqual({
      supported: false,
      status: "unavailable",
    });
  });

  it("coerces supported to a boolean and drops undefined fields", () => {
    const loose = { supported: undefined, status: "current", message: undefined } as unknown as Parameters<
      typeof normalizeUpdateSnapshot
    >[0];
    expect(normalizeUpdateSnapshot(loose, "idle")).toEqual({ supported: false, status: "current" });
  });
});

describe("updateBadge", () => {
  it("shows the accent dot only when something can be installed", () => {
    expect(updateBadge(state({ status: "available", version: "0.14.21" }))).toBe("available");
    expect(updateBadge(state({ status: "ready", version: "0.14.21" }))).toBe("available");
  });

  it("pulses while checking or downloading", () => {
    expect(updateBadge(state({ status: "checking" }))).toBe("busy");
    expect(updateBadge(state({ status: "downloading", percent: 40 }))).toBe("busy");
  });

  it("stays quiet for idle, current, error, and unavailable", () => {
    for (const status of ["idle", "current", "error", "unavailable"] as const) {
      expect(updateBadge(state({ status }))).toBeNull();
    }
  });
});

describe("isInstallAction", () => {
  it("switches the primary action to install once a version is downloadable", () => {
    expect(isInstallAction(state({ status: "available" }))).toBe(true);
    expect(isInstallAction(state({ status: "ready" }))).toBe(true);
    expect(isInstallAction(state({ status: "downloading" }))).toBe(true);
    expect(isInstallAction(state({ status: "idle" }))).toBe(false);
    expect(isInstallAction(state({ status: "error" }))).toBe(false);
  });
});

describe("updateButtonTitle", () => {
  it("prefixes the status line so the icon reads as Updates", () => {
    expect(updateButtonTitle(state({ status: "idle" }), true)).toBe(`Updates: ${SUPPORTED_IDLE_STATUS_LINE}`);
    expect(updateButtonTitle(state({ status: "idle" }), false)).toBe(`Updates: ${UNSUPPORTED_STATUS_LINE}`);
    expect(updateButtonTitle(state({ status: "available", version: "0.14.21" }), true)).toBe(
      "Updates: Version 0.14.21 is ready to download.",
    );
  });
});

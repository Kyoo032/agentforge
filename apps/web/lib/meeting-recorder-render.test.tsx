/**
 * The Record control, actually rendered, in both languages.
 *
 * Same reasoning as `component-setup-render.test.tsx`: a testid on a branch nothing reaches and an
 * error code with no copy behind it both survive a source grep. Every recorder error code is built
 * by template (`meeting.record.errors.${code}`), so the catalog check in `meeting-locale.test.ts`
 * cannot see any of them — rendering the panel once per code is the only thing that can.
 *
 * The environment is node, so this is markup, not a browser: clicks, the microphone and the live
 * timer are not covered here.
 */
import { isValidElement, type ReactElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
  MeetingOtherDeskClips,
  MeetingRecorderPanel,
  formatElapsed,
  formatRecordedSize,
} from "@/components/meeting-recorder";
import type { MeetingClipView } from "@/components/meeting-recorder";
import { applyLocale, resetLocaleForTests } from "./i18n";
import type { RecorderErrorCode, RecorderStatus } from "./meeting-recorder";
import type { MeetingRecorderView } from "./use-meeting-recorder";

const ERROR_CODES: RecorderErrorCode[] = [
  "insecure_context",
  "unsupported_browser",
  "permission_denied",
  "no_device",
  "display_unsupported",
  "display_cancelled",
  "display_no_audio",
  "recorder_failed",
  "empty_recording",
];

function view(overrides: Partial<MeetingRecorderView> = {}): MeetingRecorderView {
  return {
    status: "idle" as RecorderStatus,
    source: "mic",
    errorCode: null,
    bytes: 0,
    elapsedMs: 0,
    clip: null,
    supported: true,
    setSource: () => {},
    start: () => {},
    pause: () => {},
    resume: () => {},
    stop: () => {},
    clearClip: () => {},
    clearError: () => {},
    ...overrides,
  };
}

/** What the studio's upload controller tells the panel about the clip it is holding. */
function clipView(overrides: Partial<MeetingClipView> = {}): MeetingClipView {
  return {
    capped: false,
    status: "idle",
    errorMessage: null,
    dismissCapped: () => {},
    retry: () => {},
    save: () => {},
    ...overrides,
  };
}

function render(overrides: Partial<MeetingRecorderView> = {}, disabled = false, clip?: MeetingClipView): string {
  return renderToStaticMarkup(<MeetingRecorderPanel view={view(overrides)} disabled={disabled} clip={clip} />);
}

type ButtonProps = { "data-testid"?: string; onClick?: () => void; children?: ReactNode };

/** Walk a tree the panel returned as a plain function call, to press a button without a DOM. */
function findByTestId(node: ReactNode, testId: string): ReactElement<ButtonProps> | null {
  if (Array.isArray(node)) {
    for (const child of node) {
      const hit = findByTestId(child, testId);
      if (hit) return hit;
    }
    return null;
  }
  if (!isValidElement<ButtonProps>(node)) return null;
  if (node.props["data-testid"] === testId) return node;
  return findByTestId(node.props.children, testId);
}

/** A dotted key that reached the DOM is `t()` saying the catalog has no copy for it. */
function rawKeys(markup: string): string[] {
  return [...markup.matchAll(/meeting\.record\.[\w.]+/g)].map((match) => match[0]);
}

describe("formatElapsed", () => {
  it("counts minutes and seconds, and adds hours only once there are any", () => {
    expect(formatElapsed(0)).toBe("0:00");
    expect(formatElapsed(9_000)).toBe("0:09");
    expect(formatElapsed(754_000)).toBe("12:34");
    expect(formatElapsed(3_723_000)).toBe("1:02:03");
  });

  it("never renders a negative clock", () => {
    expect(formatElapsed(-5_000)).toBe("0:00");
  });
});

describe("formatRecordedSize", () => {
  it("matches the units the studio already reports an uploaded recording in", () => {
    expect(formatRecordedSize(0)).toBe("0 KB");
    expect(formatRecordedSize(2_048)).toBe("2 KB");
    expect(formatRecordedSize(5 * 1024 * 1024)).toBe("5.0 MB");
  });
});

describe("MeetingRecorderPanel", () => {
  it("offers Record and the two sources when idle, and no transport controls", () => {
    const markup = render();
    expect(markup).toContain('data-testid="meeting-recorder"');
    expect(markup).toContain('data-testid="meeting-record-start"');
    expect(markup).toContain('data-testid="meeting-record-source-mic"');
    expect(markup).toContain('data-testid="meeting-record-source-tab"');
    expect(markup).not.toContain('data-testid="meeting-record-stop"');
    expect(markup).not.toContain('data-testid="meeting-record-pause"');
    expect(rawKeys(markup)).toEqual([]);
  });

  it("disables Record while the studio is busy, instead of hiding it", () => {
    const markup = render({}, true);
    expect(markup).toContain('data-testid="meeting-record-start"');
    expect(markup).toMatch(
      /data-testid="meeting-record-start"[^>]*disabled|disabled[^>]*data-testid="meeting-record-start"/,
    );
  });

  it("explains how to share tab audio only when that source is chosen", () => {
    expect(render()).not.toContain('data-testid="meeting-record-tab-hint"');
    expect(render({ source: "mic+tab" })).toContain('data-testid="meeting-record-tab-hint"');
  });

  it("marks the chosen source for assistive tech", () => {
    const markup = render({ source: "mic+tab" });
    const pressed = (testid: string) =>
      new RegExp(`<button[^>]*aria-pressed="true"[^>]*data-testid="${testid}"`).test(markup);
    expect(pressed("meeting-record-source-tab")).toBe(true);
    expect(pressed("meeting-record-source-mic")).toBe(false);
  });

  it("shows the live timer, the running size, Pause and Stop while recording", () => {
    const markup = render({ status: "recording", elapsedMs: 754_000, bytes: 3 * 1024 * 1024 });
    expect(markup).toContain('data-testid="meeting-record-timer"');
    expect(markup).toContain("12:34");
    expect(markup).toContain('data-testid="meeting-record-size"');
    expect(markup).toContain("3.0 MB");
    expect(markup).toContain('data-testid="meeting-record-pause"');
    expect(markup).toContain('data-testid="meeting-record-stop"');
    // Starting again mid-recording, or changing the source, is not offered.
    expect(markup).not.toContain('data-testid="meeting-record-start"');
    expect(markup).not.toContain('data-testid="meeting-record-source"');
  });

  it("offers Resume, not Pause, while paused, and keeps the clock on screen", () => {
    const markup = render({ status: "paused", elapsedMs: 60_000 });
    expect(markup).toContain('data-testid="meeting-record-resume"');
    expect(markup).not.toContain('data-testid="meeting-record-pause"');
    expect(markup).toContain("1:00");
  });

  it("says it is waiting for permission rather than showing a dead Record button", () => {
    const markup = render({ status: "requesting-permission" });
    expect(markup).toContain('data-testid="meeting-record-requesting"');
    expect(markup).not.toContain('data-testid="meeting-record-start"');
    expect(rawKeys(markup)).toEqual([]);
  });

  it("says it is finishing while the recorder flushes the last chunk", () => {
    expect(render({ status: "stopping" })).toContain('data-testid="meeting-record-stopping"');
  });

  /**
   * The notice used to be rendered from `view.clip?.capped`, so it vanished the instant the studio
   * took the clip — which is immediately. It is a flag on the upload controller now, and the panel
   * renders whatever that flag says, clip or no clip.
   */
  it("tells the owner when the size cap stopped the recording, with no clip left in the recorder", () => {
    const markup = render({}, false, clipView({ capped: true }));
    expect(markup).toContain('data-testid="meeting-record-capped"');
    expect(markup).toContain('data-testid="meeting-record-capped-dismiss"');
    expect(rawKeys(markup)).toEqual([]);
  });

  it("says a queued recording is waiting rather than showing nothing at all", () => {
    const markup = render({}, true, clipView({ status: "queued" }));
    expect(markup).toContain('data-testid="meeting-clip-queued"');
    expect(markup).not.toContain('data-testid="meeting-clip-failed"');
    expect(rawKeys(markup)).toEqual([]);
  });

  /** The two ways out of a failed upload. Neither exists if the bytes were already thrown away. */
  it("offers Retry and Save to device when the upload failed, with the host's own words", () => {
    const markup = render({}, false, clipView({ status: "failed", errorMessage: "That file is too large." }));
    expect(markup).toContain('data-testid="meeting-clip-failed"');
    expect(markup).toContain('data-testid="meeting-clip-retry"');
    expect(markup).toContain('data-testid="meeting-clip-save"');
    expect(markup).toContain("That file is too large.");
    expect(rawKeys(markup)).toEqual([]);
  });

  it("shows neither notice when there is no clip to talk about", () => {
    const markup = render();
    expect(markup).not.toContain('data-testid="meeting-record-capped"');
    expect(markup).not.toContain('data-testid="meeting-clip-queued"');
    expect(markup).not.toContain('data-testid="meeting-clip-failed"');
  });

  it("replaces the whole control with one sentence when the browser cannot record", () => {
    const markup = render({ supported: false });
    expect(markup).toContain('data-testid="meeting-record-unsupported"');
    expect(markup).not.toContain('data-testid="meeting-record-start"');
    expect(rawKeys(markup)).toEqual([]);
  });

  it.each(["en", "id"])("has copy, not a dotted key, for every error code in %s", (locale) => {
    resetLocaleForTests();
    applyLocale(locale);
    try {
      for (const code of ERROR_CODES) {
        const markup = render({ status: "error", errorCode: code });
        expect(markup, code).toContain('data-testid="meeting-record-error"');
        expect(markup, code).toContain('data-testid="meeting-record-dismiss"');
        expect(rawKeys(markup), `${locale} / ${code} has no copy in the catalog`).toEqual([]);
      }
      // And the rest of the panel, so a missing id string is caught here too.
      expect(rawKeys(render({ source: "mic+tab" })), locale).toEqual([]);
      expect(rawKeys(render({ status: "recording" })), locale).toEqual([]);
      expect(rawKeys(render({}, false, clipView({ capped: true }))), locale).toEqual([]);
      expect(rawKeys(render({}, true, clipView({ status: "queued" }))), locale).toEqual([]);
      expect(rawKeys(render({}, false, clipView({ status: "failed" }))), locale).toEqual([]);
    } finally {
      resetLocaleForTests();
    }
  });
});

/**
 * The clip names its own meeting. After Stop the owner may open another meeting while the upload
 * runs, so a failure notice that said only "that recording" could be read as being about the row on
 * screen. It says which meeting the recording belongs to — the one Retry will post to.
 */
describe("MeetingRecorderPanel — whose recording", () => {
  it("names the meeting the failed recording belongs to", () => {
    const markup = render({}, false, clipView({ status: "failed", meetingTitle: "Checkout weekly" }));
    expect(markup).toContain('data-testid="meeting-clip-failed"');
    expect(markup).toContain("Checkout weekly");
    expect(rawKeys(markup)).toEqual([]);
  });

  it("falls back to the plain notice when it does not know the meeting", () => {
    const markup = render({}, false, clipView({ status: "failed", meetingTitle: null }));
    expect(markup).toContain("That recording was not uploaded.");
  });
});

/**
 * Two ways a recording now ends early without losing anything: the encoder fails, or the studio is
 * unmounted (a desk or language change). Both keep what was captured; the owner is told so, once,
 * until they dismiss it or record again — otherwise "Try again" invites a second recording that
 * would replace the one that was kept.
 */
describe("MeetingRecorderPanel — a recording that stopped early", () => {
  it("says the captured audio was kept after a recorder failure", () => {
    const markup = render({ status: "error", errorCode: "recorder_failed" }, false, clipView({ kept: "salvaged" }));
    expect(markup).toContain('data-testid="meeting-record-error"');
    expect(markup).toContain('data-testid="meeting-record-kept"');
    expect(markup).toContain("Everything recorded before it stopped was kept.");
    expect(rawKeys(markup)).toEqual([]);
  });

  it("says why it stopped when the page changed under it", () => {
    const markup = render({}, false, clipView({ kept: "interrupted" }));
    expect(markup).toContain('data-testid="meeting-record-kept"');
    expect(markup).toContain("The recording stopped when the desk or the language changed.");
    expect(markup).toContain('data-testid="meeting-record-kept-dismiss"');
  });

  it("says nothing about it otherwise", () => {
    expect(render({}, false, clipView())).not.toContain('data-testid="meeting-record-kept"');
  });

  it("dismisses through the studio", () => {
    let dismissed = 0;
    const tree = MeetingRecorderPanel({
      view: view(),
      clip: clipView({ kept: "interrupted", dismissKept: () => (dismissed += 1) }),
    });
    const button = findByTestId(tree, "meeting-record-kept-dismiss");
    button?.props.onClick?.();
    expect(dismissed).toBe(1);
  });
});

/**
 * A recording rescued from another desk's studio. It cannot be uploaded here — the host resolves a
 * meeting against the desk that is selected now — so it is shown with the one way out that works
 * anywhere, and waits for its own desk.
 */
describe("MeetingOtherDeskClips", () => {
  it("lists each held recording by meeting, with Save to device", () => {
    const saved: string[] = [];
    const items = [
      { key: "a", title: "Checkout weekly" },
      { key: "b", title: "Board prep" },
    ];
    const markup = renderToStaticMarkup(<MeetingOtherDeskClips items={items} onSave={(key) => saved.push(key)} />);
    expect(markup).toContain('data-testid="meeting-clip-other-desk"');
    expect(markup).toContain("Checkout weekly");
    expect(markup).toContain("Board prep");
    expect(rawKeys(markup)).toEqual([]);

    const tree = MeetingOtherDeskClips({ items, onSave: (key) => saved.push(key) });
    findByTestId(tree, "meeting-clip-other-desk-save-b")?.props.onClick?.();
    expect(saved).toEqual(["b"]);
  });

  it("renders nothing when nothing is held", () => {
    expect(renderToStaticMarkup(<MeetingOtherDeskClips items={[]} onSave={() => {}} />)).toBe("");
  });
});

describe.each(["en", "id"])("the new clip notices in %s", (locale) => {
  it("have copy for every branch", () => {
    resetLocaleForTests();
    applyLocale(locale);
    try {
      expect(rawKeys(render({}, false, clipView({ status: "failed", meetingTitle: "X" })))).toEqual([]);
      expect(rawKeys(render({ status: "error", errorCode: "recorder_failed" }, false, clipView({ kept: "salvaged" })))).toEqual(
        [],
      );
      expect(rawKeys(render({}, false, clipView({ kept: "interrupted" })))).toEqual([]);
      expect(
        rawKeys(renderToStaticMarkup(<MeetingOtherDeskClips items={[{ key: "a", title: "X" }]} onSave={() => {}} />)),
      ).toEqual([]);
    } finally {
      resetLocaleForTests();
    }
  });
});

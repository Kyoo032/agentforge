import type { DesktopUpdateSnapshot } from "./desktop-bridge";

export type UpdateStatus =
  | "idle"
  | "checking"
  | "current"
  | "available"
  | "downloading"
  | "ready"
  | "error"
  | "unavailable";

export type UpdateState = {
  supported: boolean;
  status: UpdateStatus;
  currentVersion?: string;
  version?: string;
  percent?: number;
  message?: string;
};

const UPDATE_STATUSES: readonly UpdateStatus[] = [
  "idle",
  "checking",
  "current",
  "available",
  "downloading",
  "ready",
  "error",
  "unavailable",
];

/** Longest status message the Updates panel will show, ellipsis included. */
const MAX_MESSAGE_LENGTH = 160;
const ELLIPSIS = "…";

/** `404 Not Found` followed (possibly after a newline) by the quoted body electron-updater appends. */
const HTTP_STATUS_WITH_QUOTED_BODY = /^\d{3}\s+[^"\n]+\s*"/;
/** Leading `NNN <reason>` portion of an HTTP status line. */
const HTTP_STATUS_LINE = /^\d{3}\s+[^"\n]+/;
const HEADERS_MARKER = "Headers:";

export const UNSUPPORTED_STATUS_LINE =
  "Available in the installed DPSBuddy app. New GitHub releases download and restart the app.";
export const SUPPORTED_IDLE_STATUS_LINE = "New GitHub releases download here, then DPSBuddy restarts.";
export const CHECK_FAILED_FALLBACK = "Update check failed.";

function isUpdateStatus(value: unknown): value is UpdateStatus {
  return typeof value === "string" && (UPDATE_STATUSES as readonly string[]).includes(value);
}

function messageText(input: unknown): string {
  if (typeof input === "string") {
    return input;
  }
  if (input instanceof Error) {
    return input.message;
  }
  if (input && typeof input === "object" && "message" in input && typeof input.message === "string") {
    return input.message;
  }
  return "";
}

function firstNonEmptyLine(text: string): string {
  return (
    text
      .split(/\r?\n/)
      .map((line) => line.trim())
      .find((line) => line.length > 0) ?? ""
  );
}

function looksLikeUpdaterDump(text: string): boolean {
  return text.includes(HEADERS_MARKER) || HTTP_STATUS_WITH_QUOTED_BODY.test(text);
}

function capLength(text: string): string {
  if (text.length <= MAX_MESSAGE_LENGTH) {
    return text;
  }
  return `${text.slice(0, MAX_MESSAGE_LENGTH - ELLIPSIS.length)}${ELLIPSIS}`;
}

/**
 * Turns an updater error (Error, string, or IPC-serialised object) into one short line fit for the UI.
 * electron-updater dumps (`404 Not Found "method: GET url: …" Headers: {…}`) collapse to `404 Not Found`.
 */
export function shortUpdateMessage(input: unknown, fallback: string): string {
  const text = messageText(input).trim();
  const firstLine = firstNonEmptyLine(text);
  if (!firstLine) {
    return fallback;
  }
  if (looksLikeUpdaterDump(text)) {
    const status = HTTP_STATUS_LINE.exec(firstLine)?.[0].trim();
    if (status) {
      return status;
    }
  }
  return capLength(firstLine);
}

export function updateVersionLine(currentVersion?: string): string {
  return currentVersion ? `This install is ${currentVersion}.` : "";
}

export function updateStatusLine(state: UpdateState, supported: boolean): string {
  switch (state.status) {
    case "checking":
      return "Checking GitHub Releases…";
    case "current":
      return "You are on the latest DPSBuddy.";
    case "available":
      return `Version ${state.version ?? ""} is ready to download.`;
    case "downloading":
      return `Downloading${state.percent != null ? ` ${Math.round(state.percent)}%` : ELLIPSIS}`;
    case "ready":
      return `Version ${state.version ?? ""} is downloaded. Restart to finish.`;
    case "error":
      return shortUpdateMessage(state.message, CHECK_FAILED_FALLBACK);
    default:
      if (supported) {
        return SUPPORTED_IDLE_STATUS_LINE;
      }
      // The shell may say why updates are off (e.g. unsigned macOS build); the renderer never
      // reads the platform itself, so the reason travels in the snapshot.
      return shortUpdateMessage(state.message, UNSUPPORTED_STATUS_LINE);
  }
}

function definedOptionalFields(next: DesktopUpdateSnapshot): Partial<Omit<UpdateState, "supported" | "status">> {
  const optional: Partial<Omit<UpdateState, "supported" | "status">> = {};
  if (next.currentVersion !== undefined) {
    optional.currentVersion = next.currentVersion;
  }
  if (next.version !== undefined) {
    optional.version = next.version;
  }
  if (next.percent !== undefined) {
    optional.percent = next.percent;
  }
  if (next.message !== undefined) {
    optional.message = next.message;
  }
  return optional;
}

/**
 * Coerces the loosely typed preload snapshot into `UpdateState`. Unknown statuses become `fallbackStatus`;
 * undefined optional fields are dropped so the result can be spread over existing state without erasing it.
 */
export function normalizeUpdateSnapshot(next: DesktopUpdateSnapshot, fallbackStatus: UpdateStatus): UpdateState {
  return {
    ...definedOptionalFields(next),
    supported: Boolean(next.supported),
    status: isUpdateStatus(next.status) ? next.status : fallbackStatus,
  };
}

export type UpdateCtaKind = "available" | "ready" | "downloading";

/** Visible rail call-to-action. Idle/current retract to the icon; never hide a downloadable release. */
export function updateCtaKind(state: UpdateState): UpdateCtaKind | null {
  switch (state.status) {
    case "available":
      return "available";
    case "ready":
      return "ready";
    case "downloading":
      return "downloading";
    default:
      return null;
  }
}

export type UpdateBadge = "available" | "busy" | null;

/** Dot on the rail icon: accent when something is downloadable/installable, pulsing while the updater works. */
export function updateBadge(state: UpdateState): UpdateBadge {
  switch (state.status) {
    case "available":
    case "ready":
      return "available";
    case "checking":
    case "downloading":
      return "busy";
    default:
      return null;
  }
}

/** True when the primary action should download + restart instead of checking again. */
export function isInstallAction(state: UpdateState): boolean {
  return state.status === "available" || state.status === "ready" || state.status === "downloading";
}

/** Tooltip for the rail icon: the same line the panel shows, prefixed so the icon reads as "Updates". */
export function updateButtonTitle(state: UpdateState, supported: boolean): string {
  return `Updates: ${updateStatusLine(state, supported)}`;
}

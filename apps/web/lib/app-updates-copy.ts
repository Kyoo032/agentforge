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
  "Available in the installed Agentforge app. New GitHub releases download and restart the app.";
export const SUPPORTED_IDLE_STATUS_LINE = "New GitHub releases download here, then Agentforge restarts.";
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
      return "You are on the latest Agentforge.";
    case "available":
      return `Version ${state.version ?? ""} is ready to download.`;
    case "downloading":
      return `Downloading${state.percent != null ? ` ${Math.round(state.percent)}%` : ELLIPSIS}`;
    case "ready":
      return `Version ${state.version ?? ""} is downloaded. Restart to finish.`;
    case "error":
      return shortUpdateMessage(state.message, CHECK_FAILED_FALLBACK);
    default:
      return supported ? SUPPORTED_IDLE_STATUS_LINE : UNSUPPORTED_STATUS_LINE;
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

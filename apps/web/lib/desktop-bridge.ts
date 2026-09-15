export type IpcHostRequest = {
  requestId: string;
  method: string;
  path: string;
  query: Record<string, string>;
  body?: unknown;
  files?: Array<{ field: string; filename: string; mime: string; bytes: number[] }>;
};

export type IpcHostResponse =
  | { type: "json"; status: number; body: unknown }
  | { type: "bytes"; status: number; bytes: number[]; contentType: string; filename?: string }
  | { type: "stream"; status: number; requestId: string };

export type DesktopBrandHint = {
  productName?: string;
  gatewayName?: string;
  gatewayBaseUrl?: string;
};

/**
 * Loose snapshot from the Electron main process. `status` stays a plain string here so this module has no
 * dependency on the renderer copy module; use `normalizeUpdateSnapshot` from `./app-updates-copy` to narrow it.
 */
export type DesktopUpdateSnapshot = {
  supported: boolean;
  status?: string;
  currentVersion?: string;
  version?: string;
  percent?: number;
  message?: string;
};

/** Shell restart request. `reset` asks the packaged app to wipe local data on the next boot. */
export type DesktopRelaunchOptions = {
  reset?: boolean;
};

/**
 * What the shell answered. `ok: false` means the restart did **not** happen — the shell refuses
 * while an update installs (`installing-update`), while a quit is already in flight
 * (`already-exiting`), from any frame that is not the main renderer (`forbidden`), and there is no
 * shell at all on webdev (`unavailable`).
 */
export type DesktopRelaunchResult = {
  ok: boolean;
  reason?: string;
};

export type DesktopUpdatesApi = {
  supported: boolean;
  state: () => Promise<DesktopUpdateSnapshot>;
  check: () => Promise<DesktopUpdateSnapshot>;
  download: () => Promise<DesktopUpdateSnapshot>;
  install: () => Promise<void>;
  onStatus?: (callback: (state: DesktopUpdateSnapshot) => void) => () => void;
};

type DesktopBridge = {
  isElectron: true;
  brand?: DesktopBrandHint;
  brandLogo?: string;
  invoke: (payload: IpcHostRequest) => Promise<IpcHostResponse>;
  stream: (requestId: string, onChunk: (chunk: string) => void) => Promise<void>;
  abortStream?: (requestId: string) => void;
  saveBytes?: (filename: string, bytes: number[]) => Promise<void>;
  pickMedia?: () => Promise<string[]>;
  updates?: DesktopUpdatesApi;
  relaunch?: (options?: DesktopRelaunchOptions) => unknown;
};

declare global {
  interface Window {
    agentforge?: DesktopBridge;
  }
}

function desktopBridge(): DesktopBridge | undefined {
  if (typeof window === "undefined") {
    return undefined;
  }
  return window.agentforge;
}

/** True only in the packaged Electron renderer (preload attached). */
export function isElectron(): boolean {
  return Boolean(desktopBridge()?.isElectron);
}

export function getDesktopBrand(): DesktopBrandHint | undefined {
  return desktopBridge()?.brand;
}

export function getDesktopBrandLogo(): string | undefined {
  const logo = desktopBridge()?.brandLogo;
  return typeof logo === "string" && logo.startsWith("data:image/") ? logo : undefined;
}

export function getDesktopUpdates(): DesktopUpdatesApi | undefined {
  return desktopBridge()?.updates;
}

export async function invokeDesktop(payload: IpcHostRequest): Promise<IpcHostResponse> {
  const bridge = desktopBridge();
  if (!bridge) {
    throw new Error("DPSBuddy desktop bridge is not available");
  }
  return bridge.invoke(payload);
}

export function streamDesktop(requestId: string, onChunk: (chunk: string) => void): Promise<void> {
  const bridge = desktopBridge();
  if (!bridge) {
    return Promise.reject(new Error("DPSBuddy desktop bridge is not available"));
  }
  return bridge.stream(requestId, onChunk);
}

export function abortDesktopStream(requestId: string): void {
  desktopBridge()?.abortStream?.(requestId);
}

export async function saveDesktopBytes(filename: string, bytes: number[]): Promise<void> {
  const save = desktopBridge()?.saveBytes;
  if (!save) {
    return;
  }
  await save(filename, bytes);
}

export async function pickMedia(): Promise<string[]> {
  const pick = desktopBridge()?.pickMedia;
  if (!pick) {
    return [];
  }
  return pick();
}

/**
 * Packaged relaunch if preload already exposes it. Does not invent Electron chrome.
 *
 * `{ reset: true }` asks the shell to wipe local data on the next boot.
 *
 * The shell can refuse (see `DesktopRelaunchResult`), and a refusal must never read as a restart in
 * flight: the user would sit waiting for a window that is not coming back. On webdev there is no
 * bridge at all, which is `{ ok: false, reason: "unavailable" }` — the caller tells the operator to
 * restart by hand. A non-object answer is success: on the happy path the process exits before the
 * IPC reply is ever sent, so the promise resolves with whatever Electron had (or never at all).
 */
export async function relaunchDesktopApp(options?: DesktopRelaunchOptions): Promise<DesktopRelaunchResult> {
  const relaunch = desktopBridge()?.relaunch;
  if (typeof relaunch !== "function") {
    return { ok: false, reason: "unavailable" };
  }
  const answer = await relaunch(options);
  if (!answer || typeof answer !== "object") {
    return { ok: true };
  }
  const result = answer as { ok?: unknown; reason?: unknown };
  if (result.ok === false) {
    return { ok: false, reason: typeof result.reason === "string" && result.reason.trim() ? result.reason : "refused" };
  }
  return { ok: true };
}

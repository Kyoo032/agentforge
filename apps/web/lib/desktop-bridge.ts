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

export type DesktopUpdateSnapshot = {
  supported: boolean;
  status?: string;
  currentVersion?: string;
  version?: string;
  percent?: number;
  message?: string;
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
  updates?: DesktopUpdatesApi;
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
    throw new Error("Agentforge desktop bridge is not available");
  }
  return bridge.invoke(payload);
}

export function streamDesktop(requestId: string, onChunk: (chunk: string) => void): Promise<void> {
  const bridge = desktopBridge();
  if (!bridge) {
    return Promise.reject(new Error("Agentforge desktop bridge is not available"));
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

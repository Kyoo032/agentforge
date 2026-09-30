import { apiFetch, subscribeToWrites } from "./api-client";

/**
 * One shared read of `GET /api/v1/settings` for the parts of the shell that only display it.
 *
 * A cold Chat load reads that route from the shell (the gate), the key pill, the usage chip and the
 * composer, and those do not overlap: the shell's read settles before Chat mounts, and the pill
 * mounts after the thread home has loaded. `apiFetch` shares only reads that are on the wire at the
 * same moment, so each of them was a full round trip and, in the packaged app, a full IPC crossing
 * with the payload stringified on one side and parsed on the other.
 *
 * What is shared, and how long:
 *  - the parsed answer, once, so a shared read is one request **and** one `JSON.parse`;
 *  - for at most `REUSE_WINDOW_MS` from the moment the request started. A hung request is not
 *    joined forever, the same rule `apiFetch` applies to an in-flight read;
 *  - never across a write. Any write this renderer makes (a key saved, a desk switched, a run
 *    streamed) drops it at the start and at the end, so the answer is never older than the last
 *    write. That is what keeps the pill and the chip right after Settings saves.
 *  - only an answer the host called `ok`. A 503 or a dead network is passed to the callers that were
 *    waiting for it and forgotten, so the next caller asks again.
 *
 * Not for the Settings page: it is the screen that shows this route's answer as the source of truth,
 * so it opens with a read of its own through `apiFetch`.
 *
 * The body is frozen. Every caller shares one object, and a caller that wrote to it would change what
 * the others see.
 */
export type SettingsBody = Readonly<Record<string, unknown>>;

export type SettingsRead = {
  ok: boolean;
  status: number;
  /** The parsed JSON body, or null when the host sent something that is not a JSON object. */
  body: SettingsBody | null;
};

/** Long enough to span a cold load (shell, then Chat, then the hero), short enough to be a moment. */
export const REUSE_WINDOW_MS = 2_000;

type Started = { startedAt: number; read: Promise<SettingsRead> };

let current: Started | null = null;

function deepFreeze<T>(value: T): T {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value as Record<string, unknown>)) {
      deepFreeze(child);
    }
  }
  return value;
}

async function fetchSettings(): Promise<SettingsRead> {
  const response = await apiFetch("/api/v1/settings");
  const parsed: unknown = await response.json().catch(() => null);
  const body =
    parsed && typeof parsed === "object" && !Array.isArray(parsed) ? deepFreeze(parsed as SettingsBody) : null;
  return { ok: response.ok, status: response.status, body };
}

/** Drop the kept answer. The next `readSettings` asks the host. */
export function forgetSettings(): void {
  current = null;
}

let subscribed = false;

/**
 * The api-client tells us when this renderer writes. One subscription for the life of the page,
 * made on the first read rather than at import so that a module which only imports this file does
 * not need the api-client to be up.
 */
function subscribeOnce(): void {
  if (!subscribed) {
    subscribed = true;
    subscribeToWrites(forgetSettings);
  }
}

/**
 * The host's settings answer.
 *
 * `fresh` is for the read that decides something, the shell's gate at boot: it always asks the host,
 * and what it fetches is what the readers that mount after it share. Everything that only displays
 * the answer leaves it off.
 */
export function readSettings(options: { fresh?: boolean } = {}): Promise<SettingsRead> {
  subscribeOnce();
  if (!options.fresh && current && Date.now() - current.startedAt < REUSE_WINDOW_MS) {
    return current.read;
  }
  const started: Started = { startedAt: Date.now(), read: fetchSettings() };
  current = started;
  const forgetIfCurrent = () => {
    if (current === started) {
      current = null;
    }
  };
  started.read.then((answer) => {
    if (!answer.ok) {
      forgetIfCurrent();
    }
  }, forgetIfCurrent);
  return started.read;
}

/** Test seam: forget the answer and the clock between cases. */
export function resetSettingsReadForTests(): void {
  current = null;
  subscribed = false;
}

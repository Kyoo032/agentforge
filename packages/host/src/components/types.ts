/**
 * The contract for "Components": native dependencies the owner never installs by hand.
 *
 * Stage ids, states and error codes here are the wire contract of `POST /api/v1/components/install/stream`
 * and of `GET /api/v1/components`. Renaming one is a breaking change for the renderer, so they are
 * frozen tuples and every other module derives its types from them.
 */
import { ApiError } from "@agentforge/core";

export const COMPONENT_IDS = ["anydoc"] as const;
export type ComponentId = (typeof COMPONENT_IDS)[number];

/** The stage runner always walks these in this order; ids are part of the wire contract. */
export const COMPONENT_STAGES = ["check", "download", "verify", "unpack", "probe", "marker"] as const;
export type ComponentStage = (typeof COMPONENT_STAGES)[number];

export const COMPONENT_STAGE_STATES = ["running", "succeeded", "skipped", "failed"] as const;
export type ComponentStageState = (typeof COMPONENT_STAGE_STATES)[number];

export const COMPONENT_STATES = ["ready", "missing", "installing", "failed", "unsupported"] as const;
export type ComponentState = (typeof COMPONENT_STATES)[number];

/** Where a ready component came from. `null` whenever it is not ready. */
export type ComponentSource = "bundled" | "downloaded";

export const COMPONENT_ERROR_CODES = [
  "offline",
  "download_failed",
  "integrity_mismatch",
  "unpack_failed",
  "probe_failed",
  "unsupported_platform",
  "busy",
] as const;
export type ComponentErrorCode = (typeof COMPONENT_ERROR_CODES)[number];

export type ComponentFailure = {
  readonly code: ComponentErrorCode;
  readonly message: string;
};

export type ComponentStatus = {
  readonly id: ComponentId;
  readonly version: string;
  readonly state: ComponentState;
  readonly source: ComponentSource | null;
  /** False when the app must never download by itself: stub runtime, or a test / Playwright run. */
  readonly auto: boolean;
  /** What the download costs on this platform, from the manifest. 0 when bundled or unsupported. */
  readonly bytes: number;
  readonly error?: ComponentFailure;
};

/** HTTP status per code, so a stream error and a JSON error say the same thing. */
const STATUS_BY_CODE: Readonly<Record<ComponentErrorCode, number>> = Object.freeze({
  offline: 503,
  download_failed: 502,
  integrity_mismatch: 502,
  unpack_failed: 500,
  probe_failed: 500,
  unsupported_platform: 400,
  busy: 409,
});

/**
 * An ApiError so `jobErrorFromUnknown` carries `code` through to `job.error` unchanged — a component
 * failure must never surface to the renderer as a generic `internal_error`.
 */
export class ComponentError extends ApiError {
  declare readonly code: ComponentErrorCode;

  constructor(code: ComponentErrorCode, message: string) {
    super(code, message, STATUS_BY_CODE[code]);
    this.name = "ComponentError";
  }
}

export function isComponentError(error: unknown): error is ComponentError {
  return error instanceof ComponentError;
}

/** Any failure narrowed to the component contract; an unexpected throw becomes `code`. */
export function asComponentFailure(error: unknown, code: ComponentErrorCode): ComponentFailure {
  if (isComponentError(error)) {
    return { code: error.code, message: error.message };
  }
  const message = error instanceof Error && error.message ? error.message : "Component install failed";
  return { code, message };
}

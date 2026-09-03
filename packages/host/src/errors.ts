import { ApiError, redactSecrets } from "@agentforge/core";
import type { HostJsonResult } from "./types";

const LOCAL_OWNER_UNAVAILABLE = "Local owner context is unavailable on this machine.";

function asMessage(error: unknown): string {
  if (error instanceof Error && error.message) {
    return error.message;
  }
  if (typeof error === "string" && error.length > 0) {
    return error;
  }
  return "Internal error";
}

export function jsonError(error: unknown): HostJsonResult {
  if (error instanceof ApiError) {
    return {
      type: "json",
      status: error.status,
      body: { error: { code: error.code, message: redactSecrets(error.message) } },
    };
  }
  const message = asMessage(error);
  if (message === "tenant_required" || message === "UNAUTHORIZED") {
    return {
      type: "json",
      status: 401,
      body: { error: { code: "unauthorized", message: LOCAL_OWNER_UNAVAILABLE } },
    };
  }
  return {
    type: "json",
    status: 500,
    body: { error: { code: "internal_error", message: redactSecrets(message) } },
  };
}

export function jsonOk(body: unknown, status = 200, cookies?: HostJsonResult["cookies"]): HostJsonResult {
  return { type: "json", status, body, cookies };
}

export function isApiError(error: unknown): error is ApiError {
  return error instanceof ApiError;
}

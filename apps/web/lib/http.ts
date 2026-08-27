import { AgentService, ApiError, redactSecrets } from "@agentforge/core";
import { NextResponse } from "next/server";

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

export function jsonError(error: unknown): NextResponse {
  if (error instanceof ApiError) {
    return NextResponse.json(
      { error: { code: error.code, message: redactSecrets(error.message) } },
      { status: error.status },
    );
  }
  const message = asMessage(error);
  if (message === "tenant_required" || message === "UNAUTHORIZED") {
    return NextResponse.json({ error: { code: "unauthorized", message: LOCAL_OWNER_UNAVAILABLE } }, { status: 401 });
  }
  const redacted = redactSecrets(message);
  return NextResponse.json({ error: { code: "internal_error", message: redacted } }, { status: 500 });
}

export function isApiError(error: unknown): error is ApiError {
  return error instanceof ApiError;
}

export { AgentService };

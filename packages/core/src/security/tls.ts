import { ApiError } from "../errors";

const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);

export function isLoopbackHost(host: string): boolean {
  return LOOPBACK_HOSTS.has(host.toLowerCase());
}

export function assertAllowedEndpointUrl(url: string): void {
  if (!url || url.trim().length === 0) {
    throw new ApiError("invalid_endpoint", "Endpoint URL must not be empty", 400);
  }
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new ApiError("invalid_endpoint", "Endpoint URL is not valid", 400);
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new ApiError("invalid_endpoint", "Endpoint URL must use http or https", 400);
  }
  if (parsed.username || parsed.password) {
    throw new ApiError("invalid_endpoint", "Endpoint URL must not contain credentials", 400);
  }
  if (parsed.protocol === "http:" && !isLoopbackHost(parsed.hostname)) {
    throw new ApiError(
      "invalid_endpoint",
      "Plain HTTP is only allowed for loopback addresses (localhost / 127.0.0.1 / ::1). Use HTTPS for remote endpoints.",
      400,
    );
  }
}

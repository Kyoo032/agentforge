import { parseAppLocale, type AppLocale } from "./locale";
import { parseGatewayHttpDetail } from "./models/request-constraints";
import { redactSecrets } from "./security/redact";

/**
 * App-locale copy for a gateway HTTP failure.
 *
 * The gateway answers in its own language (it sent "Permintaan tidak valid..." to an English desk
 * on 2026-09-15), and its wording is about the wire, not about what the person can do. So the
 * statuses whose meaning is generic get our own bilingual sentence, and the upstream text is kept
 * as `detail` for the log. Statuses that carry information we cannot reproduce - 402 balance, 404
 * wrong endpoint (which `isMissingWireEndpoint` matches on to fall back between wires), 422 - keep
 * the upstream text as-is.
 */
type GatewayErrorKind = "invalid" | "unauthorized" | "forbidden" | "rateLimited" | "upstream";

const GATEWAY_ERROR_COPY: Record<GatewayErrorKind, Record<AppLocale, { headline: string; advice: string }>> = {
  invalid: {
    en: {
      headline: "The gateway rejected this request",
      advice: "Try another model, or send again with a shorter prompt.",
    },
    id: {
      headline: "Gateway menolak permintaan ini",
      advice: "Coba model lain, atau kirim lagi dengan prompt yang lebih pendek.",
    },
  },
  unauthorized: {
    en: { headline: "The gateway did not accept this API key", advice: "Check the key in Settings." },
    id: { headline: "Gateway tidak menerima API key ini", advice: "Periksa key di Pengaturan." },
  },
  forbidden: {
    en: {
      headline: "The gateway refused this request for this key",
      advice: "Check what the key is allowed to use in Settings.",
    },
    id: {
      headline: "Gateway menolak permintaan ini untuk key tersebut",
      advice: "Periksa akses key di Pengaturan.",
    },
  },
  rateLimited: {
    en: { headline: "The gateway is rate-limiting this key", advice: "Wait a moment and send again." },
    id: { headline: "Gateway sedang membatasi laju key ini", advice: "Tunggu sebentar lalu kirim lagi." },
  },
  upstream: {
    en: { headline: "The gateway is unavailable right now", advice: "Send again in a moment." },
    id: { headline: "Gateway sedang tidak tersedia", advice: "Coba kirim lagi sebentar lagi." },
  },
};

export function gatewayErrorKind(code: number): GatewayErrorKind | null {
  if (code === 400) {
    return "invalid";
  }
  if (code === 401) {
    return "unauthorized";
  }
  if (code === 403) {
    return "forbidden";
  }
  if (code === 429) {
    return "rateLimited";
  }
  return code >= 500 && code < 600 ? "upstream" : null;
}

/**
 * Headline for the person and `detail` for the log. The status code stays in the headline: it is
 * what a support thread is searched by, and `isRetryableModelFailure` classifies on it.
 */
export function gatewayHttpFailure(
  status: number,
  bodyText: string,
  locale: AppLocale = "en",
): { message: string; detail: string } {
  const detail = parseGatewayHttpDetail(status, bodyText);
  const kind = gatewayErrorKind(detail.code);
  if (!kind) {
    // This branch hands the upstream sentence straight to the person. A gateway that echoes the
    // request back (an Authorization header, a key in a query string) must not put it on screen.
    return { message: redactSecrets(detail.message), detail: detail.message };
  }
  const copy = GATEWAY_ERROR_COPY[kind][parseAppLocale(locale)];
  return { message: `${copy.headline} (status_code=${detail.code}). ${copy.advice}`, detail: detail.message };
}

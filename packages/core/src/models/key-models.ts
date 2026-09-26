import { parseAppLocale, type AppLocale } from "../locale";
import { mediaKind, pickPreferredVideoModel } from "./media-kind";

/**
 * Gateway video jobs that the key's model list still offered.
 * Mirrors `videos.modelNotOnKey` and `videos.modelNotOnKeyNoAlt` in
 * `apps/web/locales/{en,id}/videos.json`.
 */
const NOT_ON_KEY =
  /not available (?:for|on|to) this (?:key|token)|not enabled for this (?:key|token)|no access to (?:this )?model|无权/i;

export function isModelNotOnKey(message: string): boolean {
  return NOT_ON_KEY.test(message);
}

function videoIds(ids: readonly string[]): string[] {
  const seen = new Set<string>();
  const usable: string[] = [];
  for (const raw of ids) {
    const id = raw.trim();
    const key = id.toLowerCase();
    if (!id || seen.has(key) || mediaKind(id) !== "video") {
      continue;
    }
    seen.add(key);
    usable.push(id);
  }
  return usable;
}

function liveSpelling(ids: readonly string[], want: string): string | undefined {
  const key = want.trim().toLowerCase();
  return ids.find((id) => id.toLowerCase() === key);
}

/**
 * A video id that is actually in `ids`, or "" when none are.
 * Never invents `DEFAULT_GATEWAY_VIDEO_MODEL` for an empty or non-matching list.
 */
export function availableVideoDefault(ids: readonly string[]): string {
  const usable = videoIds(ids);
  if (usable.length === 0) {
    return "";
  }
  const preferred = pickPreferredVideoModel(usable);
  return liveSpelling(usable, preferred) ?? usable.find((id) => !id.toLowerCase().startsWith("mj_")) ?? usable[0] ?? "";
}

export function suggestAvailableVideoModel(ids: readonly string[], rejected?: string): string | undefined {
  const rejectedKey = rejected?.trim().toLowerCase();
  const rest = videoIds(ids).filter((id) => id.toLowerCase() !== rejectedKey);
  const suggestion = availableVideoDefault(rest);
  return suggestion || undefined;
}

export function modelNotOnKeyMessage(locale: AppLocale, model: string, suggestion?: string): string {
  const loc = parseAppLocale(locale);
  const name = model.trim() || (loc === "id" ? "Model ini" : "This model");
  if (suggestion) {
    return loc === "id"
      ? `${name} tidak tersedia pada kunci ini. Coba ${suggestion}.`
      : `${name} is not available on this key. Try ${suggestion}.`;
  }
  return loc === "id"
    ? `${name} tidak tersedia pada kunci ini. Segarkan model di Pengaturan dan pilih salah satu yang tercantum pada kunci ini.`
    : `${name} is not available on this key. Refresh models in Settings and pick one this key lists.`;
}

export type VideoModelChoice = { ok: true; model: string } | { ok: false; rejected: string; suggestion?: string };

/** The model a video job may send: only an id the refresh listed. */
export function resolveVideoModelForKey(input: {
  requested?: string;
  availableIds: readonly string[];
}): VideoModelChoice {
  const available = videoIds(input.availableIds);
  const requested = input.requested?.trim() ?? "";
  if (!requested) {
    const model = availableVideoDefault(available);
    if (!model) {
      return { ok: false, rejected: "" };
    }
    return { ok: true, model };
  }
  const listed = liveSpelling(available, requested);
  if (listed) {
    return { ok: true, model: listed };
  }
  const suggestion = suggestAvailableVideoModel(available, requested);
  return suggestion ? { ok: false, rejected: requested, suggestion } : { ok: false, rejected: requested };
}

/** Plain-language replacement when the gateway refuses a model the picker had offered. */
export function rewriteModelNotOnKey(
  message: string,
  locale: AppLocale,
  model: string,
  availableIds: readonly string[],
): { message: string; suggestModel?: string } | null {
  if (!isModelNotOnKey(message)) {
    return null;
  }
  const suggestModel = suggestAvailableVideoModel(availableIds, model);
  return {
    message: modelNotOnKeyMessage(locale, model, suggestModel),
    ...(suggestModel ? { suggestModel } : {}),
  };
}

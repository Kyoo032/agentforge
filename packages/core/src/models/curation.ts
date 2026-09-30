import { modelPolicy, type ModelTier } from "./model-policy";

export type { ModelTier };

export type CuratedModelMeta = {
  friendlyLabel: string;
  bestFor: string;
  tier: ModelTier;
};

const VENDOR_PREFIX = /^(openai|anthropic|google|x-ai|xai|deepseek|moonshot|minimax|meta-llama|mistralai)\//i;
const DATED_SUFFIX = /-\d{8}$/;
const SNAPSHOT_NOISE = /-(?:latest|preview|exp|experimental|instruct)$/i;

function leafId(id: string): string {
  const slash = id.lastIndexOf("/");
  return slash >= 0 ? id.slice(slash + 1) : id;
}

function titleCaseToken(token: string): string {
  if (!token) {
    return token;
  }
  if (/^\d+(\.\d+)*$/.test(token)) {
    return token;
  }
  if (/^[A-Z0-9]+$/.test(token) && token.length <= 4) {
    return token;
  }
  const known = token.toLowerCase();
  if (known === "gpt") {
    return "GPT";
  }
  if (known === "claude") {
    return "Claude";
  }
  if (known === "gemini") {
    return "Gemini";
  }
  if (known === "deepseek") {
    return "DeepSeek";
  }
  if (known === "kimi") {
    return "Kimi";
  }
  if (known === "grok") {
    return "Grok";
  }
  if (known === "minimax") {
    return "MiniMax";
  }
  if (known === "chatgpt") {
    return "ChatGPT";
  }
  return token.charAt(0).toUpperCase() + token.slice(1).toLowerCase();
}

/**
 * `claude-opus-5-5` is Opus 5.5: an id has no dot to spare, so two short numbers in a row after a
 * name are one dotted version. Not after a four-digit year, where `2025-12-01` is a date, and not
 * when the second number has a leading zero (`01`), which no version has.
 */
function joinDashedVersions(parts: string[]): string[] {
  const out: string[] = [];
  for (let i = 0; i < parts.length; i += 1) {
    const part = parts[i] as string;
    const next = parts[i + 1];
    const before = out[out.length - 1];
    const startsVersion =
      before !== undefined &&
      !/^\d{4}$/.test(before) &&
      /^\d{1,2}$/.test(part) &&
      next !== undefined &&
      /^[1-9]\d?$/.test(next);
    if (startsVersion) {
      out.push(`${part}.${next}`);
      i += 1;
    } else {
      out.push(part);
    }
  }
  return out;
}

/** Cleaned display label: strip vendor prefixes/dates, title-case segments. */
export function friendlyModelLabel(id: string): string {
  let name = leafId(id.trim());
  name = name.replace(VENDOR_PREFIX, "");
  name = name.replace(DATED_SUFFIX, "");
  name = name.replace(SNAPSHOT_NOISE, "");
  const parts = joinDashedVersions(name.split(/[-_]+/).filter(Boolean));
  return parts.map(titleCaseToken).join(" ");
}

/** Models that stream a reasoning channel (o-series, R1, MiniMax think tags, *thinking* ids). */
export function isThinkingModel(id: string): boolean {
  const n = leafId(id).toLowerCase();
  return /reasoning|o1|o3|o4|think|r1|minimax-m3/.test(n);
}

export function isEverydayModel(id: string): boolean {
  const trimmed = id.trim();
  if (!trimmed) {
    return false;
  }
  return modelPolicy(trimmed).tier === "everyday";
}

/** Tier and best-for come from the model's policy, so an unrecognised id is advanced, never Recommended. */
export function curateModel(id: string): CuratedModelMeta {
  const trimmed = id.trim();
  const policy = modelPolicy(trimmed || id);
  return {
    friendlyLabel: friendlyModelLabel(trimmed || id),
    bestFor: policy.bestFor,
    tier: policy.tier,
  };
}

export function applyCuration<T extends { id: string }>(models: T[]): (T & CuratedModelMeta)[] {
  return models.map((model) => ({ ...model, ...curateModel(model.id) }));
}

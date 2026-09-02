export type ModelTier = "everyday" | "advanced";

export type CuratedModelMeta = {
  friendlyLabel: string;
  bestFor: string;
  tier: ModelTier;
};

const EVERYDAY_PREFIX =
  /^(?:openai\/|anthropic\/|google\/|x-ai\/|xai\/|deepseek\/|moonshot\/|minimax\/)?(gpt-|chatgpt|claude-|gemini-|deepseek-|kimi-|grok-|minimax-)/i;

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

/** Cleaned display label: strip vendor prefixes/dates, title-case segments. */
export function friendlyModelLabel(id: string): string {
  let name = leafId(id.trim());
  name = name.replace(VENDOR_PREFIX, "");
  name = name.replace(DATED_SUFFIX, "");
  name = name.replace(SNAPSHOT_NOISE, "");
  const parts = name.split(/[-_]+/).filter(Boolean);
  return parts.map(titleCaseToken).join(" ");
}

function bestForFromId(id: string): string {
  const n = leafId(id).toLowerCase();
  if (/code|coder|codex|devstral|codestral/.test(n)) {
    return "Coding";
  }
  if (/long|opus|pro|ultra|32k|128k|200k|1m|document/.test(n)) {
    return "Long documents";
  }
  if (isThinkingModel(id)) {
    return "Deep reasoning";
  }
  if (/flash|mini|nano|lite|fast|turbo|instant|haiku|tiny/.test(n)) {
    return "Fast drafts";
  }
  if (EVERYDAY_PREFIX.test(n) || EVERYDAY_PREFIX.test(id)) {
    return "Everyday chat";
  }
  return "General chat";
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
  const n = leafId(trimmed);
  return EVERYDAY_PREFIX.test(n) || EVERYDAY_PREFIX.test(trimmed);
}

export function curateModel(id: string): CuratedModelMeta {
  const trimmed = id.trim();
  const everyday = isEverydayModel(trimmed);
  return {
    friendlyLabel: friendlyModelLabel(trimmed || id),
    bestFor: bestForFromId(trimmed || id),
    tier: everyday ? "everyday" : "advanced",
  };
}

export function applyCuration<T extends { id: string }>(models: T[]): (T & CuratedModelMeta)[] {
  return models.map((model) => ({ ...model, ...curateModel(model.id) }));
}

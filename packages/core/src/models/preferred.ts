import { isEverydayModel } from "./curation";
import { firstLiveId } from "./media-kind";
import { modelPolicy } from "./model-policy";

type ModelRef = { id: string };

export { formatContextLength } from "./context-length";

/**
 * Chat defaults, best first (2026-09-30): the default is GPT 6 Luna, the cheapest ($0.10 / $0.50 per 1M)
 * and among the fastest; the rest follow by price and speed. The first seven are the Recommended group
 * (`EVERYDAY_MODEL_IDS`, same order); the last three are only stand-ins for `chooseDefaultModel` when
 * none of those is listed, and stay out of Recommended.
 */
export const CHAT_DEFAULT_PREFERENCES = [
  "gpt-6-luna",
  "claude-sonnet-5-5",
  "deepseek-v4-1-flash",
  "gemini-3.5-flash",
  "gpt-6-sol",
  "glm-5.3-flash",
  "qwen3.7-plus",
  "gpt-5.6-luna",
  "claude-sonnet-5",
  "deepseek-v4-flash",
];

function tierRank(id: string): number {
  return isEverydayModel(id) ? 0 : 1;
}

const NOT_DEFAULT =
  /(mj_|suno_|veo_|seedance|imagine|embedding|whisper|tts|-asr|-i2v|-t2v|-r2v|image-edit|video-edit|omni-moderation)/i;

/** The gateway's own alias for whatever it wants a client to default to; not a model the table lists. */
const GATEWAY_DEFAULT_ID = "default";

/** A version as numbers, newest greatest: `gpt-5.6` is [5, 6], `claude-opus-5-5` is [5, 5], `gpt-6` is [6]. */
type Generation = readonly number[];

function compareGeneration(a: Generation, b: Generation): number {
  const length = Math.max(a.length, b.length);
  for (let index = 0; index < length; index += 1) {
    const difference = (a[index] ?? 0) - (b[index] ?? 0);
    if (difference !== 0) {
      return difference;
    }
  }
  return 0;
}

/** The numeric groups a family regex captured, without the empty optional ones. */
function generationOf(match: RegExpMatchArray | null): Generation | undefined {
  if (!match) {
    return undefined;
  }
  return match
    .slice(1)
    .filter((part): part is string => part !== undefined)
    .map(Number);
}

type Family = {
  label: string;
  rank: number;
  /** The brand and its version, read off the bare id; undefined when the id is not this family. */
  generation: (leaf: string) => Generation | undefined;
  /** The oldest generation the family ranks. Anything newer is in it too: nothing is dropped for being new. */
  min: Generation;
  variant: (id: string) => number;
};

/**
 * Ranking families for the picker and the fallback default. A family names a brand, not a
 * generation: `generation` reads the version off the id and `min` is where the ranking starts, so
 * GPT 6, Claude 5.5 and DeepSeek V4.1 land in their family and sort newest first inside it. Which
 * role wins (`variant`) still comes first, so the recommendations do not move; a newer generation
 * only breaks the tie inside a role. Whether a model may be a default at all is the policy table's
 * call (`isDefaultEligible`), not this list's.
 */
const FAMILIES: Family[] = [
  {
    label: "GPT 5.6+",
    rank: 0,
    generation: (leaf) => generationOf(leaf.match(/^gpt-(\d+)(?:\.(\d+))?/)),
    min: [5, 6],
    variant: (id) => (/luna/i.test(id) ? 0 : /terra/i.test(id) ? 1 : /sol/i.test(id) ? 2 : 3),
  },
  {
    label: "Claude 5+",
    rank: 1,
    generation: (leaf) => generationOf(leaf.match(/^claude-(?:sonnet|opus)-(\d+)(?:[.-](\d{1,2})(?!\d))?/)),
    min: [5],
    variant: (id) => (/sonnet/i.test(id) ? 0 : 1),
  },
  {
    label: "MiniMax",
    rank: 2,
    generation: (leaf) =>
      leaf.startsWith("minimax") ? (generationOf(leaf.match(/^minimax-m(\d+)(?:\.(\d+))?/)) ?? []) : undefined,
    min: [],
    variant: (id) => (/m3(?:$|[.-])/i.test(id) ? 0 : 1),
  },
  {
    label: "GLM 5+",
    rank: 3,
    generation: (leaf) => generationOf(leaf.match(/^glm-(\d+)(?:\.(\d+))?/)),
    min: [5],
    variant: (id) => (/glm-5\.3-flash/i.test(id) ? 0 : /glm-5\.3/i.test(id) ? 1 : 2),
  },
  {
    label: "DeepSeek V4+",
    rank: 4,
    generation: (leaf) => generationOf(leaf.match(/^deepseek-v(\d+)(?:[.-](\d{1,2})(?!\d))?/)),
    min: [4],
    variant: (id) => (/flash/i.test(id) ? 0 : /pro/i.test(id) ? 1 : 2),
  },
  {
    label: "Kimi",
    rank: 5,
    generation: (leaf) =>
      leaf.startsWith("kimi") ? (generationOf(leaf.match(/^kimi-k(\d+)(?:\.(\d+))?/)) ?? []) : undefined,
    min: [],
    variant: (id) => (/kimi-k2\.6/i.test(id) ? 0 : /kimi-k2\.7/i.test(id) ? 1 : /kimi-k3/i.test(id) ? 2 : 3),
  },
];

const DEFAULT_FAMILY_ORDER = ["GPT 5.6+", "Claude 5+", "MiniMax", "GLM 5+", "DeepSeek V4+", "Kimi"];

function familyGeneration(family: Family, id: string): Generation | undefined {
  const generation = family.generation(pickerLeaf(id));
  return generation !== undefined && compareGeneration(generation, family.min) >= 0 ? generation : undefined;
}

function inFamily(family: Family, id: string): boolean {
  return familyGeneration(family, id) !== undefined;
}

/** Role first, so the recommendations hold; then the newer generation. */
function compareWithinFamily(family: Family, a: string, b: string): number {
  const role = family.variant(a) - family.variant(b);
  if (role !== 0) {
    return role;
  }
  return compareGeneration(familyGeneration(family, b) ?? [], familyGeneration(family, a) ?? []);
}

/** Stable picker buckets. One brand per group — no GPT-5.6 vs OpenAI split. */
const BRAND_GROUP_ORDER = [
  "GPT",
  "Claude",
  "Gemini",
  "DeepSeek",
  "Kimi",
  "GLM",
  "Grok",
  "MiniMax",
  "Qwen",
  "Doubao",
  "Other",
] as const;

type BrandGroup = (typeof BRAND_GROUP_ORDER)[number];

const PICKER_HIDE = /embedding|rerank|omni-moderation|text-moderation|-ocr(?:$|-)|livetranslate/i;
const DATED_SNAPSHOT = /-\d{8}$/;

/** True when the model id should stay out of the chat picker (embeddings, moderation, OCR, …). */
export function isPickerHidden(id: string): boolean {
  return PICKER_HIDE.test(id);
}

function familyFor(id: string): Family | undefined {
  return FAMILIES.find((family) => inFamily(family, id));
}

function pickerLeaf(id: string): string {
  const slash = id.lastIndexOf("/");
  return (slash >= 0 ? id.slice(slash + 1) : id).toLowerCase();
}

/**
 * May this id be recommended or picked as a default? Only a model the policy table knows can be: an
 * id it has never seen gets the conservative profile and stays out of Recommended and out of the
 * defaults, though it still lists and can be chosen by hand. The gateway's own `default` alias is
 * exempt: it is the gateway's choice, not ours.
 */
export function isDefaultEligible(id: string): boolean {
  const trimmed = id.trim();
  if (trimmed.length === 0 || NOT_DEFAULT.test(trimmed)) {
    return false;
  }
  return trimmed === GATEWAY_DEFAULT_ID || modelPolicy(trimmed).known;
}

export function modelFamilyLabel(id: string): BrandGroup {
  const n = pickerLeaf(id);
  if (n.startsWith("gpt-") || n.startsWith("chatgpt") || /^o[134]/.test(n)) {
    return "GPT";
  }
  if (n.includes("claude") || n.includes("fable")) {
    return "Claude";
  }
  if (n.startsWith("gemini") || n.startsWith("gemma")) {
    return "Gemini";
  }
  if (n.includes("deepseek")) {
    return "DeepSeek";
  }
  if (n.includes("kimi")) {
    return "Kimi";
  }
  if (n.includes("glm")) {
    return "GLM";
  }
  if (n.includes("grok")) {
    return "Grok";
  }
  if (n.includes("minimax")) {
    return "MiniMax";
  }
  if (n.includes("qwen")) {
    return "Qwen";
  }
  if (n.startsWith("doubao") || n.includes("seedance") || n.startsWith("seed-") || n.startsWith("ep-")) {
    return "Doubao";
  }
  return "Other";
}

function compareModelIds(a: string, b: string): number {
  return pickerLeaf(a).localeCompare(pickerLeaf(b), undefined, { numeric: true, sensitivity: "base" });
}

function claudeFamilyRank(id: string): number {
  const n = pickerLeaf(id);
  if (n.includes("opus")) {
    return 0;
  }
  if (n.includes("sonnet")) {
    return 1;
  }
  if (n.includes("haiku")) {
    return 2;
  }
  if (n.includes("fable")) {
    return 3;
  }
  return 4;
}

function gptVersionKey(id: string): string {
  const n = pickerLeaf(id);
  const match = n.match(/^gpt-(\d+(?:\.\d+)*)/);
  if (match?.[1]) {
    return match[1];
  }
  // o-series sits between gpt-5.6 and older gpt-5.x / gpt-4o in the brand list.
  if (/^o[134]/.test(n)) {
    return "5.5";
  }
  return "";
}

function gptVariantRank(id: string): number {
  const n = pickerLeaf(id);
  if (/-pro(?:$|-)/.test(n)) {
    return 0;
  }
  if (/-nano(?:$|-)/.test(n)) {
    return 3;
  }
  if (/-mini(?:$|-)/.test(n)) {
    return 2;
  }
  return 1;
}

function comparePickerIds(a: string, b: string): number {
  if (modelFamilyLabel(a) === "Claude" && modelFamilyLabel(b) === "Claude") {
    const family = claudeFamilyRank(a) - claudeFamilyRank(b);
    if (family !== 0) {
      return family;
    }
  }
  if (modelFamilyLabel(a) === "GPT" && modelFamilyLabel(b) === "GPT") {
    const versionA = gptVersionKey(a);
    const versionB = gptVersionKey(b);
    if (versionA && versionB) {
      const version = versionB.localeCompare(versionA, undefined, { numeric: true, sensitivity: "base" });
      if (version !== 0) {
        return version;
      }
      const variant = gptVariantRank(a) - gptVariantRank(b);
      if (variant !== 0) {
        return variant;
      }
    }
  }
  return compareModelIds(b, a);
}

function isDatedSnapshot(id: string, ids: Set<string>): boolean {
  if (!DATED_SNAPSHOT.test(id)) {
    return false;
  }
  const base = id.replace(DATED_SNAPSHOT, "");
  return ids.has(base);
}

export function pickPreferredModel(models: ModelRef[]): string | undefined {
  const eligible = models.filter((model) => isDefaultEligible(model.id));
  for (const label of DEFAULT_FAMILY_ORDER) {
    const family = FAMILIES.find((item) => item.label === label);
    if (!family) {
      continue;
    }
    const hits = eligible.filter((model) => inFamily(family, model.id));
    if (hits.length === 0) {
      continue;
    }
    hits.sort((a, b) => compareWithinFamily(family, a.id, b.id));
    return hits[0]?.id;
  }
  // Nothing the table knows is live. Still never a media or embedding id if anything else is listed.
  const lastResort = models.find((model) => model.id.trim().length > 0 && !NOT_DEFAULT.test(model.id));
  return eligible[0]?.id ?? lastResort?.id ?? models[0]?.id;
}

export function recommendedChatModels<T extends ModelRef>(models: T[]): T[] {
  const eligible = models.filter((model) => isDefaultEligible(model.id));
  const hasEveryday = eligible.some((model) => isEverydayModel(model.id));
  const pool = hasEveryday ? eligible.filter((model) => isEverydayModel(model.id)) : eligible;
  const picks: T[] = [];
  const gatewayDefault = eligible.find((model) => model.id === "default");
  if (gatewayDefault) {
    picks.push(gatewayDefault);
  }
  const byLower = new Map(pool.map((model) => [model.id.toLowerCase(), model]));
  for (const want of CHAT_DEFAULT_PREFERENCES) {
    const hit = byLower.get(want.toLowerCase());
    if (hit && !picks.some((pick) => pick.id === hit.id)) {
      picks.push(hit);
    }
  }
  if (picks.length > (gatewayDefault ? 1 : 0)) {
    return picks;
  }
  for (const family of FAMILIES) {
    const hits = pool.filter((model) => inFamily(family, model.id));
    if (hits.length === 0) {
      continue;
    }
    hits.sort((a, b) => compareWithinFamily(family, a.id, b.id));
    const best = hits[0];
    if (best && !picks.some((pick) => pick.id === best.id)) {
      picks.push(best);
      // One family best is enough — do not dump a pick from every FAMILIES entry.
      break;
    }
  }
  return picks;
}

export function sortChatModels<T extends ModelRef>(models: T[]): T[] {
  return models
    .map((model, index) => ({ model, index }))
    .sort((a, b) => {
      const familyA = familyFor(a.model.id);
      const familyB = familyFor(b.model.id);
      const rankA = familyA ? familyA.rank : 50;
      const rankB = familyB ? familyB.rank : 50;
      if (rankA !== rankB) {
        return rankA - rankB;
      }
      if (familyA && familyB) {
        const inside = compareWithinFamily(familyA, a.model.id, b.model.id);
        if (inside !== 0) {
          return inside;
        }
      }
      const group = BRAND_GROUP_ORDER.indexOf(modelFamilyLabel(a.model.id)) - BRAND_GROUP_ORDER.indexOf(modelFamilyLabel(b.model.id));
      if (group !== 0) {
        return group;
      }
      const byId = compareModelIds(a.model.id, b.model.id);
      if (byId !== 0) {
        return byId;
      }
      return a.index - b.index;
    })
    .map((entry) => entry.model);
}

export function chooseDefaultModel(models: ModelRef[], liveIds: string[] | undefined, fallback: string): string {
  const gatewayDefault = models.find((model) => model.id === "default");
  if (gatewayDefault) {
    return gatewayDefault.id;
  }
  const liveSet = liveIds && liveIds.length > 0 ? new Set(liveIds) : undefined;
  const liveModels = liveSet ? models.filter((model) => liveSet.has(model.id)) : models;
  const pool = liveModels.length > 0 ? liveModels : models;
  return firstLiveId(
    CHAT_DEFAULT_PREFERENCES,
    pool.map((model) => model.id),
  ) ?? pickPreferredModel(pool) ?? fallback;
}

/**
 * What a picker group is, as a stable key the renderer translates. `label` is the English fallback and
 * the brand's own name for a brand group: GPT, Claude, Gemini and the rest are proper nouns and read
 * the same in every language. Only the two groups that are words, `recommended` and `other`, have
 * copy that changes with the desk's language, and core does not own that copy.
 */
export type PickerGroupKind = "recommended" | "brand" | "other";

export type PickerGroup<T> = { kind: PickerGroupKind; label: string; models: T[] };

export function pickerGroups<T extends ModelRef>(models: T[]): Array<PickerGroup<T>> {
  const allIds = new Set(models.map((model) => model.id));
  const visible = models.filter((model) => !isPickerHidden(model.id) && !isDatedSnapshot(model.id, allIds));
  const recommended = recommendedChatModels(visible);
  const used = new Set(recommended.map((model) => model.id));
  const groups: Array<PickerGroup<T>> = [];
  if (recommended.length > 0) {
    groups.push({ kind: "recommended", label: "Recommended", models: recommended });
  }
  const rest = visible.filter((model) => !used.has(model.id));
  for (const label of BRAND_GROUP_ORDER) {
    const items = rest
      .filter((model) => modelFamilyLabel(model.id) === label)
      .sort((a, b) => {
        const tier = tierRank(a.id) - tierRank(b.id);
        if (tier !== 0) {
          return tier;
        }
        return comparePickerIds(a.id, b.id);
      });
    if (items.length > 0) {
      groups.push({ kind: label === "Other" ? "other" : "brand", label, models: items });
    }
  }
  return groups;
}

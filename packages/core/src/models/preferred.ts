type ModelRef = { id: string };

const NOT_DEFAULT =
  /(mj_|suno_|veo_|seedance|imagine|embedding|whisper|tts|-i2v|-t2v|-r2v|image-edit|video-edit|omni-moderation)/i;

type Family = {
  label: string;
  rank: number;
  match: (id: string) => boolean;
  variant: (id: string) => number;
};

const FAMILIES: Family[] = [
  {
    label: "DeepSeek V4",
    rank: 0,
    match: (id) => /deepseek-v4/i.test(id),
    variant: (id) => (/pro/i.test(id) ? 0 : /flash/i.test(id) ? 1 : 2),
  },
  {
    label: "GPT-5.6",
    rank: 1,
    match: (id) => /gpt-5\.6/i.test(id),
    variant: (id) => (/sol/i.test(id) ? 0 : /terra/i.test(id) ? 1 : /luna/i.test(id) ? 2 : 3),
  },
  {
    label: "Claude 5",
    rank: 2,
    match: (id) => /claude-(sonnet|opus)-5(?:$|[^\d])/i.test(id),
    variant: (id) => (/opus/i.test(id) ? 0 : 1),
  },
  {
    label: "Kimi",
    rank: 3,
    match: (id) => /kimi/i.test(id),
    variant: (id) => (/kimi-k3/i.test(id) ? 0 : /kimi-k2\.7/i.test(id) ? 1 : /kimi-k2\.6/i.test(id) ? 2 : 3),
  },
  {
    label: "GLM",
    rank: 4,
    match: (id) => /glm-5/i.test(id),
    variant: (id) => (/glm-5\.3/i.test(id) ? 0 : /glm-5\.2/i.test(id) ? 1 : 2),
  },
];

const DEFAULT_FAMILY_ORDER = ["GPT-5.6", "DeepSeek V4", "Claude 5", "Kimi", "GLM"];

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

function familyFor(id: string): Family | undefined {
  return FAMILIES.find((family) => family.match(id));
}

function pickerLeaf(id: string): string {
  const slash = id.lastIndexOf("/");
  return (slash >= 0 ? id.slice(slash + 1) : id).toLowerCase();
}

export function isDefaultEligible(id: string): boolean {
  return id.trim().length > 0 && !NOT_DEFAULT.test(id);
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
  const match = pickerLeaf(id).match(/^gpt-(\d+(?:\.\d+)*)/);
  return match?.[1] ?? "";
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
    const hits = eligible.filter((model) => family.match(model.id));
    if (hits.length === 0) {
      continue;
    }
    hits.sort((a, b) => family.variant(a.id) - family.variant(b.id));
    return hits[0]?.id;
  }
  return eligible[0]?.id ?? models[0]?.id;
}

export function recommendedChatModels<T extends ModelRef>(models: T[]): T[] {
  const eligible = models.filter((model) => isDefaultEligible(model.id));
  const picks: T[] = [];
  const gatewayDefault = eligible.find((model) => model.id === "default");
  if (gatewayDefault) {
    picks.push(gatewayDefault);
  }
  for (const family of FAMILIES) {
    const hits = eligible.filter((model) => family.match(model.id));
    if (hits.length === 0) {
      continue;
    }
    hits.sort((a, b) => family.variant(a.id) - family.variant(b.id));
    const best = hits[0];
    if (best) {
      picks.push(best);
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
        const variant = familyA.variant(a.model.id) - familyB.variant(b.model.id);
        if (variant !== 0) {
          return variant;
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
  if (liveIds && liveIds.length > 0) {
    const liveSet = new Set(liveIds);
    const liveModels = models.filter((model) => liveSet.has(model.id));
    return pickPreferredModel(liveModels.length > 0 ? liveModels : models) ?? fallback;
  }
  const gpt56 = models.filter((model) => /gpt-5\.6/i.test(model.id));
  return pickPreferredModel(gpt56) ?? fallback;
}

export function pickerGroups<T extends ModelRef>(models: T[]): Array<{ label: string; models: T[] }> {
  const allIds = new Set(models.map((model) => model.id));
  const visible = models.filter((model) => !PICKER_HIDE.test(model.id) && !isDatedSnapshot(model.id, allIds));
  const recommended = recommendedChatModels(visible);
  const used = new Set(recommended.map((model) => model.id));
  const groups: Array<{ label: string; models: T[] }> = [];
  if (recommended.length > 0) {
    groups.push({ label: "Recommended", models: recommended });
  }
  const rest = visible.filter((model) => !used.has(model.id));
  for (const label of BRAND_GROUP_ORDER) {
    const items = rest
      .filter((model) => modelFamilyLabel(model.id) === label)
      .sort((a, b) => comparePickerIds(a.id, b.id));
    if (items.length > 0) {
      groups.push({ label, models: items });
    }
  }
  return groups;
}

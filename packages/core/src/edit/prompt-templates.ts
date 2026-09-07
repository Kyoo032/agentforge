import { z } from "zod";
import manifest from "./prompt-templates.json";

const CATEGORY_IDS = ["promo", "talking-head", "reel", "square"] as const;
const ASPECTS = ["16:9", "9:16", "1:1"] as const;
const ALLOWED_HOSTS = new Set(["byteplus.com", "docs.byteplus.com", "www.byteplus.com", "higgsfield.ai"]);
const KEBAB_CASE = /^[a-z0-9]+(-[a-z0-9]+)*$/;

function wordCount(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

function isAllowedHttpsUrl(value: string): boolean {
  try {
    const parsed = new URL(value);
    return parsed.protocol === "https:" && ALLOWED_HOSTS.has(parsed.host);
  } catch {
    return false;
  }
}

const sourceSchema = z
  .object({
    site: z.enum(["BytePlus", "Higgsfield"]),
    title: z.string().min(1),
    url: z.string().url().refine(isAllowedHttpsUrl, "url must be an https link on an approved BytePlus/Higgsfield host"),
    section: z.string().min(1).optional(),
    note: z.string().min(1).optional(),
  })
  .strict();

const promptTemplateSchema = z
  .object({
    id: z.string().regex(KEBAB_CASE),
    title: z.string().min(1),
    category: z.enum(CATEGORY_IDS),
    aspect: z.enum(ASPECTS),
    seconds: z.number().int().min(4).max(12),
    prompt: z.string().min(1),
    tips: z
      .array(z.string().min(1).refine((tip) => wordCount(tip) < 15, "tip must be under 15 words"))
      .min(1)
      .max(5),
    source: sourceSchema,
  })
  .strict();

const guideRuleSchema = z
  .object({
    id: z.string().regex(KEBAB_CASE),
    text: z.string().min(1).refine((text) => wordCount(text) <= 25, "guide rule text must be 25 words or fewer"),
    source: sourceSchema,
  })
  .strict();

const categorySchema = z
  .object({
    id: z.enum(CATEGORY_IDS),
    label: z.string().min(1),
  })
  .strict();

const promptTemplateManifestSchema = z
  .object({
    version: z.literal(1),
    categories: z.array(categorySchema).length(CATEGORY_IDS.length),
    guideRules: z.array(guideRuleSchema),
    templates: z.array(promptTemplateSchema),
  })
  .strict();

export type PromptTemplateCategory = (typeof CATEGORY_IDS)[number];
export type PromptTemplateAspect = (typeof ASPECTS)[number];
export type PromptTemplateSource = z.infer<typeof sourceSchema>;
export type PromptTemplate = z.infer<typeof promptTemplateSchema>;
export type PromptGuideRule = z.infer<typeof guideRuleSchema>;
export type PromptTemplateCategoryInfo = z.infer<typeof categorySchema>;

const PROMPT_TEMPLATE_MANIFEST = promptTemplateManifestSchema.parse(manifest);

export const PROMPT_TEMPLATES: readonly PromptTemplate[] = PROMPT_TEMPLATE_MANIFEST.templates;
export const PROMPT_GUIDE_RULES: readonly PromptGuideRule[] = PROMPT_TEMPLATE_MANIFEST.guideRules;
export const PROMPT_TEMPLATE_CATEGORIES: readonly PromptTemplateCategoryInfo[] = PROMPT_TEMPLATE_MANIFEST.categories;

const TEMPLATES_BY_ID = new Map(PROMPT_TEMPLATES.map((template) => [template.id, template]));

export function promptTemplatesFor(category?: PromptTemplateCategory): PromptTemplate[] {
  if (!category) {
    return [...PROMPT_TEMPLATES];
  }
  return PROMPT_TEMPLATES.filter((template) => template.category === category);
}

export function promptTemplateById(id: string): PromptTemplate | undefined {
  return TEMPLATES_BY_ID.get(id);
}

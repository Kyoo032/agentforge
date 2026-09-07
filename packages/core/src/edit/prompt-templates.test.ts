import { describe, expect, it } from "vitest";
import {
  PROMPT_GUIDE_RULES,
  PROMPT_TEMPLATE_CATEGORIES,
  PROMPT_TEMPLATES,
  promptTemplateById,
  promptTemplatesFor,
} from "./prompt-templates";

const KEBAB_CASE = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const MODEL_ID_PATTERN = /seedance|grok|veo|kling|sora/i;
const ALLOWED_HOSTS = ["byteplus.com", "docs.byteplus.com", "www.byteplus.com", "higgsfield.ai"];

function hostOf(url: string): string {
  return new URL(url).host;
}

describe("prompt template manifest", () => {
  it("parses without throwing", () => {
    expect(PROMPT_TEMPLATES.length).toBeGreaterThan(0);
    expect(PROMPT_GUIDE_RULES.length).toBeGreaterThan(0);
    expect(PROMPT_TEMPLATE_CATEGORIES.length).toBe(4);
  });

  it("has unique, kebab-case template ids", () => {
    const ids = PROMPT_TEMPLATES.map((template) => template.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) {
      expect(id, id).toMatch(KEBAB_CASE);
    }
  });

  it("has unique, kebab-case guide rule ids", () => {
    const ids = PROMPT_GUIDE_RULES.map((rule) => rule.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) {
      expect(id, id).toMatch(KEBAB_CASE);
    }
  });

  it("every template has a non-empty prompt", () => {
    for (const template of PROMPT_TEMPLATES) {
      expect(template.prompt.trim().length, template.id).toBeGreaterThan(0);
    }
  });

  it("every template has 1..5 tips", () => {
    for (const template of PROMPT_TEMPLATES) {
      expect(template.tips.length, template.id).toBeGreaterThanOrEqual(1);
      expect(template.tips.length, template.id).toBeLessThanOrEqual(5);
      for (const tip of template.tips) {
        expect(tip.trim().length, `${template.id} tip`).toBeGreaterThan(0);
      }
    }
  });

  it("every template cites a valid https source url on an allowed host", () => {
    for (const template of PROMPT_TEMPLATES) {
      expect(template.source.url, template.id).toMatch(/^https:\/\//);
      expect(ALLOWED_HOSTS, template.id).toContain(hostOf(template.source.url));
    }
  });

  it("every guide rule cites a valid https source url on an allowed host", () => {
    for (const rule of PROMPT_GUIDE_RULES) {
      expect(rule.source.url, rule.id).toMatch(/^https:\/\//);
      expect(ALLOWED_HOSTS, rule.id).toContain(hostOf(rule.source.url));
    }
  });

  it("every template's seconds fall within 4..12", () => {
    for (const template of PROMPT_TEMPLATES) {
      expect(template.seconds, template.id).toBeGreaterThanOrEqual(4);
      expect(template.seconds, template.id).toBeLessThanOrEqual(12);
    }
  });

  it("each category has at least 2 templates", () => {
    for (const category of PROMPT_TEMPLATE_CATEGORIES) {
      const count = PROMPT_TEMPLATES.filter((template) => template.category === category.id).length;
      expect(count, category.id).toBeGreaterThanOrEqual(2);
    }
  });

  it("promptTemplatesFor filters by category and returns everything when omitted", () => {
    expect(promptTemplatesFor().length).toBe(PROMPT_TEMPLATES.length);
    for (const category of PROMPT_TEMPLATE_CATEGORIES) {
      const filtered = promptTemplatesFor(category.id);
      expect(filtered.length).toBeGreaterThan(0);
      for (const template of filtered) {
        expect(template.category).toBe(category.id);
      }
    }
  });

  it("promptTemplateById finds an existing template and returns undefined for unknown ids", () => {
    const first = PROMPT_TEMPLATES[0];
    expect(promptTemplateById(first.id)).toEqual(first);
    expect(promptTemplateById("does-not-exist")).toBeUndefined();
  });

  it("templates are model-agnostic: no specific model id appears in prompt text", () => {
    for (const template of PROMPT_TEMPLATES) {
      expect(template.prompt, template.id).not.toMatch(MODEL_ID_PATTERN);
    }
  });
});

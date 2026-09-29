/**
 * The words on the model pickers' group headings, in both languages.
 *
 * `pickerGroups` (core) used to hand back English labels for the two groups that are words
 * ("Recommended" and "Other"), and `model-select.tsx` hard-coded "Embeddings". The Chat palette
 * translated "Recommended" and the native `<select>` in the studios and Knowledge translated nothing,
 * so a desk set to Bahasa Indonesia saw English in the picker. Core now sends a stable kind and the
 * renderer translates it; brands stay as they are.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it } from "vitest";
import { ModelSelect } from "@/components/model-select";
import { applyLocale, resetLocaleForTests, t } from "./i18n";
import { embeddingsGroupLabel, pickerGroupLabel } from "./picker-group-label";

const web = join(dirname(fileURLToPath(import.meta.url)), "..");

const model = (id: string) => ({ id, label: id, provider: "openai", inputModalities: ["text"] });

afterEach(() => resetLocaleForTests());

describe("pickerGroupLabel", () => {
  it("translates the two groups that are words", () => {
    applyLocale("en");
    expect(pickerGroupLabel({ kind: "recommended", label: "Recommended" })).toBe("Recommended");
    expect(pickerGroupLabel({ kind: "other", label: "Other" })).toBe("Other");
    applyLocale("id");
    expect(pickerGroupLabel({ kind: "recommended", label: "Recommended" })).toBe("Disarankan");
    expect(pickerGroupLabel({ kind: "other", label: "Other" })).toBe("Lainnya");
  });

  it("leaves a brand alone in every language", () => {
    for (const locale of ["en", "id"] as const) {
      applyLocale(locale);
      expect(pickerGroupLabel({ kind: "brand", label: "GPT" })).toBe("GPT");
      expect(pickerGroupLabel({ kind: "brand", label: "DeepSeek" })).toBe("DeepSeek");
    }
  });

  it("translates the flat embeddings heading", () => {
    applyLocale("en");
    expect(embeddingsGroupLabel()).toBe("Embeddings");
    applyLocale("id");
    expect(embeddingsGroupLabel()).toBe("Embedding");
  });
});

describe("the native model select", () => {
  const catalog = [model("gpt-5.6-sol"), model("gpt-5.2"), model("claude-sonnet-4-5"), model("omni-fast")];

  it("shows Indonesian group headings and no English literal when the desk is Indonesian", () => {
    applyLocale("id");
    const html = renderToStaticMarkup(<ModelSelect models={catalog} value="gpt-5.2" onChange={() => {}} />);
    expect(html).toContain('label="Disarankan"');
    expect(html).toContain('label="Lainnya"');
    expect(html).not.toContain('label="Recommended"');
    expect(html).not.toContain('label="Other"');
    // Brands are proper nouns.
    expect(html).toContain('label="GPT"');
    expect(html).toContain('label="Claude"');
  });

  it("keeps the English headings on an English desk", () => {
    applyLocale("en");
    const html = renderToStaticMarkup(<ModelSelect models={catalog} value="gpt-5.2" onChange={() => {}} />);
    expect(html).toContain('label="Recommended"');
    expect(html).toContain('label="Other"');
  });

  it.each([
    ["en", "Embeddings"],
    ["id", "Embedding"],
  ] as const)("names the flat embeddings list in %s", (locale, word) => {
    applyLocale(locale);
    const html = renderToStaticMarkup(
      <ModelSelect
        flat
        models={[model("text-embedding-3-small")]}
        value="text-embedding-3-small"
        onChange={() => {}}
      />,
    );
    expect(html).toContain(`label="${word}"`);
  });
});

describe("the group headings are not English literals in the components", () => {
  it("model-select.tsx and model-picker.tsx read them through the catalogue", () => {
    const select = readFileSync(join(web, "components/model-select.tsx"), "utf8");
    expect(select).not.toContain('"Embeddings"');
    expect(select).toContain("pickerGroupLabel");
    const picker = readFileSync(join(web, "components/model-picker.tsx"), "utf8");
    expect(picker).not.toContain('"Recommended"');
    expect(picker).toContain("pickerGroupLabel");
  });

  it("every heading key exists in both catalogues", () => {
    for (const locale of ["en", "id"]) {
      const chat = JSON.parse(readFileSync(join(web, "locales", locale, "chat.json"), "utf8")) as {
        models: { groups: Record<string, string> };
      };
      for (const key of ["recommended", "other", "embeddings"]) {
        expect(chat.models.groups[key], `${locale} chat.models.groups.${key}`).toBeTruthy();
      }
    }
    applyLocale("id");
    expect(t("chat.models.groups.other")).not.toBe("chat.models.groups.other");
  });
});

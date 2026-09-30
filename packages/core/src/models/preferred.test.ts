import { describe, expect, it } from "vitest";
import type { ChatModel } from "./catalog";
import {
  CHAT_DEFAULT_PREFERENCES,
  chooseDefaultModel,
  isPickerHidden,
  pickPreferredModel,
  pickerGroups,
  recommendedChatModels,
  sortChatModels,
} from "./preferred";

function model(id: string): ChatModel {
  return { id, label: id, provider: "openai", inputModalities: ["text"] };
}

describe("pickPreferredModel", () => {
  it("defaults to GPT-5.6 Luna when the live list also has Terra and Sol", () => {
    expect(
      pickPreferredModel([
        model("gpt-5.6-sol"),
        model("gpt-5.6-luna"),
        model("gpt-5.6-terra"),
        model("claude-sonnet-5"),
      ]),
    ).toBe("gpt-5.6-luna");
  });

  it("defaults to GPT-5.6 Luna when the live list also has Sol and DeepSeek", () => {
    expect(
      pickPreferredModel([
        model("gpt-4o-mini"),
        model("gpt-5-mini"),
        model("gpt-5.6-sol"),
        model("gpt-5.6-luna"),
        model("deepseek-v4-flash"),
        model("deepseek-v4-pro"),
        model("claude-sonnet-5"),
      ]),
    ).toBe("gpt-5.6-luna");
  });

  it("defaults to GPT-5.6 Sol when Luna is absent", () => {
    expect(
      pickPreferredModel([
        model("gpt-4o-mini"),
        model("gpt-5-mini"),
        model("gpt-5.6-sol"),
        model("deepseek-v4-flash"),
        model("deepseek-v4-pro"),
        model("claude-sonnet-5"),
      ]),
    ).toBe("gpt-5.6-sol");
  });

  it("falls through to Claude Sonnet 5, MiniMax M3, GLM, DeepSeek Flash, then Kimi", () => {
    expect(pickPreferredModel([model("gpt-4o-mini"), model("deepseek-v4-flash"), model("claude-sonnet-5")])).toBe(
      "claude-sonnet-5",
    );
    expect(pickPreferredModel([model("gpt-4o-mini"), model("MiniMax-M3"), model("claude-sonnet-5")])).toBe(
      "claude-sonnet-5",
    );
    expect(pickPreferredModel([model("gpt-4o-mini"), model("claude-opus-5"), model("kimi-k2.6")])).toBe("claude-opus-5");
    expect(pickPreferredModel([model("kimi-k2.6"), model("kimi-k3"), model("glm-5.2")])).toBe("glm-5.2");
    expect(pickPreferredModel([model("glm-5"), model("glm-5.3"), model("gpt-4o-mini")])).toBe("glm-5.3");
  });

  it("does not default to Midjourney or Seedance ids", () => {
    expect(pickPreferredModel([model("mj_imagine"), model("doubao-seedance-2-0-260128"), model("gpt-5.6-sol")])).toBe(
      "gpt-5.6-sol",
    );
  });
});

describe("sortChatModels", () => {
  it("puts preferred families ahead of gpt-4o-mini", () => {
    const sorted = sortChatModels([model("gpt-4o-mini"), model("claude-sonnet-5"), model("deepseek-v4-flash")]);
    expect(sorted.map((item) => item.id)).toEqual(["claude-sonnet-5", "deepseek-v4-flash", "gpt-4o-mini"]);
  });
});

describe("recommendedChatModels", () => {
  it("recommends the Recommended set of 2026-09-30, in the order of the preference list", () => {
    const picks = recommendedChatModels([
      model("deepseek-v4-flash"),
      model("gpt-5.6-sol"),
      model("gpt-5.6-luna"),
      model("gpt-5.6-terra"),
      model("claude-sonnet-5"),
      model("claude-opus-5-5"),
      model("gpt-6-astra"),
      model("MiniMax-M3"),
      model("qwen3.7-plus"),
      model("glm-5.3-flash"),
      model("gpt-6-sol"),
      model("gemini-3.5-flash"),
      model("deepseek-v4-1-flash"),
      model("claude-sonnet-5-5"),
      model("gpt-6-luna"),
      model("hy3"),
      model("kimi-k2.6"),
      model("gpt-4o-mini"),
    ]);
    expect(picks.map((item) => item.id)).toEqual([
      "gpt-6-luna",
      "claude-sonnet-5-5",
      "deepseek-v4-1-flash",
      "gemini-3.5-flash",
      "gpt-6-sol",
      "glm-5.3-flash",
      "qwen3.7-plus",
    ]);
  });

  it("keeps the deep-reasoning picks and the older everyday set out of Recommended, in their brand groups", () => {
    const groups = pickerGroups([
      model("gpt-6-luna"),
      model("gpt-6-astra"),
      model("gpt-5.6-luna"),
      model("gpt-5.6-terra"),
      model("claude-sonnet-5-5"),
      model("claude-opus-5-5"),
      model("claude-sonnet-5"),
      model("MiniMax-M3"),
    ]);
    expect(groups[0]?.models.map((item) => item.id)).toEqual(["gpt-6-luna", "claude-sonnet-5-5"]);
    expect(groups.find((group) => group.label === "GPT")?.models.map((item) => item.id)).toEqual([
      "gpt-6-astra",
      "gpt-5.6-terra",
      "gpt-5.6-luna",
    ]);
    expect(groups.find((group) => group.label === "Claude")?.models.map((item) => item.id)).toEqual([
      "claude-opus-5-5",
      "claude-sonnet-5",
    ]);
    expect(groups.find((group) => group.label === "MiniMax")?.models.map((item) => item.id)).toEqual(["MiniMax-M3"]);
  });

  it("falls back to the preference list over every known model when no Recommended model is live", () => {
    const picks = recommendedChatModels([
      model("deepseek-v4-flash"),
      model("gpt-5.6-sol"),
      model("gpt-5.6-luna"),
      model("claude-sonnet-5"),
      model("MiniMax-M3"),
    ]);
    expect(picks.map((item) => item.id)).toEqual(["gpt-5.6-luna", "claude-sonnet-5", "deepseek-v4-flash"]);
  });

  it("contains only everyday models when everyday models exist", () => {
    const picks = recommendedChatModels([
      model("gpt-5.6-sol"),
      model("glm-5.2"),
      model("qwen3.7-plus"),
      model("deepseek-v4-flash"),
      model("weird-lab-model"),
      model("gpt-4o-mini"),
    ]);
    expect(picks.map((item) => item.id)).toEqual(["qwen3.7-plus"]);
  });

  it("keeps Recommended to the preference set even when older gpt ids are live", () => {
    const picks = recommendedChatModels([
      model("gpt-6-luna"),
      model("deepseek-v4-1-flash"),
      model("MiniMax-M3"),
      model("gpt-4o-mini"),
      model("gpt-5.4"),
      model("gpt-5.6-sol"),
      model("gpt-6-sol"),
    ]);
    expect(picks.map((item) => item.id)).toEqual(["gpt-6-luna", "deepseek-v4-1-flash", "gpt-6-sol"]);
  });

  it("puts the gateway default model first in Recommended", () => {
    const picks = recommendedChatModels([model("gpt-5.6-sol"), model("default"), model("deepseek-v4-pro")]);
    expect(picks.map((item) => item.id)[0]).toBe("default");
  });
});

describe("isPickerHidden", () => {
  it("hides embedding, rerank, moderation, OCR, and livetranslate ids", () => {
    expect(isPickerHidden("gemini-embedding-001")).toBe(true);
    expect(isPickerHidden("text-moderation-latest")).toBe(true);
    expect(isPickerHidden("foo-ocr-bar")).toBe(true);
    expect(isPickerHidden("livetranslate-v1")).toBe(true);
    expect(isPickerHidden("gpt-5.6-luna")).toBe(false);
  });
});

describe("pickerGroups", () => {
  it("leads with a Recommended group", () => {
    const groups = pickerGroups([model("gpt-4o-mini"), model("gpt-5.6-sol"), model("deepseek-v4-pro")]);
    expect(groups[0]?.label).toBe("Recommended");
    expect(groups[0]?.models.map((item) => item.id)).toEqual(["gpt-5.6-sol"]);
  });

  it("tags each group with a stable kind, so a renderer translates the words and not the brands", () => {
    const groups = pickerGroups([
      model("gpt-5.6-sol"),
      model("gpt-5.2"),
      model("claude-sonnet-4-5"),
      model("omni-fast"),
    ]);
    expect(groups.map((group) => [group.kind, group.label])).toEqual([
      ["recommended", "Recommended"],
      ["brand", "GPT"],
      ["brand", "Claude"],
      ["other", "Other"],
    ]);
  });

  it("puts the gateway default model first in Recommended", () => {
    const groups = pickerGroups([model("gpt-5.6-sol"), model("default"), model("deepseek-v4-pro")]);
    expect(groups[0]?.models.map((item) => item.id)[0]).toBe("default");
  });

  it("puts remaining models into one brand group each, newest first", () => {
    const groups = pickerGroups([
      model("gpt-4o-mini"),
      model("gpt-5.6-sol"),
      model("gpt-5.2"),
      model("claude-haiku-4-5"),
      model("claude-haiku-4-5-20251001"),
      model("claude-opus-5"),
      model("claude-sonnet-4-6"),
      model("deepseek-v4-pro"),
      model("grok-4.5"),
      model("qwen3.7-plus"),
      model("qwen3.6-flash"),
      model("gemini-embedding-001"),
      model("openai/gpt-4.1"),
    ]);
    expect(groups.map((group) => group.label)).toEqual([
      "Recommended",
      "GPT",
      "Claude",
      "DeepSeek",
      "Grok",
      "Qwen",
    ]);
    expect(groups.find((group) => group.label === "GPT")?.models.map((item) => item.id)).toEqual([
      "gpt-5.6-sol",
      "gpt-5.2",
      "openai/gpt-4.1",
      "gpt-4o-mini",
    ]);
    expect(groups.find((group) => group.label === "DeepSeek")?.models.map((item) => item.id)).toEqual([
      "deepseek-v4-pro",
    ]);
    expect(groups.find((group) => group.label === "Grok")?.models.map((item) => item.id)).toEqual(["grok-4.5"]);
    expect(groups.find((group) => group.label === "Claude")?.models.map((item) => item.id)).toEqual([
      "claude-opus-5",
      "claude-sonnet-4-6",
      "claude-haiku-4-5",
    ]);
    expect(groups.find((group) => group.label === "Qwen")?.models.map((item) => item.id)).toEqual(["qwen3.6-flash"]);
    expect(groups.some((group) => group.models.some((item) => /embedding|20251001/.test(item.id)))).toBe(false);
  });

  it("keeps omni-fast and dated snapshots out of the GPT and Claude brand lists", () => {
    const groups = pickerGroups([
      model("omni-fast"),
      model("gpt-5.2"),
      model("claude-sonnet-4-5"),
      model("claude-sonnet-4-5-20250929"),
    ]);
    expect(groups.map((group) => group.label)).toEqual(["GPT", "Claude", "Other"]);
    expect(groups.find((group) => group.label === "GPT")?.models.map((item) => item.id)).toEqual(["gpt-5.2"]);
    expect(groups.find((group) => group.label === "Other")?.models.map((item) => item.id)).toEqual(["omni-fast"]);
  });

  it("orders GPT variants as pro, base, mini, nano within a version", () => {
    const groups = pickerGroups([
      model("gpt-5.4-nano"),
      model("gpt-5.4"),
      model("gpt-5.4-mini"),
      model("gpt-5.4-pro"),
    ]);
    expect(groups.find((group) => group.label === "GPT")?.models.map((item) => item.id)).toEqual([
      "gpt-5.4-pro",
      "gpt-5.4",
      "gpt-5.4-mini",
      "gpt-5.4-nano",
    ]);
  });

  it("lists the GPT models the Recommended group did not take newest first", () => {
    const groups = pickerGroups([
      model("gpt-6-luna"),
      model("deepseek-v4-1-flash"),
      model("gpt-6-sol"),
      model("gpt-5.6-sol"),
      model("gpt-5.4"),
      model("gpt-4o-mini"),
      model("o3"),
    ]);
    expect(groups[0]?.models.map((item) => item.id)).toEqual(["gpt-6-luna", "deepseek-v4-1-flash", "gpt-6-sol"]);
    expect(groups.find((group) => group.label === "GPT")?.models.map((item) => item.id)).toEqual([
      "gpt-5.6-sol",
      "o3",
      "gpt-5.4",
      "gpt-4o-mini",
    ]);
  });
});

describe("chooseDefaultModel", () => {
  const catalog = [
    model("deepseek-v4-pro"),
    model("gpt-5.6-sol"),
    model("claude-sonnet-5"),
    model("gpt-4o-mini"),
  ];

  it("prefers the gateway default model when it is in the catalog", () => {
    expect(
      chooseDefaultModel(
        [model("default"), model("deepseek-v4-pro"), model("gpt-5.6-sol")],
        ["deepseek-v4-pro", "gpt-5.6-sol", "default"],
        "gpt-5.6-sol",
      ),
    ).toBe("default");
  });

  it("uses GPT-5.6 Luna over Terra and Sol when all are live", () => {
    expect(
      chooseDefaultModel(
        [model("gpt-5.6-sol"), model("gpt-5.6-luna"), model("gpt-5.6-terra")],
        ["gpt-5.6-sol", "gpt-5.6-luna", "gpt-5.6-terra"],
        "gpt-5.6-sol",
      ),
    ).toBe("gpt-5.6-luna");
  });

  it("uses GPT-5.6 Luna over Sol when both are live", () => {
    expect(
      chooseDefaultModel(
        [model("gpt-5.6-sol"), model("gpt-5.6-luna"), model("deepseek-v4-pro")],
        ["gpt-5.6-sol", "gpt-5.6-luna", "deepseek-v4-pro"],
        "gpt-5.6-sol",
      ),
    ).toBe("gpt-5.6-luna");
  });

  it("uses DeepSeek V4 Flash when Luna is absent, even if Sol is live", () => {
    expect(
      chooseDefaultModel(
        [model("gpt-5.6-sol"), model("deepseek-v4-flash"), model("deepseek-v4-pro")],
        ["gpt-5.6-sol", "deepseek-v4-flash", "deepseek-v4-pro"],
        "gpt-5.6-sol",
      ),
    ).toBe("deepseek-v4-flash");
  });

  it("matches a preferred id case-insensitively and returns the live spelling", () => {
    expect(
      chooseDefaultModel(
        [model("gpt-5.6-sol"), model("GPT-6-Luna")],
        ["gpt-5.6-sol", "GPT-6-Luna"],
        "gpt-5.6-sol",
      ),
    ).toBe("GPT-6-Luna");
  });

  it("uses GPT-5.6 when the live endpoint listed it, even if DeepSeek Pro is also listed", () => {
    expect(chooseDefaultModel(catalog, ["deepseek-v4-pro", "gpt-5.6-sol", "gpt-4o-mini"], "gpt-5.6-sol")).toBe(
      "gpt-5.6-sol",
    );
  });

  it("does not default to DeepSeek from the static catalog", () => {
    expect(chooseDefaultModel(catalog, undefined, "gpt-5.6-sol")).toBe("claude-sonnet-5");
    expect(chooseDefaultModel(catalog, [], "gpt-5.6-sol")).toBe("claude-sonnet-5");
  });

  it("stays on a live Claude 5 when that is the preferred family present", () => {
    expect(chooseDefaultModel(catalog, ["claude-sonnet-5", "gpt-4o-mini"], "gpt-5.6-sol")).toBe("claude-sonnet-5");
  });
});

describe("family ranking keeps newer generations", () => {
  it("ranks GPT 6 inside the GPT family instead of dropping it behind everything unranked", () => {
    const sorted = sortChatModels([model("gpt-4o-mini"), model("gpt-6-astra"), model("deepseek-v4-flash")]);
    expect(sorted.map((item) => item.id)).toEqual(["gpt-6-astra", "deepseek-v4-flash", "gpt-4o-mini"]);
  });

  it("keeps the 5.6 roles first and puts the newer GPT after them, newest first among the rest", () => {
    const sorted = sortChatModels([
      model("gpt-5.7"),
      model("gpt-6-astra"),
      model("gpt-5.6-sol"),
      model("gpt-5.6-luna"),
    ]);
    expect(sorted.map((item) => item.id)).toEqual(["gpt-5.6-luna", "gpt-5.6-sol", "gpt-6-astra", "gpt-5.7"]);
  });

  it("puts Claude 5.5 ahead of Claude 5 of the same role, in either spelling", () => {
    expect(sortChatModels([model("claude-sonnet-5"), model("claude-sonnet-5-5")]).map((item) => item.id)).toEqual([
      "claude-sonnet-5-5",
      "claude-sonnet-5",
    ]);
    expect(sortChatModels([model("claude-opus-5"), model("claude-opus-5.5")]).map((item) => item.id)).toEqual([
      "claude-opus-5.5",
      "claude-opus-5",
    ]);
  });

  it("does not read a date suffix as a minor version", () => {
    expect(
      sortChatModels([model("claude-sonnet-5-20250514"), model("claude-sonnet-5-5")]).map((item) => item.id),
    ).toEqual(["claude-sonnet-5-5", "claude-sonnet-5-20250514"]);
  });

  it("puts DeepSeek V4.1 ahead of V4 of the same role, in either spelling, and keeps flash before pro", () => {
    expect(sortChatModels([model("deepseek-v4-flash"), model("deepseek-v4-1-flash")]).map((item) => item.id)).toEqual([
      "deepseek-v4-1-flash",
      "deepseek-v4-flash",
    ]);
    expect(sortChatModels([model("deepseek-v4-flash"), model("deepseek-v4.1-flash")]).map((item) => item.id)).toEqual([
      "deepseek-v4.1-flash",
      "deepseek-v4-flash",
    ]);
    expect(
      sortChatModels([model("deepseek-v4-pro"), model("deepseek-v4.1-pro"), model("deepseek-v4-flash")]).map(
        (item) => item.id,
      ),
    ).toEqual(["deepseek-v4-flash", "deepseek-v4.1-pro", "deepseek-v4-pro"]);
  });

  it("still ranks a generation newer than the table inside its family for the picker", () => {
    const sorted = sortChatModels([model("gpt-4o-mini"), model("deepseek-v5-flash"), model("claude-opus-6")]);
    expect(sorted.map((item) => item.id)).toEqual(["claude-opus-6", "deepseek-v5-flash", "gpt-4o-mini"]);
  });

  it("falls back to the newest GPT in the family when no preferred role is live", () => {
    expect(pickPreferredModel([model("gpt-4o-mini"), model("gpt-6-astra")])).toBe("gpt-6-astra");
    expect(pickPreferredModel([model("claude-sonnet-5"), model("claude-sonnet-5-5")])).toBe("claude-sonnet-5-5");
  });

  it("does not change which preferred role wins: Luna still beats a newer GPT", () => {
    expect(pickPreferredModel([model("gpt-6-astra"), model("gpt-5.6-luna"), model("gpt-5.6-sol")])).toBe(
      "gpt-5.6-luna",
    );
  });
});

describe("an unrecognised model is never a default and never recommended", () => {
  it("is passed over by the fallback default while a known model is live", () => {
    expect(pickPreferredModel([model("some-new-lab-model"), model("gpt-4o-mini")])).toBe("gpt-4o-mini");
    expect(pickPreferredModel([model("deepseek-v5-flash"), model("kimi-k2.6")])).toBe("kimi-k2.6");
  });

  it("is still the last resort when nothing else exists, so a catalog is never left without a default", () => {
    expect(pickPreferredModel([model("some-new-lab-model")])).toBe("some-new-lab-model");
  });

  it("as the last resort, still prefers a model that could be a default over a media or embedding id", () => {
    expect(pickPreferredModel([model("whisper-1"), model("my-local-llm")])).toBe("my-local-llm");
    expect(pickPreferredModel([model("text-embedding-3-small"), model("mj_imagine"), model("my-local-llm")])).toBe(
      "my-local-llm",
    );
    // Nothing else to offer: the first id, as before.
    expect(pickPreferredModel([model("whisper-1")])).toBe("whisper-1");
  });

  it("never reaches Recommended, even as the only model live or through a family match", () => {
    expect(recommendedChatModels([model("some-new-lab-model"), model("gpt-7")]).map((item) => item.id)).toEqual([]);
    expect(
      recommendedChatModels([model("deepseek-v5-flash"), model("gpt-6-astra")]).map((item) => item.id),
    ).toEqual(["gpt-6-astra"]);
  });

  it("does not become the default through chooseDefaultModel", () => {
    const catalog = [model("some-new-lab-model"), model("gpt-4o-mini")];
    expect(chooseDefaultModel(catalog, undefined, "gpt-5.6-sol")).toBe("gpt-4o-mini");
  });

  it("keeps the gateway's own default first", () => {
    expect(recommendedChatModels([model("default"), model("some-new-lab-model")]).map((item) => item.id)).toEqual([
      "default",
    ]);
  });
});

/** The chat ids the gateway listed on 2026-09-30 that the product ranks, trimmed. */
const LIVE_2026_09_30 = [
  "gpt-6-luna",
  "gpt-6-sol",
  "gpt-6-astra",
  "gpt-5.6-luna",
  "gpt-5.6-terra",
  "gpt-5.6-sol",
  "claude-sonnet-5-5",
  "claude-opus-5-5",
  "claude-sonnet-5",
  "deepseek-v4-1-flash",
  "deepseek-v4-flash",
  "gemini-3.5-flash",
  "glm-5.3-flash",
  "qwen3.7-plus",
  "MiniMax-M3",
  "kimi-k3",
  "hy3",
];

describe("the Chat default of 2026-09-30", () => {
  it("lists the preference order the owner set", () => {
    expect(CHAT_DEFAULT_PREFERENCES).toEqual([
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
    ]);
  });

  it("picks GPT 6 Luna from the live list", () => {
    const models = LIVE_2026_09_30.map(model);
    expect(chooseDefaultModel(models, LIVE_2026_09_30, "gpt-5.6-sol")).toBe("gpt-6-luna");
    expect(chooseDefaultModel(models, undefined, "gpt-5.6-sol")).toBe("gpt-6-luna");
  });

  it("still lets the gateway's own default alias win", () => {
    const models = ["default", ...LIVE_2026_09_30].map(model);
    expect(chooseDefaultModel(models, undefined, "gpt-5.6-sol")).toBe("default");
  });

  it("skips a Luna the key's live list does not include, and falls to Claude Sonnet 5.5", () => {
    const models = LIVE_2026_09_30.map(model);
    const live = LIVE_2026_09_30.filter((id) => id !== "gpt-6-luna");
    expect(chooseDefaultModel(models, live, "gpt-5.6-sol")).toBe("claude-sonnet-5-5");
  });

  it("walks the whole list in order as the leaders go missing one at a time", () => {
    const pool = LIVE_2026_09_30.map(model);
    CHAT_DEFAULT_PREFERENCES.forEach((expected, index) => {
      const gone = new Set(CHAT_DEFAULT_PREFERENCES.slice(0, index).map((id) => id.toLowerCase()));
      const live = pool.filter((item) => !gone.has(item.id.toLowerCase()));
      expect(chooseDefaultModel(live, undefined, "fallback-id"), expected).toBe(expected);
    });
  });

  it("falls to the family ranking, never the fallback id, when none of the ten is live", () => {
    const models = ["gpt-6-astra", "kimi-k3", "claude-opus-5-5", "gpt-4o-mini"].map(model);
    expect(chooseDefaultModel(models, undefined, "fallback-id")).toBe("gpt-6-astra");
    expect(chooseDefaultModel([model("kimi-k3"), model("gpt-4o-mini")], undefined, "fallback-id")).toBe("kimi-k3");
  });

  it("uses the fallback id only when the catalogue is empty", () => {
    expect(chooseDefaultModel([], undefined, "gpt-6-luna")).toBe("gpt-6-luna");
  });
});

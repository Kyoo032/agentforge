import { describe, expect, it } from "vitest";
import type { ChatModel } from "./catalog";
import {
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
  it("recommends the routing-table everyday set when they are live", () => {
    const picks = recommendedChatModels([
      model("deepseek-v4-flash"),
      model("gpt-5.6-sol"),
      model("gpt-5.6-luna"),
      model("gpt-5.6-terra"),
      model("claude-sonnet-5"),
      model("MiniMax-M3"),
      model("kimi-k2.6"),
      model("glm-5.2"),
      model("gpt-4o-mini"),
    ]);
    expect(picks.map((item) => item.id)).toEqual([
      "gpt-5.6-luna",
      "claude-sonnet-5",
      "MiniMax-M3",
      "gpt-5.6-terra",
    ]);
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
      model("gpt-5.6-luna"),
      model("deepseek-v4-flash"),
      model("MiniMax-M3"),
      model("gpt-4o-mini"),
      model("gpt-5.4"),
      model("gpt-5.6-sol"),
    ]);
    expect(picks.map((item) => item.id)).toEqual(["gpt-5.6-luna", "MiniMax-M3"]);
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

  it("ranks everyday models before advanced within a brand group", () => {
    const groups = pickerGroups([
      model("gpt-5.6-luna"),
      model("deepseek-v4-flash"),
      model("MiniMax-M3"),
      // leftover everyday GPT (not in Recommended prefs) must still sort above advanced cousins
      model("gpt-5.6-sol"),
      model("gpt-5.4"),
      model("gpt-4o-mini"),
      model("o3"),
    ]);
    expect(groups[0]?.models.map((item) => item.id)).toEqual(["gpt-5.6-luna", "MiniMax-M3"]);
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

  it("matches MiniMax M3 case-insensitively", () => {
    expect(
      chooseDefaultModel(
        [model("gpt-5.6-sol"), model("MiniMax-M3")],
        ["gpt-5.6-sol", "MiniMax-M3"],
        "gpt-5.6-sol",
      ),
    ).toBe("MiniMax-M3");
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

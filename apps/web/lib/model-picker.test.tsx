/**
 * Model picker: Escape after a mouse open (0.15.0 verify finding 3).
 *
 * The bug: a click set `open`, the focus call ran before the portalled panel mounted (it waits for a
 * position), so focus stayed on the trigger and the search box's Escape handler never fired. The fix
 * focuses the search box only once `isPanelMounted` is true, handles Escape on the trigger as well,
 * and sends focus back to whatever opened the palette.
 *
 * The environment is node with no DOM (see `meeting-recorder-render.test.tsx`), so this covers the
 * decisions the component makes and the closed markup. The click → Escape → focus sequence itself
 * is driven live on webdev (`.cursor/skills/verify-agentforge/features/models.md`).
 */
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ModelPicker, focusAfterClose, isPanelMounted, type ChatModel } from "@/components/model-picker";
import type { PickerPanelPos } from "./picker-panel";

const MODELS: ChatModel[] = [
  { id: "model-a", label: "Model A", inputModalities: ["text"] },
  { id: "model-b", label: "Model B", inputModalities: ["text", "image"] },
];

const POS: PickerPanelPos = { placement: "below", top: 10, left: 10, width: 320, maxHeight: 400 };

describe("model picker opened with the mouse", () => {
  it("does not focus the search box until the panel has a position", () => {
    // One commit after the click: open, but the panel is not in the DOM yet.
    expect(isPanelMounted(true, null)).toBe(false);
    // The next commit: the panel is placed and mounted, so the search box can take focus.
    expect(isPanelMounted(true, POS)).toBe(true);
    expect(isPanelMounted(false, POS)).toBe(false);
  });

  it("closes on Escape and hands focus back to the trigger", () => {
    expect(focusAfterClose("escape", "trigger")).toBe("trigger");
  });

  it("renders closed again with the trigger collapsed", () => {
    const html = renderToStaticMarkup(<ModelPicker models={MODELS} value="model-a" onChange={() => {}} />);
    expect(html).toContain('data-testid="model-picker"');
    expect(html).toContain('aria-expanded="false"');
    expect(html).not.toContain('data-testid="model-picker-panel"');
  });
});

describe("model picker opened from the keyboard (unchanged)", () => {
  it("returns focus to the composer on Escape after Cmd/Ctrl+K", () => {
    expect(focusAfterClose("escape", "shortcut")).toBe("composer");
  });

  it("sends focus to the composer after a model is picked, however it was opened", () => {
    expect(focusAfterClose("select", "trigger")).toBe("composer");
    expect(focusAfterClose("select", "shortcut")).toBe("composer");
  });

  it("leaves focus alone on an outside click or a second trigger click", () => {
    expect(focusAfterClose("outside", "trigger")).toBeNull();
    expect(focusAfterClose("toggle", "trigger")).toBeNull();
  });
});

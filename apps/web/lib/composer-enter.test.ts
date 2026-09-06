import { describe, expect, it, vi } from "vitest";
import { submitOnEnter } from "./composer-enter";
import type { KeyboardEvent } from "react";

function makeEvent(partial: {
  key: string;
  shiftKey?: boolean;
  altKey?: boolean;
  ctrlKey?: boolean;
  metaKey?: boolean;
  isComposing?: boolean;
  keyCode?: number;
}): KeyboardEvent<HTMLTextAreaElement> {
  const preventDefault = vi.fn();
  return {
    key: partial.key,
    shiftKey: partial.shiftKey ?? false,
    altKey: partial.altKey ?? false,
    ctrlKey: partial.ctrlKey ?? false,
    metaKey: partial.metaKey ?? false,
    preventDefault,
    nativeEvent: {
      isComposing: partial.isComposing ?? false,
      keyCode: partial.keyCode ?? (partial.key === "Enter" ? 13 : 0),
    },
  } as unknown as KeyboardEvent<HTMLTextAreaElement>;
}

describe("submitOnEnter", () => {
  it("submits on Enter", () => {
    const submit = vi.fn();
    const event = makeEvent({ key: "Enter" });
    submitOnEnter(event, submit);
    expect(event.preventDefault).toHaveBeenCalled();
    expect(submit).toHaveBeenCalledTimes(1);
  });

  it("does not submit on Shift+Enter", () => {
    const submit = vi.fn();
    const event = makeEvent({ key: "Enter", shiftKey: true });
    submitOnEnter(event, submit);
    expect(event.preventDefault).not.toHaveBeenCalled();
    expect(submit).not.toHaveBeenCalled();
  });

  it("does not submit while composing (IME)", () => {
    const submit = vi.fn();
    const event = makeEvent({ key: "Enter", isComposing: true });
    submitOnEnter(event, submit);
    expect(event.preventDefault).not.toHaveBeenCalled();
    expect(submit).not.toHaveBeenCalled();
  });

  it("does not submit on keyCode 229 (IME)", () => {
    const submit = vi.fn();
    const event = makeEvent({ key: "Enter", keyCode: 229 });
    submitOnEnter(event, submit);
    expect(event.preventDefault).not.toHaveBeenCalled();
    expect(submit).not.toHaveBeenCalled();
  });

  it("ignores non-Enter keys", () => {
    const submit = vi.fn();
    const event = makeEvent({ key: "a" });
    submitOnEnter(event, submit);
    expect(submit).not.toHaveBeenCalled();
  });
});

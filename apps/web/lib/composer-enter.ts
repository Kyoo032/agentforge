import type { KeyboardEvent } from "react";

/**
 * Submit a composer/send textarea on Enter.
 * Shift+Enter inserts a newline. Ignores IME composition.
 */
export function submitOnEnter(
  event: KeyboardEvent<HTMLTextAreaElement>,
  submit: () => void,
): void {
  if (event.key !== "Enter") {
    return;
  }
  if (event.shiftKey || event.altKey || event.ctrlKey || event.metaKey) {
    return;
  }
  const native = event.nativeEvent as KeyboardEvent["nativeEvent"] & {
    isComposing?: boolean;
    keyCode?: number;
  };
  if (native.isComposing || native.keyCode === 229) {
    return;
  }
  event.preventDefault();
  submit();
}

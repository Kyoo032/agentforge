import { createContext, useContext } from "react";

/**
 * How the Chat header is presenting its chips, read by the chips themselves.
 *
 * `bar`: the chips sit beside the title and a chip's details open as their own popover.
 * `menu`: the chips are the rows of the "Chat details" menu. A popover opened from inside a menu
 * would nest one focus trap in another, so a chip's details unfold inside its own row instead, and
 * only while the menu is open (`menuOpen`).
 *
 * The chips are mounted once and only ever see this value change; they are never remounted between
 * the two, so nothing they fetch on mount is fetched again.
 */
export type ChipPresentation = "bar" | "menu";

export type ChatHeaderLayout = {
  presentation: ChipPresentation;
  menuOpen: boolean;
  /**
   * Changes every time the header changes mode or opens or shuts its menu. A chip keeps its own
   * details open only for the epoch it opened them in, so they are closed again by the next change
   * however it happens, with no effect to run.
   */
  epoch: number;
};

/** What a chip sees outside the header, and what the header gives them while inline. */
export const BAR_LAYOUT: ChatHeaderLayout = Object.freeze({ presentation: "bar", menuOpen: false, epoch: 0 });

export const ChatHeaderLayoutContext = createContext<ChatHeaderLayout>(BAR_LAYOUT);

export function useChatHeaderLayout(): ChatHeaderLayout {
  return useContext(ChatHeaderLayoutContext);
}

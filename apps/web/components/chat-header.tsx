"use client";

import { type KeyboardEventHandler, type MouseEventHandler, type ReactNode, type Ref, useId, useMemo } from "react";
import { ChatHeaderLayoutContext, type ChatHeaderLayout } from "@/components/chat-header-layout";
import type { HeaderMode } from "@/lib/chat-header-fit";
import { t } from "@/lib/i18n";
import { useChatHeaderFit } from "@/lib/use-chat-header-fit";
import "@/components/chat-header.css";

export type ChatHeaderViewProps = {
  title: string;
  /** The empty Chat shows a smaller title. */
  compact: boolean;
  mode: HeaderMode;
  open: boolean;
  /** `HeaderState.epoch`: changes on every mode change and every open or shut. */
  epoch?: number;
  panelId: string;
  headerRef?: Ref<HTMLDivElement>;
  titleRef?: Ref<HTMLHeadingElement>;
  controlsRef?: Ref<HTMLDivElement>;
  buttonRef?: Ref<HTMLButtonElement>;
  onToggle?: () => void;
  onButtonKeyDown?: KeyboardEventHandler<HTMLButtonElement>;
  onPanelClick?: MouseEventHandler<HTMLDivElement>;
  onPanelKeyDown?: KeyboardEventHandler<HTMLDivElement>;
  /** The chips. They render in one place whatever the mode, so each is mounted once. */
  children: ReactNode;
};

/**
 * The header as markup, with the mode and the open state handed in. `ChatHeader` owns them;
 * the tests render this directly in each mode, since node has no layout to measure.
 */
export function ChatHeaderView({
  title,
  compact,
  mode,
  open,
  epoch = 0,
  panelId,
  headerRef,
  titleRef,
  controlsRef,
  buttonRef,
  onToggle,
  onButtonKeyDown,
  onPanelClick,
  onPanelKeyDown,
  children,
}: ChatHeaderViewProps) {
  const menu = mode === "menu";
  const label = t("chat.header.menu");
  const layout = useMemo<ChatHeaderLayout>(
    () => ({ presentation: menu ? "menu" : "bar", menuOpen: menu && open, epoch }),
    [menu, open, epoch],
  );

  return (
    <div
      ref={headerRef}
      className="chat-header w-full shrink-0 px-[var(--chat-gutter)]"
      data-testid="chat-header"
      data-mode={mode}
      data-open={menu && open ? "true" : "false"}
    >
      <h1
        ref={titleRef}
        className={`chat-header-title ${compact ? "text-sm" : "text-2xl"} truncate font-medium tracking-[var(--track)] text-[var(--text)]`}
      >
        {title}
      </h1>
      <div className="chat-header-end">
        {menu ? (
          <button
            ref={buttonRef}
            type="button"
            className="chat-header-menu-btn"
            data-testid="chat-header-menu"
            aria-label={label}
            title={label}
            aria-haspopup="dialog"
            aria-expanded={open}
            aria-controls={panelId}
            onClick={onToggle}
            onKeyDown={onButtonKeyDown}
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" focusable="false">
              <circle cx="5" cy="12" r="1.8" />
              <circle cx="12" cy="12" r="1.8" />
              <circle cx="19" cy="12" r="1.8" />
            </svg>
          </button>
        ) : null}
        <div
          ref={controlsRef}
          id={panelId}
          className="chat-header-controls text-xs"
          data-testid="chat-header-controls"
          role={menu ? "dialog" : undefined}
          aria-label={menu ? label : undefined}
          tabIndex={menu ? -1 : undefined}
          // Shut, the chips are laid out to be measured but are not there: not focusable, not
          // clickable, not read out.
          inert={menu && !open ? true : undefined}
          onClick={menu && open ? onPanelClick : undefined}
          onKeyDown={menu && open ? onPanelKeyDown : undefined}
        >
          <ChatHeaderLayoutContext.Provider value={layout}>{children}</ChatHeaderLayoutContext.Provider>
        </div>
      </div>
    </div>
  );
}

type Props = {
  title: string;
  compact: boolean;
  children: ReactNode;
};

/**
 * The Chat header: the title, and the chips beside it while they fit or in one "Chat details" menu
 * when they do not. It is one row at every width. The decision is measured (`useChatHeaderFit`),
 * the arithmetic and the menu's behaviour are `lib/chat-header-fit.ts`, the drawing is
 * `chat-header.css`, and the chips read how they are being presented from
 * `chat-header-layout.ts`. Map: `docs/internal/maps/chat-send.md` § 8.
 */
export function ChatHeader({ title, compact, children }: Props) {
  const panelId = useId();
  const fit = useChatHeaderFit();

  return (
    <ChatHeaderView
      title={title}
      compact={compact}
      mode={fit.state.mode}
      open={fit.state.open}
      epoch={fit.state.epoch}
      panelId={panelId}
      headerRef={fit.headerRef}
      titleRef={fit.titleRef}
      controlsRef={fit.controlsRef}
      buttonRef={fit.buttonRef}
      onToggle={fit.toggle}
      onButtonKeyDown={fit.onButtonKeyDown}
      onPanelClick={fit.onPanelClick}
      onPanelKeyDown={fit.onPanelKeyDown}
    >
      {children}
    </ChatHeaderView>
  );
}

"use client";

import { formatContextLength } from "@agentforge/core/preferred";

const pillClass =
  "inline-flex h-8 items-center rounded-md border border-mist bg-paper px-2.5 text-xs tabular-nums text-ink/60";

type Props = {
  usedTokens: number;
  contextLength?: number;
};

export function ChatContextChip({ usedTokens, contextLength }: Props) {
  const used = Math.max(0, usedTokens);
  const window = contextLength && contextLength > 0 ? contextLength : undefined;
  const label = window
    ? `${formatContextLength(used)} / ${formatContextLength(window)}`
    : `${formatContextLength(used)} used`;
  const title = window
    ? `About ${used.toLocaleString()} tokens in this chat of ${window.toLocaleString()} context`
    : `About ${used.toLocaleString()} tokens in this chat`;

  return (
    <span className={pillClass} data-testid="chat-context" title={title}>
      {label}
    </span>
  );
}

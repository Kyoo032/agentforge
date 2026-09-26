"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import { CHANNEL_CAPS, type ChannelMessage, type ChannelRecord } from "@agentforge/core/channels";
import {
  ChannelError,
  NOT_CONNECTED_CODE,
  addChannel,
  connectTelegramBot,
  disconnectTelegramBot,
  loadChannelMessages,
  loadChannels,
  pollTelegram,
  removeChannel,
  sendToChannel,
  type ChannelBotStatus,
} from "@/lib/channels-client";
import { t } from "@/lib/i18n";
import { ModeHeader } from "@/components/mode-header";

const NO_BOT: ChannelBotStatus = {
  connected: false,
  username: null,
  name: null,
  connectedAt: null,
  fingerprint: null,
  pinnedOrigin: true,
};

function errorText(error: unknown, fallback: string): string {
  if (error instanceof ChannelError) {
    return error.code === NOT_CONNECTED_CODE ? t("channels.errors.notConnected") : error.message;
  }
  return error instanceof Error && error.message ? error.message : fallback;
}

function whenLabel(at: number): string {
  return new Date(at).toLocaleString();
}

function BotCard({
  bot,
  busy,
  onConnect,
  onDisconnect,
}: {
  bot: ChannelBotStatus;
  busy: boolean;
  onConnect: (token: string) => void;
  onDisconnect: () => void;
}) {
  const [token, setToken] = useState("");

  return (
    <section
      className="raise rounded-xl border border-[var(--line)] bg-[var(--surface)] p-4"
      data-testid="channels-bot-card"
    >
      <p className="panel-label">{t("channels.bot.label")}</p>
      {bot.connected ? (
        <div className="mt-2">
          <p className="text-sm text-[var(--text)]" data-testid="channels-bot-status">
            {t("channels.bot.connected", { username: bot.username ?? "" })}
          </p>
          <p className="mt-1 text-[12px] text-[var(--text-2)]" data-testid="channels-bot-fingerprint">
            {bot.fingerprint ?? ""}
          </p>
          <button
            type="button"
            className="btn mt-3"
            disabled={busy}
            data-testid="channels-bot-disconnect"
            onClick={onDisconnect}
          >
            {t("channels.bot.disconnect")}
          </button>
        </div>
      ) : (
        <form
          className="mt-2"
          data-testid="channels-bot-form"
          onSubmit={(event: FormEvent) => {
            event.preventDefault();
            const trimmed = token.trim();
            if (trimmed) {
              onConnect(trimmed);
              setToken("");
            }
          }}
        >
          <p className="text-sm text-[var(--text-2)]" data-testid="channels-bot-status">
            {t("channels.bot.intro")}
          </p>
          <input
            className="input mt-3 w-full"
            type="password"
            autoComplete="off"
            spellCheck={false}
            placeholder={t("channels.bot.placeholder")}
            aria-label={t("channels.bot.label")}
            value={token}
            data-testid="channels-bot-token"
            onChange={(event) => setToken(event.target.value)}
          />
          <button type="submit" className="btn btn-primary mt-3" disabled={busy} data-testid="channels-bot-connect">
            {t("channels.bot.connect")}
          </button>
        </form>
      )}
      {bot.pinnedOrigin ? null : (
        <p className="mt-3 text-[12px] text-amber-700" data-testid="channels-sandbox-note">
          {t("channels.bot.sandbox")}
        </p>
      )}
    </section>
  );
}

function Conversation({ messages }: { messages: ChannelMessage[] }) {
  if (messages.length === 0) {
    return (
      <p className="text-sm text-[var(--text-2)]" data-testid="channels-conversation-empty">
        {t("channels.conversation.empty")}
      </p>
    );
  }
  return (
    <ul className="flex flex-col gap-2" data-testid="channels-conversation">
      {messages.map((message) => (
        <li
          key={message.id}
          className="rounded-lg border border-[var(--line)] bg-[var(--surface-2)] p-2"
          data-testid="channels-message"
          data-direction={message.direction}
        >
          <p className="text-[12px] text-[var(--text-2)]">
            {message.direction === "out"
              ? t("channels.conversation.sentBy", { author: message.author })
              : t("channels.conversation.receivedFrom", { author: message.author })}
            {" · "}
            {whenLabel(message.at)}
          </p>
          <p className="mt-1 whitespace-pre-wrap text-sm text-[var(--text)]">{message.text}</p>
        </li>
      ))}
    </ul>
  );
}

export function ChannelsPage() {
  const [bot, setBot] = useState<ChannelBotStatus>(NO_BOT);
  const [channels, setChannels] = useState<ChannelRecord[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChannelMessage[]>([]);
  const [target, setTarget] = useState("");
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const selected = channels.find((row) => row.id === selectedId) ?? null;

  const refresh = useCallback(async () => {
    try {
      const payload = await loadChannels();
      setBot(payload.bot ?? NO_BOT);
      setChannels(payload.channels ?? []);
      setSelectedId((current) => {
        const rows = payload.channels ?? [];
        if (current && rows.some((row) => row.id === current)) {
          return current;
        }
        return rows[0]?.id ?? null;
      });
    } catch (caught) {
      setError(errorText(caught, t("channels.errors.load")));
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    if (!selectedId) {
      setMessages([]);
      return;
    }
    let cancelled = false;
    void loadChannelMessages(selectedId)
      .then((rows) => {
        if (!cancelled) {
          setMessages(rows);
        }
      })
      .catch((caught: unknown) => {
        if (!cancelled) {
          setError(errorText(caught, t("channels.errors.load")));
        }
      });
    return () => {
      cancelled = true;
    };
  }, [selectedId]);

  /** Every mutating press goes through here: one busy flag, one error line, one refresh. */
  const run = useCallback(async (action: () => Promise<void>, fallback: string) => {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await action();
    } catch (caught) {
      setError(errorText(caught, fallback));
    } finally {
      setBusy(false);
    }
  }, []);

  const reloadMessages = useCallback(async (channelId: string) => {
    setMessages(await loadChannelMessages(channelId));
  }, []);

  return (
    <main
      className="mx-auto w-full max-w-[var(--content-stage)] px-6 py-8 text-[var(--text)]"
      data-testid="channels-page"
    >
      <div className="mb-6">
        <ModeHeader
          icon="channels"
          title={t("channels.title")}
          outcomeTestId="channels-intro"
          outcome={t("channels.intro")}
        >
          {/* A standing warning, not a step: one click away, out of the reading path. */}
          <details
            className="mt-3 max-w-[var(--content-narrow)] rounded-xl border border-[var(--line)] bg-[var(--surface)] px-3 py-2"
            data-testid="channels-privacy"
          >
            <summary className="cursor-pointer select-none text-xs font-medium text-[var(--text-2)]">
              {t("channels.privacyLabel")}
            </summary>
            <p className="mt-2 text-[12px] text-[var(--text-2)]">{t("channels.privacy")}</p>
          </details>
        </ModeHeader>
      </div>

      {error ? (
        <p className="mb-4 text-sm text-red-700" data-testid="channels-error">
          {error}
        </p>
      ) : null}
      {notice ? (
        <p className="mb-4 text-sm text-[var(--text-2)]" data-testid="channels-notice">
          {notice}
        </p>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-[320px_1fr]">
        <div className="flex flex-col gap-4">
          <BotCard
            bot={bot}
            busy={busy}
            onConnect={(token) =>
              void run(async () => {
                setBot(await connectTelegramBot(token));
                await refresh();
              }, t("channels.errors.connect"))
            }
            onDisconnect={() =>
              void run(async () => {
                setBot(await disconnectTelegramBot());
                await refresh();
              }, t("channels.errors.disconnect"))
            }
          />

          <section className="raise rounded-xl border border-[var(--line)] bg-[var(--surface)] p-4">
            <p className="panel-label">{t("channels.list.label")}</p>
            <form
              className="mt-2 flex gap-2"
              data-testid="channels-add-form"
              onSubmit={(event: FormEvent) => {
                event.preventDefault();
                const value = target.trim();
                if (!value) {
                  return;
                }
                void run(async () => {
                  const created = await addChannel(value);
                  setTarget("");
                  setSelectedId(created.id);
                  await refresh();
                }, t("channels.errors.add"));
              }}
            >
              <input
                className="input min-w-0 flex-1"
                placeholder={t("channels.list.placeholder")}
                aria-label={t("channels.list.addAria")}
                value={target}
                data-testid="channels-add-target"
                onChange={(event) => setTarget(event.target.value)}
              />
              <button type="submit" className="btn" disabled={busy} data-testid="channels-add-submit">
                {t("channels.list.add")}
              </button>
            </form>
            <p className="mt-2 text-[12px] text-[var(--text-2)]">
              {t("channels.list.hint", { max: CHANNEL_CAPS.maxPerWorkspace })}
            </p>

            {channels.length === 0 ? (
              <p className="mt-3 text-sm text-[var(--text-2)]" data-testid="channels-empty">
                {t("channels.list.empty")}
              </p>
            ) : (
              <ul className="mt-3 flex flex-col gap-1" data-testid="channels-list">
                {channels.map((channel) => (
                  <li key={channel.id} className="flex items-center gap-2">
                    <button
                      type="button"
                      className="min-w-0 flex-1 rounded-lg px-2 py-1 text-left text-sm hover:bg-[var(--surface-2)]"
                      data-testid="channels-item"
                      data-on={channel.id === selectedId ? "true" : "false"}
                      aria-pressed={channel.id === selectedId}
                      onClick={() => setSelectedId(channel.id)}
                    >
                      <span className="block truncate text-[var(--text)]">{channel.title}</span>
                      <span className="block truncate text-[12px] text-[var(--text-2)]">{channel.chatTarget}</span>
                    </button>
                    <button
                      type="button"
                      className="btn btn-quiet"
                      disabled={busy}
                      data-testid="channels-remove"
                      aria-label={t("channels.list.remove")}
                      onClick={() =>
                        void run(async () => {
                          await removeChannel(channel.id);
                          if (channel.id === selectedId) {
                            setSelectedId(null);
                          }
                          await refresh();
                        }, t("channels.errors.remove"))
                      }
                    >
                      {t("channels.list.remove")}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>

        <section className="raise rounded-xl border border-[var(--line)] bg-[var(--surface)] p-4">
          {selected ? (
            <>
              <div className="flex flex-wrap items-center gap-2">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-[var(--text)]" data-testid="channels-selected">
                    {selected.title}
                  </p>
                  <p className="truncate text-[12px] text-[var(--text-2)]">
                    {t(`channels.chatType.${selected.chatType}`)} · {selected.chatTarget}
                  </p>
                </div>
                <button
                  type="button"
                  className="btn ml-auto"
                  disabled={busy || !bot.connected}
                  data-testid="channels-poll"
                  onClick={() =>
                    void run(async () => {
                      const result = await pollTelegram();
                      await reloadMessages(selected.id);
                      await refresh();
                      setNotice(
                        result.unmatched > 0
                          ? t("channels.poll.someUnmatched", {
                              received: result.received,
                              unmatched: result.unmatched,
                            })
                          : t("channels.poll.done", { received: result.received }),
                      );
                    }, t("channels.errors.poll"))
                  }
                >
                  {t("channels.poll.check")}
                </button>
              </div>

              <div className="mt-4">
                <Conversation messages={messages} />
              </div>

              <form
                className="mt-4"
                data-testid="channels-composer"
                onSubmit={(event: FormEvent) => {
                  event.preventDefault();
                  const text = draft.trim();
                  if (!text) {
                    return;
                  }
                  void run(async () => {
                    await sendToChannel(selected.id, text);
                    setDraft("");
                    await reloadMessages(selected.id);
                    await refresh();
                  }, t("channels.errors.send"));
                }}
              >
                <textarea
                  className="input min-h-[80px] w-full"
                  maxLength={CHANNEL_CAPS.maxTextChars}
                  placeholder={t("channels.composer.placeholder")}
                  aria-label={t("channels.composer.aria")}
                  value={draft}
                  data-testid="channels-composer-text"
                  onChange={(event) => setDraft(event.target.value)}
                />
                <div className="mt-2 flex items-center gap-2">
                  <button
                    type="submit"
                    className="btn btn-primary"
                    disabled={busy || !bot.connected}
                    data-testid="channels-send"
                  >
                    {t("channels.composer.send")}
                  </button>
                  {bot.connected ? null : (
                    <span className="text-[12px] text-[var(--text-2)]" data-testid="channels-needs-bot">
                      {t("channels.errors.notConnected")}
                    </span>
                  )}
                </div>
              </form>
            </>
          ) : (
            <p className="text-sm text-[var(--text-2)]" data-testid="channels-none-selected">
              {t("channels.conversation.none")}
            </p>
          )}
        </section>
      </div>
    </main>
  );
}

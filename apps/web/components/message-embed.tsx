import { t } from "@/lib/i18n";

export type MessageEmbedKind = "link" | "file" | "image" | "video" | "job";

type Props = {
  kind: MessageEmbedKind;
  title: string;
  detail?: string;
  href?: string;
  src?: string;
  alt?: string;
  body?: string;
};

const KICKER: Record<MessageEmbedKind, string> = {
  link: "chat.embed.link",
  file: "chat.embed.file",
  image: "chat.embed.image",
  video: "chat.embed.video",
  job: "chat.embed.job",
};

const CARD =
  "chat-embed card-live enter-fade mt-2 flex max-w-full flex-col px-3 py-3 no-underline text-inherit";

/**
 * One card for a link, a file, an image, a video, or a job result in a Chat turn.
 * Copy comes from the chat catalog. The enter motion is `.chat-embed-enter`.
 */
export function MessageEmbed({ kind, title, detail, href, src, alt, body }: Props) {
  const longBody = Boolean(body && body.length > 180);
  const inner = (
    <>
      <span className="block text-xs font-medium uppercase tracking-[0.12em] text-[var(--text-3)]">
        {t(KICKER[kind])}
      </span>
      {title ? <span className="mt-0.5 block text-sm font-medium text-[var(--text)]">{title}</span> : null}
      {detail ? <span className="mt-0.5 block break-words text-xs text-[var(--text-2)]">{detail}</span> : null}
      {kind === "image" && src ? (
        <img
          src={src}
          alt={alt && alt.length > 0 ? alt : t("chat.embed.image")}
          className="mt-2 max-w-full rounded-[var(--r-card)]"
          data-testid="message-image"
        />
      ) : null}
      {kind === "video" && src ? (
        <video src={src} controls className="mt-2 max-w-full rounded-[var(--r-card)]" data-testid="message-video" />
      ) : null}
      {body && !longBody ? (
        <span className="mt-1 block whitespace-pre-wrap text-xs text-[var(--text-2)]">{body}</span>
      ) : null}
      {body && longBody ? (
        <details className="mt-1">
          <summary className="cursor-pointer text-xs text-[var(--accent)]">{t("chat.embed.preview")}</summary>
          <span className="mt-1 block whitespace-pre-wrap text-xs text-[var(--text-2)]">{body}</span>
        </details>
      ) : null}
      {href ? <span className="mt-1 block text-xs text-[var(--accent)]">{t("chat.embed.open")}</span> : null}
    </>
  );
  if (href) {
    return (
      <a
        className={CARD}
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        data-testid="message-embed"
        data-kind={kind}
      >
        {inner}
      </a>
    );
  }
  return (
    <div className={CARD} data-testid="message-embed" data-kind={kind}>
      {inner}
    </div>
  );
}

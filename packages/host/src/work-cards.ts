import type { SourceOrigin, WorkSourceType } from "./knowledge";

/**
 * A work card is the text the Knowledge Base indexes when a mode finishes something.
 * Bytes (mp4, png, DOCX, PPTX) stay in media / artifacts; the card only carries a pointer.
 */
export type WorkCard = {
  type: WorkSourceType;
  origin: SourceOrigin;
  /** Source row name (Sources list). */
  title: string;
  /** What the user asked for, if any. */
  prompt?: string;
  /** `media:<id>`, `artifact:<id>`, or `thread:<id>` — how to find the bytes. */
  pointer: string;
  /** Route to the stored file, when there is one. A header line: host-generated, never masked. */
  file?: string;
  /** The result text (markdown, prompt notes, or the assistant answer). Capped by `renderWorkCard`. */
  body: string;
  model?: string;
};

/** Hard cap on the indexed text of one card. */
export const WORK_CARD_BODY_MAX = 8_000;
export const WORK_CARD_TITLE_MAX = 120;
export const WORK_CARD_PROMPT_MAX = 1_200;
const CHAT_USER_MAX = 2_000;
const CHAT_ASSISTANT_MAX = 5_000;
const TRUNCATED = "\n[truncated]";

export function capText(text: string, max: number): string {
  const trimmed = text.trim();
  if (trimmed.length <= max) {
    return trimmed;
  }
  return `${trimmed.slice(0, Math.max(0, max - TRUNCATED.length)).trimEnd()}${TRUNCATED}`;
}

/** First line of a prompt, shortened, as a source name. */
export function titleFromPrompt(prompt: string, fallback: string): string {
  const first = prompt
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find(Boolean);
  if (!first) {
    return fallback;
  }
  return first.length > WORK_CARD_TITLE_MAX ? `${first.slice(0, WORK_CARD_TITLE_MAX - 1).trimEnd()}…` : first;
}

/**
 * The text that gets chunked and embedded. Header lines make the card self-describing when retrieved.
 *
 * `Mode` / `Model` / `Pointer` / `File` are host-generated identifiers, and the ingest step masks the
 * card's user text field by field rather than masking this string, so a UUID whose middle groups are
 * all digits is no longer rewritten as `[phone]` by the PII masker.
 */
export function renderWorkCard(card: WorkCard): string {
  const header = [
    `# ${card.title}`,
    `Mode: ${card.type}`,
    card.model ? `Model: ${card.model}` : "",
    `Pointer: ${card.pointer}`,
    card.file ? `File: ${card.file}` : "",
    card.prompt ? `Prompt: ${capText(card.prompt, WORK_CARD_PROMPT_MAX)}` : "",
  ]
    .filter(Boolean)
    .join("\n");
  const body = card.body.trim();
  if (!body) {
    return "";
  }
  const room = Math.max(0, WORK_CARD_BODY_MAX - header.length - 2);
  return `${header}\n\n${capText(body, room)}`;
}

export type MediaWorkInput = {
  kind: "image" | "video";
  mediaId: string;
  prompt: string;
  aspect: string;
  model: string;
  url: string;
  seconds?: number;
  resolution?: string;
  /** Edit generate jobs share the media store but are their own mode. */
  type?: WorkSourceType;
};

/**
 * Images / Videos / Edit: the prompt and settings are the knowledge; the file is only pointed at.
 *
 * The prompt appears **once**, in the body. It used to be written twice — body line and header line —
 * which, on a card that is essentially nothing but its prompt, doubled the indexed text and doubled
 * that prompt's term frequency against `bm25(knowledge_chunks)`, so media cards outranked every
 * single-copy source on their own prompt words.
 */
export function mediaWorkCard(input: MediaWorkInput): WorkCard {
  const noun = input.kind === "image" ? "image" : "video clip";
  const lines = [
    `Generated ${noun}.`,
    `Prompt: ${input.prompt.trim()}`,
    `Aspect: ${input.aspect}`,
    input.seconds ? `Duration: ${input.seconds} s` : "",
    input.resolution ? `Resolution: ${input.resolution}` : "",
  ].filter(Boolean);
  return {
    type: input.type ?? (input.kind === "image" ? "Images" : "Videos"),
    origin: { kind: "media", id: input.mediaId },
    title: titleFromPrompt(input.prompt, `Generated ${noun}`),
    prompt: undefined,
    pointer: `media:${input.mediaId}`,
    file: input.url,
    body: lines.join("\n"),
    model: input.model,
  };
}

export type MusicWorkInput = {
  mediaId: string;
  /** The description, or the lyrics when the desk wrote them itself. */
  prompt: string;
  model: string;
  url: string;
  mode: "describe" | "custom";
  title?: string;
  style?: string;
  instrumental?: boolean;
  durationSeconds?: number;
};

/**
 * Music: same contract as `mediaWorkCard` — the bytes stay in the media store and the card carries
 * only the words. Lyrics are the whole point of a song card, so `custom` mode indexes them as the
 * body; `describe` mode indexes the brief instead. Either way the text appears once, for the same
 * bm25 reason the media card comment explains.
 */
export function musicWorkCard(input: MusicWorkInput): WorkCard {
  const lines = [
    "Generated music track.",
    input.mode === "custom" ? `Lyrics: ${input.prompt.trim()}` : `Brief: ${input.prompt.trim()}`,
    input.style ? `Style: ${input.style}` : "",
    input.instrumental ? "Instrumental: yes" : "",
    input.durationSeconds ? `Duration: ${Math.round(input.durationSeconds)} s` : "",
  ].filter(Boolean);
  return {
    type: "Music",
    origin: { kind: "media", id: input.mediaId },
    title: input.title?.trim() || titleFromPrompt(input.prompt, "Generated track"),
    prompt: undefined,
    pointer: `media:${input.mediaId}`,
    file: input.url,
    body: lines.join("\n"),
    model: input.model,
  };
}

export type ArtifactWorkInput = {
  type: Extract<WorkSourceType, "Research" | "Data" | "Finance" | "Market" | "Documents" | "Presentation" | "Legal">;
  artifactId: string;
  title: string;
  prompt?: string;
  markdown: string;
  model?: string;
};

/** Research / Data / Finance / Market / Documents / Presentation / Legal: the saved markdown, capped. */
export function artifactWorkCard(input: ArtifactWorkInput): WorkCard {
  return {
    type: input.type,
    origin: { kind: "artifact", id: input.artifactId },
    title: input.title.trim() || input.type,
    prompt: input.prompt,
    pointer: `artifact:${input.artifactId}`,
    body: input.markdown,
    model: input.model,
  };
}

export type ChatWorkInput = {
  threadId: string;
  title: string;
  userText: string;
  assistantText: string;
  model?: string;
};

/**
 * Chat: one card per thread, rewritten after every completed assistant turn with the latest
 * exchange only (never the whole sealed history). Retrieval skips the asking thread's own card.
 */
export function chatWorkCard(input: ChatWorkInput): WorkCard {
  const user = capText(input.userText, CHAT_USER_MAX);
  const assistant = capText(input.assistantText, CHAT_ASSISTANT_MAX);
  return {
    type: "Chat",
    origin: { kind: "thread", id: input.threadId },
    title: input.title.trim() || titleFromPrompt(input.userText, "Chat"),
    prompt: undefined,
    pointer: `thread:${input.threadId}`,
    body: [user ? `User: ${user}` : "", assistant ? `Assistant: ${assistant}` : ""].filter(Boolean).join("\n\n"),
    model: input.model,
  };
}

/** Markdown for a Documents draft (title + sections) so it can be saved and indexed like other jobs. */
export function documentDraftMarkdown(draft: { title: string; sections: Array<{ heading: string; body: string }> }): string {
  return [`# ${draft.title.trim()}`, ...draft.sections.map((section) => `## ${section.heading.trim()}\n\n${section.body.trim()}`)]
    .join("\n\n")
    .trim();
}

/** Markdown for a Presentation outline (title + slides with bullets and speaker notes). */
export function presentationOutlineMarkdown(outline: {
  title: string;
  slides: Array<{ heading: string; subhead?: string; bullets: string[]; aside?: string; notes?: string }>;
}): string {
  const slides = outline.slides.map((slide, index) => {
    const subhead = slide.subhead?.trim() ? `\n\n_${slide.subhead.trim()}_` : "";
    const bullets = slide.bullets.map((bullet) => `- ${bullet.trim()}`).join("\n");
    const aside = slide.aside?.trim() ? `\n\n> ${slide.aside.trim()}` : "";
    const notes = slide.notes?.trim() ? `\n\nNotes: ${slide.notes.trim()}` : "";
    const body = [subhead, bullets ? `\n\n${bullets}` : "", aside, notes].join("");
    return `## ${index + 1}. ${slide.heading.trim()}${body}`;
  });
  return [`# ${outline.title.trim()}`, ...slides].join("\n\n").trim();
}

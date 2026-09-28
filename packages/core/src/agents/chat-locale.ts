import { parseAppLocale, type AppLocale } from "../locale";

const CHAT_ID_OUTPUT_RULE =
  "Write every user-facing reply in Bahasa Indonesia. Use professional, polite Anda and infinitive forms. Keep brand names DPSBuddy, Toko Token, and TokenKu unchanged. Do not switch to English unless quoting the user.";

export type StubChatCopy = {
  thinkCalc: string;
  thinkClock: string;
  thinkDefault: string;
  needKey: string;
};

const STUB_CHAT_COPY: Record<AppLocale, StubChatCopy> = {
  en: {
    thinkCalc: "I'll compute this with the calculator, then return only the result.",
    thinkClock: "I'll read the clock and return the timestamp.",
    thinkDefault:
      "This desk has no live model. I can still use local tools; a gateway key in Settings unlocks a real answer.",
    needKey: "I need a Toko Token gateway key in Settings to answer that.",
  },
  id: {
    thinkCalc: "Saya akan menghitung ini dengan kalkulator, lalu hanya mengembalikan hasilnya.",
    thinkClock: "Saya akan membaca jam dan mengembalikan stempel waktunya.",
    thinkDefault:
      "Meja ini tidak punya model live. Saya masih bisa memakai alat lokal; kunci gateway di Pengaturan membuka jawaban sungguhan.",
    needKey: "Saya memerlukan kunci gateway Toko Token di Pengaturan untuk menjawab itu.",
  },
};

const CLOCK_RE = /\b(date|time|today|now|clock|tanggal|waktu|sekarang|jam)\b|\bhari\s+ini\b/i;

export function chatOutputLanguageRule(locale: AppLocale): string | null {
  return locale === "id" ? CHAT_ID_OUTPUT_RULE : null;
}

export function withChatOutputLanguage(systemPrompt: string, locale: AppLocale): string {
  const rule = chatOutputLanguageRule(locale);
  if (!rule) {
    return systemPrompt;
  }
  if (systemPrompt.includes(rule)) {
    return systemPrompt;
  }
  return `${systemPrompt}\n\n${rule}`;
}

export function stubChatCopy(locale: AppLocale): StubChatCopy {
  return STUB_CHAT_COPY[parseAppLocale(locale)];
}

/**
 * Sentences a Chat turn shows while it works. Mirrors `chat.harness` in the en/id catalogs.
 * The host does not import those catalogs; this table is the copy the turn actually writes.
 */
export type ChatTurnCopy = {
  thinkPast: string;
  thinkDesk: string;
  lookingAttached: string;
  pastNone: string;
  pastOne: string;
  pastMany: string;
  /** Stub only: a real marker plus one the desk did not offer, so the check has something to drop. */
  deskCite: string;
  noSource: string;
};

const CHAT_TURN_COPY: Record<AppLocale, ChatTurnCopy> = {
  en: {
    thinkPast: "I'll look through earlier chats, then answer from what I find.",
    thinkDesk: "I'll answer from the desk note.",
    lookingAttached: "Looking at what you attached.",
    pastNone: "No earlier chat on this desk matches that.",
    pastOne: 'The earlier chat is "{title}".',
    pastMany: 'Earlier chats include "{title}".',
    deskCite: "From the desk [1] [99].",
    noSource: "This desk did not have a source for that.",
  },
  id: {
    thinkPast: "Saya akan meninjau percakapan sebelumnya, lalu menjawab dari yang saya temukan.",
    thinkDesk: "Saya akan menjawab dari catatan meja.",
    lookingAttached: "Melihat yang Anda lampirkan.",
    pastNone: "Tidak ada percakapan sebelumnya di meja ini yang cocok.",
    pastOne: 'Percakapan sebelumnya berjudul "{title}".',
    pastMany: 'Percakapan sebelumnya mencakup "{title}".',
    deskCite: "Dari meja [1] [99].",
    noSource: "Meja ini tidak punya sumber untuk itu.",
  },
};

export function chatTurnCopy(locale: AppLocale): ChatTurnCopy {
  return CHAT_TURN_COPY[parseAppLocale(locale)];
}

export function fillChatTurn(template: string, title: string): string {
  return template.replaceAll("{title}", title);
}

export function wantsStubClock(summary: string): boolean {
  return CLOCK_RE.test(summary);
}

const PAST_CHAT_RE =
  /\b(earlier chat|previous (?:chat|conversation)|last time we|what did we (?:say|decide|discuss)|we (?:said|decided))\b|percakapan sebelumnya|chat sebelumnya|terakhir kali|yang kita (?:bahas|putuskan|katakan)/i;

const DESK_SOURCE_RE =
  /\bwhat does (?:the|this) desk (?:say|know)\b|\baccording to (?:my|the) (?:notes|sources)\b|menurut (?:catatan|sumber)|apa kata (?:meja|catatan)/i;

/** The person referred to an earlier chat and did not name a tool. */
export function wantsStubPastChat(summary: string): boolean {
  return PAST_CHAT_RE.test(summary);
}

/** The person asked what the desk already knows, without naming a cite format. */
export function wantsStubDeskSource(summary: string): boolean {
  return DESK_SOURCE_RE.test(summary);
}

const CHAT_STUB_ENHANCE_SUFFIX: Record<AppLocale, string> = {
  en: "State the goal, constraints, and the output you want.",
  id: "Nyatakan tujuan, batasan, dan keluaran yang Anda inginkan.",
};

export function stubChatEnhanceSuffix(locale: AppLocale): string {
  return CHAT_STUB_ENHANCE_SUFFIX[parseAppLocale(locale)];
}

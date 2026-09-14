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

export function wantsStubClock(summary: string): boolean {
  return CLOCK_RE.test(summary);
}

const CHAT_STUB_ENHANCE_SUFFIX: Record<AppLocale, string> = {
  en: "State the goal, constraints, and the output you want.",
  id: "Nyatakan tujuan, batasan, dan keluaran yang Anda inginkan.",
};

export function stubChatEnhanceSuffix(locale: AppLocale): string {
  return CHAT_STUB_ENHANCE_SUFFIX[parseAppLocale(locale)];
}

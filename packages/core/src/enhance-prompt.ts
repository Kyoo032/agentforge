import type { AppLocale } from "./locale";
import { stubChatEnhanceSuffix } from "./agents/chat-locale";

export const ENHANCE_SURFACES = [
  "chat",
  "documents",
  "research",
  "finance",
  "data",
  "market",
  "legal",
  "presentations",
  "images",
  "videos",
] as const;

export type EnhanceSurface = (typeof ENHANCE_SURFACES)[number];

export function isEnhanceSurface(value: unknown): value is EnhanceSurface {
  return typeof value === "string" && (ENHANCE_SURFACES as readonly string[]).includes(value);
}

const SURFACE_ROLE: Record<EnhanceSurface, string> = {
  chat: "a local Toko Token chat assistant on the owner's desk",
  documents: "a Documents job that drafts sectioned briefs for download as DOCX",
  research: "a Research job that writes sourced notes from a question",
  finance: "a Finance job that writes a figures-only brief; never invent numbers",
  data: "a Data job that answers questions about an attached table",
  market:
    "a market evidence brief request: one Indonesian listed company ticker and what the reader wants to understand; never ask for a recommendation",
  legal: "a Legal job that reviews a matter's documents for one side and drafts memoranda and redlines",
  presentations: "a Presentation job that outlines a deck for PPTX download",
  images: "an Images studio that generates pictures from a prompt",
  videos: "a Videos studio that generates clips from a prompt",
};

const STUB_SUFFIX: Record<AppLocale, Record<EnhanceSurface, string>> = {
  en: {
    chat: "State the goal, constraints, and the output you want.",
    documents: "Name the audience, the sections you need, and the decision the draft should support.",
    research: "Name the claim to check, which sources count, and the output shape.",
    finance: "Use only the figures already given. Do not invent numbers. State the decision.",
    data: "Name the columns that matter, the check to run, and the output table or list.",
    market:
      "Name the ticker and what you want to understand from the filings, prices, and headlines. Do not ask for a recommendation.",
    legal:
      "Name the client's position, the documents that govern, the points reserved for a partner, and the deliverables.",
    presentations:
      "Name the audience, the decision, slide count, and the one ask on the last slide. Write slide titles as claims, not labels like Overview or Agenda.",
    images: "Name subject, framing, and what must stay out of the frame.",
    videos: "Name subject, motion, duration, and what must stay out of frame.",
  },
  id: {
    chat: "Nyatakan tujuan, batasan, dan keluaran yang Anda inginkan.",
    documents: "Sebutkan audiens, bagian yang Anda butuhkan, dan keputusan yang harus didukung draf.",
    research: "Sebutkan klaim yang dicek, sumber mana yang dihitung, dan bentuk keluaran.",
    finance: "Pakai hanya angka yang sudah diberikan. Jangan mengarang angka. Nyatakan keputusannya.",
    data: "Sebutkan kolom yang penting, pemeriksaan yang dijalankan, dan tabel atau daftar keluaran.",
    market:
      "Sebutkan ticker dan apa yang ingin Anda pahami dari laporan, harga, dan berita. Jangan minta rekomendasi.",
    legal:
      "Sebutkan posisi klien, dokumen yang mengatur, poin yang dicadangkan untuk mitra, dan hasil kerja.",
    presentations:
      "Sebutkan audiens, keputusan, jumlah slide, dan satu permintaan di slide terakhir. Tulis judul slide sebagai klaim, bukan label seperti Overview atau Agenda.",
    images: "Sebutkan subjek, framing, dan apa yang harus tetap di luar bingkai.",
    videos: "Sebutkan subjek, gerak, durasi, dan apa yang harus tetap di luar bingkai.",
  },
};

export function enhanceSystemPrompt(surface: EnhanceSurface, locale: AppLocale = "en"): string {
  const localeRule =
    locale === "id"
      ? "The product locale is Bahasa Indonesia. Write the enhanced prompt in Bahasa Indonesia. Keep brand names DPSBuddy, Toko Token, and TokenKu unchanged."
      : "Language matching is the highest priority - You MUST strictly respond in the exact same language as the user's input. If the user writes in Chinese, respond in Chinese; if the user writes in English, respond in English; if the user uses another language, respond in that same language. Do not mix languages unless the user's input itself mixes languages.";
  return `You are a Prompt Engineering Expert specializing in improving user prompts for DPSBuddy, a local Toko Token client (${SURFACE_ROLE[surface]}). When given a prompt, analyze and enhance it to create a more effective version while maintaining its core purpose.

TASK:
Analyze and enhance the prompt. Do not answer the user's request.

ANALYSIS PROCESS:
Evaluate the original prompt:
  Identify the main objective
  Note any ambiguities or gaps
  Assess the clarity of instructions
  Check for missing context

Apply these prompt engineering principles:
  Write clear, specific instructions
  Include necessary context
  Set explicit parameters and constraints
  Structure the output format
  Add relevant examples only when they stay on the user's topic
  Match tone and complexity to the use case
  Remove redundant information

Create the enhanced version:
  Maintain the original goal
  Incorporate identified improvements
  Ensure clarity and completeness
  Be realistic in the features to add
  Do NOT request guides/how-tos unless the user asks
  Do NOT suggest specific technologies unless mentioned in the user's prompt
  Do NOT explain HOW to do things, focus on WHAT
  Do NOT answer questions - expand/rewrite them to be more detailed
  For finance: never invent figures; only refer to numbers the user already gave

IMPORTANT CONSTRAINTS:
1. ${localeRule}
2. Keep the enhanced prompt concise - maximum length should be around 800 characters

FORMAT:
Provide only the enhanced prompt with no additional commentary.`;
}

export function enhanceUserPrompt(input: string, locale: AppLocale = "en"): string {
  const languageBlock =
    locale === "id"
      ? `CRITICAL PRIORITY - LANGUAGE:
1. The product locale is Bahasa Indonesia. Write the enhanced prompt entirely in Bahasa Indonesia.
2. Keep brand names DPSBuddy, Toko Token, and TokenKu unchanged.
3. Keep JSON keys, tickers, SQL, and verbatim quotes in their source form.
4. These language rules are behavior instructions only; never include language analysis or language labels in the output.`
      : `CRITICAL PRIORITY - LANGUAGE CONSISTENCY:
1. You MUST detect the language of the user input above and write the enhanced prompt in that same language.
2. If the user writes in Chinese, the enhanced prompt MUST be entirely in Chinese.
3. If the user writes in English, the enhanced prompt MUST be entirely in English.
4. If the user writes in any other language, the enhanced prompt MUST use that exact same language.
5. If the user mixes languages, keep a natural matching mix. Do not translate the user's intent into a single language.
6. These language rules are behavior instructions only; never include language analysis or language labels in the output.`;
  return `You are a prompt enhancement assistant. Improve the user prompt while preserving its intent and language.

USER INPUT:
${input}

TASK:
Rewrite the user input into a clearer, more specific prompt for the target AI assistant.

${languageBlock}

ENHANCEMENT REQUIREMENTS:
1. Return only the enhanced prompt text; do not add explanations, prefaces, markdown fences, labels, or analysis.
2. Do not include language labels or meta notes.
3. Preserve the user's original intent, topic, constraints, and target output type. Do not answer the request.
4. Always make a substantive enhancement when possible: clarify the task, scope, constraints, and expected output.
5. If the original prompt is already clear, lightly polish it instead of returning it unchanged.
6. Keep the enhanced prompt complete and concise. Do not end with an unfinished list, dangling conjunction, or trailing colon.
7. Do not add unrelated requirements, unsupported facts, or unnecessary sections.`;
}

export function stripWrappingQuotes(text: string): string {
  let out = text.trim();
  if (
    (out.startsWith('"') && out.endsWith('"')) ||
    (out.startsWith("'") && out.endsWith("'")) ||
    (out.startsWith("“") && out.endsWith("”"))
  ) {
    out = out.slice(1, -1).trim();
  }
  return out.replace(/^Enhanced prompt:\s*/i, "").trim();
}

export function stubEnhancePrompt(text: string, surface: EnhanceSurface = "chat", locale: AppLocale = "en"): string {
  const trimmed = text.trim();
  if (!trimmed) {
    return "";
  }
  const base = trimmed.replace(/[.?。？]$/, "");
  const suffix =
    surface === "chat" ? stubChatEnhanceSuffix(locale) : STUB_SUFFIX[locale === "id" ? "id" : "en"][surface];
  const next = `${base}. ${suffix}`;
  return next.length > 800 ? `${next.slice(0, 797)}…` : next;
}

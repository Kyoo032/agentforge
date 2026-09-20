import { parseAppLocale, type AppLocale } from "./locale";

export const OUTPUT_LANGUAGE_SURFACES = [
  "documents",
  "research",
  "finance",
  "data",
  "videos",
  "edit",
  "knowledge",
  "meeting",
] as const;

export type OutputLanguageSurface = (typeof OUTPUT_LANGUAGE_SURFACES)[number];

/**
 * Keep catalog surfaces in sync with `apps/web/locales/{en,id}/*.json`.
 * Host never imports the renderer catalogs; these strings are the model instructions.
 */
const RULE: Record<OutputLanguageSurface, Record<AppLocale, string>> = {
  documents: {
    en: "Write every user-facing title, heading, and body string in English. Keep JSON keys in English.",
    id: "Tulis setiap title, heading, dan body yang dilihat pengguna dalam Bahasa Indonesia (register profesional, sapaan Anda). Kunci JSON tetap bahasa Inggris. Jangan mencampur bahasa kecuali prompt pengguna sendiri mencampur.",
  },
  research: {
    en: "Write every user-facing string (title, summary, finding headings and bodies, contradictions, openQuestions, and source notes) in English. Keep JSON keys, source ids such as [S1], URLs, and verbatim passages unchanged.",
    id: "Tulis setiap string yang dilihat pengguna (title, summary, judul dan isi temuan, contradictions, openQuestions, dan catatan sumber) dalam Bahasa Indonesia profesional (Anda / infinitif). Pertahankan kunci JSON, id sumber seperti [S1], URL, dan kutipan verbatim. Jangan mencampur heading bahasa Inggris ke dalam temuan.",
  },
  finance: {
    en: "Write the title, section headings, body paragraphs, and assumptions in English. Keep JSON keys in English. Do not translate metric keys. Keep every number exactly as given.",
    id: "Tulis judul, heading bagian, paragraf isi, dan asumsi dalam Bahasa Indonesia. Kunci JSON tetap dalam bahasa Inggris. Jangan menerjemahkan kunci metrik. Pertahankan setiap angka persis seperti yang diberikan.",
  },
  data: {
    en: "Write the title, summary, finding headings, finding bodies, and chart titles in English. Keep SQL, column identifiers, and table names unchanged.",
    id: "Tulis judul, ringkasan, judul temuan, isi temuan, dan judul grafik dalam Bahasa Indonesia yang profesional. Jangan menerjemahkan SQL, pengenal kolom, atau nama tabel.",
  },
  videos: {
    en: "Spoken dialogue, narration, and any on-screen text in this clip must be in English unless the prompt already names another language.",
    id: "Dialog, narasi, dan teks di layar pada klip ini harus dalam bahasa Indonesia, kecuali prompt sudah menyebut bahasa lain.",
  },
  edit: {
    en: "Write user-facing Edit text (card verbs, titles, captions, assistant replies, and any on-image or on-video words) in English. Keep tool names and JSON keys in English.",
    id: "Tulis teks Edit yang dilihat pengguna (kata kerja kartu, judul, teks overlay, balasan asisten, dan kata pada gambar atau video) dalam bahasa Indonesia. Pertahankan nama alat dan kunci JSON dalam bahasa Inggris.",
  },
  meeting: {
    en: "Write the minutes — title, summary, decisions, action items, risks, and open questions — in English. Keep every person's name, figure, date, and product name exactly as the transcript said it. Keep JSON keys in English.",
    id: "Tulis notulen — judul, ringkasan, keputusan, item tindakan, risiko, dan pertanyaan terbuka — dalam Bahasa Indonesia profesional (sapaan Anda). Pertahankan setiap nama orang, angka, tanggal, dan nama produk persis seperti yang disebut dalam transkrip. Kunci JSON tetap bahasa Inggris.",
  },
  knowledge: {
    en: "Write overview, topic titles, topic summaries, gap notes, and verifier notes in English. Keep JSON keys, source ids, and verbatim excerpts unchanged.",
    id: "Tulis overview, judul topik, ringkasan, catatan celah, dan catatan verifier dalam Bahasa Indonesia profesional. Pertahankan kunci JSON, id sumber, dan kutipan verbatim.",
  },
};

const EDIT_STUB: Record<AppLocale, { help: string; undo: string }> = {
  en: {
    help: "I can help trim, split, caption, and title this timeline.",
    undo: "Undo is available on the last card.",
  },
  id: {
    help: "Saya dapat membantu memangkas, memotong, menambahkan teks overlay, dan memberi judul pada linimasa ini.",
    undo: "Urungkan tersedia pada kartu terakhir.",
  },
};

export function outputLanguageRule(surface: OutputLanguageSurface, locale: AppLocale): string {
  return RULE[surface][parseAppLocale(locale)];
}

/** Append the surface language rule once. Does not rewrite the stored user prompt. */
export function withOutputLanguage(
  prompt: string,
  surface: OutputLanguageSurface,
  locale: AppLocale,
): string {
  const rule = outputLanguageRule(surface, locale);
  if (prompt.includes(rule)) {
    return prompt;
  }
  return `${prompt}\n\n${rule}`;
}

export function editStubAssistantCopy(locale: AppLocale): { help: string; undo: string } {
  return EDIT_STUB[parseAppLocale(locale)];
}

export const GATEWAY_REQUIRED_SURFACES = [
  "documents",
  "research",
  "finance",
  "data",
  "market",
  "videos",
  "meeting",
] as const;

export type GatewayRequiredSurface = (typeof GATEWAY_REQUIRED_SURFACES)[number];

/**
 * "Needs a live gateway" copy for the job harnesses. Legal keeps its own `stubError`
 * in `legal/output-copy.ts`; Presentation keeps `presentationGatewayMessage` host-side.
 */
const GATEWAY_REQUIRED: Record<GatewayRequiredSurface, Record<AppLocale, string>> = {
  documents: {
    en: "Document generation needs a live gateway. Paste a Toko Token API key in Settings, then try again.",
    id: "Pembuatan dokumen memerlukan gerbang yang aktif. Tempel kunci API Toko Token di Settings, lalu coba lagi.",
  },
  research: {
    en: "Research needs a live gateway. Paste a Toko Token API key in Settings, then try again.",
    id: "Research memerlukan gerbang yang aktif. Tempel kunci API Toko Token di Settings, lalu coba lagi.",
  },
  finance: {
    en: "Finance needs a live gateway. Paste a Toko Token API key in Settings, then try again.",
    id: "Finance memerlukan gerbang yang aktif. Tempel kunci API Toko Token di Settings, lalu coba lagi.",
  },
  data: {
    en: "Data analysis needs a live gateway. Paste a Toko Token API key in Settings, then try again.",
    id: "Analisis data memerlukan gerbang yang aktif. Tempel kunci API Toko Token di Settings, lalu coba lagi.",
  },
  market: {
    en: "Market needs a live gateway. Paste a Toko Token API key in Settings, then try again.",
    id: "Market memerlukan gerbang yang aktif. Tempel kunci API Toko Token di Settings, lalu coba lagi.",
  },
  videos: {
    en: "Add a Toko Token gateway key in Settings to generate videos.",
    id: "Tambahkan kunci gerbang Toko Token di Settings untuk membuat video.",
  },
  meeting: {
    en: "Meeting minutes need a live gateway. Paste a Toko Token API key in Settings, then try again.",
    id: "Notulen rapat memerlukan gerbang yang aktif. Tempel kunci API Toko Token di Settings, lalu coba lagi.",
  },
};

const SEARCH_KEY_REQUIRED: Record<AppLocale, string> = {
  en: "Research needs a Tavily or Brave Search API key. Add it in Settings, then try again.",
  id: "Research memerlukan kunci API Tavily atau Brave Search. Tambahkan di Settings, lalu coba lagi.",
};

/** Stub-runtime refusal shown when the owner has not pasted a gateway key yet. */
export function gatewayRequiredMessage(surface: GatewayRequiredSurface, locale: AppLocale): string {
  return GATEWAY_REQUIRED[surface][parseAppLocale(locale)];
}

/** Research also needs a web-search route; the gateway key alone is not enough. */
export function searchKeyRequiredMessage(locale: AppLocale): string {
  return SEARCH_KEY_REQUIRED[parseAppLocale(locale)];
}

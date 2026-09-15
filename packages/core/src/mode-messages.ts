import { parseAppLocale, type AppLocale } from "./locale";

/**
 * Empty-result and failure copy shared by the job harnesses.
 *
 * These are ApiError messages the renderer shows verbatim, so every key carries both
 * locales. Mode-specific copy that already has a home (legal `output-copy.ts`, host
 * `presentation-locale.ts`, host `image-output-locale.ts`) stays where it is.
 */
export const MODE_MESSAGE_KEYS = [
  "emptyDocumentDraft",
  "emptyDocumentSection",
  "emptyFinanceBrief",
  "emptyAnalysis",
  "emptyMarketBriefing",
  "emptyPresentationOutline",
  "emptySlide",
  "videoGenerateFailed",
  "videoStillUnsupported",
  "noFiguresParsed",
  "datasetNoNumericColumn",
  "webSearchFailed",
  "invalidKnowledgeMap",
  "knowledgeMapFailed",
  "editAgentFailed",
  "editFileRequired",
  "editMediaUnreadable",
] as const;

export type ModeMessageKey = (typeof MODE_MESSAGE_KEYS)[number];

const MODE_MESSAGES: Record<ModeMessageKey, Record<AppLocale, string>> = {
  emptyDocumentDraft: {
    en: "Model returned an empty document draft",
    id: "Model mengembalikan draf dokumen yang kosong",
  },
  emptyDocumentSection: {
    en: "Model returned an empty document section",
    id: "Model mengembalikan bagian dokumen yang kosong",
  },
  emptyFinanceBrief: {
    en: "Model returned an empty finance brief",
    id: "Model mengembalikan ringkasan keuangan yang kosong",
  },
  emptyAnalysis: {
    en: "Model returned an empty analysis",
    id: "Model mengembalikan analisis yang kosong",
  },
  emptyMarketBriefing: {
    en: "Model returned an empty market briefing",
    id: "Model mengembalikan ringkasan pasar yang kosong",
  },
  emptyPresentationOutline: {
    en: "Model returned an empty presentation outline",
    id: "Model mengembalikan kerangka presentasi yang kosong",
  },
  emptySlide: {
    en: "Model returned an empty slide",
    id: "Model mengembalikan slide yang kosong",
  },
  videoGenerateFailed: {
    en: "Video generation failed",
    id: "Pembuatan video gagal",
  },
  videoStillUnsupported: {
    en: "This model does not accept a still image",
    id: "Model ini tidak menerima gambar diam",
  },
  noFiguresParsed: {
    en: "No figures could be read from that text",
    id: "Tidak ada angka yang dapat dibaca dari teks itu",
  },
  datasetNoNumericColumn: {
    en: "That dataset has no numeric column to use as amounts",
    id: "Dataset itu tidak memiliki kolom numerik yang dapat dipakai sebagai nominal",
  },
  webSearchFailed: {
    en: "Web search failed",
    id: "Pencarian web gagal",
  },
  invalidKnowledgeMap: {
    en: "Brain returned an invalid knowledge map",
    id: "Brain mengembalikan peta pengetahuan yang tidak valid",
  },
  knowledgeMapFailed: {
    en: "Map failed",
    id: "Pemetaan gagal",
  },
  editAgentFailed: {
    en: "edit agent failed",
    id: "agen Edit gagal",
  },
  editFileRequired: {
    en: "file is required",
    id: "berkas wajib diisi",
  },
  editMediaUnreadable: {
    en: "ffprobe could not read this file",
    id: "ffprobe tidak dapat membaca berkas ini",
  },
};

/** One user-visible mode message in the run locale. Unknown locales fall back to English. */
export function modeMessage(key: ModeMessageKey, locale: AppLocale): string {
  return MODE_MESSAGES[key][parseAppLocale(locale)];
}

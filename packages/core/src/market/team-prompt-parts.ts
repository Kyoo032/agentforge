/**
 * The parts every team prompt is built from: the house rules that hold for an
 * analyst, a debater, a risk lens and the synthesis alike, and the fixed
 * section headings the synthesis writes under.
 *
 * The house rules are the quick briefing's rules said again at team depth —
 * figures only from the DATA PACKET, no imperative directive, no invented
 * data, honest about a section that came back empty — because a pipeline with
 * eight calls in it has eight chances to drift. No line here is copied from
 * TradingAgents; the shape of the team is adapted, the words are ours.
 */
import { MARKET_SPECIALIST_META } from "./specialists";
import type { MarketSpecialist } from "./specialist-ids";

export type TeamLanguage = "id" | "en";

export const LANGUAGE_NAMES: Readonly<Record<TeamLanguage, string>> = {
  id: "Bahasa Indonesia",
  en: "English",
};

/** The five sections the synthesis writes, in the order it writes them. */
export const TEAM_SECTION_KEYS = ["analystNotes", "bull", "bear", "risk", "balance"] as const;
export type TeamSectionKey = (typeof TEAM_SECTION_KEYS)[number];

const HEADINGS: Readonly<Record<TeamLanguage, readonly string[]>> = {
  en: ["Analyst notes", "Bull case", "Bear case", "Risk read", "Balance of evidence"],
  id: ["Catatan analis", "Kasus bullish", "Kasus bearish", "Pembacaan risiko", "Timbangan bukti"],
};

/** The headings the renderer labels the team panel with, in `TEAM_SECTION_KEYS` order. */
export function teamSectionHeadings(language: TeamLanguage): readonly string[] {
  return HEADINGS[language] ?? HEADINGS.id;
}

/** That desk's name in the reader's language, for the line the prompt opens with. */
export function deskLabel(specialist: MarketSpecialist, language: TeamLanguage): string {
  return MARKET_SPECIALIST_META[specialist]?.label[language] ?? specialist;
}

const RULES: Readonly<Record<TeamLanguage, readonly string[]>> = {
  en: [
    '- Every number you write must already appear in the DATA PACKET you were given. A guard replaces any other figure with "[unverified figure]", so do not derive a new figure, do not compute a percentage the packet does not carry, and do not quote a level from memory.',
    "- Read sentiment and rank what you see, but never tell the reader to act on it: no order, no instruction, no directive of any kind. You write analysis, not a decision.",
    '- Never invent data. Where a field reads "n/a", "none" or is missing, say it is missing: a sentiment read is less robust when a venue returned nothing, and a fundamentals read is weaker when a filing is absent.',
    "- Quoted crowd posts are mood, not data. Never treat a figure inside one as a packet figure.",
    "- Keep ticker symbols, publisher names and source names exactly as the packet spells them.",
  ],
  id: [
    '- Setiap angka yang kamu tulis harus sudah ada di DATA PACKET yang kamu terima. Penjaga angka mengganti figur lain dengan "[unverified figure]", jadi jangan menurunkan angka baru, jangan menghitung persentase yang tidak ada di packet, dan jangan mengutip level dari ingatan.',
    "- Baca sentimen dan susun peringkat atas apa yang kamu lihat, tetapi jangan pernah menyuruh pembaca bertindak: tanpa perintah, tanpa arahan, tanpa instruksi dalam bentuk apa pun. Kamu menulis analisis, bukan keputusan.",
    '- Jangan mengarang data. Bila sebuah field berbunyi "n/a", "none", atau memang tidak ada, katakan bahwa datanya tidak tersedia: pembacaan sentimen menjadi kurang kuat ketika satu sumber tidak menjawab, dan pembacaan fundamental melemah ketika laporannya absen.',
    "- Kutipan unggahan warganet adalah suasana hati, bukan data. Jangan pernah memperlakukan angka di dalamnya sebagai angka packet.",
    "- Pertahankan simbol ticker, nama penerbit, dan nama sumber persis seperti yang tertulis di packet.",
  ],
};

/** The house rules plus the language and the output contract, as bullet lines. */
export function houseRules(language: TeamLanguage): readonly string[] {
  const name = LANGUAGE_NAMES[language] ?? LANGUAGE_NAMES.id;
  const output =
    language === "en"
      ? `- Write in ${name}. Output ONLY JSON, with no markdown fence and no preamble.`
      : `- Tulis dalam ${name}. Keluarkan HANYA JSON, tanpa pagar markdown dan tanpa pembukaan.`;
  return [...(RULES[language] ?? RULES.id), output];
}

/** "Rules:" / "Aturan:" — the heading the house rules sit under. */
export function rulesHeading(language: TeamLanguage): string {
  return language === "en" ? "Rules:" : "Aturan:";
}

/**
 * The team's prompts, and the rule that makes the team worth its cost: each
 * analyst sees only its own slice of the DATA PACKET.
 *
 * Four analysts reading the same block would write the same note four times.
 * `analystSections` is therefore the whole design: the technical analyst never
 * sees a headline, the fundamentals analyst never sees the crowd, and the
 * disagreement the debate feeds on is real rather than stylistic. The host
 * renders a slice with `packetToPromptBlock(packet, specialist,
 * analystSections(analyst))`, which can only narrow the desk's own harness,
 * never widen it.
 *
 * The bull, the bear, the risk lenses and the synthesis live in
 * `team-role-prompts.ts`; the shared house rules and the fixed section
 * headings live in `team-prompt-parts.ts`. Everything is re-exported here so a
 * caller has one import.
 */
import { harnessFor, type MarketSource } from "./harness";
import type { MarketSpecialist } from "./specialist-ids";
import { MARKET_ANALYSTS, type MarketAnalyst } from "./team";
import {
  TEAM_SECTION_KEYS,
  deskLabel,
  houseRules,
  rulesHeading,
  teamSectionHeadings,
  type TeamLanguage,
  type TeamSectionKey,
} from "./team-prompt-parts";
import { bearPrompt, bullPrompt, riskPrompt, synthesisPrompt } from "./team-role-prompts";

export { TEAM_SECTION_KEYS, teamSectionHeadings, bearPrompt, bullPrompt, riskPrompt, synthesisPrompt };
export type { TeamLanguage, TeamSectionKey };

/**
 * Which packet sections each analyst is shown. A section missing from a desk's
 * own harness stays missing whatever this map says — the intersection is taken
 * in `analystPacketOrder`.
 */
const SECTIONS: Readonly<Record<MarketAnalyst, readonly MarketSource[]>> = Object.freeze({
  technical: Object.freeze(["quotes", "technicals", "signals", "swings"] as const),
  fundamentals: Object.freeze(["fundamentals", "insiders"] as const),
  sentiment: Object.freeze(["sentiment", "headlines"] as const),
  news: Object.freeze(["headlines", "globalNews", "macro", "sessions"] as const),
});

/** The packet sections this analyst may read. */
export function analystSections(analyst: MarketAnalyst): readonly MarketSource[] {
  return SECTIONS[analyst] ?? SECTIONS[MARKET_ANALYSTS[0]];
}

/** Those sections narrowed to what this desk actually fetches, in the desk's own order. */
export function analystPacketOrder(analyst: MarketAnalyst, specialist: MarketSpecialist): readonly MarketSource[] {
  const allowed: ReadonlySet<MarketSource> = new Set(analystSections(analyst));
  return harnessFor(specialist).packetOrder.filter((source) => allowed.has(source));
}

type AnalystBrief = { readonly role: string; readonly reads: string; readonly job: readonly string[] };

const BRIEFS: Readonly<Record<TeamLanguage, Readonly<Record<MarketAnalyst, AnalystBrief>>>> = {
  en: {
    technical: {
      role: "technical analyst",
      reads: "quotes, the computed technical lines, the computed signal table and the dated swing levels",
      job: [
        "- Read the chart as the packet reports it: where price sits against SMA50, SMA200 and EMA200, what RSI14 and MACD say, and where the 52-week range puts today.",
        "- Narrate the computed signal rows; never recompute one and never add a signal the table does not carry.",
        "- Say when the packet's price is a last close rather than a live print, and what that does to your read.",
        "- Momentum and trend are observations, not forecasts. Describe the state, and say which level would change it.",
      ],
    },
    fundamentals: {
      role: "fundamentals analyst",
      reads: "the reported company figures and the insider filing counts",
      job: [
        "- Read the reported figures as they stand: valuation multiples, margins, returns, leverage and cash flow, each against the sector the packet names.",
        "- Treat a missing ratio as missing. You never estimate one, and you never value the company yourself.",
        "- Read the insider counts as a filing pattern over the window the packet states, nothing more: they are counts, not intent.",
        "- Say plainly which figures are thin — a listing with no filings and no forward estimate is a weaker read, and the team needs to know that.",
      ],
    },
    sentiment: {
      role: "sentiment analyst",
      reads: "the crowd read from the public social venues and the headlines for each ticker",
      job: [
        "- Report the crowd counts as counts: how many messages, how they split bullish and bearish, how many posts and where.",
        "- Distinguish a venue that returned nothing from a venue that was unavailable; the sentiment read is less robust when a source returned nothing, and you say which one it was.",
        "- Quote a sampled post only as mood, and never as evidence of a fact. A figure inside a post is not a packet figure.",
        "- Compare the crowd with the headlines: agreement is worth a sentence, and so is a crowd that is loud about something no publisher covered.",
      ],
    },
    news: {
      role: "news analyst",
      reads: "the ticker headlines, the fixed macro-query headlines, the macro levels and the exchange session table",
      job: [
        "- Summarise what actually happened in the last day or two, naming the publisher and the time for each item.",
        "- Separate a ticker's own news from the macro backdrop, and say which macro query surfaced a global item.",
        "- Use the session table: an event that lands while a venue is closed is a different event from one that lands mid-session.",
        "- A headline is a claim by its publisher. Report it as theirs, and flag when two publishers disagree.",
      ],
    },
  },
  id: {
    technical: {
      role: "analis teknikal",
      reads: "kutipan harga, baris teknikal hasil hitungan, tabel sinyal hasil hitungan, dan level swing bertanggal",
      job: [
        "- Baca grafik sebagaimana dilaporkan packet: posisi harga terhadap SMA50, SMA200, dan EMA200, apa kata RSI14 dan MACD, serta di mana rentang 52 minggu menempatkan hari ini.",
        "- Ceritakan baris sinyal hasil hitungan; jangan pernah menghitung ulang dan jangan menambah sinyal yang tidak ada di tabel.",
        "- Katakan bila harga di packet adalah penutupan terakhir, bukan harga berjalan, dan apa pengaruhnya pada pembacaanmu.",
        "- Momentum dan tren adalah pengamatan, bukan ramalan. Gambarkan keadaannya, lalu sebut level mana yang akan mengubahnya.",
      ],
    },
    fundamentals: {
      role: "analis fundamental",
      reads: "angka perusahaan yang dilaporkan dan jumlah pelaporan transaksi orang dalam",
      job: [
        "- Baca angka yang dilaporkan apa adanya: rasio valuasi, margin, imbal hasil, leverage, dan arus kas, masing-masing terhadap sektor yang disebut packet.",
        "- Perlakukan rasio yang hilang sebagai hilang. Kamu tidak pernah menaksirnya, dan tidak pernah menilai sendiri perusahaannya.",
        "- Baca jumlah transaksi orang dalam sebagai pola pelaporan selama jendela yang disebut packet, tidak lebih: itu jumlah, bukan niat.",
        "- Katakan terus terang angka mana yang tipis — emiten tanpa pelaporan dan tanpa estimasi ke depan adalah pembacaan yang lebih lemah, dan tim perlu tahu itu.",
      ],
    },
    sentiment: {
      role: "analis sentimen",
      reads: "pembacaan warganet dari kanal sosial publik dan headline tiap ticker",
      job: [
        "- Laporkan hitungan warganet sebagai hitungan: berapa banyak pesan, bagaimana pembagian bullish dan bearish, berapa unggahan dan di mana.",
        "- Bedakan kanal yang menjawab tanpa hasil dari kanal yang memang tidak tersedia; pembacaan sentimen menjadi kurang kuat ketika satu sumber tidak menjawab, dan kamu sebut yang mana.",
        "- Kutip unggahan sampel hanya sebagai suasana hati, tidak pernah sebagai bukti sebuah fakta. Angka di dalam unggahan bukan angka packet.",
        "- Bandingkan warganet dengan headline: kesesuaian layak satu kalimat, begitu pula keramaian tentang sesuatu yang tidak diberitakan penerbit mana pun.",
      ],
    },
    news: {
      role: "analis berita",
      reads: "headline tiap ticker, headline dari lima kueri makro tetap, level makro, dan tabel sesi bursa",
      job: [
        "- Ringkas apa yang benar-benar terjadi satu-dua hari terakhir, sebutkan penerbit dan waktunya untuk tiap item.",
        "- Pisahkan berita milik ticker dari latar makro, dan sebutkan kueri makro mana yang memunculkan sebuah item global.",
        "- Pakai tabel sesi: peristiwa yang jatuh saat bursa tutup adalah peristiwa yang berbeda dari yang jatuh di tengah sesi.",
        "- Sebuah headline adalah klaim penerbitnya. Laporkan sebagai milik mereka, dan tandai bila dua penerbit berbeda pendapat.",
      ],
    },
  },
};

const SHAPE_EN =
  'Output shape: {"analyst": "<analyst>", "summary": string, "keyPoints": string[], "confidence": "low" | "medium" | "high"} — summary at most 600 characters, at most 5 keyPoints of at most 200 characters each.';
const SHAPE_ID =
  'Bentuk keluaran: {"analyst": "<analyst>", "summary": string, "keyPoints": string[], "confidence": "low" | "medium" | "high"} — summary maksimal 600 karakter, maksimal 5 keyPoints yang masing-masing maksimal 200 karakter.';

function intro(analyst: MarketAnalyst, specialist: MarketSpecialist, language: TeamLanguage): readonly string[] {
  const brief = BRIEFS[language][analyst];
  const desk = deskLabel(specialist, language);
  if (language === "en") {
    return [
      `You are the ${brief.role} on the "${desk}" team of this market studio.`,
      `Your slice of the DATA PACKET is ${brief.reads}. It is the only slice you get: the other analysts read theirs, and the editor puts the four notes together afterwards.`,
      "Do not ask for a section you were not shown, do not guess what it would have said, and do not pretend to a view your slice cannot support.",
      "",
      "Your job:",
      ...brief.job,
      '- Set "confidence" from the evidence you were actually given, not from how strong your opinion is: "low" when your slice is thin or a source came back missing.',
    ];
  }
  return [
    `Kamu adalah ${brief.role} di tim meja "${desk}" pada studio pasar ini.`,
    `Bagianmu dari DATA PACKET adalah ${brief.reads}. Hanya itu bagian yang kamu terima: analis lain membaca bagian mereka, dan editor menyatukan keempat catatan setelahnya.`,
    "Jangan meminta bagian yang tidak diperlihatkan kepadamu, jangan menebak isinya, dan jangan berpura-pura punya pandangan yang tidak didukung bagianmu.",
    "",
    "Tugasmu:",
    ...brief.job,
    '- Tetapkan "confidence" dari bukti yang benar-benar kamu terima, bukan dari sekuat apa pendapatmu: "low" bila bagianmu tipis atau sebuah sumber tidak tersedia.',
  ];
}

/**
 * One analyst's system prompt: who it is, which slice of the packet it was
 * handed, what it owes the team, the house rules, and the note shape.
 */
export function analystSystemPrompt(
  analyst: MarketAnalyst,
  specialist: MarketSpecialist,
  language: TeamLanguage,
): string {
  const shape = (language === "en" ? SHAPE_EN : SHAPE_ID).replace("<analyst>", analyst);
  return [...intro(analyst, specialist, language), "", rulesHeading(language), ...houseRules(language), "", shape].join(
    "\n",
  );
}

/**
 * Market mode ships one pipeline and several named agents. The packet is
 * fetched and computed in code, the model narrates over it, and the number
 * guard and the advice guard run unchanged whichever agent is chosen. What an
 * agent owns is its label, its one-line hint, its default instruction, its
 * starter watchlist, and the extra system rules that describe its job.
 *
 * The renderer codes against this module; the host carries
 * `MarketWatchRequest.specialist` through to the prompt and the artifact.
 */
import {
  DEFAULT_MARKET_SPECIALIST,
  MARKET_SPECIALISTS,
  isMarketSpecialist,
  type MarketFocus,
  type MarketSpecialist,
} from "./specialist-ids";
import { MARKET_SPECIALIST_PROMPTS, type LocalizedPrompt } from "./specialist-prompts";
import { specialistSystemRules } from "./specialist-rules";

export { DEFAULT_MARKET_SPECIALIST, MARKET_SPECIALISTS, isMarketSpecialist, specialistSystemRules };
export type { MarketFocus, MarketSpecialist };

export type LocalizedText = { readonly id: string; readonly en: string };

export type MarketSpecialistMeta = {
  readonly id: MarketSpecialist;
  readonly label: LocalizedText;
  /** One short sentence for the chip or the picker row. */
  readonly hint: LocalizedText;
  readonly defaultPrompt: LocalizedPrompt;
  /** Watchlist the studio prefills; every entry resolves through `toYahooSymbol`. */
  readonly starterTickers: readonly string[];
  readonly focus: MarketFocus;
};

/** IDX blue chips; `toYahooSymbol` maps each to its `.JK` listing. */
const IDX_STARTERS: readonly string[] = Object.freeze(["BBCA", "BBRI", "BMRI", "TLKM", "ASII"]);

/**
 * The equities desk is not one country's market: four IDX blue chips that
 * resolve to `.JK` through the universe, and four U.S. large caps that stay
 * bare so Yahoo reads them on NYSE/Nasdaq. Every entry resolves through
 * `toYahooSymbol`, asserted in `specialists.test.ts`.
 */
const EQUITY_STARTERS: readonly string[] = Object.freeze([
  "BBCA",
  "BBRI",
  "TLKM",
  "ASII",
  "NVDA",
  "AAPL",
  "MSFT",
  "TSLA",
]);

const META: Readonly<Record<MarketSpecialist, MarketSpecialistMeta>> = {
  saham: {
    id: "saham",
    label: { id: "Saham", en: "Stocks" },
    hint: {
      id: "Saham di bursa mana pun — IDX, AS, dan seterusnya: peringkat watchlist, pembacaan sektor, sadar jam bursa.",
      en: "Equities on any exchange — IDX, US, and beyond: ranked watchlist, sector read, session-aware.",
    },
    defaultPrompt: MARKET_SPECIALIST_PROMPTS.saham,
    starterTickers: EQUITY_STARTERS,
    focus: "equities",
  },
  forex: {
    id: "forex",
    label: { id: "Forex", en: "Forex" },
    hint: {
      id: "Pasangan mata uang dibaca terhadap dolar, selisih suku bunga, dan jam sesi.",
      en: "Currency pairs read against the dollar, rate differentials, and session hours.",
    },
    defaultPrompt: MARKET_SPECIALIST_PROMPTS.forex,
    starterTickers: Object.freeze(["IDR=X", "EURUSD=X", "USDJPY=X", "DX-Y.NYB"]),
    focus: "fx",
  },
  gold: {
    id: "gold",
    label: { id: "Emas & Mineral", en: "Gold & Minerals" },
    hint: {
      id: "Emas, perak dan tembaga terhadap dolar dan yield riil, plus penambang Indonesia sebagai beta.",
      en: "Gold, silver and copper against the dollar and real yields, plus the Indonesian miners as beta.",
    },
    defaultPrompt: MARKET_SPECIALIST_PROMPTS.gold,
    /**
     * The three metals futures, four Indonesian miners, and the U.S. miner
     * ETF. TINS is outside the LQ45 roster the alias table covers, so it is
     * spelled with its venue suffix rather than resolving to a U.S. symbol.
     */
    starterTickers: Object.freeze(["GC=F", "SI=F", "HG=F", "ANTM", "INCO", "TINS.JK", "MDKA", "GDX"]),
    focus: "commodity",
  },
  crypto: {
    id: "crypto",
    label: { id: "Kripto", en: "Crypto" },
    hint: {
      id: "Pasar 24/7: bitcoin sebagai penggerak, dominance, dan volatilitas altcoin.",
      en: "A 24/7 market: bitcoin as the driver, dominance, and altcoin volatility.",
    },
    defaultPrompt: MARKET_SPECIALIST_PROMPTS.crypto,
    starterTickers: Object.freeze(["BTC-USD", "ETH-USD", "SOL-USD", "BNB-USD"]),
    focus: "crypto",
  },
  commodities: {
    id: "commodities",
    label: { id: "Komoditas", en: "Commodities" },
    hint: {
      id: "Energi dan logam: kurva futures, sensitivitas dolar, dan dampak ke eksportir.",
      en: "Energy and metals: the futures curve, dollar sensitivity, and the exporter read.",
    },
    defaultPrompt: MARKET_SPECIALIST_PROMPTS.commodities,
    starterTickers: Object.freeze(["CL=F", "NG=F", "HG=F", "SI=F"]),
    focus: "commodities",
  },
  indices: {
    id: "indices",
    label: { id: "Indeks Global", en: "Global Indices" },
    hint: {
      id: "Estafet sesi Asia-Eropa-Amerika, futures versus indeks tunai.",
      en: "The Asia-Europe-US session relay, futures against the cash indices.",
    },
    defaultPrompt: MARKET_SPECIALIST_PROMPTS.indices,
    starterTickers: Object.freeze(["^JKSE", "^GSPC", "^IXIC", "^DJI", "^N225", "^HSI", "^STI", "ES=F", "NQ=F"]),
    focus: "indices",
  },
  "sector-rotation": {
    id: "sector-rotation",
    label: { id: "Rotasi Sektor", en: "Sector Rotation" },
    hint: {
      id: "Peringkat kinerja relatif antar sektor IDX dan ETF sektor AS, pemimpin dan tertinggal.",
      en: "Relative performance across IDX sectors and US sector ETFs, leaders and laggards.",
    },
    defaultPrompt: MARKET_SPECIALIST_PROMPTS["sector-rotation"],
    starterTickers: Object.freeze([
      "BBCA",
      "BBRI",
      "TLKM",
      "ASII",
      "UNVR",
      "ICBP",
      "ANTM",
      "ADRO",
      "PGAS",
      "XLK",
      "XLF",
      "XLE",
      "XLV",
    ]),
    focus: "rotation",
  },
  scanner: {
    id: "scanner",
    label: { id: "Market Scanner", en: "Market Scanner" },
    hint: {
      id: "Tabel setup berperingkat per kelompok sinyal, tanpa narasi.",
      en: "A ranked setups table per signal group, with no narrative filler.",
    },
    defaultPrompt: MARKET_SPECIALIST_PROMPTS.scanner,
    starterTickers: Object.freeze([
      "BBCA",
      "BBRI",
      "TLKM",
      "ASII",
      "NVDA",
      "AAPL",
      "MSFT",
      "AMD",
      "TSLA",
      "^JKSE",
      "^GSPC",
      "BTC-USD",
      "ETH-USD",
      "GC=F",
      "CL=F",
    ]),
    focus: "scan",
  },
  summary: {
    id: "summary",
    label: { id: "Ringkasan Pasar", en: "Market Summary" },
    hint: {
      id: "Gambaran satu halaman: indeks, futures, mata uang, yield, komoditas.",
      en: "A one page overview: indices, futures, currencies, yields, commodities.",
    },
    defaultPrompt: MARKET_SPECIALIST_PROMPTS.summary,
    starterTickers: Object.freeze([
      "^GSPC",
      "^IXIC",
      "^JKSE",
      "ES=F",
      "NQ=F",
      "DX-Y.NYB",
      "^TNX",
      "GC=F",
      "CL=F",
      "BTC-USD",
    ]),
    focus: "overview",
  },
  "elliott-wave": {
    id: "elliott-wave",
    label: { id: "Elliott Wave Count", en: "Elliott Wave Count" },
    hint: {
      id: "Hitungan gelombang berhati-hati dari swing di packet, dengan level invalidasi.",
      en: "A hedged wave count over the packet swings, with an invalidation level.",
    },
    defaultPrompt: MARKET_SPECIALIST_PROMPTS["elliott-wave"],
    starterTickers: Object.freeze(["^JKSE", "BBCA", "BTC-USD", "GC=F"]),
    focus: "waves",
  },
  news: {
    id: "news",
    label: { id: "Agregator Berita", en: "News Aggregator" },
    hint: {
      id: "Digest headline per ticker dan per tema, dengan penerbit, waktu, dan tanda basi.",
      en: "A headline digest by ticker and theme, with publisher, time, and a stale flag.",
    },
    defaultPrompt: MARKET_SPECIALIST_PROMPTS.news,
    starterTickers: IDX_STARTERS,
    focus: "news",
  },
};

export const MARKET_SPECIALIST_META: Readonly<Record<MarketSpecialist, MarketSpecialistMeta>> = Object.freeze(META);

/** The instruction the studio prefills for one agent. `{maxChars}` is still to substitute. */
export function defaultWatchPrompt(specialist: MarketSpecialist, language: "id" | "en"): string {
  const meta = MARKET_SPECIALIST_META[specialist] ?? MARKET_SPECIALIST_META[DEFAULT_MARKET_SPECIALIST];
  return language === "en" ? meta.defaultPrompt.en : meta.defaultPrompt.id;
}

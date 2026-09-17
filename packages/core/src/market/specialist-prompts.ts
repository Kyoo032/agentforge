/**
 * The default instruction each Market agent starts with, in both languages.
 * These are real desk instructions, not translations of one another: the
 * Indonesian text is written for an Indonesian desk and the English text for
 * an English one. `{maxChars}` is substituted by the studio.
 *
 * Every prompt keeps the house rules: figures come from the DATA PACKET or the
 * reader's own position context, and no sentence tells the reader to trade.
 */
import type { MarketSpecialist } from "./specialist-ids";

export type LocalizedPrompt = { readonly id: string; readonly en: string };

const CLOSE_ID = `- Setiap angka harus berasal dari DATA PACKET atau dari konteks posisi saya; jika tidak ada, tulis "data tidak tersedia".
- Boleh menilai sentimen dan menyusun peringkat, tetapi jangan pernah menyuruh saya bertransaksi.
- Maksimal {maxChars} karakter. Tutup dengan satu baris: "Ini analisis, bukan saran investasi."`;

const CLOSE_EN = `- Every number must come from the DATA PACKET or from my position context; when it is missing, write "not available".
- You may read sentiment and rank the names, but never instruct me to trade.
- Stay under {maxChars} characters. End with one line: "This is analysis, not investment advice."`;

const SAHAM: LocalizedPrompt = {
  id: `Buat briefing saham untuk watchlist saya dari DATA PACKET. Bahasa Indonesia, padat, tanpa pembukaan.

Struktur: 1. TL;DR + confidence. 2. Peta bursa: tiap ticker diperdagangkan di bursa mana menurut blok SESSIONS di packet, beserta mata uangnya. 3. Konteks pasar untuk setiap bursa yang disentuh watchlist: emiten IDX terhadap IHSG dan USD/IDR, emiten AS terhadap S&P 500 dan Nasdaq, bursa lain terhadap acuannya masing-masing sejauh ada di packet. 4. Snapshot per emiten dalam mata uang bursanya sendiri (harga, perubahan, rating TradingView, RSI, posisi terhadap SMA50/200), dan sebut bila angka itu adalah penutupan terakhir di bursa tersebut, bukan harga berjalan. 5. Ranking dari paling bullish ke paling bearish dengan satu alasan per emiten, dibandingkan lewat perubahan persen, bukan level harga antar mata uang. 6. Baca sektor: emiten mana yang bergerak searah, di dalam satu bursa maupun lintas bursa. 7. Katalis 24-48 jam dari headline packet, sebut penerbit dan waktu. 8. Level kunci per emiten (52 minggu, SMA, high/low terakhir). 9. Catatan risiko, termasuk risiko mata uang dan perbedaan jam bursa.

${CLOSE_ID}`,
  en: `Write an equities briefing for my watchlist from the DATA PACKET. English, compact, no preamble.

Structure: 1. TL;DR + confidence. 2. Exchange map: which exchange each ticker trades on, read from the packet SESSIONS block, and in which currency. 3. Market context for every exchange the watchlist touches: the IDX names against the IHSG and USD/IDR, the US names against the S&P 500 and the Nasdaq, any other venue against its own benchmark as far as the packet carries it. 4. Snapshot per name in its own exchange currency (price, change, TradingView rating, RSI, position vs SMA50/200), saying when that figure is the last close on that exchange rather than a live print. 5. Ranking from most bullish to most bearish with one reason each, compared on percentage moves rather than on price levels across currencies. 6. Sector read: which names move together, within an exchange and across exchanges. 7. Catalysts from the last 24-48h in the packet headlines, with publisher and time. 8. Key levels per name (52-week, SMAs, recent high/low). 9. Risk note, including currency and trading-hours risk.

${CLOSE_EN}`,
};

const FOREX: LocalizedPrompt = {
  id: `Buat briefing forex untuk pasangan mata uang di watchlist saya dari DATA PACKET. Bahasa Indonesia, padat.

Struktur: 1. TL;DR + confidence. 2. Arah dolar (DXY) dan artinya untuk tiap pasangan. 3. Snapshot per pasangan: level terakhir, perubahan, RSI, posisi terhadap SMA50/200, dan konvensi kuotasi (mana base, mana quote). 4. Ranking kekuatan mata uang. 5. Konteks selisih suku bunga dan yield sejauh yang ada di packet. 6. Agenda makro yang terbaca dari headline packet, sebut penerbit dan waktu. 7. Level kunci per pasangan. 8. Catatan risiko: korelasi antar pasangan dan jam sesi Asia/Eropa/AS.

${CLOSE_ID}`,
  en: `Write an FX briefing for the pairs on my watchlist from the DATA PACKET. English, compact.

Structure: 1. TL;DR + confidence. 2. Dollar direction (DXY) and what it means for each pair. 3. Snapshot per pair: last level, change, RSI, position vs SMA50/200, and the quote convention (which currency is the base). 4. Currency strength ranking. 5. Rate-differential and yield context as far as the packet shows it. 6. Macro calendar items visible in the packet headlines, with publisher and time. 7. Key levels per pair. 8. Risk note: cross-pair correlation and the Asia/Europe/US session hours.

${CLOSE_EN}`,
};

const GOLD: LocalizedPrompt = {
  id: `Buat briefing emas dari DATA PACKET. Bahasa Indonesia, padat.

Struktur: 1. TL;DR + confidence. 2. Emas versus dolar (DXY) dan yield riil sejauh yang ada di packet. 3. Snapshot per instrumen: level terakhir, perubahan, RSI, SMA50/200, rentang 52 minggu. 4. Futures versus spot: sebut instrumen mana yang dikutip dan jangan mencampur keduanya. 5. Saham tambang emas sebagai beta terhadap logamnya. 6. Katalis dari headline packet dengan penerbit dan waktu. 7. Level kunci. 8. Catatan risiko.

${CLOSE_ID}`,
  en: `Write a gold briefing from the DATA PACKET. English, compact.

Structure: 1. TL;DR + confidence. 2. Gold against the dollar (DXY) and real yields as far as the packet shows them. 3. Snapshot per instrument: last level, change, RSI, SMA50/200, 52-week range. 4. Futures versus spot: say which instrument you are quoting and never blend the two. 5. Gold miners as beta on the metal. 6. Catalysts from the packet headlines with publisher and time. 7. Key levels. 8. Risk note.

${CLOSE_EN}`,
};

const CRYPTO: LocalizedPrompt = {
  id: `Buat briefing kripto dari DATA PACKET. Bahasa Indonesia, padat.

Struktur: 1. TL;DR + confidence, sebut bahwa pasar kripto buka 24/7 sehingga "penutupan" hanyalah batas harian UTC. 2. Bitcoin sebagai penggerak dan bagaimana altcoin di watchlist mengikutinya. 3. Snapshot per aset: harga, perubahan 1 hari / 5 hari / 1 bulan, RSI, SMA50/200. 4. Ranking kekuatan relatif. 5. Sentimen dan pendanaan HANYA sejauh yang tertulis di headline packet. 6. Volatilitas: rentang 52 minggu dan jarak harga dari SMA200. 7. Level kunci. 8. Catatan risiko.

${CLOSE_ID}`,
  en: `Write a crypto briefing from the DATA PACKET. English, compact.

Structure: 1. TL;DR + confidence, noting that crypto trades 24/7 so a "close" is only a UTC daily boundary. 2. Bitcoin as the driver and how the altcoins on the watchlist track it. 3. Snapshot per asset: price, 1 day / 5 days / 1 month change, RSI, SMA50/200. 4. Relative-strength ranking. 5. Sentiment and funding ONLY as far as the packet headlines state them. 6. Volatility: the 52-week range and the distance from SMA200. 7. Key levels. 8. Risk note.

${CLOSE_EN}`,
};

const COMMODITIES: LocalizedPrompt = {
  id: `Buat briefing komoditas dari DATA PACKET. Bahasa Indonesia, padat.

Struktur: 1. TL;DR + confidence. 2. Energi: minyak dan gas, level terakhir dan perubahannya. 3. Logam industri dan logam mulia di watchlist. 4. Sensitivitas terhadap dolar: bacalah tiap komoditas terhadap DXY di packet. 5. Kurva futures: sebut kontrak mana yang dikutip dan katakan bila packet hanya memuat satu kontrak. 6. Pasokan dan permintaan dari headline packet, dengan penerbit dan waktu. 7. Dampak ke Indonesia: eksportir CPO dan batu bara serta jalur USD/IDR, sejauh yang ada di packet. 8. Level kunci dan catatan risiko.

${CLOSE_ID}`,
  en: `Write a commodities briefing from the DATA PACKET. English, compact.

Structure: 1. TL;DR + confidence. 2. Energy: oil and natural gas, last level and change. 3. Industrial and precious metals on the watchlist. 4. Dollar sensitivity: read each commodity against the DXY in the packet. 5. Futures curve: say which contract you are quoting and note when the packet carries only one contract. 6. Supply and demand from the packet headlines, with publisher and time. 7. Indonesia read-through: CPO and coal exporters and the USD/IDR channel, as far as the packet shows them. 8. Key levels and risk note.

${CLOSE_EN}`,
};

const INDICES: LocalizedPrompt = {
  id: `Buat briefing indeks global dari DATA PACKET. Bahasa Indonesia, padat.

Struktur: 1. TL;DR + confidence. 2. Estafet sesi: Asia (IHSG, Nikkei, Hang Seng, STI), lalu Eropa bila ada di packet, lalu Amerika. 3. Futures versus indeks tunai: sebut mana yang kamu kutip di tiap baris. 4. Snapshot per indeks: level, perubahan, RSI, posisi terhadap SMA50/200. 5. Ranking kekuatan antar indeks. 6. Pembacaan breadth HANYA dari angka yang ada di packet; jika tidak ada, katakan tidak tersedia. 7. Katalis lintas kawasan dari headline packet. 8. Level kunci dan yang perlu diperhatikan pada pembukaan sesi berikutnya.

${CLOSE_ID}`,
  en: `Write a global indices briefing from the DATA PACKET. English, compact.

Structure: 1. TL;DR + confidence. 2. The session relay: Asia (IHSG, Nikkei, Hang Seng, STI), then Europe when the packet carries it, then the US. 3. Futures versus cash: say which one you are quoting on every line. 4. Snapshot per index: level, change, RSI, position vs SMA50/200. 5. Strength ranking across the indices. 6. Breadth read ONLY from figures present in the packet; when there are none, say it is not available. 7. Cross-region catalysts from the packet headlines. 8. Key levels and what to watch at the next session open.

${CLOSE_EN}`,
};

const SECTOR_ROTATION: LocalizedPrompt = {
  id: `Buat pembacaan rotasi sektor dari DATA PACKET. Bahasa Indonesia. Tabel dipakai untuk peringkat.

Struktur: 1. TL;DR + confidence. 2. Tabel kinerja relatif: satu baris per proksi sektor dengan perubahan 1 hari, 5 hari, dan 1 bulan dari packet. 3. Pemimpin: sektor yang menguat di beberapa horizon sekaligus. 4. Tertinggal: sektor yang melemah di beberapa horizon sekaligus. 5. Pembacaan rotasi: dari sektor mana ke sektor mana uang tampak berpindah, dan apakah sinyalnya konsisten antar horizon. 6. Bandingkan sisi IDX dengan sisi ETF sektor AS. 7. Apa yang membatalkan pembacaan ini.
Ini pembacaan kinerja relatif, bukan saran alokasi: jangan menyarankan bobot portofolio.

${CLOSE_ID}`,
  en: `Produce a sector rotation read from the DATA PACKET. English. Use a table for the ranking.

Structure: 1. TL;DR + confidence. 2. Relative performance table: one row per sector proxy with the 1 day, 5 days, and 1 month changes from the packet. 3. Leaders: the sectors strengthening across more than one horizon. 4. Laggards: the sectors weakening across more than one horizon. 5. Rotation read: out of which sector and into which the money appears to move, and whether the horizons agree. 6. Compare the IDX side with the US sector ETF side. 7. What would break this read.
This is a relative performance read, not an allocation recommendation: never suggest portfolio weights.

${CLOSE_EN}`,
};

const SCANNER: LocalizedPrompt = {
  id: `Pindai watchlist saya dari DATA PACKET dan keluarkan tabel setup berperingkat. Bahasa Indonesia. Tanpa narasi pengantar.

Satu bagian per kelompok sinyal, masing-masing sebuah tabel markdown dengan kolom: Ticker | Pembacaan | Angka dari packet | Catatan.
1. RSI ekstrem (overbought/oversold). 2. Persilangan MACD terhadap garis sinyalnya. 3. Harga menembus SMA50/SMA200. 4. Dekat atau menembus rentang 52 minggu. 5. Pergerakan tidak biasa (perubahan 1 hari / 5 hari terbesar). 6. Ringkasan berperingkat: emiten mana yang muncul di paling banyak kelompok.
Kelompok tanpa kandidat ditulis "tidak ada kandidat"; jangan diisi tebakan.

${CLOSE_ID}`,
  en: `Scan my watchlist from the DATA PACKET and output a ranked setups table. English. No introductory narrative.

One section per signal group, each a markdown table with the columns: Ticker | Reading | Packet figure | Note.
1. RSI extremes (overbought/oversold). 2. MACD crosses against its signal line. 3. Price breaking SMA50/SMA200. 4. Near or through the 52-week range. 5. Unusual moves (largest 1 day / 5 days change). 6. Ranked summary: which names appear in the most groups.
A group with no candidate is written "no candidates"; never pad it with a guess.

${CLOSE_EN}`,
};

const SUMMARY: LocalizedPrompt = {
  id: `Buat ringkasan pasar satu halaman dari DATA PACKET. Bahasa Indonesia, padat, tabel boleh dipakai.

Struktur: 1. TL;DR + confidence. 2. Indeks (IHSG dan indeks AS yang ada di packet). 3. Futures indeks. 4. Mata uang: dolar dan USD/IDR. 5. Yield obligasi. 6. Komoditas: minyak dan emas. 7. Kripto sebagai barometer risiko. 8. Penggerak terbesar hari ini, naik dan turun. 9. Yang perlu diperhatikan pada sesi berikutnya, berdasarkan sesi yang tercatat di blok CLOCK packet.

${CLOSE_ID}`,
  en: `Write a one-page market summary from the DATA PACKET. English, compact, tables welcome.

Structure: 1. TL;DR + confidence. 2. Indices (IHSG and the US indices in the packet). 3. Index futures. 4. Currencies: the dollar and USD/IDR. 5. Bond yields. 6. Commodities: oil and gold. 7. Crypto as a risk barometer. 8. Today's biggest movers, up and down. 9. What to watch next session, based on the session recorded in the packet CLOCK block.

${CLOSE_EN}`,
};

const ELLIOTT: LocalizedPrompt = {
  id: `Buat hitungan Elliott Wave yang berhati-hati untuk setiap ticker dari DATA PACKET. Bahasa Indonesia.

Untuk tiap ticker: 1. Daftar swing (pivot high/low) yang dipakai, apa adanya dari blok "swings" pada packet. 2. Hitungan utama: beri label gelombang pada swing tersebut dan jelaskan alasannya. 3. Hitungan alternatif yang sama masuk akalnya. 4. Level invalidasi: harga swing mana yang jika ditembus membatalkan hitungan utama. 5. Tingkat keyakinan (rendah/sedang/tinggi) beserta alasannya.
Jika swing terlalu sedikit untuk sebuah hitungan, tulis "swing tidak cukup untuk dihitung" dan berhenti di situ untuk ticker tersebut.

${CLOSE_ID}`,
  en: `Produce a hedged Elliott Wave count for every ticker from the DATA PACKET. English.

Per ticker: 1. List the swings (pivot highs and lows) you are using, exactly as the packet "swings" block gives them. 2. Preferred count: label those swings and say why. 3. An alternate count that fits the same swings. 4. Invalidation level: which swing price, if broken, kills the preferred count. 5. Confidence (low/medium/high) and why.
When there are too few swings for a count, write "not enough swings to count" and stop there for that ticker.

${CLOSE_EN}`,
};

const NEWS: LocalizedPrompt = {
  id: `Buat digest berita untuk watchlist saya dari DATA PACKET. Bahasa Indonesia. Headline dulu, harga belakangan.

Struktur: 1. TL;DR tiga kalimat tentang tema hari ini. 2. Per ticker: daftar headline dengan penerbit dan waktu terbit, satu kalimat isi per headline. 3. Per tema lintas ticker (regulasi, suku bunga, rantai pasok, dan seterusnya). 4. Pisahkan fakta yang diberitakan dari opini atau pandangan analis di dalam berita tersebut. 5. Tandai "basi" untuk item yang lebih tua dari 24 jam terhadap blok CLOCK packet. 6. Yang belum terjawab dari kumpulan berita ini.
Jangan menyebut target harga sendiri; jika sebuah headline memuatnya, kutip sebagai klaim penerbitnya.

${CLOSE_ID}`,
  en: `Build a headline digest for my watchlist from the DATA PACKET. English. Headlines first, prices last.

Structure: 1. Three-sentence TL;DR of today's themes. 2. Per ticker: the headlines with publisher and publication time, one sentence of substance each. 3. Per cross-ticker theme (regulation, rates, supply chain, and so on). 4. Separate reported fact from the opinion or analyst view inside the item. 5. Flag anything older than 24 hours against the packet CLOCK block as stale. 6. What this set of headlines leaves unanswered.
Do not state price targets of your own; when a headline carries one, quote it as that publisher's claim.

${CLOSE_EN}`,
};

export const MARKET_SPECIALIST_PROMPTS: Readonly<Record<MarketSpecialist, LocalizedPrompt>> = {
  saham: SAHAM,
  forex: FOREX,
  gold: GOLD,
  crypto: CRYPTO,
  commodities: COMMODITIES,
  indices: INDICES,
  "sector-rotation": SECTOR_ROTATION,
  scanner: SCANNER,
  summary: SUMMARY,
  "elliott-wave": ELLIOTT,
  news: NEWS,
};

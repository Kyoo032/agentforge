import type { DocumentDraft } from "./document-outline";
import { t } from "./i18n";
import type { PresentationOutline } from "./presentation-outline";

export type DocumentStarter = {
  id: string;
  label: string;
  description: string;
  draft: DocumentDraft;
};

export type PresentationStarter = {
  id: string;
  label: string;
  description: string;
  outline: PresentationOutline;
};

export const DOCUMENT_STARTERS: DocumentStarter[] = [
  {
    id: "status-memo",
    label: "Status memo",
    description: "A finished weekly memo you can download as DOCX and rewrite.",
    draft: {
      title: "Northline checkout — week ending 1 Sep",
      sections: [
        {
          heading: "What I need from you",
          body: "Approve staying on the current gateway through the 15 Oct renewal. I will write the dual-run design this week; legal will not review a second vendor before then.\n\nIf you want a hard cutover instead, say so by Thursday. That path needs a legal slot we do not have.",
        },
        {
          heading: "What moved",
          body: "Error budget is 2.1% over a 28-day window (target 1.0%). Two timeouts on Thursday sat in the gateway; we have traces, not a vendor ticket number yet.\n\nFieldnote export shipped outline JSON and a DOCX download from a starter. Section regen with attachments is still open — Jin owns it, blocked on filename collisions when two exports share a title.",
        },
        {
          heading: "What slipped",
          body: "The packaged Windows installer is still the 31 Aug build. Webdev already has the workspace-first rail; anyone on the installed app will not see it until we rebuild NSIS.\n\nI did not measure time-to-first-artifact this week. I will not pretend we have a number.",
        },
        {
          heading: "Risks",
          body: "Prompt cards were one-line examples. Live Documents and Presentation jobs look thin if someone clicks Generate without rewriting. Template briefs are the fix; they are not in the last installer.\n\nFilename collisions will bite the first person who exports twice from the same title.",
        },
        {
          heading: "Next seven days",
          body: "Mon–Tue: dual-run design draft (Sam). Wed: collide-safe export names (Jin). Thu: decision on rebuild vs keep using desktop:dev (you). I will send a six-line recap Friday whether or not the rebuild happens.",
        },
      ],
    },
  },
  {
    id: "one-pager",
    label: "One-pager brief",
    description: "An executable project brief — scope, three-week sequence, and an ask.",
    draft: {
      title: "Fieldnote export — one-page brief",
      sections: [
        {
          heading: "Outcome",
          body: "An owner can leave Documents with a .docx that matches the on-screen draft, without opening Word first. Success is the first 20 exports completing without a support thread, and p95 under 8 seconds on this machine.",
        },
        {
          heading: "Who it is for",
          body: "The person who already pasted a gateway key and is doing real work on Home. They are not looking for a collaborative editor. They want a file they can email or file on disk.",
        },
        {
          heading: "In scope / out of scope",
          body: "In: prompt → structured draft → section regen → DOCX download; collide-safe filenames; a starter they can download offline.\n\nOut: collaborative editing, comments, cloud sync, and classroom-only nouns in the kernel.",
        },
        {
          heading: "Approach and the risk",
          body: "Keep the existing JSON draft shape. Do not invent a second document model. The risk is the model returning empty headings when the user prompt is a one-liner — the template library has to carry audience, deliverable, and a sample scenario so the system prompt has something to write.",
        },
        {
          heading: "Sequence",
          body: "Week 1 (Jin): collide-safe names and a worked starter, not a placeholder memo.\n\nWeek 2 (Jin): section regen with attachments, verified on Home.\n\nWeek 3 (Sam): one live generate on this desk with a full brief, then a DOCX opened locally. If p95 is over 8s, we stop adding features and fix the run.",
        },
        {
          heading: "Ask",
          body: "Confirm out-of-scope stays out. If you want comments or sync in this cycle, that is a different brief — say so now.",
        },
      ],
    },
  },
];

export const PRESENTATION_STARTERS: PresentationStarter[] = [
  {
    id: "project-update",
    label: "Project update",
    description: "A 6-slide operating update with evidence, a slip, and one ask.",
    outline: {
      title: "Northline + Fieldnote — week of 1 Sep",
      slides: [
        {
          kind: "section",
          heading: "This week in one line",
          subhead:
            "Home is current. The installer is last month’s build. I need a yes or no on rebuilding NSIS this week.",
          bullets: [],
          aside: "",
          notes:
            "If someone only remembers one sentence, it is the installer gap. Do not bury it under process. Offer a Thursday yes or no, not a backlog item.",
        },
        {
          kind: "bullets",
          heading: "What we can show on this machine",
          subhead: "Proof is the rail on this desk, not a roadmap slide.",
          bullets: [
            "Chat, Documents, Research, Images, Videos, Presentation on Home.",
            "Settings is paste-key, usage, and privacy — no Advanced tab.",
            "A Legal desk can hide Images and Videos; we did not create one here.",
          ],
          aside: "",
          notes: "Open /chat if they want proof. Do not send them to /agents — it redirects.",
        },
        {
          kind: "bullets",
          heading: "What slipped",
          subhead: "desktop:dev already wraps the new UI on port 3000.",
          bullets: [
            "Packaged Electron was last built 31 Aug.",
            "Anyone on the .exe will not see GTM until we rebuild.",
            "This is a ship miss, not a code miss.",
          ],
          aside: "",
          notes: "Offer the rebuild as the decision. Do not apologize for webdev being ahead.",
        },
        {
          kind: "split",
          heading: "Quality risk I will not paper over",
          subhead: "Thin prompts made thin decks.",
          bullets: [
            "Old example cards were one-sentence prompts.",
            "Generate then produced thin memos and 3-slide decks.",
          ],
          aside: "New briefs name audience, deliverable, and a sample scenario.",
          notes: "Show one Documents card if they ask. The starter memo is the offline proof.",
        },
        {
          kind: "bullets",
          heading: "Decision in this room",
          subhead: "Owner of the call: you. Date: Thursday.",
          bullets: [
            "Rebuild NSIS this week, or keep using desktop:dev.",
            "I will not call the August installer the GTM product.",
            "If you defer, we write deferred on the recap — not implied.",
          ],
          aside: "",
          notes: "If they defer, write ‘deferred’ on the slide in the recap. Do not leave it implied.",
        },
        {
          kind: "close",
          heading: "Next seven days",
          subhead: "Three outcomes. A fourth waits.",
          bullets: [
            "Mon–Tue: dual-run design draft (Sam).",
            "Wed: collide-safe export names (Jin).",
            "Fri: six-line recap whether or not we rebuilt.",
          ],
          aside: "",
          notes: "Three outcomes, not a backlog. If a fourth appears, it waits.",
        },
      ],
    },
  },
  {
    id: "decision-brief",
    label: "Decision brief",
    description: "Options, a named recommendation, and the tradeoffs we accept.",
    outline: {
      title: "Stay, dual-run, or cut over — Northline checkout",
      slides: [
        {
          kind: "section",
          heading: "The decision",
          subhead: "Do we stay on the current gateway through 15 Oct, or lose the uptime language the deal needs?",
          bullets: [],
          aside: "",
          notes:
            "One decision. If they start a second, park it. Error budget is 2.1% against a 1.0% target — that number belongs in the next slide, not as a second ask.",
        },
        {
          kind: "bullets",
          heading: "Cost of waiting",
          subhead: "Renewal is six weeks out.",
          bullets: [
            "Error budget is 2.1% against a 1.0% target.",
            "Every week on 2.1% is another week we cannot sign the deal.",
            "Legal will not review a second vendor this month.",
          ],
          aside: "",
          notes: "If they say ‘just get legal to rush,’ remind them we already asked.",
        },
        {
          kind: "split",
          heading: "Three options",
          subhead: "Stay, dual-run, or hard cutover.",
          bullets: [
            "Stay: no legal slot, error budget unchanged.",
            "Dual-run 90 days: one engineer-week, reversible.",
            "Hard cutover in 30 days: needs the legal slot we do not have.",
          ],
          aside: "Do not let a fourth vendor into the room. That is a new memo.",
          notes: "Do not let ‘explore a fourth vendor’ into the room. That is a new memo.",
        },
        {
          kind: "bullets",
          heading: "Recommendation: stay, write the dual-run",
          subhead: "Name the pick in the first sentence.",
          bullets: [
            "Pick stay through renewal.",
            "Write the dual-run design this week so October is a choice.",
            "Do not start a hard cutover without a legal date.",
          ],
          aside: "",
          notes: "Name the pick in the first sentence. Then the two tradeoffs.",
        },
        {
          kind: "bullets",
          heading: "Tradeoffs we are accepting",
          subhead: "Unknowns stay unknown.",
          bullets: [
            "We will miss the enterprise deal if they will not wait.",
            "We spend an engineer-week on a design we might not run.",
            "Unknown: whether the gateway will publish a status page we can cite.",
          ],
          aside: "",
          notes: "Unknowns stay unknown. Do not invent an SLA.",
        },
        {
          kind: "close",
          heading: "If you approve today",
          subhead: "Close on the first action, not a thank-you.",
          bullets: [
            "Sam writes the dual-run design by Friday.",
            "I send the six-line recap with the written pick.",
            "We revisit at renewal with evidence, not a vibe.",
          ],
          aside: "",
          notes: "Close on the first action, not a thank-you.",
        },
      ],
    },
  },
];

export const PRESENTATION_STARTERS_ID: PresentationStarter[] = [
  {
    id: "project-update",
    label: "Pembaruan proyek",
    description: "Pembaruan operasional 6 slide dengan bukti, satu keterlambatan, dan satu permintaan.",
    outline: {
      title: "Northline + Fieldnote — minggu 1 Sep",
      slides: [
        {
          kind: "section",
          heading: "Minggu ini dalam satu kalimat",
          subhead:
            "Home sudah mutakhir. Installer masih build bulan lalu. Saya butuh ya atau tidak untuk membangun ulang NSIS minggu ini.",
          bullets: [],
          aside: "",
          notes:
            "Jika yang diingat hanya satu kalimat, itu kesenjangan installer. Jangan dikubur di bawah proses. Tawarkan ya atau tidak pada hari Kamis, bukan item backlog.",
        },
        {
          kind: "bullets",
          heading: "Yang bisa kami tunjukkan di mesin ini",
          subhead: "Buktinya adalah rel di meja ini, bukan slide peta jalan.",
          bullets: [
            "Chat, Documents, Research, Images, Videos, dan Presentation ada di Home.",
            "Settings hanya tempel kunci, pemakaian, dan privasi — tanpa tab Advanced.",
            "Meja Legal bisa menyembunyikan Images dan Videos; kami tidak membuatnya di sini.",
          ],
          aside: "",
          notes: "Buka /chat jika mereka ingin bukti. Jangan kirim ke /agents — itu dialihkan.",
        },
        {
          kind: "bullets",
          heading: "Yang terlambat",
          subhead: "desktop:dev sudah membungkus UI baru di port 3000.",
          bullets: [
            "Electron terpaket terakhir dibangun 31 Agu.",
            "Siapa pun di .exe tidak akan melihat GTM sampai kami membangun ulang.",
            "Ini miss pengiriman, bukan miss kode.",
          ],
          aside: "",
          notes: "Tawarkan rebuild sebagai keputusan. Jangan minta maaf karena webdev lebih dulu.",
        },
        {
          kind: "split",
          heading: "Risiko mutu yang tidak akan saya tutupi",
          subhead: "Prompt tipis menghasilkan dek tipis.",
          bullets: [
            "Kartu contoh lama hanya prompt satu kalimat.",
            "Buat lalu menghasilkan memo tipis dan dek 3 slide.",
          ],
          aside: "Brief baru menyebut audiens, deliverable, dan skenario contoh.",
          notes: "Tunjukkan satu kartu Documents jika diminta. Memo contoh siap pakai adalah bukti luring.",
        },
        {
          kind: "bullets",
          heading: "Keputusan di ruangan ini",
          subhead: "Pemilik panggilan: Anda. Tanggal: Kamis.",
          bullets: [
            "Bangun ulang NSIS minggu ini, atau tetap pakai desktop:dev.",
            "Saya tidak akan menyebut installer Agustus sebagai produk GTM.",
            "Jika ditunda, kami menulis ditunda di rekap — bukan tersirat.",
          ],
          aside: "",
          notes: "Jika ditunda, tulis ‘ditunda’ di slide pada rekap. Jangan biarkan tersirat.",
        },
        {
          kind: "close",
          heading: "Tujuh hari ke depan",
          subhead: "Tiga hasil. Yang keempat menunggu.",
          bullets: [
            "Sen–Sel: draf desain dual-run (Sam).",
            "Rab: nama ekspor yang aman dari tabrakan (Jin).",
            "Jum: rekap enam baris, dibangun ulang atau tidak.",
          ],
          aside: "",
          notes: "Tiga hasil, bukan backlog. Jika muncul yang keempat, itu menunggu.",
        },
      ],
    },
  },
  {
    id: "decision-brief",
    label: "Ringkasan keputusan",
    description: "Opsi, rekomendasi yang disebut namanya, dan kompromi yang kita terima.",
    outline: {
      title: "Tetap, dual-run, atau cut over — checkout Northline",
      slides: [
        {
          kind: "section",
          heading: "Keputusannya",
          subhead:
            "Apakah kita tetap di gateway saat ini sampai 15 Okt, atau kehilangan bahasa uptime yang dibutuhkan kesepakatan?",
          bullets: [],
          aside: "",
          notes:
            "Satu keputusan. Jika mereka mulai yang kedua, parkir. Error budget 2,1% terhadap target 1,0% — angka itu untuk slide berikutnya, bukan permintaan kedua.",
        },
        {
          kind: "bullets",
          heading: "Biaya menunggu",
          subhead: "Perpanjangan masih enam minggu lagi.",
          bullets: [
            "Error budget 2,1% terhadap target 1,0%.",
            "Setiap minggu di 2,1% adalah minggu lain kita tidak bisa menandatangani kesepakatan.",
            "Legal tidak akan meninjau vendor kedua bulan ini.",
          ],
          aside: "",
          notes: "Jika mereka bilang ‘suruh Legal buru-buru,’ ingatkan kami sudah meminta.",
        },
        {
          kind: "split",
          heading: "Tiga opsi",
          subhead: "Tetap, dual-run, atau cut over keras.",
          bullets: [
            "Tetap: tanpa slot legal, error budget tidak berubah.",
            "Dual-run 90 hari: satu minggu-insinyur, bisa dibalik.",
            "Cut over keras dalam 30 hari: butuh slot legal yang tidak kita punya.",
          ],
          aside: "Jangan biarkan vendor keempat masuk ruangan. Itu memo baru.",
          notes: "Jangan biarkan ‘jelajahi vendor keempat’ masuk ruangan. Itu memo baru.",
        },
        {
          kind: "bullets",
          heading: "Rekomendasi: tetap, tulis dual-run",
          subhead: "Sebut pilihannya di kalimat pertama.",
          bullets: [
            "Pilih tetap sampai perpanjangan.",
            "Tulis desain dual-run minggu ini agar Oktober menjadi pilihan.",
            "Jangan mulai cut over keras tanpa tanggal legal.",
          ],
          aside: "",
          notes: "Sebut pilihannya di kalimat pertama. Lalu dua kompromi.",
        },
        {
          kind: "bullets",
          heading: "Kompromi yang kita terima",
          subhead: "Yang tidak diketahui tetap tidak diketahui.",
          bullets: [
            "Kita akan kehilangan kesepakatan enterprise jika mereka tidak mau menunggu.",
            "Kita menghabiskan satu minggu-insinyur untuk desain yang mungkin tidak dijalankan.",
            "Tidak diketahui: apakah gateway akan menerbitkan halaman status yang bisa kita kutip.",
          ],
          aside: "",
          notes: "Yang tidak diketahui tetap tidak diketahui. Jangan mengarang SLA.",
        },
        {
          kind: "close",
          heading: "Jika Anda setujui hari ini",
          subhead: "Tutup dengan tindakan pertama, bukan terima kasih.",
          bullets: [
            "Sam menulis desain dual-run sebelum Jumat.",
            "Saya mengirim rekap enam baris dengan pilihan tertulis.",
            "Kita tinjau lagi saat perpanjangan dengan bukti, bukan perasaan.",
          ],
          aside: "",
          notes: "Tutup dengan tindakan pertama, bukan terima kasih.",
        },
      ],
    },
  },
];

export function presentationStarters(locale: "en" | "id" = "en"): PresentationStarter[] {
  return locale === "id" ? PRESENTATION_STARTERS_ID : PRESENTATION_STARTERS;
}

function starterSections(base: string, keys: readonly string[]): DocumentDraft["sections"] {
  return keys.map((key) => ({
    heading: t(`${base}.${key}.heading`),
    body: t(`${base}.${key}.body`),
  }));
}

export function documentStarters(): DocumentStarter[] {
  return [
    {
      id: "status-memo",
      label: t("documents.starters.statusMemo.label"),
      description: t("documents.starters.statusMemo.description"),
      draft: {
        title: t("documents.starters.statusMemo.title"),
        sections: starterSections("documents.starters.statusMemo", ["s1", "s2", "s3", "s4", "s5"]),
      },
    },
    {
      id: "one-pager",
      label: t("documents.starters.onePager.label"),
      description: t("documents.starters.onePager.description"),
      draft: {
        title: t("documents.starters.onePager.title"),
        sections: starterSections("documents.starters.onePager", ["s1", "s2", "s3", "s4", "s5", "s6"]),
      },
    },
  ];
}

export function findDocumentStarter(id: string): DocumentStarter | undefined {
  return DOCUMENT_STARTERS.find((item) => item.id === id);
}

export function findPresentationStarter(id: string, locale: "en" | "id" = "en"): PresentationStarter | undefined {
  return presentationStarters(locale).find((item) => item.id === id);
}

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
      title: "Saturday pickup — week ending 6 Sep",
      sections: [
        {
          heading: "What I need from you",
          body: "Approve keeping Saturday pickup on the current card reader through the 15 Oct renewal. Maya will write the two-reader plan this week; accounts will not sign a second supplier before then.\n\nIf you want a full switch instead, say so by Thursday. That path needs a supplier slot we do not have.",
        },
        {
          heading: "What moved",
          body: "Saturday wait is 8 minutes over the last four weekends (target 5). Two readers timed out on Thursday; we have the till log, not a repair ticket yet.\n\nBag labels went out for the first twenty pre-orders. Timing the queue is still open — Alex owns it, blocked when two orders share a customer name.",
        },
        {
          heading: "What slipped",
          body: "The printed door menu is still the 31 Aug sheet. The counter whiteboard already shows the new Saturday hours; anyone who only reads the door will not see them until we reprint.\n\nI did not time the queue this week. I will not pretend we have a number.",
        },
        {
          heading: "Risks",
          body: "The handover notes were one line. A new Saturday looks thin if someone runs the counter from that card alone. The checklist is the fix; it is not on the door yet.\n\nShared customer names will mix up the first person who collects two orders under one name.",
        },
        {
          heading: "Next seven days",
          body: "Mon–Tue: two-reader plan (Maya). Wed: bag names that stay distinct (Alex). Thu: decision on reprinting the menu or keeping the whiteboard (you). I will send a six-line recap Friday whether or not we reprint.",
        },
      ],
    },
  },
  {
    id: "one-pager",
    label: "One-pager brief",
    description: "An executable project brief — scope, three-week sequence, and an ask.",
    draft: {
      title: "Saturday pickup — one-page brief",
      sections: [
        {
          heading: "Outcome",
          body: "A customer can leave with a named bag in under 8 minutes on Saturday, without asking which order is theirs. Success is the first 20 pickups completing without a counter argument, and a wait under 8 minutes.",
        },
        {
          heading: "Who it is for",
          body: "Someone who already ordered ahead and is collecting on Saturday. They are not looking for a second shop. They want a bag they can carry out.",
        },
        {
          heading: "In scope / out of scope",
          body: "In: a named bag, a spare card reader, a printed ticket, and a checklist the counter can follow with the power off.\n\nOut: a second shop, home delivery, notes on the order, and wording that only makes sense in our own notes.",
        },
        {
          heading: "Approach and the risk",
          body: "Keep the existing Saturday checklist. Do not invent a second order book. The risk is a one-line note that leaves the counter guessing — the checklist has to name who it is for, what done looks like, and a sample Saturday so a new person can run it.",
        },
        {
          heading: "Sequence",
          body: "Week 1 (Alex): distinct bag names and a worked checklist, not a blank card.\n\nWeek 2 (Alex): time the queue with the spare reader, checked on a quiet Saturday.\n\nWeek 3 (Maya): one full Saturday with the brief, then the bags opened at the counter. If the wait is over 8 minutes, we stop adding menu items and fix the line.",
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
      title: "Saturday pickup — week of 6 Sep",
      slides: [
        {
          kind: "section",
          heading: "This week in one line",
          subhead:
            "The door menu is last month's sheet. The whiteboard is current. I need a yes or no on reprinting it this week.",
          bullets: [],
          aside: "",
          notes:
            "If someone only remembers one sentence, it is the door menu. Do not bury it under process. Offer a Thursday yes or no, not a backlog item.",
        },
        {
          kind: "bullets",
          heading: "What we can show at the counter",
          subhead: "Proof is a Saturday at this shop, not a plan on paper.",
          bullets: [
            "Named bags for the first twenty pre-orders.",
            "The spare reader sits on the counter — no back room.",
            "A second shop can wait; we did not open one here.",
          ],
          aside: "",
          notes: "Walk them to the counter if they want proof. Do not send them to a binder they have not opened.",
        },
        {
          kind: "bullets",
          heading: "What slipped",
          subhead: "The whiteboard already shows the new hours.",
          bullets: [
            "The printed door menu was last printed 31 Aug.",
            "Anyone who only reads the door will miss the new hours.",
            "This is a print miss, not a counter miss.",
          ],
          aside: "",
          notes: "Offer the reprint as the decision. Do not apologise for the whiteboard being ahead.",
        },
        {
          kind: "split",
          heading: "A thin Saturday I will not paper over",
          subhead: "One-line notes made a thin handoff.",
          bullets: ["Old handover cards were one sentence.", "The counter then ran from guesswork."],
          aside: "The new checklist names who collects, what done looks like, and a sample Saturday.",
          notes: "Show the checklist if they ask. The named bag is the proof they can hold.",
        },
        {
          kind: "bullets",
          heading: "Decision in this room",
          subhead: "Owner of the call: you. Date: Thursday.",
          bullets: [
            "Reprint the menu this week, or keep the whiteboard.",
            "I will not call the August sheet the current hours.",
            "If you defer, we write deferred on the recap — not implied.",
          ],
          aside: "",
          notes: "If they defer, write deferred on the recap. Do not leave it implied.",
        },
        {
          kind: "close",
          heading: "Next seven days",
          subhead: "Three outcomes. A fourth waits.",
          bullets: [
            "Mon–Tue: two-reader plan (Maya).",
            "Wed: bag names that stay distinct (Alex).",
            "Fri: six-line recap whether or not we reprinted.",
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
      title: "Stay, both readers, or switch — Saturday pickup",
      slides: [
        {
          kind: "section",
          heading: "The decision",
          subhead:
            "Do we stay on the current card reader through 15 Oct, or lose the Saturday slot the wholesale account needs?",
          bullets: [],
          aside: "",
          notes:
            "One decision. If they start a second, park it. Saturday wait is 8 minutes against a 5-minute target — that number belongs on the next slide, not as a second ask.",
        },
        {
          kind: "bullets",
          heading: "Cost of waiting",
          subhead: "The contract renews in six weeks.",
          bullets: [
            "Saturday wait is 8 minutes against a 5-minute target.",
            "Every week at 8 minutes is another week we cannot promise the account.",
            "Accounts will not sign a second supplier this month.",
          ],
          aside: "",
          notes: "If they say just get accounts to rush, remind them we already asked.",
        },
        {
          kind: "split",
          heading: "Three options",
          subhead: "Stay, both readers, or a full switch.",
          bullets: [
            "Stay: no supplier slot, the wait stays 8 minutes.",
            "Both readers for 90 days: one week of Maya's time, reversible.",
            "Full switch in 30 days: needs the supplier slot we do not have.",
          ],
          aside: "Do not let a fourth supplier into the room. That is a new memo.",
          notes: "Do not let a fourth supplier into the room. That is a new memo.",
        },
        {
          kind: "bullets",
          heading: "Recommendation: stay, write the two-reader plan",
          subhead: "Name the pick in the first sentence.",
          bullets: [
            "Pick stay through renewal.",
            "Write the two-reader plan this week so October is a choice.",
            "Do not start a full switch without a supplier date.",
          ],
          aside: "",
          notes: "Name the pick in the first sentence. Then the two tradeoffs.",
        },
        {
          kind: "bullets",
          heading: "Tradeoffs we are accepting",
          subhead: "Unknowns stay unknown.",
          bullets: [
            "We will miss the wholesale account if they will not wait.",
            "We spend a week on a plan we might not run.",
            "Unknown: whether the reader company will publish a status page we can cite.",
          ],
          aside: "",
          notes: "Unknowns stay unknown. Do not invent a service promise.",
        },
        {
          kind: "close",
          heading: "If you approve today",
          subhead: "Close on the first action, not a thank-you.",
          bullets: [
            "Maya writes the two-reader plan by Friday.",
            "I send the six-line recap with the written pick.",
            "We revisit at renewal with the till log, not a feeling.",
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
      title: "Pengambilan Sabtu — minggu 6 Sep",
      slides: [
        {
          kind: "section",
          heading: "Minggu ini dalam satu kalimat",
          subhead:
            "Menu di pintu masih lembar bulan lalu. Papan sudah mutakhir. Saya butuh ya atau tidak untuk mencetak ulang minggu ini.",
          bullets: [],
          aside: "",
          notes:
            "Jika yang diingat hanya satu kalimat, itu menu di pintu. Jangan dikubur di bawah proses. Tawarkan ya atau tidak pada hari Kamis, bukan item daftar tunggu.",
        },
        {
          kind: "bullets",
          heading: "Yang bisa kami tunjukkan di kasir",
          subhead: "Buktinya Sabtu di toko ini, bukan rencana di kertas.",
          bullets: [
            "Tas bernama untuk dua puluh pesanan pertama.",
            "Mesin cadangan ada di kasir — bukan di ruang belakang.",
            "Toko kedua bisa menunggu; kami tidak membukanya di sini.",
          ],
          aside: "",
          notes: "Ajak mereka ke kasir jika mereka ingin bukti. Jangan kirim ke binder yang belum mereka buka.",
        },
        {
          kind: "bullets",
          heading: "Yang terlambat",
          subhead: "Papan sudah menampilkan jam yang baru.",
          bullets: [
            "Menu di pintu terakhir dicetak 31 Agu.",
            "Siapa pun yang hanya membaca pintu akan melewatkan jam baru.",
            "Ini kelalaian cetak, bukan kelalaian kasir.",
          ],
          aside: "",
          notes: "Tawarkan cetak ulang sebagai keputusan. Jangan minta maaf karena papan lebih dulu.",
        },
        {
          kind: "split",
          heading: "Sabtu yang tipis, tidak akan saya tutupi",
          subhead: "Catatan satu baris membuat serah terima tipis.",
          bullets: ["Kartu serah terima lama hanya satu kalimat.", "Kasir lalu berjalan dari tebakan."],
          aside: "Daftar periksa baru menyebut siapa yang mengambil, seperti apa selesai, dan satu Sabtu contoh.",
          notes: "Tunjukkan daftar periksa jika diminta. Tas bernama adalah bukti yang bisa dipegang.",
        },
        {
          kind: "bullets",
          heading: "Keputusan di ruangan ini",
          subhead: "Pemilik panggilan: Anda. Tanggal: Kamis.",
          bullets: [
            "Cetak ulang menu minggu ini, atau tetap pakai papan.",
            "Saya tidak akan menyebut lembar Agustus sebagai jam yang berlaku.",
            "Jika ditunda, kami menulis ditunda di rekap — bukan tersirat.",
          ],
          aside: "",
          notes: "Jika ditunda, tulis ditunda di rekap. Jangan biarkan tersirat.",
        },
        {
          kind: "close",
          heading: "Tujuh hari ke depan",
          subhead: "Tiga hasil. Yang keempat menunggu.",
          bullets: [
            "Sen–Sel: rencana dua mesin (Maya).",
            "Rab: nama tas yang tetap berbeda (Alex).",
            "Jum: rekap enam baris, dicetak ulang atau tidak.",
          ],
          aside: "",
          notes: "Tiga hasil, bukan daftar tunggu. Jika muncul yang keempat, itu menunggu.",
        },
      ],
    },
  },
  {
    id: "decision-brief",
    label: "Ringkasan keputusan",
    description: "Opsi, rekomendasi yang disebut namanya, dan kompromi yang kita terima.",
    outline: {
      title: "Tetap, kedua mesin, atau ganti — pengambilan Sabtu",
      slides: [
        {
          kind: "section",
          heading: "Keputusannya",
          subhead:
            "Apakah kita tetap di mesin kartu yang sekarang sampai 15 Okt, atau kehilangan slot Sabtu yang dibutuhkan akun grosir?",
          bullets: [],
          aside: "",
          notes:
            "Satu keputusan. Jika mereka mulai yang kedua, parkir. Antrean Sabtu 8 menit terhadap target 5 menit — angka itu untuk slide berikutnya, bukan permintaan kedua.",
        },
        {
          kind: "bullets",
          heading: "Biaya menunggu",
          subhead: "Kontrak diperpanjang enam minggu lagi.",
          bullets: [
            "Antrean Sabtu 8 menit terhadap target 5 menit.",
            "Setiap minggu di 8 menit adalah minggu lain kita tidak bisa menjanjikan akun itu.",
            "Keuangan tidak akan menandatangani pemasok kedua bulan ini.",
          ],
          aside: "",
          notes: "Jika mereka bilang suruh keuangan buru-buru, ingatkan kami sudah meminta.",
        },
        {
          kind: "split",
          heading: "Tiga opsi",
          subhead: "Tetap, kedua mesin, atau ganti penuh.",
          bullets: [
            "Tetap: tanpa slot pemasok, antrean tetap 8 menit.",
            "Kedua mesin 90 hari: satu minggu waktu Maya, bisa dibalik.",
            "Ganti penuh dalam 30 hari: butuh slot pemasok yang tidak kita punya.",
          ],
          aside: "Jangan biarkan pemasok keempat masuk ruangan. Itu memo baru.",
          notes: "Jangan biarkan pemasok keempat masuk ruangan. Itu memo baru.",
        },
        {
          kind: "bullets",
          heading: "Rekomendasi: tetap, tulis rencana dua mesin",
          subhead: "Sebut pilihannya di kalimat pertama.",
          bullets: [
            "Pilih tetap sampai perpanjangan.",
            "Tulis rencana dua mesin minggu ini agar Oktober menjadi pilihan.",
            "Jangan mulai ganti penuh tanpa tanggal pemasok.",
          ],
          aside: "",
          notes: "Sebut pilihannya di kalimat pertama. Lalu dua kompromi.",
        },
        {
          kind: "bullets",
          heading: "Kompromi yang kita terima",
          subhead: "Yang tidak diketahui tetap tidak diketahui.",
          bullets: [
            "Kita akan kehilangan akun grosir jika mereka tidak mau menunggu.",
            "Kita menghabiskan satu minggu untuk rencana yang mungkin tidak dijalankan.",
            "Tidak diketahui: apakah perusahaan mesin akan menerbitkan halaman status yang bisa kita kutip.",
          ],
          aside: "",
          notes: "Yang tidak diketahui tetap tidak diketahui. Jangan mengarang janji layanan.",
        },
        {
          kind: "close",
          heading: "Jika Anda setujui hari ini",
          subhead: "Tutup dengan tindakan pertama, bukan terima kasih.",
          bullets: [
            "Maya menulis rencana dua mesin sebelum Jumat.",
            "Saya mengirim rekap enam baris dengan pilihan tertulis.",
            "Kita tinjau lagi saat perpanjangan dengan catatan kasir, bukan perasaan.",
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

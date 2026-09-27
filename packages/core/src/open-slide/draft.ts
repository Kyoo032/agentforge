import type { AppLocale } from "../locale";
import { parseAppLocale } from "../locale";
import {
  OPEN_SLIDE_CANVAS_WIDTH,
  OPEN_SLIDE_PADDING,
  type OpenSlideBlock,
  type OpenSlideBrief,
  type OpenSlideDeck,
  type OpenSlideDensity,
  type OpenSlideDesign,
  type OpenSlideMotion,
  type OpenSlidePage,
  type OpenSlidePageCount,
  type OpenSlideRole,
  type OpenSlideWeight,
} from "./deck";

const PAD = OPEN_SLIDE_PADDING;

type Copy = {
  aesthetic: string;
  kicker: string;
  coverSub: string;
  agenda: string;
  agendaItems: (topic: string) => string[];
  section: string;
  headings: [string, string, string];
  bullets: (topic: string) => string[];
  bigLabel: string;
  bigCaption: string;
  quote: string;
  quoteBy: string;
  compareLeft: string;
  compareRight: string;
  compareLeftLines: string[];
  compareRightLines: string[];
  close: string;
  closeBody: string;
  notes: Record<OpenSlideRole, string>;
};

const COPY: Record<AppLocale, Copy> = {
  en: {
    aesthetic: "Calm editorial — off-white field, one teal accent, generous padding.",
    kicker: "Open Slide",
    coverSub: "One idea on each page, drafted on this desk.",
    agenda: "What this deck covers",
    agendaItems: (topic) => [
      `The subject is ${topic}.`,
      "Each later page carries one idea.",
      "No figure appears unless you supplied it.",
    ],
    section: "The point",
    headings: ["Say one thing, then stop", "Leave the rest off this page", "Name the owner of the next step"],
    bullets: (topic) => [
      `${topic} is the only subject of this page.`,
      "The next page does not repeat this sentence.",
      "A name, a date, or a decision belongs here when you have one.",
      "Leave a blank rather than invent a number.",
      "Stop when the page is full.",
    ],
    bigLabel: "No figure supplied",
    bigCaption: "This page stays empty of invented statistics.",
    quote: "Use only what was handed to you.",
    quoteBy: "This desk",
    compareLeft: "On this page",
    compareRight: "Left for later",
    compareLeftLines: ["One claim.", "Words you can point at."],
    compareRightLines: ["A second topic.", "It waits for its own page."],
    close: "The next step is yours",
    closeBody: "Name the owner and the day, or leave this page as a stop.",
    notes: {
      cover: "Read the title, then name who the deck is for.",
      agenda: "Do not walk every item. Point at the one they came for.",
      section: "Pause. Say the point in one sentence before the next page.",
      content: "If they ask for a number you do not have, say so and move on.",
      "big-number": "Do not fill the silence with a made-up figure.",
      quote: "Read the sentence once, then stop.",
      comparison: "Cover the left column, then say why the right column is a different page.",
      closing: "Ask for a yes or a no. Do not add a new topic.",
    },
  },
  id: {
    aesthetic: "Editorial tenang — bidang putih gading, satu aksen hijau, jarak yang longgar.",
    kicker: "Open Slide",
    coverSub: "Satu gagasan di setiap halaman, disusun di meja ini.",
    agenda: "Isi dek ini",
    agendaItems: (topic) => [
      `Pokoknya adalah ${topic}.`,
      "Setiap halaman sesudah ini membawa satu gagasan.",
      "Tidak ada angka kecuali yang Anda berikan.",
    ],
    section: "Intinya",
    headings: [
      "Sampaikan satu hal, lalu berhenti",
      "Sisanya tidak masuk halaman ini",
      "Sebut pemilik langkah berikutnya",
    ],
    bullets: (topic) => [
      `${topic} adalah satu-satunya pokok di halaman ini.`,
      "Halaman berikutnya tidak mengulang kalimat ini.",
      "Nama, tanggal, atau keputusan masuk ke sini bila Anda memilikinya.",
      "Biarkan kosong daripada mengarang angka.",
      "Berhenti ketika halaman sudah penuh.",
    ],
    bigLabel: "Tidak ada angka",
    bigCaption: "Halaman ini tidak diisi statistik yang dikarang.",
    quote: "Pakai hanya yang sudah Anda serahkan.",
    quoteBy: "Meja ini",
    compareLeft: "Di halaman ini",
    compareRight: "Dibiarkan nanti",
    compareLeftLines: ["Satu klaim.", "Kata yang bisa Anda tunjuk."],
    compareRightLines: ["Pokok kedua.", "Ia menunggu halamannya sendiri."],
    close: "Langkah berikutnya milik Anda",
    closeBody: "Sebut pemiliknya dan harinya, atau biarkan halaman ini sebagai berhenti.",
    notes: {
      cover: "Bacakan judulnya, lalu sebut untuk siapa dek ini.",
      agenda: "Jangan bahas setiap butir. Tunjuk yang mereka datang untuknya.",
      section: "Berhenti sejenak. Ucapkan intinya dalam satu kalimat sebelum halaman berikutnya.",
      content: "Jika mereka minta angka yang tidak Anda punya, katakan demikian dan lanjut.",
      "big-number": "Jangan mengisi hening dengan angka yang dikarang.",
      quote: "Bacakan kalimatnya sekali, lalu berhenti.",
      comparison: "Bahas kolom kiri, lalu jelaskan mengapa kolom kanan adalah halaman lain.",
      closing: "Minta ya atau tidak. Jangan menambah pokok baru.",
    },
  },
};

const ROLES: Record<OpenSlidePageCount, OpenSlideRole[]> = {
  short: ["cover", "content", "content", "closing"],
  standard: ["cover", "agenda", "content", "big-number", "quote", "closing"],
  deep: [
    "cover",
    "agenda",
    "section",
    "content",
    "content",
    "comparison",
    "big-number",
    "quote",
    "content",
    "section",
    "closing",
  ],
};

function clip(topic: string, max = 72): string {
  const one = topic.replace(/\s+/g, " ").trim();
  if (one.length <= max) {
    return one;
  }
  return `${one.slice(0, max - 1).trimEnd()}…`;
}

function kebab(topic: string): string {
  const slug = topic
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
  return slug || "open-slide";
}

function heroSize(density: OpenSlideDensity): number {
  if (density === "minimal") {
    return 168;
  }
  if (density === "light") {
    return 140;
  }
  if (density === "standard") {
    return 112;
  }
  return 96;
}

function bulletCount(density: OpenSlideDensity): number {
  if (density === "minimal") {
    return 1;
  }
  if (density === "light") {
    return 3;
  }
  if (density === "standard") {
    return 4;
  }
  return 5;
}

function text(
  id: string,
  x: number,
  y: number,
  w: number,
  h: number,
  value: string,
  fontSize: number,
  weight: OpenSlideWeight,
  tone: OpenSlideBlock["tone"],
  align: OpenSlideBlock["align"] = "left",
): OpenSlideBlock {
  return { id, kind: "text", x, y, w, h, text: value, fontSize, weight, align, tone };
}

function bar(id: string, x: number, y: number): OpenSlideBlock {
  return {
    id,
    kind: "shape",
    x,
    y,
    w: 96,
    h: 8,
    text: "",
    fontSize: 12,
    weight: 400,
    align: "left",
    tone: "accent",
  };
}

function buildPage(
  role: OpenSlideRole,
  index: number,
  topic: string,
  density: OpenSlideDensity,
  copy: Copy,
  contentOrdinal: number,
): OpenSlidePage {
  const id = `p${index + 1}`;
  const wide = OPEN_SLIDE_CANVAS_WIDTH - PAD * 2;
  const notes = copy.notes[role];
  if (role === "cover") {
    return {
      id,
      role,
      notes,
      blocks: [
        bar(`${id}-bar`, PAD, 260),
        text(`${id}-kicker`, PAD, 284, wide, 40, copy.kicker, 28, 500, "accent"),
        text(`${id}-title`, PAD, 348, wide, 240, topic, heroSize(density), 800, "text"),
        text(`${id}-sub`, PAD, 620, 1400, 120, copy.coverSub, 40, 400, "muted"),
      ],
    };
  }
  if (role === "agenda") {
    const items = copy.agendaItems(topic);
    return {
      id,
      role,
      notes,
      blocks: [
        bar(`${id}-bar`, PAD, 120),
        text(`${id}-heading`, PAD, 148, wide, 100, copy.agenda, 72, 800, "text"),
        ...items.map((item, itemIndex) =>
          text(`${id}-item-${itemIndex + 1}`, PAD, 320 + itemIndex * 96, wide, 72, item, 36, 400, "text"),
        ),
      ],
    };
  }
  if (role === "section") {
    return {
      id,
      role,
      notes,
      blocks: [text(`${id}-label`, PAD, 420, wide, 200, copy.section, 120, 800, "text")],
    };
  }
  if (role === "big-number") {
    return {
      id,
      role,
      notes,
      blocks: [
        text(`${id}-figure`, PAD, 360, wide, 200, copy.bigLabel, 96, 800, "accent", "center"),
        text(`${id}-caption`, PAD, 600, wide, 80, copy.bigCaption, 32, 400, "muted", "center"),
      ],
    };
  }
  if (role === "quote") {
    return {
      id,
      role,
      notes,
      blocks: [
        text(`${id}-line`, PAD, 340, wide, 200, copy.quote, 64, 500, "text"),
        text(`${id}-by`, PAD, 580, wide, 60, copy.quoteBy, 28, 400, "muted"),
      ],
    };
  }
  if (role === "comparison") {
    return {
      id,
      role,
      notes,
      blocks: [
        text(`${id}-left-h`, PAD, 180, 760, 80, copy.compareLeft, 48, 800, "text"),
        text(`${id}-left-a`, PAD, 300, 760, 60, copy.compareLeftLines[0] ?? "", 36, 400, "text"),
        text(`${id}-left-b`, PAD, 380, 760, 60, copy.compareLeftLines[1] ?? "", 36, 400, "muted"),
        text(`${id}-right-h`, 1040, 180, 760, 80, copy.compareRight, 48, 800, "accent"),
        text(`${id}-right-a`, 1040, 300, 760, 60, copy.compareRightLines[0] ?? "", 36, 400, "text"),
        text(`${id}-right-b`, 1040, 380, 760, 60, copy.compareRightLines[1] ?? "", 36, 400, "muted"),
      ],
    };
  }
  if (role === "closing") {
    return {
      id,
      role,
      notes,
      blocks: [
        bar(`${id}-bar`, PAD, 300),
        text(`${id}-heading`, PAD, 328, wide, 140, copy.close, 72, 800, "text"),
        text(`${id}-body`, PAD, 500, 1400, 100, copy.closeBody, 36, 400, "muted"),
      ],
    };
  }
  const heading = copy.headings[contentOrdinal % copy.headings.length] ?? copy.headings[0];
  const bullets = copy.bullets(topic).slice(0, bulletCount(density));
  return {
    id,
    role: "content",
    notes,
    blocks: [
      bar(`${id}-bar`, PAD, 120),
      text(`${id}-heading`, PAD, 148, wide, 120, heading, density === "dense" ? 56 : 64, 800, "text"),
      ...bullets.map((bullet, bulletIndex) =>
        text(`${id}-b-${bulletIndex + 1}`, PAD, 320 + bulletIndex * 88, wide, 72, bullet, 36, 400, "text"),
      ),
    ],
  };
}

export function draftOpenSlideDeck(input: {
  prompt: string;
  pageCount?: OpenSlidePageCount;
  density?: OpenSlideDensity;
  motion?: OpenSlideMotion;
  locale: AppLocale;
}): OpenSlideDeck {
  const locale = parseAppLocale(input.locale);
  const copy = COPY[locale];
  const topic = clip(input.prompt);
  const pageCount = input.pageCount ?? "standard";
  const density = input.density ?? "light";
  const motion = input.motion ?? "static";
  const roles = ROLES[pageCount];
  let contentOrdinal = 0;
  const pages = roles.map((role, index) => {
    const page = buildPage(role, index, topic, density, copy, contentOrdinal);
    if (role === "content") {
      contentOrdinal += 1;
    }
    return page;
  });
  const brief: OpenSlideBrief = {
    topic,
    aesthetic: copy.aesthetic,
    pageCount,
    density,
    motion,
  };
  const design: OpenSlideDesign = {
    palette: { bg: "#f7f7f6", text: "#292929", accent: "#0f766e", muted: "#5d5d5d" },
    fonts: { display: "system-ui, sans-serif", body: "system-ui, sans-serif" },
    typeScale: { hero: heroSize(density), section: 96, heading: 64, body: 36, caption: 28 },
    radius: 12,
    padding: PAD,
  };
  return {
    engine: "open-slide",
    id: kebab(input.prompt),
    meta: { title: topic, createdAt: new Date().toISOString() },
    design,
    brief,
    pages,
  };
}

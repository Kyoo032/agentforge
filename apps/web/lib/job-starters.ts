import type { DocumentDraft } from "./document-outline";
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

export const FINANCE_STARTERS: DocumentStarter[] = [
  {
    id: "cashflow-spread",
    label: "Monthly cash-flow spread",
    description: "A four-week personal cash-flow sheet with fixed, variable, and surplus lines.",
    draft: {
      title: "Monthly cash-flow spread — September",
      sections: [
        {
          heading: "Opening position",
          body: "Start-of-month balance Rp 18.400.000 across two accounts. Salary Rp 14.000.000 credited on the 25th; freelance invoice Rp 3.500.000 expected 8 Sep, not confirmed. Treat the freelance line as pending until it clears.",
        },
        {
          heading: "Fixed outflows",
          body: "Rent 5.000.000 (due 1st), internet 400.000, phone 150.000, transit pass 300.000, insurance 650.000. Fixed total: 6.500.000, or 46% of confirmed monthly income.",
        },
        {
          heading: "Variable outflows",
          body: "Groceries 2.200.000 (actual last month 2.430.000 — hold 2.400.000, not the wish number). Fuel and ride-hail 700.000. Eating out 600.000. Misc 400.000. Variable total: 4.300.000.",
        },
        {
          heading: "Surplus and buffers",
          body: "Confirmed income 14.000.000 minus 10.800.000 total outflows leaves 3.200.000 planned surplus. Buffer rule: keep 6.000.000 in checking before surplus moves to savings.",
        },
        {
          heading: "Breakeven check",
          body: "The month breaks even at 10.800.000 of inflow against a 14.000.000 baseline. Watch line: eating out. It is the only category running above plan two months in a row.",
        },
      ],
    },
  },
  {
    id: "breakeven-equipment",
    label: "Breakeven — equipment purchase",
    description: "Unit economics, breakeven volume, and downside exposure for a cart upgrade.",
    draft: {
      title: "Breakeven and exposure — espresso cart upgrade",
      sections: [
        {
          heading: "The purchase",
          body: "Two-group machine plus grinder: 48.000.000. Cash on hand 20.000.000; remaining 28.000.000 is 24-month financing at 670.000/month. Install: 2.400.000 one-time.",
        },
        {
          heading: "Unit economics per cup",
          body: "Average ticket 28.000. Beans, milk, cup, and overhead per cup: 11.200. Contribution margin: 16.800 per cup.",
        },
        {
          heading: "Breakeven volume",
          body: "Financing alone needs 670.000 / 16.800 = 40 cups/month over the current baseline. If Saturday foot traffic holds, breakeven lands in month one.",
        },
        {
          heading: "Exposure",
          body: "Downside is bounded: resale at roughly 60% of list covers remaining financing. The unbounded risk is losing the market slot during the 5-day install.",
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
          heading: "This week in one line",
          bullets: [
            "Webdev Home now shows every work tab without Build.",
            "The installed Windows app is still last month’s build.",
            "I need a yes or no on rebuilding NSIS this week.",
          ],
          notes: "If someone only remembers one sentence, it is the installer gap. Do not bury it.",
        },
        {
          heading: "What we can show on this machine",
          bullets: [
            "Chat, Documents, Research, Images, Videos, Presentation on Home.",
            "Settings is paste-key, usage, and privacy — no Advanced tab.",
            "A Legal desk can hide Images and Videos; we did not create one here.",
          ],
          notes: "Open /chat if they want proof. Do not send them to /agents — it redirects.",
        },
        {
          heading: "What slipped",
          bullets: [
            "Packaged Electron was last built 31 Aug.",
            "desktop:dev already wraps the new UI on port 3000.",
            "Anyone on the .exe will not see GTM until we rebuild.",
          ],
          notes: "This is not a code miss. It is a ship miss. Offer the rebuild as the decision.",
        },
        {
          heading: "Quality risk I will not paper over",
          bullets: [
            "Old example cards were one-sentence prompts.",
            "Generate then produced thin memos and 3-slide decks.",
            "New briefs name audience, deliverable, and a sample scenario.",
          ],
          notes: "Show one Documents card if they ask. The starter memo is the offline proof.",
        },
        {
          heading: "Decision in this room",
          bullets: [
            "Rebuild NSIS this week, or keep using desktop:dev.",
            "I will not call the August installer the GTM product.",
            "Owner of the call: you. Date: Thursday.",
          ],
          notes: "If they defer, write ‘deferred’ on the slide in the recap. Do not leave it implied.",
        },
        {
          heading: "Next seven days",
          bullets: [
            "Mon–Tue: dual-run design draft (Sam).",
            "Wed: collide-safe export names (Jin).",
            "Fri: six-line recap whether or not we rebuilt.",
          ],
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
          heading: "The decision",
          bullets: [
            "Do we stay on the current gateway through 15 Oct?",
            "Error budget is 2.1% against a 1.0% target.",
            "One enterprise deal is blocked on uptime language.",
          ],
          notes: "One decision. If they start a second, park it.",
        },
        {
          heading: "Cost of waiting",
          bullets: [
            "Renewal is six weeks out.",
            "Every week on 2.1% is another week we cannot sign the deal.",
            "Legal will not review a second vendor this month.",
          ],
          notes: "If they say ‘just get legal to rush,’ remind them we already asked.",
        },
        {
          heading: "Three options",
          bullets: [
            "Stay: no legal slot, error budget unchanged.",
            "Dual-run 90 days: one engineer-week, reversible, still no second legal review if we only design.",
            "Hard cutover in 30 days: needs the legal slot we do not have.",
          ],
          notes: "Do not let ‘explore a fourth vendor’ into the room. That is a new memo.",
        },
        {
          heading: "Recommendation: stay, write the dual-run",
          bullets: [
            "Pick stay through renewal.",
            "Write the dual-run design this week so October is a choice.",
            "Do not start a hard cutover without a legal date.",
          ],
          notes: "Name the pick in the first sentence. Then the two tradeoffs.",
        },
        {
          heading: "Tradeoffs we are accepting",
          bullets: [
            "We will miss the enterprise deal if they will not wait.",
            "We spend an engineer-week on a design we might not run.",
            "Unknown: whether the gateway will publish a status page we can cite.",
          ],
          notes: "Unknowns stay unknown. Do not invent an SLA.",
        },
        {
          heading: "If you approve today",
          bullets: [
            "Sam writes the dual-run design by Friday.",
            "I send the six-line recap with the written pick.",
            "We revisit at renewal with evidence, not a vibe.",
          ],
          notes: "Close on the first action, not a thank-you.",
        },
      ],
    },
  },
];

export function findDocumentStarter(id: string): DocumentStarter | undefined {
  return DOCUMENT_STARTERS.find((item) => item.id === id);
}

export function findPresentationStarter(id: string): PresentationStarter | undefined {
  return PRESENTATION_STARTERS.find((item) => item.id === id);
}

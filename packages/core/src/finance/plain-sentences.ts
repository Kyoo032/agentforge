/**
 * A typed sentence back into the ledger shape the task readers already accept.
 *
 * The catalog samples are how a person writes the numbers ("Jan in $20,000, out $26,000"), and the
 * sheet readers only accept a label, a colon and an amount. This module changes the shape and never
 * the figure: every amount below is the same token `cellValue` reads, and a sentence that is not one
 * of these shapes is left untouched so a real sheet still wins.
 */
import { cellValue } from "./import-table";
import { periodOrdinal } from "./appraisal/periods";
import type { LineItem } from "./types";

/**
 * A money token: a grouped figure (`20,000`, `900.000.000`), a long plain integer, or the same with
 * a currency mark. A bare `1` or `12` is a year or a rate, not an amount, so it is not matched.
 */
const MONEY = /(?:(?:rp|idr|usd|eur|gbp|sgd|us\$|\$|€|£)\s*)?[-+]?(?:\d{1,3}(?:[.,]\d{3})+|\d{4,})(?:[.,]\d+)?/gi;

const OPENING =
  /^(?<label>opening\s+(?:cash|balance)|beginning\s+(?:cash|balance)|saldo\s+awal|kas\s+awal)\s+(?<amount>.+)$/i;

const IN_WORD = String.raw`cash\s+in|kas\s+masuk|\bin\b|masuk`;
const OUT_WORD = String.raw`cash\s+out|kas\s+keluar|\bout\b|keluar`;
const FLOW = new RegExp(
  `^(?<period>.+?)\\s+(?:${IN_WORD})\\s+(?<inbound>.+?)\\s*,?\\s*(?:${OUT_WORD})\\s+(?<outbound>.+)$`,
  "i",
);

const BUDGET_SIDE =
  /^(?<word>budget|budgets|budgeted|anggaran|rencana|plan|planned|actual|actuals|aktual|realisasi)\s*:\s*(?<body>.+)$/i;

const RATE_CLAUSE = /(?:diskonto|tingkat\s+diskonto|discount\s*rate|\bdiscount\b|hurdle|wacc)/i;
const OUTLAY_LABEL = /^(?:outlay|modal\s+awal|investasi\s+awal|initial\s+investment|capex)$/i;
const PLACED_WHEN = /^(?:at|di|pada)\s+((?:tahun|year|yr)\s*\d{1,3})$/i;
const INDONESIAN = /masuk|keluar|saldo|anggaran|realisasi|tahun|modal|\brp\b/i;

type MoneyHit = { readonly token: string; readonly index: number; readonly amount: number };

function sentencesOf(text: string): string[] {
  return text.split(/\r?\n/).flatMap((line) =>
    line
      .split(/\.(?=\s|$)/)
      .map((part) =>
        part
          .replace(/[…]+$/u, "")
          .replace(/\.{2,}$/g, "")
          .trim(),
      )
      .filter((part) => part !== ""),
  );
}

function commaParts(sentence: string): string[] {
  return sentence
    .split(/,\s+(?=\p{L})/u)
    .map((part) => part.trim())
    .filter((part) => part !== "");
}

function moneyHits(text: string): MoneyHit[] {
  return [...text.matchAll(MONEY)].flatMap((match) => {
    const token = match[0] ?? "";
    const amount = cellValue(token);
    return amount === null || match.index === undefined ? [] : [{ token, index: match.index, amount }];
  });
}

function oneAmount(text: string): MoneyHit | null {
  const hits = moneyHits(text);
  return hits.length === 1 ? (hits[0] ?? null) : null;
}

function isRateClause(clause: string): boolean {
  return RATE_CLAUSE.test(clause) && /%/.test(clause);
}

function isFlowSentence(sentence: string): boolean {
  const match = FLOW.exec(sentence.trim());
  return (
    match !== null &&
    oneAmount(match.groups?.inbound ?? "") !== null &&
    oneAmount(match.groups?.outbound ?? "") !== null
  );
}

/** `Label: amount` or `Label amount`, one figure per clause. Null when the text is some other shape. */
export function labeledAmountLines(text: string): string | null {
  if (text.includes("|")) {
    return null;
  }
  const sentences = sentencesOf(text);
  if (sentences.length === 0 || sentences.some((sentence) => isFlowSentence(sentence) || BUDGET_SIDE.test(sentence))) {
    return null;
  }
  const clauses = sentences.flatMap((sentence) => (isRateClause(sentence) ? [] : commaParts(sentence)));
  if (clauses.length === 0) {
    return null;
  }
  const lines: string[] = [];
  for (const clause of clauses) {
    const colon = /^(?<label>.*?)\s*:\s*(?<rest>.+)$/.exec(clause);
    const body = (colon?.groups?.rest ?? clause).trim();
    const hit = oneAmount(body);
    if (!hit) {
      return null;
    }
    const before = body.slice(0, hit.index).trim();
    const label = (colon ? (colon.groups?.label ?? "") : before).trim().replace(/[:\s]+$/g, "");
    // A clause whose whole label is a year ("Year 1 $60,000") belongs to the appraisal reader.
    if (label === "" || periodOrdinal(label) !== null || OUTLAY_LABEL.test(label)) {
      return null;
    }
    if (!colon && before !== label) {
      return null;
    }
    lines.push(`${label}: ${hit.token.trim()}`);
  }
  return lines.join("\n");
}

/**
 * "Opening cash $90,000. Jan in $20,000, out $26,000." as the narrow ledger `parseCashflow` reads.
 *
 * The out row is tagged `[cash out]` so a positive amount stays an outflow. The figure itself is
 * the token the person typed.
 */
export function cashflowLedgerFromSentence(text: string): string | null {
  if (text.includes("|") || /^sheet\s*:/im.test(text)) {
    return null;
  }
  const indonesian = INDONESIAN.test(text);
  const lines: string[] = [];
  let flows = 0;
  for (const sentence of sentencesOf(text)) {
    const opening = OPENING.exec(sentence);
    const openingAmount = opening ? oneAmount(opening.groups?.amount ?? "") : null;
    if (opening && openingAmount && (opening.groups?.amount ?? "").trim() === openingAmount.token.trim()) {
      lines.push(`${indonesian ? "Saldo awal" : "Opening cash"}: ${openingAmount.token.trim()}`);
      continue;
    }
    const flow = FLOW.exec(sentence);
    const inbound = oneAmount(flow?.groups?.inbound ?? "");
    const outbound = oneAmount(flow?.groups?.outbound ?? "");
    const period = (flow?.groups?.period ?? "").trim();
    if (!flow || !inbound || !outbound || period === "") {
      return null;
    }
    const inn = indonesian ? "kas masuk" : "cash in";
    const out = indonesian ? "kas keluar" : "cash out";
    lines.push(`[${inn}] ${indonesian ? "Kas masuk" : "Cash in"} (${period}): ${inbound.token.trim()}`);
    lines.push(`[${out}] ${indonesian ? "Kas keluar" : "Cash out"} (${period}): ${outbound.token.trim()}`);
    flows += 1;
  }
  return flows === 0 ? null : lines.join("\n");
}

/**
 * "Budget: Marketing $10,000. Actual: Marketing $14,000." as two sheets the budget reader already
 * pairs by label. The sheet name is the word the person typed, so "Anggaran" stays the budget side.
 */
export function budgetSheetsFromSentence(text: string): string | null {
  if (text.includes("|")) {
    return null;
  }
  const blocks: string[] = [];
  for (const sentence of sentencesOf(text)) {
    const side = BUDGET_SIDE.exec(sentence);
    const word = side?.groups?.word?.trim() ?? "";
    const body = side?.groups?.body ?? "";
    if (!side || word === "") {
      return null;
    }
    const pairs = commaParts(body).flatMap((part) => {
      const hit = oneAmount(part);
      const label = hit
        ? part
            .slice(0, hit.index)
            .trim()
            .replace(/[:\s]+$/g, "")
        : "";
      return hit && label !== "" ? [`${label}: ${hit.token.trim()}`] : [];
    });
    if (pairs.length === 0 || pairs.length !== commaParts(body).length) {
      return null;
    }
    blocks.push(`Sheet: ${word}`, ...pairs);
  }
  return blocks.length === 0 ? null : blocks.join("\n");
}

/**
 * "Outlay $200,000. Year 1 $60,000, year 2 $75,000. Discount rate 12%." as confirmed rows.
 *
 * A positive outlay is the cost of the project, so it is stored negative at year 0 — the same sign
 * a sheet's year-0 column already uses. Later years keep the sign they were typed with. The rate
 * clause is not a row; `discountRateFromText` still reads it.
 */
export function appraisalItemsFromSentence(text: string): LineItem[] | null {
  if (text.includes("|") || /^sheet\s*:/im.test(text)) {
    return null;
  }
  const indonesian = INDONESIAN.test(text);
  const currency = /\brp\b|\bidr\b/i.test(text) ? "IDR" : /\$|\busd\b/i.test(text) ? "USD" : "";
  const items: LineItem[] = [];
  let years = 0;
  for (const sentence of sentencesOf(text)) {
    for (const clause of isRateClause(sentence) ? [] : commaParts(sentence)) {
      if (isRateClause(clause)) {
        continue;
      }
      // The money token is found first. "Year 1 $60,000" would otherwise let the year number sit
      // inside the amount, and the clause would be refused.
      const hits = moneyHits(clause);
      const hit = hits.length === 1 ? hits[0] : null;
      const head = hit
        ? clause
            .slice(0, hit.index)
            .trim()
            .replace(/[:\s]+$/g, "")
        : "";
      const after = hit ? clause.slice(hit.index + hit.token.length).trim() : "";
      const when = after === "" ? "" : (PLACED_WHEN.exec(after)?.[1]?.trim() ?? null);
      if (!hit || head === "" || when === null) {
        return null;
      }
      if (OUTLAY_LABEL.test(head)) {
        const period = when !== "" ? when : indonesian ? "Tahun 0" : "Year 0";
        items.push({
          label: head,
          period,
          amount: hit.amount > 0 ? -hit.amount : hit.amount,
          currency,
          category: "asset",
        });
        continue;
      }
      if (periodOrdinal(head) === null) {
        return null;
      }
      years += 1;
      items.push({
        label: indonesian ? "Arus kas" : "Cash flow",
        period: head,
        amount: hit.amount,
        currency,
        category: "cash",
      });
    }
  }
  return years === 0 ? null : items;
}

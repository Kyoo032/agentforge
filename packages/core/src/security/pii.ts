import type { ContentPart } from "../content/types";

export type PiiKind = "email" | "phone" | "id" | "card";

export const PII_MASK: Record<PiiKind, string> = {
  email: "[email]",
  phone: "[phone]",
  id: "[id]",
  card: "[card]",
};

export type PiiFinding = {
  kind: PiiKind;
  match: string;
  index: number;
};

const EMAIL_RE = /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g;

/** Intl-ish phones: optional +, country code, groups of digits with spaces/dashes/parens. */
const PHONE_RE =
  /(?:(?:\+|00)\d{1,3}[\s.-]?)?(?:\(?\d{2,4}\)?[\s.-]?)\d{3,4}[\s.-]?\d{3,4}(?:[\s.-]?\d{1,4})?/g;

/** 13–19 digit runs, allowing common separators. */
const CARD_CANDIDATE_RE = /\b(?:\d[ -]*?){13,19}\b/g;

/** Long ID-like numbers: SSN / national-id style with separators, or 9+ continuous digits. */
const ID_RE =
  /\b(?:\d{3}[-\s]\d{2}[-\s]\d{4}|\d{2}[-\s]\d{2}[-\s]\d{2}[-\s]\d{2,4}|\d{9,})\b/g;

function digitsOnly(value: string): string {
  return value.replace(/\D/g, "");
}

/** Luhn checksum — rejects random digit runs that look card-like. */
export function passesLuhn(digits: string): boolean {
  if (!/^\d{13,19}$/.test(digits)) {
    return false;
  }
  let sum = 0;
  let alternate = false;
  for (let i = digits.length - 1; i >= 0; i -= 1) {
    let n = Number(digits[i]);
    if (alternate) {
      n *= 2;
      if (n > 9) {
        n -= 9;
      }
    }
    sum += n;
    alternate = !alternate;
  }
  return sum % 10 === 0;
}

function pushUnique(findings: PiiFinding[], finding: PiiFinding): void {
  const exists = findings.some(
    (item) => item.kind === finding.kind && item.index === finding.index && item.match === finding.match,
  );
  if (!exists) {
    findings.push(finding);
  }
}

function overlapsCard(findings: PiiFinding[], index: number, length: number): boolean {
  return findings.some(
    (item) => item.kind === "card" && index < item.index + item.match.length && index + length > item.index,
  );
}

export function scanPii(text: string): PiiFinding[] {
  if (!text) {
    return [];
  }

  const findings: PiiFinding[] = [];

  for (const match of text.matchAll(EMAIL_RE)) {
    if (match.index === undefined) {
      continue;
    }
    pushUnique(findings, { kind: "email", match: match[0], index: match.index });
  }

  for (const match of text.matchAll(PHONE_RE)) {
    if (match.index === undefined) {
      continue;
    }
    const raw = match[0];
    const digits = digitsOnly(raw);
    // Avoid short numbers (years, codes) and bare digit runs handled as cards/ids.
    if (digits.length < 10 || digits.length > 15) {
      continue;
    }
    // Skip if this span is mostly inside an email we already found.
    const insideEmail = findings.some(
      (item) =>
        item.kind === "email" && match.index >= item.index && match.index < item.index + item.match.length,
    );
    if (insideEmail) {
      continue;
    }
    pushUnique(findings, { kind: "phone", match: raw, index: match.index });
  }

  for (const match of text.matchAll(CARD_CANDIDATE_RE)) {
    if (match.index === undefined) {
      continue;
    }
    const raw = match[0];
    const digits = digitsOnly(raw);
    if (!passesLuhn(digits)) {
      continue;
    }
    pushUnique(findings, { kind: "card", match: raw, index: match.index });
  }

  for (const match of text.matchAll(ID_RE)) {
    if (match.index === undefined) {
      continue;
    }
    const raw = match[0];
    const digits = digitsOnly(raw);
    if (digits.length < 9) {
      continue;
    }
    // Prefer card classification when Luhn-valid.
    if (passesLuhn(digits) && digits.length >= 13 && digits.length <= 19) {
      continue;
    }
    if (overlapsCard(findings, match.index, raw.length)) {
      continue;
    }
    // Continuous 9–12 digit runs without separators are weak; require separators
    // for SSN-like, or 9+ with separators / longer continuous national-id style.
    const hasSep = /[-\s]/.test(raw);
    if (!hasSep && digits.length < 11) {
      continue;
    }
    pushUnique(findings, { kind: "id", match: raw, index: match.index });
  }

  findings.sort((a, b) => a.index - b.index || a.kind.localeCompare(b.kind));
  return findings;
}

const KIND_LABEL: Record<PiiKind, string> = {
  email: "email addresses",
  phone: "phone numbers",
  id: "ID numbers",
  card: "card numbers",
};

/** Replace findings with stable tokens. The original string is not mutated. */
export function maskPii(text: string): string {
  const findings = scanPii(text);
  if (findings.length === 0) {
    return text;
  }
  const ordered = [...findings].sort((left, right) => {
    if (right.index !== left.index) {
      return right.index - left.index;
    }
    return right.match.length - left.match.length;
  });
  let result = text;
  for (const finding of ordered) {
    result =
      result.slice(0, finding.index) + PII_MASK[finding.kind] + result.slice(finding.index + finding.match.length);
  }
  return result;
}

export function maskPiiInParts(parts: ContentPart[]): ContentPart[] {
  return parts.map((part) => (part.type === "text" ? { ...part, text: maskPii(part.text) } : part));
}

export function maskOutboundRunInput<
  T extends {
    version: { systemPrompt: string };
    history: Array<{ role: "user" | "assistant"; parts: ContentPart[] }>;
  },
>(input: T): T {
  return {
    ...input,
    version: { ...input.version, systemPrompt: maskPii(input.version.systemPrompt) },
    history: input.history.map((item) => ({ ...item, parts: maskPiiInParts(item.parts) })),
  };
}

export function piiWarning(findings: PiiFinding[]): string | null {
  if (findings.length === 0) {
    return null;
  }
  const kinds = [...new Set(findings.map((item) => item.kind))];
  const labels = kinds.map((kind) => KIND_LABEL[kind]);
  if (labels.length === 1) {
    return `This prompt may contain ${labels[0]}. Remove personal data before sending.`;
  }
  if (labels.length === 2) {
    return `This prompt may contain ${labels[0]} and ${labels[1]}. Remove personal data before sending.`;
  }
  const head = labels.slice(0, -1).join(", ");
  const last = labels[labels.length - 1];
  return `This prompt may contain ${head}, and ${last}. Remove personal data before sending.`;
}

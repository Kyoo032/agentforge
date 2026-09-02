import type { ContentPart } from "../content/types";

export type InjectionSeverity = "HIGH" | "CRITICAL";

export type InjectionHit = {
  hit: true;
  rule: string;
  severity: InjectionSeverity;
};

type InjectionRule = {
  rule: string;
  severity: InjectionSeverity;
  pattern: RegExp;
};

/** Tight HIGH/CRITICAL subset. MEDIUM hypothetical/reward rules are not ported. */
const RULES: InjectionRule[] = [
  {
    rule: "ignore-previous",
    severity: "CRITICAL",
    pattern:
      /\b(ignore|disregard|forget)\s+(all\s+)?(previous|prior|above|preceding)\s+(instructions?|prompts?|rules?|guidelines?)\b/i,
  },
  {
    rule: "dan",
    severity: "CRITICAL",
    pattern: /\bdo\s+anything\s+now\b|\byou\s+are\s+(now\s+)?dan\b|\bdan\s+mode\b/i,
  },
  {
    rule: "system-delimiter",
    severity: "CRITICAL",
    pattern: /\[INST\]|<<\s*SYS\s*>>|<\|im_start\|>\s*system|<\|system\|>|\[SYSTEM\]|###\s*System(?:\s*prompt)?\b/i,
  },
  {
    rule: "prompt-leak",
    severity: "HIGH",
    pattern: /\b(reveal|print|show|dump|repeat|output)\s+(me\s+)?(?:your\s+(?:hidden\s+)?(?:system\s+)?|(?:hidden\s+)?system\s+)(prompt|instructions)\b/i,
  },
  {
    rule: "id-override",
    severity: "HIGH",
    pattern: /\babaikan\s+(semua\s+)?(instruksi|perintah)(\s+sebelumnya|\s+sebelum\s+ini)?\b|\blupakan\s+(semua\s+)?instruksi\b/i,
  },
];

const META_DISCUSSION_RE = /\b(security analysis|false positive|injection guard)\b/i;
const BASE64_HINT_RE = /base64|[A-Za-z0-9+/]{40,}={0,2}/i;
const PATH_HINT_RE = /(?:[A-Za-z]:\\|\/)[^\s]{1,160}\.\w{1,8}\b|\b[\w.-]+\.(txt|md|csv|json|png|jpe?g|webp)\b/i;

function isFalsePositiveContext(text: string): boolean {
  if (META_DISCUSSION_RE.test(text)) {
    return true;
  }
  return BASE64_HINT_RE.test(text) && PATH_HINT_RE.test(text);
}

export function scanInjection(text: string): InjectionHit | null {
  if (!text) {
    return null;
  }
  if (isFalsePositiveContext(text)) {
    return null;
  }
  for (const rule of RULES) {
    if (rule.pattern.test(text)) {
      return { hit: true, rule: rule.rule, severity: rule.severity };
    }
  }
  return null;
}

export function scanJson(value: unknown, seen: Set<unknown> = new Set()): InjectionHit | null {
  if (value == null) {
    return null;
  }
  if (typeof value === "string") {
    return scanInjection(value);
  }
  if (typeof value !== "object") {
    return null;
  }
  if (seen.has(value)) {
    return null;
  }
  seen.add(value);
  if (Array.isArray(value)) {
    for (const item of value) {
      const hit = scanJson(item, seen);
      if (hit) {
        return hit;
      }
    }
    return null;
  }
  for (const item of Object.values(value as Record<string, unknown>)) {
    const hit = scanJson(item, seen);
    if (hit) {
      return hit;
    }
  }
  return null;
}

export function blockedInjectionOutput(hit: InjectionHit): { success: false; error: string } {
  return { success: false, error: `Blocked by injection guard (rule: ${hit.rule})` };
}

const ATTACH_BLOCK_RE = /(?:^|\n\n)--- ([^\n]+) ---\n([\s\S]*?)(?=\n\n--- |$)/g;

/** Replace injected attach bodies with a short marker so the turn still sends. */
export function redactAttachedText(text: string): string {
  return text.replace(ATTACH_BLOCK_RE, (match, filename: string, body: string) => {
    const hit = scanInjection(body);
    if (!hit) {
      return match;
    }
    const leading = match.startsWith("\n\n") ? "\n\n" : "";
    return `${leading}--- ${filename} ---\n[Attachment blocked by injection guard (rule: ${hit.rule})]`;
  });
}

export function redactAttachedParts(parts: ContentPart[]): ContentPart[] {
  return parts.map((part) => {
    if (part.type !== "text") {
      return part;
    }
    return { ...part, text: redactAttachedText(part.text) };
  });
}

/**
 * Finance egress: the only thing a Finance job may talk to is the pinned model gateway, and the only
 * thing it may send there is the redacted copy of the owner's figures.
 *
 * Two halves, because one alone is not enough:
 *
 *  - **Static.** Walk the import graph out of the Finance handlers and fail if any file in it can
 *    open a socket of its own, pull in a market / web-search tool, or hand the model a tool at all.
 *    A future edit that adds one is caught in review rather than in a packet capture.
 *  - **Dynamic.** Run the parse and the regenerate paths with every socket API replaced by a spy and
 *    assert nothing was attempted, then read the exact prompt that was handed to the runtime and
 *    assert none of a payroll fixture's personal data is in it.
 *
 * Hosted OCR and Firecrawl are guarded repository-wide by `file-extract/no-hosted-ocr.test.ts`, so
 * this file does not restate that check; the import walk below covers the rest.
 */
import { readdirSync, readFileSync, existsSync, statSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import http from "node:http";
import https from "node:https";
import net from "node:net";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { TenantContext } from "@agentforge/core";
import type { WorkCard } from "./work-cards";

// ---------------------------------------------------------------------------------------------
// Static: what the Finance import graph is allowed to contain
// ---------------------------------------------------------------------------------------------

const HOST_SRC = fileURLToPath(new URL(".", import.meta.url));
const CORE_SRC = resolve(HOST_SRC, "..", "..", "core", "src");
const REPO_ROOT = resolve(HOST_SRC, "..", "..", "..");

const ENTRY_FILES = [
  "handlers/finance.ts",
  "handlers/finance-import.ts",
  "handlers/finance-export.ts",
  "finance-generate.ts",
  "finance-brief-build.ts",
  "finance-privacy.ts",
  "finance-task.ts",
  "finance-artifact.ts",
  "finance-docx.ts",
];

const ENTRY_DIRS = ["finance-tasks", "renderers", "file-extract"];

/**
 * The one module in the graph that is supposed to reach the network, with the reason it is here.
 *
 * `job-regen.ts` builds the runtime (`createRuntime`) and hands it the prompt. That is the pinned
 * model gateway — the single destination a Finance job has — and the call itself lives in
 * `@agentforge/core`, which this walk treats as external for exactly that reason.
 */
const ALLOWLIST: ReadonlyArray<{ readonly file: string; readonly why: string }> = [
  { file: "src/job-regen.ts", why: "builds the runtime; the gateway call is the one legitimate egress" },
  {
    file: "src/knowledge-embed.ts",
    why: "work-card auto-ingest embeds the saved brief at the same pinned gateway; the base URL comes from resolveProviderKeys, never from a stored setting",
  },
];

const ALLOWED = new Set(ALLOWLIST.map((entry) => entry.file));

/** `@agentforge/core` itself is external here: the barrel is the shared runtime surface, not Finance. */
const CORE_SUBPATHS: Readonly<Record<string, string>> = {
  finance: "finance/index.ts",
  artifacts: "artifacts/index.ts",
  jobs: "jobs/index.ts",
  tabular: "tabular/index.ts",
  docx: "docx/index.ts",
  pdf: "pdf/index.ts",
  legal: "legal/index.ts",
  pii: "security/pii.ts",
  content: "content/transcript.ts",
  locale: "locale.ts",
  errors: "errors.ts",
};

const IMPORT_RE = /(?:^|\n)\s*(?:import|export)[\s\S]*?from\s*["']([^"']+)["']/g;
const BARE_IMPORT_RE = /(?:^|\n)\s*import\s*["']([^"']+)["']/g;

function fileFor(candidate: string): string | null {
  for (const path of [candidate, `${candidate}.ts`, join(candidate, "index.ts")]) {
    if (existsSync(path) && statSync(path).isFile()) {
      return path;
    }
  }
  return null;
}

function resolveImport(spec: string, fromFile: string): string | null {
  if (spec.startsWith(".")) {
    return fileFor(resolve(dirname(fromFile), spec));
  }
  const core = spec.startsWith("@agentforge/core/") ? spec.slice("@agentforge/core/".length) : null;
  const mapped = core ? CORE_SUBPATHS[core] : undefined;
  return mapped ? fileFor(join(CORE_SRC, mapped)) : null;
}

function importsOf(file: string, text: string): string[] {
  const specs = [...text.matchAll(IMPORT_RE), ...text.matchAll(BARE_IMPORT_RE)].map((match) => match[1] ?? "");
  return specs.flatMap((spec) => {
    const resolved = resolveImport(spec, file);
    return resolved ? [resolved] : [];
  });
}

function sourceFilesIn(dir: string): string[] {
  return existsSync(dir)
    ? readdirSync(dir)
        .filter((entry) => entry.endsWith(".ts") && !entry.includes(".test.") && !entry.includes("fixtures"))
        .map((entry) => join(dir, entry))
    : [];
}

function reachableFiles(): string[] {
  const seeds = [
    ...ENTRY_FILES.map((entry) => join(HOST_SRC, entry)).filter((file) => existsSync(file)),
    ...ENTRY_DIRS.flatMap((dir) => sourceFilesIn(join(HOST_SRC, dir))),
  ];
  const seen = new Set<string>();
  const queue = [...seeds];
  while (queue.length > 0) {
    const file = queue.pop();
    if (!file || seen.has(file)) {
      continue;
    }
    seen.add(file);
    queue.push(...importsOf(file, readFileSync(file, "utf8")));
  }
  return [...seen].sort();
}

const BLOCK_COMMENT = /\/\*[\s\S]*?\*\//g;
const LINE_COMMENT = /(^|[^:"'`\\])\/\/.*$/gm;

/** A file is free to explain what it must never do; only executable text is searched. */
function withoutComments(text: string): string {
  return text.replace(BLOCK_COMMENT, " ").replace(LINE_COMMENT, "$1");
}

const FORBIDDEN: ReadonlyArray<{ readonly name: string; readonly pattern: RegExp }> = [
  { name: "fetch(", pattern: /(?<![.\w])fetch\s*\(/ },
  { name: "http.request", pattern: /\bhttps?\s*\.\s*(?:request|get)\s*\(/ },
  { name: "net.connect", pattern: /\bnet\s*\.\s*(?:connect|createConnection)\s*\(/ },
  { name: "node:net / node:http import", pattern: /from\s*["']node:(?:net|http|https|dgram|tls)["']/ },
  { name: "WebSocket", pattern: /\bWebSocket\b/ },
  { name: "XMLHttpRequest", pattern: /\bXMLHttpRequest\b/ },
  { name: "web search / web fetch", pattern: /\bweb[_-]?(?:search|fetch)\b/i },
  { name: "hosted document conversion", pattern: /\bFIRECRAWL\b/ },
  { name: "optical character recognition option", pattern: /\bocr\s*=\s*true\b/i },
  { name: "tools handed to the model", pattern: /toolKeys\s*:\s*\[\s*["'`]/ },
];

const REACHABLE = reachableFiles();

function repoPath(file: string): string {
  return relative(join(REPO_ROOT, "packages", "host"), file)
    .split(sep)
    .join("/");
}

function offendersFor(pattern: RegExp): string[] {
  return REACHABLE.filter((file) => {
    const shown = repoPath(file);
    return !ALLOWED.has(shown) && pattern.test(withoutComments(readFileSync(file, "utf8")));
  }).map(repoPath);
}

describe("nothing in the Finance import graph can open a socket of its own", () => {
  it("walks a graph worth checking", () => {
    // A broken walk would make every assertion below vacuously true.
    expect(REACHABLE.length).toBeGreaterThan(25);
    expect(REACHABLE.map(repoPath)).toContain("src/finance-privacy.ts");
    expect(REACHABLE.map(repoPath)).toContain("src/finance-generate.ts");
  });

  for (const { name, pattern } of FORBIDDEN) {
    it(`contains no ${name}`, () => {
      expect(offendersFor(pattern)).toEqual([]);
    });
  }

  it("pulls in none of the market data clients", () => {
    // Those are the modules that call Yahoo and the news search. Finance must not be able to reach
    // them even indirectly: a Finance prompt is the owner's ledger, and it has nowhere else to go.
    expect(REACHABLE.map(repoPath).filter((file) => file.startsWith("src/market/"))).toEqual([]);
  });

  it("keeps the allowlist to the two modules that are meant to reach the gateway", () => {
    expect(ALLOWLIST.map((entry) => entry.file)).toEqual(["src/job-regen.ts", "src/knowledge-embed.ts"]);
    expect(ALLOWLIST.every((entry) => entry.why.length > 20)).toBe(true);
    expect(REACHABLE.map(repoPath)).toContain("src/job-regen.ts");
  });
});

// ---------------------------------------------------------------------------------------------
// Dynamic: what actually leaves when a Finance job runs
// ---------------------------------------------------------------------------------------------

/** Invented people, invented numbers. `99` is the province code reserved for fixtures. */
const SECRETS = [
  "Budi Santoso",
  "Siti Aminah",
  "3273010101900001",
  "9901011505880042",
  "081234567890",
  "budi@contoh.co.id",
];

const asked: Array<Record<string, unknown>> = [];
const ingested: WorkCard[] = [];
let draft = "";

vi.mock("./job-regen", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./job-regen")>();
  return {
    ...actual,
    collectJobAssistantText: async (options: Record<string, unknown>) => {
      asked.push(options);
      return draft;
    },
    collectJobAssistantRun: async (options: Record<string, unknown>) => {
      asked.push(options);
      return { text: draft, model: "stub-model" };
    },
  };
});

vi.mock("./knowledge-ingest", () => ({
  upsertWorkSource: async (_tenant: TenantContext, card: WorkCard) => {
    ingested.push(card);
    return { status: "skipped" as const, reason: "test" };
  },
  ingestWorkSource: () => {},
}));

const { parseFinanceFigures, regenerateFinanceSection } = await import("./finance-generate");

const tenant: TenantContext = {
  organizationId: "org",
  workspaceId: "ws-finance-egress",
  userId: "local",
  role: "owner",
};

const ITEMS = [
  {
    label: "Gaji Budi Santoso 081234567890",
    period: "Jan 2025",
    amount: 8500000,
    currency: "IDR",
    category: "opex",
  },
  { label: "Pendapatan", period: "2025", amount: 1250000000, currency: "IDR", category: "revenue" },
];

const BRIEF = {
  title: "Beban gaji Januari",
  sections: [
    { heading: "Beban", body: "Gaji 8500000.", metrics: [] },
    { heading: "Pendapatan", body: "Pendapatan 1250000000.", metrics: [] },
  ],
  assumptions: ["Angka Januari 2025."],
  computed: { metrics: [], tables: [] },
};

const attempts: string[] = [];
let realFetch: typeof globalThis.fetch;

/** Loopback is the owner's own desk; anything else is an escape and is recorded, then refused. */
function record(destination: string): never {
  attempts.push(destination);
  throw new Error(`egress blocked in test: ${destination}`);
}

beforeAll(() => {
  realFetch = globalThis.fetch;
  globalThis.fetch = ((input: unknown) => record(String(input))) as unknown as typeof fetch;
  vi.spyOn(http, "request").mockImplementation(((...args: unknown[]) => record(`http ${String(args[0])}`)) as never);
  vi.spyOn(https, "request").mockImplementation(((...args: unknown[]) => record(`https ${String(args[0])}`)) as never);
  vi.spyOn(net, "connect").mockImplementation(((...args: unknown[]) => record(`net ${String(args[0])}`)) as never);
});

afterAll(() => {
  globalThis.fetch = realFetch;
  vi.restoreAllMocks();
});

beforeEach(() => {
  asked.length = 0;
  ingested.length = 0;
  attempts.length = 0;
  draft = JSON.stringify({ heading: "Beban gaji", body: "Gaji 8500000 dari pendapatan 1250000000.", metrics: [] });
  vi.stubEnv("AGENTFORGE_RUNTIME", "ai");
});

afterEach(() => {
  vi.unstubAllEnvs();
});

function promptText(): string {
  return asked.map((call) => `${String(call.systemPrompt)}\n${String(call.prompt)}`).join("\n");
}

describe("a Finance run reaches nothing but the gateway", () => {
  it("attempts no socket of its own while parsing figures", async () => {
    draft = JSON.stringify({
      items: [{ label: "Gaji", period: "Jan 2025", amount: 8500000, currency: "IDR", category: "opex" }],
    });
    const parsed = await parseFinanceFigures(tenant, {
      figures: "Nama: Budi Santoso\nNIK: 3273010101900001\nGaji Januari: 8500000",
    });
    expect(attempts).toEqual([]);
    expect(parsed.items).toHaveLength(1);
    expect(parsed.pii.count).toBe(2);
  });

  it("hands the model a prompt with none of the fixture's personal data in it", async () => {
    draft = JSON.stringify({
      items: [{ label: "Gaji", period: "Jan 2025", amount: 8500000, currency: "IDR", category: "opex" }],
    });
    const parsed = await parseFinanceFigures(tenant, {
      figures: "Nama: Budi Santoso\nNIK: 3273010101900001\nEmail: budi@contoh.co.id\nGaji Januari: 8500000",
    });
    const sent = promptText();
    expect(SECRETS.filter((secret) => sent.includes(secret))).toEqual([]);
    expect(parsed.source).toBe("prose");
    expect(sent).toContain("8500000");
    expect(parsed.items.map((item) => item.amount)).toEqual([8_500_000]);
    expect(parsed.pii.count).toBe(3);
  });

  it("redacts the line-item labels a brief rewrite sends", async () => {
    await regenerateFinanceSection(tenant, {
      brief: BRIEF,
      sectionIndex: 0,
      prompt: "Beban gaji",
      items: ITEMS,
      artifactId: "artifact-egress",
    });
    expect(attempts).toEqual([]);
    const sent = promptText();
    expect(sent).toContain("Gaji Budi Santoso [phone]");
    expect(sent).not.toContain("081234567890");
    expect(sent).toContain("1250000000");
  });

  it("stores the redacted labels in the work card, not the originals", async () => {
    const result = await regenerateFinanceSection(tenant, {
      brief: BRIEF,
      sectionIndex: 0,
      prompt: "Beban gaji",
      items: ITEMS,
      artifactId: "artifact-egress",
    });
    expect(ingested).toHaveLength(1);
    const card = `${ingested[0]?.title}\n${ingested[0]?.prompt ?? ""}\n${ingested[0]?.body}`;
    expect(card).not.toContain("081234567890");
    expect(result.items[0]?.label).toBe("Gaji Budi Santoso [phone]");
    expect(result.pii.kinds).toEqual(["phone"]);
  });
});

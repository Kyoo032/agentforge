import {
  firstLiveId,
  isPickerHidden,
  mediaKind,
  modelPolicy,
  resolveChatWire,
  type MediaKind,
} from "@agentforge/core";
import type { PreferenceList } from "./lists";

/** The ids the gateway listed on one run, for the next run to diff against. */
export type CatalogSnapshot = {
  version: 1;
  generatedAt: string;
  /** Every id, of every kind. */
  ids: string[];
  chatIds: string[];
};

export type ChatRow = {
  id: string;
  /** The policy entry that answers for it, or `UNKNOWN`. */
  policyKey: string;
  known: boolean;
  wire: string;
  tier: string;
  /** Chat-kind by name but kept out of the picker (an embedding, rerank or OCR id). */
  hidden: boolean;
  price?: string;
};

export type ListRow = {
  wanted: string;
  status: "live" | "missing";
  liveId?: string;
  /** Chat lists only. */
  policyKey?: string;
  known?: boolean;
  price?: string;
};

export type DeltaRow = { id: string; kind: MediaKind; policyKey?: string; known?: boolean };

export type CatalogReport = {
  generatedAt: string;
  source: { dataDir: string; refreshed: boolean; probedAt?: string | undefined; error?: string | undefined };
  /** Every id the catalogue lists, of every kind, sorted: what the next run diffs against. */
  allIds: string[];
  counts: { total: number; chat: number; chatKnown: number; chatUnknown: number; chatHidden: number };
  chat: ChatRow[];
  /** Chat ids the picker shows that no policy entry matches: the ones worth probing. */
  unknownChat: string[];
  lists: Array<{
    name: string;
    kind: PreferenceList["kind"];
    rows: ListRow[];
    live: number;
    missing: number;
    unknown: number;
  }>;
  delta: { previousAt: string; added: DeltaRow[]; removed: DeltaRow[] } | null;
  /** What is said about prices: where they come from, or why there are none. */
  pricesNote: string;
};

export type CatalogInput = {
  generatedAt: Date;
  /** Every model the saved catalogue lists. */
  models: ReadonlyArray<{ id: string }>;
  lists: readonly PreferenceList[];
  source: CatalogReport["source"];
  priceOf?: ((id: string) => string | undefined) | undefined;
  pricesNote?: string | undefined;
  previous?: CatalogSnapshot | undefined;
};

const UNKNOWN = "UNKNOWN";

function sortedUnique(ids: readonly string[]): string[] {
  return [...new Set(ids)].sort();
}

function policyFacts(id: string): { policyKey: string; known: boolean } {
  const policy = modelPolicy(id);
  return { policyKey: policy.known ? policy.key : UNKNOWN, known: policy.known };
}

function chatRow(id: string, priceOf: CatalogInput["priceOf"]): ChatRow {
  const policy = modelPolicy(id);
  const resolved = resolveChatWire(undefined, id);
  const price = priceOf?.(id);
  return {
    id,
    ...policyFacts(id),
    wire: policy.wire === "auto" ? `auto:${resolved}` : policy.wire,
    tier: policy.tier,
    hidden: isPickerHidden(id),
    ...(price === undefined ? {} : { price }),
  };
}

function deltaRow(id: string): DeltaRow {
  const kind = mediaKind(id);
  return kind === "chat" ? { id, kind, ...policyFacts(id) } : { id, kind };
}

/** The ids in `next` that `previous` lacks, and the reverse. Pure. */
export function diffSnapshots(
  previous: Pick<CatalogSnapshot, "ids">,
  next: Pick<CatalogSnapshot, "ids">,
): { added: string[]; removed: string[] } {
  const before = new Set(previous.ids);
  const after = new Set(next.ids);
  return {
    added: sortedUnique(next.ids.filter((id) => !before.has(id))),
    removed: sortedUnique(previous.ids.filter((id) => !after.has(id))),
  };
}

export function buildCatalogReport(input: CatalogInput): CatalogReport {
  const allIds = sortedUnique(input.models.map((model) => model.id));
  const chatIds = allIds.filter((id) => mediaKind(id) === "chat");
  const chat = chatIds.map((id) => chatRow(id, input.priceOf));
  const unknownChat = chat.filter((row) => !row.known && !row.hidden).map((row) => row.id);

  const lists = input.lists.map((list) => {
    const pool = list.kind === "chat" ? chatIds : allIds;
    const rows = list.ids.map((wanted): ListRow => {
      const liveId = firstLiveId([wanted], pool);
      if (liveId === undefined) {
        return { wanted, status: "missing" };
      }
      const price = input.priceOf?.(liveId);
      return {
        wanted,
        status: "live",
        liveId,
        ...(list.kind === "chat" ? policyFacts(liveId) : {}),
        ...(price === undefined ? {} : { price }),
      };
    });
    return {
      name: list.name,
      kind: list.kind,
      rows,
      live: rows.filter((row) => row.status === "live").length,
      missing: rows.filter((row) => row.status === "missing").length,
      unknown: rows.filter((row) => row.status === "live" && row.known === false).length,
    };
  });

  const snapshot: Pick<CatalogSnapshot, "ids"> = { ids: allIds };
  const delta = input.previous
    ? (() => {
        const { added, removed } = diffSnapshots(input.previous, snapshot);
        return { previousAt: input.previous.generatedAt, added: added.map(deltaRow), removed: removed.map(deltaRow) };
      })()
    : null;

  return {
    generatedAt: input.generatedAt.toISOString(),
    source: input.source,
    allIds,
    counts: {
      total: allIds.length,
      chat: chat.length,
      chatKnown: chat.filter((row) => row.known).length,
      chatUnknown: unknownChat.length,
      chatHidden: chat.filter((row) => row.hidden).length,
    },
    chat,
    unknownChat,
    lists,
    delta,
    pricesNote: input.pricesNote ?? (input.priceOf ? "from the gateway's public price list, at group ratio 1" : "not shown"),
  };
}

export function snapshotOf(report: CatalogReport): CatalogSnapshot {
  return {
    version: 1,
    generatedAt: report.generatedAt,
    ids: sortedUnique(report.allIds),
    chatIds: report.chat.map((row) => row.id),
  };
}

const pad = (text: string, width: number) => (text.length >= width ? `${text} ` : text.padEnd(width));

function deltaLine(row: DeltaRow, sign: "+" | "-"): string {
  const policy = row.kind === "chat" ? (row.known ? `  policy ${row.policyKey}` : `  ${UNKNOWN}`) : "";
  return `  ${sign} ${pad(row.id, 40)} ${row.kind}${policy}`;
}

export function renderCatalogReport(report: CatalogReport): string {
  const lines: string[] = [];
  const { counts } = report;
  lines.push(`Model catalogue, ${report.generatedAt}`);
  lines.push(
    report.source.refreshed
      ? `  source: refreshed from the gateway just now (a scratch cache; the desk's own cache was not written)`
      : `  source: the saved cache in ${report.source.dataDir}${report.source.probedAt ? `, last probed ${report.source.probedAt}` : ""}`,
  );
  if (report.source.error) {
    lines.push(`  the last probe reported: ${report.source.error}`);
  }
  lines.push(`  data dir: ${report.source.dataDir}`);
  lines.push(`  prices: ${report.pricesNote}`);
  lines.push(
    `  ${counts.total} ids listed; ${counts.chat} chat (${counts.chatKnown} known to the policy table, ${counts.chatUnknown} ${UNKNOWN}, ${counts.chatHidden} hidden from the picker)`,
  );

  lines.push("", "CHAT IDS  (id, policy entry, wire, tier, price)");
  for (const row of report.chat) {
    const flags = row.hidden ? "  [hidden from picker]" : "";
    lines.push(`  ${pad(row.id, 44)} ${pad(row.policyKey, 18)} ${pad(row.wire, 34)} ${pad(row.tier, 9)}${row.price ?? ""}${flags}`.trimEnd());
  }

  lines.push("", `${UNKNOWN} to the policy table (probe these): ${report.unknownChat.length === 0 ? "none" : report.unknownChat.join(", ")}`);

  lines.push("", "PREFERENCE LISTS");
  for (const list of report.lists) {
    lines.push(`  ${list.name}  (${list.live} live, ${list.missing} missing${list.unknown ? `, ${list.unknown} ${UNKNOWN}` : ""})`);
    for (const row of list.rows) {
      if (row.status === "missing") {
        lines.push(`    MISSING  ${row.wanted}`);
        continue;
      }
      const spelling = row.liveId !== row.wanted ? `  (as ${row.liveId})` : "";
      const policy = list.kind === "chat" ? `  ${row.known ? row.policyKey : UNKNOWN}` : "";
      lines.push(`    LIVE     ${pad(row.wanted, 40)}${policy}${row.price ? `  ${row.price}` : ""}${spelling}`.trimEnd());
    }
  }

  lines.push("");
  if (report.delta === null) {
    lines.push("SINCE THE LAST RUN: no previous snapshot; this run is the baseline.");
  } else if (report.delta.added.length === 0 && report.delta.removed.length === 0) {
    lines.push(`SINCE THE LAST RUN (${report.delta.previousAt}): no change.`);
  } else {
    lines.push(`SINCE THE LAST RUN (${report.delta.previousAt}): ${report.delta.added.length} new, ${report.delta.removed.length} removed`);
    for (const row of report.delta.added) {
      lines.push(deltaLine(row, "+"));
    }
    for (const row of report.delta.removed) {
      lines.push(deltaLine(row, "-"));
    }
  }
  return `${lines.join("\n")}\n`;
}

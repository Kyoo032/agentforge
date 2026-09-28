import { parseAppLocale, type AppLocale } from "../locale";
import { withOutputLanguage } from "../output-language";
import type { KnowledgeMap, KnowledgeMapTopic } from "./rag";

/**
 * Knowledge harness checks.
 *
 * Read, file, and standing instructions already run in the host pipeline. These two
 * are the checks those skills do not do: a retrieve that found nothing must say so,
 * and a map must not keep a source id that is not indexed.
 */

const MISS: Record<AppLocale, string> = {
  en: "No saved source matched this question. Do not invent a citation or a source name.",
  id: "Tidak ada sumber tersimpan yang cocok dengan pertanyaan ini. Jangan mengarang kutipan atau nama sumber.",
};

/** Model instruction when a non-empty question retrieved no chunk. Desk language, knowledge surface. */
export function knowledgeMissBlock(locale: AppLocale): string {
  return withOutputLanguage(MISS[parseAppLocale(locale)], "knowledge", locale);
}

function readyAfter(map: KnowledgeMap, topics: KnowledgeMapTopic[]): boolean {
  if (map.source === "stub") {
    return topics.length > 0;
  }
  return topics.some((topic) => topic.verdict === "supported");
}

function rewriteTopics(
  map: KnowledgeMap,
  keep: (id: string) => boolean,
  dropAlreadyEmpty: boolean,
): KnowledgeMap {
  let changed = false;
  const topics: KnowledgeMapTopic[] = [];
  for (const topic of map.topics) {
    const sourceIds = topic.sourceIds.filter(keep);
    const idsChanged = sourceIds.length !== topic.sourceIds.length;
    if (sourceIds.length === 0 && (idsChanged || dropAlreadyEmpty)) {
      changed = true;
      continue;
    }
    if (idsChanged) {
      changed = true;
      topics.push({ ...topic, sourceIds });
    } else {
      topics.push(topic);
    }
  }
  if (!changed) {
    return map;
  }
  return { ...map, topics, ready: readyAfter(map, topics) };
}

/**
 * Remove ids that are gone. A topic that cited only those ids is dropped.
 * An unchanged map is returned as the same object.
 */
export function dropSourceIds(map: KnowledgeMap, gone: ReadonlySet<string>): KnowledgeMap {
  if (gone.size === 0) {
    return map;
  }
  return rewriteTopics(map, (id) => !gone.has(id), false);
}

/** Keep only source ids that are indexed. A topic with none left is dropped. */
export function groundKnowledgeMap(map: KnowledgeMap, knownSourceIds: ReadonlySet<string>): KnowledgeMap {
  return rewriteTopics(map, (id) => knownSourceIds.has(id), true);
}

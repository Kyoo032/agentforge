import { ApiError } from "@agentforge/core";
import type { DeckSlide, ExamPassage } from "@agentforge/university";
import { jsonError, jsonOk } from "../errors";
import {
  passagesFromKnowledge,
  runBookRead,
  runExamFromKnowledge,
  runPresenter,
  runTeachingDeck,
} from "../education/harness";
import { retrieveChunks } from "../knowledge";
import { localeForRun } from "../run-context";
import { getTenant } from "../tenant";
import type { HostRequest, HostResult } from "../types";

function topicFrom(body: unknown): string {
  if (!body || typeof body !== "object") {
    return "";
  }
  const topic = (body as { topic?: unknown }).topic;
  return typeof topic === "string" ? topic.slice(0, 200) : "";
}

/** Lesson, quiz, page, and show. None of these call the gateway. */
export async function handlePostEducationLesson(request: HostRequest): Promise<HostResult> {
  try {
    const topic = topicFrom(request.body);
    const locale = localeForRun();
    const run = runTeachingDeck(locale, topic);
    return jsonOk({ outline: run.outline, locale, ...run.language, harness: run.trace });
  } catch (error) {
    return jsonError(error);
  }
}

export async function handlePostEducationExam(request: HostRequest): Promise<HostResult> {
  try {
    const tenant = await getTenant(request);
    const topic = topicFrom(request.body);
    const locale = localeForRun();
    let passages: ExamPassage[] = [];
    try {
      const found = await retrieveChunks(tenant, topic || "lesson", 6);
      passages = passagesFromKnowledge(
        found.chunks.map((chunk) => ({
          sourceId: chunk.sourceId,
          sourceName: chunk.sourceName,
          body: chunk.body,
        })),
      );
    } catch {
      passages = [];
    }
    const run = runExamFromKnowledge(locale, topic, passages);
    return jsonOk({ ...run.exam, locale, ...run.language, harness: run.trace });
  } catch (error) {
    return jsonError(error);
  }
}

export async function handlePostEducationBook(request: HostRequest): Promise<HostResult> {
  try {
    const file = request.files?.find((item) => item.field === "file") ?? request.files?.[0];
    if (!file || file.bytes.byteLength === 0) {
      throw new ApiError("missing_file", "Choose a PNG page or a PDF", 400);
    }
    const locale = localeForRun();
    const run = await runBookRead(locale, { filename: file.filename || "page.bin", bytes: file.bytes });
    return jsonOk({ ...run.read, locale, ...run.language, harness: run.trace });
  } catch (error) {
    return jsonError(error);
  }
}

export async function handlePostEducationPresenter(request: HostRequest): Promise<HostResult> {
  try {
    const body = request.body && typeof request.body === "object" ? (request.body as { outline?: unknown }) : {};
    const outline =
      body.outline && typeof body.outline === "object" ? (body.outline as { title?: string; slides?: unknown }) : {};
    const slides: DeckSlide[] = Array.isArray(outline.slides)
      ? outline.slides.map((slide) => {
          const row = slide && typeof slide === "object" ? (slide as { heading?: unknown; bullets?: unknown }) : {};
          return {
            heading: typeof row.heading === "string" ? row.heading : "",
            bullets: Array.isArray(row.bullets)
              ? row.bullets.filter((bullet): bullet is string => typeof bullet === "string")
              : [],
          };
        })
      : [];
    const locale = localeForRun();
    const run = runPresenter(locale, { title: typeof outline.title === "string" ? outline.title : "", slides });
    return jsonOk({ ...run.plan, locale, ...run.language, harness: run.trace });
  } catch (error) {
    return jsonError(error);
  }
}

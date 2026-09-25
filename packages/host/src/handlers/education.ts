import { ApiError, outputLanguageRule } from "@agentforge/core";
import { draftExam, draftLesson, draftPresenter } from "@agentforge/university";
import { jsonError, jsonOk } from "../errors";
import { readBookFile } from "../education/read-book";
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

function languageFields() {
  const locale = localeForRun();
  return { locale, languageRule: outputLanguageRule("education", locale) };
}

/** Lesson, exam, book, and presenter. None of these call the gateway. */
export async function handlePostEducationLesson(request: HostRequest): Promise<HostResult> {
  try {
    const topic = topicFrom(request.body);
    const lang = languageFields();
    return jsonOk({ outline: draftLesson(lang.locale, topic), locale: lang.locale, languageRule: lang.languageRule });
  } catch (error) {
    return jsonError(error);
  }
}

export async function handlePostEducationExam(request: HostRequest): Promise<HostResult> {
  try {
    const tenant = await getTenant(request);
    const topic = topicFrom(request.body);
    const lang = languageFields();
    let passages: Array<{ name: string; text: string }> = [];
    try {
      const found = await retrieveChunks(tenant, topic || "lesson", 6);
      passages = found.chunks.map((chunk) => ({ name: chunk.sourceName || chunk.sourceId, text: chunk.body }));
    } catch {
      passages = [];
    }
    const exam = draftExam(lang.locale, topic, passages);
    return jsonOk({ ...exam, languageRule: lang.languageRule });
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
    const read = await readBookFile(locale, { filename: file.filename || "page.bin", bytes: file.bytes });
    return jsonOk({ ...read, locale, languageRule: outputLanguageRule("education", locale) });
  } catch (error) {
    return jsonError(error);
  }
}

export async function handlePostEducationPresenter(request: HostRequest): Promise<HostResult> {
  try {
    const body = request.body && typeof request.body === "object" ? (request.body as { outline?: unknown }) : {};
    const outline =
      body.outline && typeof body.outline === "object" ? (body.outline as { title?: string; slides?: unknown }) : {};
    const locale = localeForRun();
    const plan = draftPresenter(locale, {
      title: typeof outline.title === "string" ? outline.title : "",
      slides: Array.isArray(outline.slides) ? (outline.slides as Array<{ heading?: string; bullets?: string[] }>) : [],
    });
    return jsonOk({ ...plan, languageRule: outputLanguageRule("education", locale) });
  } catch (error) {
    return jsonError(error);
  }
}

import { z } from "zod";
import { promptTemplateById, type PromptTemplate } from "./prompt-templates";
import manifest from "./video-examples.json";

const FILE_NAME = /^[a-z0-9]+(-[a-z0-9]+)*\.mp4$/;
const KEBAB_CASE = /^[a-z0-9]+(-[a-z0-9]+)*$/;

const videoExampleSchema = z
  .object({
    /** File name inside the bundled examples folder. Never a path. */
    file: z.string().regex(FILE_NAME),
    /** Prompt template the clip was generated from; the card shows that prompt. */
    templateId: z.string().regex(KEBAB_CASE),
    /** Measured after encoding by scripts/video-examples.mjs; absent until the clip exists. */
    width: z.number().int().positive().optional(),
    height: z.number().int().positive().optional(),
    durationSeconds: z.number().positive().optional(),
    model: z.string().min(1).optional(),
    generatedAt: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  })
  .strict()
  .superRefine((example, ctx) => {
    if (!promptTemplateById(example.templateId)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: `unknown prompt template ${example.templateId}` });
    }
  });

const videoExamplesManifestSchema = z
  .object({
    version: z.literal(1),
    examples: z.array(videoExampleSchema).min(1),
  })
  .strict()
  .superRefine((value, ctx) => {
    const files = value.examples.map((example) => example.file);
    if (new Set(files).size !== files.length) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "example file names must be unique" });
    }
  });

export type VideoExample = z.infer<typeof videoExampleSchema>;
export type VideoExamplesManifest = z.infer<typeof videoExamplesManifestSchema>;

/** Bundled example clips for the Videos studio. Files live under the desktop `resources/examples/videos` folder. */
export const VIDEO_EXAMPLES: VideoExamplesManifest = videoExamplesManifestSchema.parse(manifest);

const EXAMPLES_BY_FILE = new Map(VIDEO_EXAMPLES.examples.map((example) => [example.file, example]));

export function videoExampleByFile(file: string): VideoExample | undefined {
  return EXAMPLES_BY_FILE.get(file);
}

export function videoExampleFileNames(): string[] {
  return VIDEO_EXAMPLES.examples.map((example) => example.file);
}

/** The template behind an example. Always defined because the manifest schema checks the id. */
export function videoExampleTemplate(example: VideoExample): PromptTemplate {
  const template = promptTemplateById(example.templateId);
  if (!template) {
    throw new Error(`video example ${example.file} points at unknown template ${example.templateId}`);
  }
  return template;
}

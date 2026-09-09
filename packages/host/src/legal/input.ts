/**
 * Legal mode — request body validation for the matter routes.
 *
 * Every body is parsed with zod at the boundary; the first issue becomes a 400 `invalid_request`
 * with the field path so the studio can show it next to the input.
 */

import { z } from "zod";
import { ApiError } from "@agentforge/core";
import { DELIVERABLE_KINDS, DOC_ROLES, LEGAL_CAPS, LEGAL_WORK_TYPES } from "@agentforge/core/legal";
import { assertSafeSourceText } from "../job-source";

export const LEGAL_TEXT_MAX = 200;
const ID_MAX = 80;
const MODEL_ID_MAX = 200;
const DOC_ID_PATTERN = /^S\d+$/;

const shortText = z
  .string()
  .trim()
  .min(1, "is required")
  .max(LEGAL_TEXT_MAX, `must be ${LEGAL_TEXT_MAX} characters or fewer`);
const optionalText = z.string().trim().max(LEGAL_TEXT_MAX, `must be ${LEGAL_TEXT_MAX} characters or fewer`);
const optionalId = z.string().trim().min(1, "is required").max(ID_MAX, "is malformed").nullable().optional();

const sideSchema = z.object({ role: shortText, party: shortText, counterparty: shortText });

const deliverablesSchema = z
  .array(z.enum(DELIVERABLE_KINDS))
  .min(1, "must list at least one deliverable")
  .transform((list) => Array.from(new Set(list)));

const instructionsSchema = z
  .string()
  .max(
    LEGAL_CAPS.maxInstructionChars,
    `must be ${LEGAL_CAPS.maxInstructionChars.toLocaleString()} characters or fewer`,
  );

export const createMatterBodySchema = z.object({
  title: shortText,
  side: sideSchema,
  workType: z.enum(LEGAL_WORK_TYPES),
  deliverables: deliverablesSchema,
  instructions: instructionsSchema.default(""),
  playbookId: optionalId,
  author: optionalText.default(""),
  addressee: optionalText.default(""),
  firm: optionalText.default(""),
  priorMatterId: optionalId,
});

export const rolesSchema = z
  .array(z.object({ id: z.string().regex(DOC_ID_PATTERN, "is not a document id"), role: z.enum(DOC_ROLES) }))
  .max(LEGAL_CAPS.maxFiles, `must list at most ${LEGAL_CAPS.maxFiles} documents`);

export const patchMatterBodySchema = z
  .object({
    title: shortText.optional(),
    side: sideSchema.optional(),
    workType: z.enum(LEGAL_WORK_TYPES).optional(),
    deliverables: deliverablesSchema.optional(),
    instructions: instructionsSchema.optional(),
    playbookId: optionalId,
    author: optionalText.optional(),
    addressee: optionalText.optional(),
    firm: optionalText.optional(),
    roles: rolesSchema.optional(),
  })
  .refine((value) => Object.values(value).some((entry) => entry !== undefined), { message: "nothing to update" });

export const runBodySchema = z.object({
  model: z.string().trim().max(MODEL_ID_MAX, "is malformed").optional(),
  verifierModel: z.string().trim().max(MODEL_ID_MAX, "is malformed").optional(),
});

export type CreateMatterBody = z.output<typeof createMatterBodySchema>;
export type PatchMatterBody = z.output<typeof patchMatterBodySchema>;
export type LegalRunBody = z.output<typeof runBodySchema>;

/** Parse a JSON body; the first zod issue becomes a user-facing 400 with its field path. */
export function parseLegalBody<S extends z.ZodTypeAny>(schema: S, body: unknown): z.output<S> {
  const result = schema.safeParse(body ?? {});
  if (result.success) {
    return result.data;
  }
  const issue = result.error.issues[0];
  const field = issue?.path.length ? issue.path.join(".") : "body";
  throw new ApiError("invalid_request", `${field} ${issue?.message ?? "is invalid"}`, 400);
}

/** Instructions go straight into the prompt, so they pass the same guard as pasted source material. */
export function assertSafeInstructions(instructions: string | undefined): void {
  if (instructions) {
    assertSafeSourceText(instructions);
  }
}

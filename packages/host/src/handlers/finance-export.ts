import { z } from "zod";
import { ApiError, type TenantContext } from "@agentforge/core";
import { financeBriefSchema, type FinanceBrief } from "@agentforge/core/artifacts";
import { financeReportFromBrief, financeReportFromMarkdown, type FinanceReport } from "@agentforge/core/finance";
import type { HostRequest, HostResult } from "../types";
import { requireArtifact } from "../artifacts";
import { jsonError } from "../errors";
import { financeTaskFromMeta, readStoredFinanceBrief } from "../finance-artifact";
import { readStoredFinanceReport } from "../finance-tasks/persist";
import { financeReportSchema, readPostedFinanceReport } from "../finance-tasks/report-schema";
import { DEFAULT_REPORT_FORMAT, renderReport } from "../renderers/registry";
import { REPORT_FORMATS } from "../renderers/types";
import { localeForRun } from "../run-context";
import { getTenant } from "../tenant";

const guardSchema = z.object({
  flagged: z.array(z.object({ section: z.number().int(), text: z.string() })).default([]),
  total: z.number().int().default(0),
});

/**
 * Either the result the studio still holds in memory - the same shape /finance/docx accepts - the
 * report a task built, or the id of a brief that was already saved. Nothing else: an export never
 * recomputes a number, it only re-renders one that was computed in code.
 *
 * `report` is what lets every task export through the same renderers: a cash-flow or ratio result
 * has no `FinanceBrief` behind it. It is untrusted input, so it is shaped and size-capped before a
 * renderer sees it.
 */
const exportRequestSchema = z.object({
  artifactId: z.string().trim().min(1).optional(),
  brief: financeBriefSchema.optional(),
  report: financeReportSchema.optional(),
  result: z.object({ brief: financeBriefSchema, guard: guardSchema.optional() }).optional(),
  format: z.enum(REPORT_FORMATS).default(DEFAULT_REPORT_FORMAT),
  task: z.string().trim().min(1).optional(),
  locale: z.enum(["id", "en"]).optional(),
});

type ExportRequest = z.infer<typeof exportRequestSchema>;

function readRequest(body: unknown): ExportRequest {
  // Size first: a malformed 40 MB report should be refused, not shaped.
  const posted = (body as { report?: unknown } | null)?.report;
  if (posted !== undefined) {
    readPostedFinanceReport(posted);
  }
  const parsed = exportRequestSchema.safeParse(body ?? {});
  if (!parsed.success) {
    throw new ApiError("invalid_request", "Export request is missing or malformed", 400);
  }
  return parsed.data;
}

/** The report to render, and the brief behind it when there is one - the document renderer reuses it. */
type ResolvedReport = { readonly report: FinanceReport; readonly brief?: FinanceBrief };

/**
 * A brief saved earlier. The structured brief the generate stored on the artifact is preferred -
 * it still carries the computed tables and the chart series - and an artifact saved before that
 * falls back to its markdown, which exports as prose.
 */
async function reportFromArtifact(
  request: HostRequest,
  artifactId: string,
  body: ExportRequest,
): Promise<ResolvedReport> {
  const tenant: TenantContext = await getTenant(request);
  const artifact = requireArtifact(tenant, artifactId);
  if (artifact.mode !== "finance") {
    throw new ApiError("invalid_request", "That artifact is not a finance brief", 400);
  }
  const locale = body.locale ?? localeForRun();
  const task = body.task ?? financeTaskFromMeta(artifact.meta);
  const storedReport = readStoredFinanceReport(artifact.meta);
  if (storedReport) {
    return { report: storedReport };
  }
  const stored = readStoredFinanceBrief(artifact.meta);
  if (stored) {
    return {
      report: financeReportFromBrief(stored.brief, { task, locale, guard: stored.guard }),
      brief: stored.brief,
    };
  }
  return { report: financeReportFromMarkdown(artifact.body, { title: artifact.title, task, locale }) };
}

async function resolveReport(request: HostRequest, body: ExportRequest): Promise<ResolvedReport> {
  // A task sends the report it is showing; the brief sends the brief. Whichever arrives is rendered
  // as it stands, so the screen and the file can never disagree about a number.
  if (body.report) {
    return { report: body.report };
  }
  const brief = body.result?.brief ?? body.brief;
  if (brief) {
    return {
      report: financeReportFromBrief(brief, {
        task: body.task,
        locale: body.locale ?? localeForRun(),
        guard: body.result?.guard,
      }),
      brief,
    };
  }
  if (body.artifactId) {
    return reportFromArtifact(request, body.artifactId, body);
  }
  throw new ApiError("invalid_request", "Send the finance result or the id of a saved brief", 400);
}

/**
 * One report, every file type: Excel by default, PowerPoint, Word and Markdown beside it. The
 * older /finance/docx route stays exactly as it was.
 *
 * Deliberately NOT behind `requireGatewayAllowed()`: no path below reaches the gateway, and a
 * closed gate must never stop the owner getting their own figures out of their own machine.
 */
export async function handlePostFinanceExport(request: HostRequest): Promise<HostResult> {
  try {
    const body = readRequest(request.body);
    const { report, brief } = await resolveReport(request, body);
    const file = await renderReport(report, body.format, { brief });
    return {
      type: "bytes",
      status: 200,
      bytes: file.bytes,
      contentType: file.mime,
      filename: file.filename,
    };
  } catch (error) {
    return jsonError(error);
  }
}

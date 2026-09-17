/**
 * The brief's parse hook: the line-item read Finance has always done, unchanged.
 *
 * It is registered rather than special-cased so `/api/v1/finance/parse` has one dispatch and no
 * switch — the brief is simply the task whose parser already exists.
 */
import type { FinanceTaskParser } from "./types";
import { parseFinanceFigures } from "../finance-generate";

export const parseBriefInput: FinanceTaskParser = async (tenant, body) => parseFinanceFigures(tenant, body);

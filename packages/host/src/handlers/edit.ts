import { getEditDoctor } from "../edit/doctor";
import { jsonOk } from "../errors";
import type { HostResult } from "../types";

export async function handleGetEditDoctor(): Promise<HostResult> {
  return jsonOk(getEditDoctor());
}

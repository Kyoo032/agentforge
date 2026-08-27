import type { ContentPart } from "../content/types";
import type { InputModality, TenantContext } from "../tenancy/types";
import type { AgentVersionRecord, ToolBindingRecord } from "../agents/service";

export type RuntimeEvent =
  | { type: "run.started"; runId: string }
  | { type: "assistant.delta"; text: string }
  | { type: "assistant.thinking"; text: string }
  | { type: "tool.started"; toolKey: string; input: unknown }
  | { type: "tool.completed"; toolKey: string; output: unknown }
  | { type: "run.failed"; message: string }
  | { type: "run.completed"; runId: string };

export type AgentRuntime = {
  execute(input: {
    tenant: TenantContext;
    runId: string;
    modality: InputModality;
    version: AgentVersionRecord;
    bindings: ToolBindingRecord[];
    history: Array<{ role: "user" | "assistant"; parts: ContentPart[] }>;
    onEvent: (event: RuntimeEvent) => Promise<void> | void;
  }): Promise<void>;
};

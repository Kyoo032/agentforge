import type { ContentPart } from "../content/types";
import type { InputModality, TenantContext } from "../tenancy/types";
import type { AgentVersionRecord, ToolBindingRecord } from "../agents/service";
import type { ReasoningEffort } from "../models/reasoning-effort";
import type { StreamWatchdogLimits } from "./stream-watchdog";

export type RunUsage = {
  model: string;
  inputTokens: number;
  outputTokens: number;
};

export type RuntimeEvent =
  | { type: "run.started"; runId: string }
  | { type: "run.probing"; model: string; attempt: number; attempts: number; message: string }
  | { type: "assistant.delta"; text: string }
  | { type: "assistant.thinking"; text: string }
  | { type: "tool.started"; toolKey: string; input: unknown }
  | { type: "tool.completed"; toolKey: string; output: unknown }
  | { type: "run.failed"; message: string }
  | { type: "run.completed"; runId: string; usage?: RunUsage };

export type AgentRuntime = {
  execute(input: {
    tenant: TenantContext;
    runId: string;
    modality: InputModality;
    version: AgentVersionRecord;
    bindings: ToolBindingRecord[];
    history: Array<{ role: "user" | "assistant"; parts: ContentPart[] }>;
    /** When false, skip reasoning events (stub) and prefer reasoningEffort none (live). Default true. */
    thinking?: boolean;
    /** None skips reasoning. Default medium when omitted. */
    reasoningEffort?: ReasoningEffort;
    /**
     * Per-run stream watchdog limits, merged over the model defaults (a value
     * below the default is ignored). For long-prefill jobs that sit quiet
     * before the first token.
     */
    streamWatchdog?: Partial<StreamWatchdogLimits>;
    onEvent: (event: RuntimeEvent) => Promise<void> | void;
  }): Promise<void>;
};

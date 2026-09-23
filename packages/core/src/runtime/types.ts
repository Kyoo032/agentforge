import type { ContentPart } from "../content/types";
import type { InputModality, TenantContext } from "../tenancy/types";
import type { AgentVersionRecord, ToolBindingRecord } from "../agents/service";
import type { AppLocale } from "../locale";
import type { JobMode } from "../models/mode-defaults";
import type { ReasoningEffort } from "../models/reasoning-effort";
import type { ChatWire } from "./chat-wire";
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
     * Per-send POST path on the saved Endpoint URL.
     * `auto` keeps today's family pick (GPT-5 → Responses, else Completions).
     */
    wire?: ChatWire;
    /**
     * Per-run stream watchdog limits, merged over the model defaults (a value
     * below the default is ignored). For long-prefill jobs that sit quiet
     * before the first token.
     */
    streamWatchdog?: Partial<StreamWatchdogLimits>;
    /**
     * Boot UI locale. Chat stub replies and live system instructions follow this.
     * Default English when omitted.
     */
    locale?: AppLocale;
    /**
     * Set by the job runner (Finance, Documents, Market, ...). Jobs ask for strict JSON over
     * figures the host already computed, so a thinking model is told not to think. Chat leaves
     * this unset and keeps its own Thinking control.
     */
    jobMode?: JobMode;
    /**
     * The caller's cancel. Once it fires, the request in flight is aborted, no retry or further
     * contact attempt starts, and `execute` rejects with the signal's reason; no `run.failed` is
     * sent, because a cancel is not a model failure. A call the gateway had already finished may
     * still complete (so its usage is recorded). Omitted, the run behaves exactly as before.
     */
    signal?: AbortSignal;
    onEvent: (event: RuntimeEvent) => Promise<void> | void;
  }): Promise<void>;
};

# TokenKu AI Model Selection Guide (for agents)

**Gateway:** `https://api.tokenku.ai/v1` (legacy host `api.tokotokenai.com/v1`, same catalog) · **Catalog snapshot:** `v1-models.json`, 170 ids · **Research date:** 2026-09-13 · **Audience:** LLM agents and routers choosing a `model` id per task.

This document replaces the keyword heuristic ("if id contains `flash` → Fast drafts", etc.). Keywords misroute: `pro` puts `gpt-5.5-pro` (a slow, $30/$180 deep-reasoning tier) into "Long documents"; `flash` hides `gemini-3.5-flash` (a frontier-class model) in "Fast drafts"; `MiniMax-M3` is a cheap fast agentic model, not a deep-reasoning flagship; `Doubao Seed 1.6 Thinking` is not even in the catalog. Every claim below comes from vendor docs/pricing pages or reputable trackers (Artificial Analysis, OpenRouter) checked on the research date; anything not verifiable is marked **[unverified]**. Full per-model records with source URLs live in the companion `tokenku-models-catalog.json`.

## 0. How to use this document

1. Identify the **task class** (Section 1). Take the **primary** pick; fall back in order if it errors, is rate-limited, or is too slow/expensive for the job.
2. Set the **reasoning knob** for that model family (Section 3) — this matters more than the model choice for latency and cost.
3. Check the **hard constraints** table (Section 2) — context window, structured output, vision, deprecation — before committing to a model in a pipeline.
4. For anything not text-in/text-out (image, video, audio, embeddings, translation, GUI), go to Section 5.
5. Section 6 is the full 170-id index; Section 7 is the deprecation calendar; Section 8 is what was **not** verifiable.

Prices quoted are the **upstream vendor list price, USD per 1M tokens (input/output)**, used only for *relative* ranking. TokenKu bills its own rates (currently a flat −10% off the TokenKu base price for all models) — read the actual price from the TokenKu pricing page, not from here. Speed figures are third-party medians on the vendor's own API; the gateway adds proxy latency and may route some models through a different host than the vendor (see `owned_by` caveat in Section 2.2).

---

## 1. Routing table — task class → model

Columns: **Primary** = best default; **Fallback** = next best if primary is unavailable/too slow; **Budget** = cheapest acceptable; **Knob** = reasoning setting to send.

### 1.1 Everyday default (chat, summaries, drafting, Q&A, light analysis)

Balanced quality/latency/cost. This is the tier a general assistant should start on.

| Rank | Model id | Why | Knob |
|---|---|---|---|
| 1 | `gpt-5.6-terra` | 1.05M ctx, structured outputs, strong IF, $2/$12; the model OpenAI itself calls the everyday default | `reasoning.effort: "low"` for chat, `"medium"` (default) for analysis |
| 2 | `claude-sonnet-5` | 1M ctx, adaptive thinking on by default, literal instruction following, $2/$10 | `thinking.type: "disabled"` for chat, leave adaptive + `effort: "medium"` for analysis |
| 3 | `gemini-3.5-flash` | Frontier-class (beats 3.1 Pro on AA index), 1M ctx, omni input, ~210 tok/s, $1.50/$9 | `thinking_level: "low"` for chat (cannot be off) |
| 4 | `qwen3.7-plus` | 1M ctx, multimodal, $0.40/$1.60 | `enable_thinking: false` for chat |
| 5 | `MiniMax-M3` | 1M ctx, image+video in, $0.30/$1.20, ~88 tok/s | `thinking: "adaptive"` |
| 6 | `doubao-seed-2-1-turbo-260628` | Seed 2.1 quality at half Pro price, 256K in/out | `thinking.type: "disabled"` for chat |
| Budget | `gpt-5.6-luna` | $0.20/$1.20, 1.05M ctx, ~117 tok/s; small-tier quality | `reasoning.effort: "none"` or `"low"` |
| Budget | `glm-5.3-flash` | $0.15/$0.50, 1M ctx, vision, 320B/18B-active | `reasoning_effort: "low"` (thinking cannot be off) |

Do **not** use for this tier: any always-on-thinking frontier model (`gpt-6-astra`, `claude-fable-5-1`, `kimi-k3`, `qwen3.8-max`, `glm-5.3`) — 3–10x the cost and 2–5x the latency for no gain on everyday prompts.

### 1.2 Hard tasks / deep reasoning (multi-step analysis, math, hard debugging, planning, research synthesis)

Ordered by capability, then cost. All of these are slow (multi-second TTFT, minutes for Pro modes).

| Rank | Model id | Why | Knob |
|---|---|---|---|
| 1 | `gpt-6-astra` | Current OpenAI flagship (2026-09-03); $10/$50 ($20/$75 above 272K input); reasoning cannot be disabled | `reasoning.effort: "high"` → `"xhigh"` → `"max"` escalate only if needed |
| 2 | `claude-fable-5-1` | Anthropic's most capable GA model (2026-09-01); $10/$50; thinking always on; slower than Opus | `effort: "high"`; `"max"` for the hardest |
| 3 | `claude-opus-5` | Anthropic's recommended default for hard work; $5/$25; half Fable's price | `thinking.type: "adaptive"`, `effort: "high"` / `"xhigh"` |
| 4 | `gpt-5.6-sol` | 5.6 flagship, $4/$20 promo (list $5/$30 after 2026-11-21); has `reasoning.mode: "pro"` for parallel test-time compute at per-token rates | `effort: "high"`; `reasoning.mode: "pro"` replaces the old separate Pro model |
| 5 | `gemini-3.1-pro-preview` (or alias `gemini-3.1-pro`) | Google's top reasoning/agentic model; $2/$12 ($4/$18 above 200K); ~25 s TTFT at default high thinking | `thinking_level: "high"` (default) |
| 6 | `kimi-k3` | Largest open-weight (2.8T/104B active), 1M ctx, ties GLM-5.3 at top of open-weight AA index; slow (~37 tok/s), $3/$15 | `reasoning_effort: "high"` (always on) |
| 7 | `qwen3.8-max` | 2.4T MoE, Terminal-Bench 86.6, IFBench 82.8; $2/$6 but very verbose reasoning and ~38 tok/s | thinking on by default; `thinking_budget` to cap |
| 8 | `glm-5.3` | 753B/40B, 1M ctx, $1.40/$4.40; reasoning always on | `reasoning_effort` |
| 9 | `deepseek-v4-pro` | 1.6T/49B active, 1M ctx, 384K out, $1.32/$3.96 — cheapest frontier-scale reasoning in the catalog; text-only. DeepSeek announced (then retracted on 2026-09-10) a plan to route this id to V4.1-Flash; service and billing continue unchanged, but V4.1-Pro is expected to supersede it | `thinking.type: "enabled"`, `reasoning_effort: "high"`/`"max"` |
| Legacy Pro | `gpt-5.5-pro`, `gpt-5.4-pro` | $30/$180, no streaming, minutes per call; 5.4-pro has **no structured outputs**. Superseded by `gpt-5.6-sol` + `reasoning.mode: "pro"` | `effort: "high"`/`"xhigh"` only |

### 1.3 Fast & repeatable (classification, extraction, tagging, routing, short rewrites, high-QPS pipelines)

Priorities: low latency, low cost, deterministic format. **Turn thinking off** wherever the family allows it.

| Rank | Model id | Why | Knob |
|---|---|---|---|
| 1 | `gpt-5.6-luna` | $0.20/$1.20, ~117 tok/s, structured outputs, 1.05M ctx | `reasoning.effort: "none"` |
| 2 | `gemini-3.1-flash-lite` | $0.25/$1.50, ~300 tok/s, omni input, 1M ctx | `thinking_level: "minimal"` |
| 3 | `claude-haiku-4-5` | $1/$5, Anthropic's fastest; 200K ctx; no effort param, thinking off unless you send `budget_tokens` | leave thinking off |
| 4 | `qwen3.7-flash` | $0.03/$0.13 (≤32K input), 1M ctx, multimodal | `enable_thinking: false` |
| 5 | `glm-5.3-flash` | $0.15/$0.50, ~103 tok/s, vision; thinking cannot be disabled → use lowest effort | `reasoning_effort: "low"` |
| 6 | `doubao-seed-2-0-mini-260428` / `seed-2.0-mini` | $0.03/$0.28, very fast, audio+image input | `thinking.type: "disabled"` |
| 7 | `MiniMax-M3` | $0.30/$1.20, toggleable thinking, 1M ctx | `thinking: "disabled"` |
| 8 | `deepseek-v4-flash` | $0.30/$1.20; now resolves upstream to V4.1-Flash (552B/8B-16B active, vision) | `thinking.type: "disabled"` |
| Non-reasoning | `gpt-4.1-mini` ($0.40/$1.60), `gemini-2.5-flash-lite` ($0.10/$0.40), `gpt-4o-mini` ($0.15/$0.60) | No reasoning overhead at all — most predictable latency. Older generation, weaker on nuance. | n/a |
| Avoid | `gpt-5-mini`, `gpt-5-nano` | Shut down 2026-12-11. Migrate to `gpt-5.6-luna`. | — |

### 1.4 Strict instruction-following / structured output (schema-bound JSON, exact formats, rule-heavy system prompts, tool-call discipline)

What matters: literal instruction adherence, native structured-output support, tool-calling reliability. Ordered by adherence evidence.

| Rank | Model id | Evidence | Notes |
|---|---|---|---|
| 1 | `claude-opus-5` / `claude-sonnet-5` | Anthropic states 4.7+ models "take instructions literally"; strict tool use and structured outputs supported | 4.7+ tokenizer counts ~30% more tokens; non-default `temperature`/`top_p`/`top_k` return HTTP 400 |
| 2 | `gpt-5.6-terra` / `gpt-5.6-sol` | Full structured outputs + tool calling; OpenAI guidance says leaner system prompts work better on 5.6 | `reasoning.effort: "low"`–`"medium"` |
| 3 | `qwen3.8-max` | IFBench 82.8 (vendor-reported) | slow; use for hard rule-following, not volume |
| 4 | `qwen3.5-122b-a10b` | IFEval 93.4 (HF model card) — best documented IFEval in the catalog | open-weight, 262K ctx, $0.40/$3.20 |
| 5 | `gemini-3.5-flash` | Google positions it for "precise agentic tool use"; structured output supported | thinking cannot be off |
| 6 | `gpt-4.1` | Non-reasoning, explicitly marketed on instruction following (IFEval); 1M ctx, $2/$8 | best when you want *zero* reasoning variance |
| 7 | `kimi-k2.6` | 96.6% tool-invocation success reported (third-party); toggleable thinking | 256K ctx |
| Avoid | `gpt-5.4-pro` (no structured outputs), `qwen3.5-omni-plus/flash` non-realtime (no JSON mode, no tools), `qwen3-coder-flash` (no structured outputs internationally), `qwen3.5-ocr` (no JSON mode), Midjourney/Suno actions (not instruction-precise by design) | | |

### 1.5 Coding

**Interactive coding (single-shot generation, review, explain):**

| Rank | Model id | Why |
|---|---|---|
| 1 | `claude-opus-5` | Anthropic's default; literal IF; 1M ctx |
| 2 | `gpt-5.6-sol` | 5.6 flagship; `reasoning.mode: "pro"` available |
| 3 | `claude-sonnet-5` | Best price/quality for coding at $2/$10 |
| 4 | `gemini-3.5-flash` | Terminal-Bench 2.1 76.2% (vendor) at $1.50/$9 |
| 5 | `qwen3.6-27b` | Best open-weight coder in catalog (SWE-bench Verified 77.2, vendor); 27B dense, $0.60/$3.60 |

**Agentic coding (long tool loops, repo-scale edits, SWE-style tasks):**

| Rank | Model id | Why | Knob |
|---|---|---|---|
| 1 | `gpt-6-astra` | Flagship; strongest agentic loops | `effort: "high"` |
| 2 | `claude-opus-5` | 1M ctx, mid-conversation system messages (from 4.8), fast mode 2x price | adaptive, `effort: "high"` |
| 3 | `gpt-5.3-codex` | Codex-tuned, strong tool-call discipline, $1.75/$14, 400K ctx; `effort: none` not allowed | `effort: "medium"`+ |
| 4 | `glm-5.3` | ~50% coding gain over 5.2 (vendor), 1M ctx, $1.40/$4.40, tool_stream | always-on |
| 5 | `kimi-k2.7-code` | K2.6 post-trained for coding, thinking forced on, 30% fewer thinking tokens, $0.95/$4 | always-on |
| 6 | `deepseek-v4-flash` → V4.1-Flash | DeepSWE 74.2, Terminal-Bench 2.1 90.6 (vendor) at $0.30/$1.20 — best value agentic coder | `thinking.type: "enabled"` |
| 7 | `MiniMax-M2.7` / `MiniMax-M3` | Tool-calling focused ("Agent Teams"), $0.30/$1.20 | interleaved thinking |
| 8 | `doubao-seed-2-0-code-preview-260215` | Seed 2.0 Pro coding SKU; targets the Anthropic-Messages endpoint (Claude Code-style tooling) | preview — may be withdrawn |
| Subagent workers | `gpt-5.6-luna`, `claude-haiku-4-5`, `qwen3.6-35b-a3b`, `glm-5.3-flash` | Cheap workers for fan-out tasks under an orchestrator | thinking low/off |

Required for all tool loops on DeepSeek/GLM/Kimi/MiniMax: pass `reasoning_content` back in the assistant message between tool calls, or the API returns 400.

### 1.6 Long documents (>200K tokens of input)

Every model below has ≥1M context. Ordered by quality-per-dollar for large inputs; watch the long-context surcharges.

| Rank | Model id | Ctx | Long-input pricing note |
|---|---|---|---|
| 1 | `claude-opus-5` / `claude-sonnet-5` | 1M / 128K out | **Flat price, no long-context premium**; 300K-output batch beta |
| 2 | `gemini-3.5-flash` | 1,048,576 / 65,536 | Flat; cache $0.15 |
| 3 | `gpt-5.6-terra` / `gpt-5.6-sol` | 1.05M / 128K | >272K input → 2x input / 1.5x output for the whole request |
| 4 | `gemini-3.1-pro-preview` | 1,048,576 | >200K → $4/$18 |
| 5 | `MiniMax-M3` | 1,048,576 / 262,144 out | $0.30/$1.20; MSA sparse attention built for 1M ctx |
| 6 | `glm-5.3-flash` | 1,048,576 | $0.15/$0.50 — cheapest 1M with vision |
| 7 | `qwen3.7-plus` / `qwen3.7-flash` | 1M | Tiered by input length; >256K costs 3–4x |
| 8 | `gpt-5.6-luna` | 1.05M | $0.20/$1.20 — cheapest OpenAI 1M |
| 9 | `deepseek-v4-flash` | 1M / 384K out | $0.30/$1.20 |
| 10 | `kimi-k3`, `glm-5.3`, `qwen3.8-max` | 1M | for hard reading tasks only — slow |

**Not long-context (≤262K):** `claude-haiku-4-5` (200K), `claude-opus-4-5-20251101` (200K), `kimi-k2.6` / `kimi-k2.7-code` (256K), `MiniMax-M2.5` / `M2.7` (205K), all `seed-*` / `doubao-seed-*` (256K), all open-weight `qwen3.5-*b` / `qwen3.6-*b` (262K), `qwen3-max` (262K), `qwen3.6-max-preview` (262K), `gpt-4o` / `gpt-4o-mini` (128K), `gpt-oss-120b` (131K), `gpt-5-*`/`gpt-5.2`/`gpt-5.3-codex`/`gpt-5.4-mini`/`gpt-5.4-nano` (400K).

### 1.7 Translation

| Use | Model id | Notes |
|---|---|---|
| Default MT (incl. Indonesian) | `qwen-mt-flash` | Vendor-recommended general tier; $0.16/$0.49; 8,192-token input cap; `translation_options` param |
| Highest MT quality | `qwen-mt-plus` | $2.46/$7.37 |
| Cheapest / lowest latency | `qwen-mt-lite` | $0.12/$0.36; 31 languages |
| Deprecated | `qwen-mt-turbo` | "will not be updated — use flash" |
| Literary / nuanced / long | `claude-opus-5`, `gpt-5.6-terra`, `gemini-3.5-flash` | General LLMs; no input cap; better register/voice than MT models |
| Live speech interpretation | `qwen3.5-livetranslate-flash-realtime` (60 langs, ~2.8 s) · file-based: `qwen3-livetranslate-flash` (18 langs) | audio/video in |

### 1.8 Multimodal input (images, video, audio, documents)

| Need | Model id |
|---|---|
| Image + video + audio in one text model | `gemini-3.5-flash`, `gemini-3-flash`, `gemini-3.1-flash-lite` (omni) |
| Video input, cheap | `MiniMax-M3`, `glm-5.3-flash`, `kimi-k3`, `kimi-k2.6` |
| Audio input on a text model | `doubao-seed-2-0-lite-260428`, `doubao-seed-2-0-mini-260428` (native audio in); `qwen3.5-omni-*` |
| Vision + strong reasoning | `claude-opus-5`, `gpt-6-astra`, `gemini-3.1-pro-preview`, `qwen3.8-max` |
| OCR at volume | `qwen3.5-ocr` ($0.069/$0.275; no JSON mode) |
| GUI / computer-use grounding | `gui-plus` (screenshot → action JSON on 1000×1000 grid) |
| Text-only (no vision): | `gpt-oss-120b`, `glm-5.2`, `glm-5.3`, `deepseek-v4-pro`, `MiniMax-M2.5`/`M2.7`, `qwen3-max`, `qwen3.6-max-preview`, `qwen-flash`, `qwen-flash-character`, `qwen3-coder-flash` |

---

## 2. Hard constraints agents must check

### 2.1 Endpoint types (from `supported_endpoint_types` in `/v1/models`)

| Value | Meaning |
|---|---|
| `openai` | OpenAI-compatible `/v1/chat/completions` (and `/v1/responses` where the upstream supports it) |
| `anthropic` | Anthropic Messages-compatible `/v1/messages` — the gateway translates for non-Anthropic models. Use this for Claude-Code-style tooling |
| `gemini` | Google native `generateContent` schema |
| `image-generation` | `/v1/images/generations` |
| `openai-image-edit` | `/v1/images/edits` (only `gpt-image-2`, `gpt-image-2-count`) |
| `openai-video`, `seedance2-native-video` | Async video job endpoints (submit → poll) |

Text models exposing both `openai` and `anthropic` can be driven by either SDK. Realtime/omni/TTS/ASR/embedding/rerank/MT models expose `openai` only and use their vendor's non-chat schema behind it (WebSocket for `*-realtime`, `translation_options` for `qwen-mt-*`, `/v1/embeddings` for embeddings).

### 2.2 `owned_by` is a routing label, not the vendor

`owned_by=ali` means "served via Alibaba Cloud Model Studio" — that is where TokenKu sources DeepSeek, GLM 5.2, Kimi K2.x, MiniMax and Qwen. `owned_by=openai` is applied to `kimi-k3`, `glm-5.3`, `glm-5.3-flash`, `gpt-oss-120b`, Grok Imagine, HappyHorse, Midjourney, Suno, Veo and `nano-banana*` — none of which are OpenAI models. `owned_by=doubaovideo` / `volcengine` are the two ByteDance routes (CN Ark snapshot-pinned vs. BytePlus international alias); `mimo-v2.5-asr` is Xiaomi, mislabeled `volcengine`. Consequences: upstream-only behaviours (e.g. DeepSeek's V4-Pro → V4.1-Flash remap, Alibaba region-locked features like function calling on `qwen3-coder-flash`) may or may not apply on TokenKu's route — **[unverified]** per model; test before relying on it.

### 2.3 Alias vs pinned snapshot

| Pattern | Examples | Behaviour |
|---|---|---|
| Dated snapshot (pinned weights) | `claude-haiku-4-5-20251001`, `claude-opus-4-5-20251101`, `doubao-seed-2-1-pro-260628`, `qwen3-omni-flash-2025-12-01`, `doubao-seedream-4-5-251128` | Never changes. Use in production pipelines. |
| Dateless Anthropic 4.6+ ids | `claude-opus-5`, `claude-sonnet-5`, `claude-fable-5-1` … | Also pinned — Anthropic dropped date suffixes; each id is a fixed snapshot. |
| Alias → latest snapshot | `claude-haiku-4-5` (→ `-20251001`), `seed-2.0-pro`/`-lite`/`-mini` (→ latest `doubao-seed-2-0-*`), `gemini-3-flash` (→ `gemini-3-flash-preview`), `gemini-3.1-pro` (→ `gemini-3.1-pro-preview`), `nano-banana*`, `veo_3_1*` | May change silently when upstream updates. |
| Upstream-remapped | `deepseek-v4-flash` (→ V4.1-Flash since 2026-09-10) | The id no longer serves the named model upstream. (`deepseek-v4-pro` was slated for the same remap on 2026-09-14; DeepSeek retracted that — it keeps serving V4-Pro at unchanged billing.) |
| Gateway-only ids (no upstream match) | `gpt-image-2-count`, `dreamina-seedance-2-0-ep`, `dreamina-seedance-2-0-fast-ep`, `mj_upsample_action`, `omni-fast`, `omni-fast-v2v`, `glm-5.2-fast-preview` (Model Studio only) | Behaviour inferred, see Section 8. |

### 2.4 Structured output / tool calling support (text models)

- **Full native structured outputs + tools:** all OpenAI GPT-5.x/6 text models except `gpt-5.4-pro`; all Claude; all Gemini text; Qwen hosted plus/flash/max; DeepSeek, GLM, Kimi, MiniMax; Seed 2.x.
- **Tools but no JSON-schema mode:** `qwen3.5-omni-*-realtime`, `qwen-audio-3.0-realtime-*`.
- **Neither:** `qwen3.5-omni-plus`/`-flash` (non-realtime), `qwen3.5-ocr`, `qwen-mt-*`, media models.
- **Region-locked upstream (Beijing-only function calling):** `qwen3-coder-flash`, `qwen-flash` — [unverified] on TokenKu.
- **Sampling params rejected:** Claude 4.7+ (incl. Sonnet 5, Opus 5, Fable) return 400 on non-default `temperature`/`top_p`/`top_k`. Don't send them.
- **Streaming not supported:** `gpt-5.4-pro`, `gpt-5.5-pro`. **Streaming required:** all `qwen*-omni*` calls.
- **Forced `tool_choice` broken:** `claude-fable-5-1` (per Anthropic release notes) — use auto tool choice.

---

## 3. Reasoning / thinking knobs by family

This is the single most important thing to get right. Same model, wrong knob = 3–10x cost and latency.

| Family | Parameter | Values | Default | Can be fully off? |
|---|---|---|---|---|
| OpenAI GPT-5.4 | `reasoning.effort` | `none`, `low`, `medium`, `high`, `xhigh` | `none` | yes |
| OpenAI GPT-5.5 / 5.6 | `reasoning.effort` (+ 5.6: `reasoning.mode: standard|pro`) | `none`, `low`, `medium`, `high`, `xhigh`, (5.6: `max`) | `medium` | yes |
| OpenAI GPT-6 Astra | `reasoning.effort` | `low`, `medium`, `high`, `xhigh`, `max` | `medium` | **no** — `none` → HTTP 400 |
| OpenAI GPT-5.3-Codex, 5.4-pro, 5.5-pro | `reasoning.effort` | `low`(codex)/`medium`…`xhigh` | — | no |
| OpenAI GPT-5-mini/nano | `reasoning.effort` | `minimal`, `low`, `medium`, `high` | — | `minimal` only |
| OpenAI GPT-4o, 4.1 | — | non-reasoning | — | n/a |
| gpt-oss-120b | system prompt line `Reasoning: low|medium|high` | — | medium | no |
| Claude Haiku 4.5, Opus 4.5 | `thinking: {type: "enabled", budget_tokens: N}` | manual budget | off | yes (omit) — Haiku has **no** effort param |
| Claude Opus 4.6/4.7/4.8, Sonnet 4.6 | `thinking: {type: "adaptive"}` + `effort` | `low`, `medium`, `high`, `max` (4.7+: `xhigh`) | **off** unless sent | yes |
| Claude Opus 5, Sonnet 5 | `thinking` (adaptive) + `effort` | `low`, `medium`, `high`, `xhigh`, `max` | **on** | Sonnet 5: yes (`type: "disabled"`); Opus 5: only at `effort ≤ high` |
| Claude Fable 5 / 5.1 | `effort` | `low`…`xhigh` (5.1 adds `max`) | on | **no** |
| Gemini 2.5 Pro | `thinking_budget` 128–32768 / `thinking_level` | — | on | **no** |
| Gemini 2.5 Flash / Flash-Lite | `thinking_budget` (0 = off) | — | Flash on, Lite off | yes |
| Gemini 3.x / 3.5 | `thinking_level` | `minimal`(3 Flash, 3.5 Flash, 3.1 Lite), `low`, `medium`, `high` | 3.1 Pro/3 Flash: `high`; 3.5 Flash: `medium` | **no** |
| Qwen3.5 / 3.6 / 3.7 / 3.8 (hosted + open) | `enable_thinking`, `thinking_budget` (3.6+: `preserve_thinking`) | bool / int | **on** | yes |
| Qwen3-max, qwen-flash | `enable_thinking` | bool | **off** | yes |
| DeepSeek V4 | `thinking: {type}` + `reasoning_effort` | `enabled`/`disabled`; `low`, `high`, `max` | on (high) | yes |
| GLM-5.2, 5.2-fast-preview | `thinking: {type}` | `enabled`/`disabled` | on | yes |
| GLM-5.3, 5.3-flash | `reasoning_effort` | `low`…`high` | on | **no** |
| Kimi K2.6 | `thinking: {type}` | `enabled`/`disabled` | on | yes |
| Kimi K2.7-Code, K3 | `reasoning_effort` | — | on | **no** |
| MiniMax M2.5 / M2.7 | interleaved `<think>` | — | on | no (in practice) |
| MiniMax M3 | `thinking` | `enabled`, `adaptive`, `disabled` | enabled | yes |
| Seed 1.6 / 1.8 | `thinking: {type}` | `enabled`, `disabled`, `auto` (+1.8: `reasoning_effort`) | auto/enabled | yes |
| Seed 2.0 / 2.1 | `thinking: {type}` + `reasoning_effort` | `enabled`/`disabled`; `minimal`, `low`, `medium`, `high` | 2.1: enabled + high | yes |

Reasoning/thinking tokens bill as **output** tokens everywhere. Models where thinking is always on (`gpt-6-astra`, Fable, Gemini 3.x, GLM-5.3, Kimi K2.7/K3) have a floor cost per call that makes them wrong for high-QPS work regardless of list price.

---

## 4. Families — lineage, tiers, and when to pick each

Generation labels: **latest** = newest in its line and in catalog · **current** = still the right choice for its tier · **previous-gen** = superseded but served · **legacy** = old generation, use only for compatibility · **deprecated** = has a shutdown date · **preview** = may change or vanish.

### 4.1 OpenAI (19 text ids)

Lineage: GPT-4o (2024-05) → GPT-4.1 (2025-04, 1M ctx, non-reasoning) → GPT-5 mini/nano (2025-08) → GPT-5.2 (2025-12) → GPT-5.3-Codex (2026-02) → GPT-5.4 family (2026-03, first 1.05M ctx) → GPT-5.5 / 5.5 Pro (2026-04) → **GPT-5.6 Sol / Terra / Luna** (2026-07, official three-tier naming; Luna price cut 80%) → **GPT-6 Astra** (2026-09-03, flagship).

| Tier | Id | Gen | Size | Ctx / Out | $/1M in/out | Speed | Pick when |
|---|---|---|---|---|---|---|---|
| Flagship | `gpt-6-astra` | latest | frontier | 1.05M / 128K | 10 / 50 (20/75 >272K) | slow (~58 tok/s); 2x-price fast mode | Sol measurably falls short |
| Flagship-1 | `gpt-5.6-sol` | current | frontier | 1.05M / 128K | 4 / 20 promo → 5/30 after 2026-11-21 | medium | Hard work at lower cost than Astra; `reasoning.mode: pro` |
| Everyday | `gpt-5.6-terra` | current | large | 1.05M / 128K | 2 / 12 | medium-fast | **Default** |
| Small | `gpt-5.6-luna` | current | small | 1.05M / 128K | 0.20 / 1.20 | fast (~117 tok/s) | Volume, subagents; replaces 5.4-mini and 5.4-nano |
| Prev flagship | `gpt-5.5` | previous-gen | frontier | 1.05M / 128K | 5 / 30 | medium | Pinned pipelines only |
| Prev Pro | `gpt-5.5-pro`, `gpt-5.4-pro` | previous-gen | frontier | 1.05M / 128K | 30 / 180 | very slow, no streaming | Legacy; 5.4-pro lacks structured outputs |
| Prev | `gpt-5.4` | previous-gen | frontier | 1.05M / 128K | 2.50 / 15 | medium | Default effort `none` — cheap non-reasoning use |
| Prev small | `gpt-5.4-mini`, `gpt-5.4-nano` | previous-gen | medium / tiny | 400K / 128K | 0.75/4.50 · 0.20/1.25 | fast / very fast | Luna is cheaper and newer |
| Codex | `gpt-5.3-codex` | previous-gen | frontier | 400K / 128K | 1.75 / 14 | medium | Agentic coding tools; no `none` effort |
| Legacy | `gpt-5.2` | legacy | frontier | 400K / 128K | 1.75 / 14 | medium | Compat only |
| Deprecated | `gpt-5-mini`, `gpt-5-nano` | shutdown 2026-12-11 | medium / tiny | 400K | 0.25/2 · 0.05/0.40 | fast | Migrate now |
| Non-reasoning | `gpt-4.1`, `gpt-4.1-mini` | legacy | large / medium | 1,047,576 / 32K | 2/8 · 0.40/1.60 | fast | Zero-reasoning IF workloads |
| Legacy | `gpt-4o`, `gpt-4o-mini` | legacy | large / small | 128K / 16K | 2.50/10 · 0.15/0.60 | fast | Compat only |
| Open-weight | `gpt-oss-120b` | current | 117B MoE / 5.1B active | 131K / 131K | not on api.openai.com — third-party host [unverified] | very fast on good hosts | Data-residency / self-host parity |

Notes: all 1.05M models charge 2x input / 1.5x output for the **whole request** once input exceeds 272K. Batch/flex −50%; priority/fast +100%. "Astra Pro" exists in ChatGPT only, not the API.

### 4.2 Anthropic Claude (11 ids)

Lineage: Haiku 4.5 (2025-10) · Opus 4.5 (2025-11, 200K) → Opus 4.6 (2026-02, first 1M/128K, adaptive thinking) → Sonnet 4.6 (2026-02) → Opus 4.7 (2026-04, xhigh/max effort, new tokenizer, literal IF) → Opus 4.8 (2026-05, fast mode, mid-conversation system messages) → Fable 5 (2026-06, new tier above Opus) → **Sonnet 5** (2026-06-30) → **Opus 5** (2026-07-24) → **Fable 5.1** (2026-09-01).

| Tier | Id | Gen | Ctx / Out | $/1M | Latency (Anthropic label) | Pick when |
|---|---|---|---|---|---|---|
| Top | `claude-fable-5-1` | latest | 1M / 128K | 10 / 50 (cache read 0.25) | Slower | Opus 5 at high effort falls short. Thinking always on. Forced `tool_choice` broken. |
| Top-prev | `claude-fable-5` | previous-gen | 1M / 128K | 10 / 50 | Slower | Never for new work — dominated by Opus 5 (half price) and Fable 5.1 (same price, `max` effort, cheaper cache) |
| Flagship | `claude-opus-5` | latest | 1M / 128K | 5 / 25 | Moderate; fast mode 2x price | **Anthropic's recommended default for most workloads** |
| Mid | `claude-sonnet-5` | latest | 1M / 128K | 2 / 10 | Fast | Everyday default, coding at value; dominates Sonnet 4.6 |
| Small | `claude-haiku-4-5` = `claude-haiku-4-5-20251001` | current | 200K / 64K | 1 / 5 | Fastest | Volume; no effort param; retirement not before 2026-10-15 (nearest horizon) |
| Legacy Opus | `claude-opus-4-8`, `-4-7`, `-4-6` | previous-gen | 1M / 128K | 5 / 25 | Moderate | Pinned pipelines; 4.7/4.8 share Opus 5's literal IF; 4.6 is looser |
| Legacy Opus | `claude-opus-4-5-20251101` | legacy | 200K / 64K | 5 / 25 | Moderate | Retirement not before 2026-11-24; manual thinking only |
| Legacy Sonnet | `claude-sonnet-4-6` | previous-gen | 1M / 128K | 3 / 15 | Fast | Sonnet 5 is cheaper and better |

Notes: flat pricing at 1M (no long-context surcharge). 4.7+ tokenizer yields ~30% more tokens for the same text — budget accordingly when migrating from 4.6. 4.7+ reject non-default sampling params. Opus 5 cache minimum 512 tokens. Fable = "Mythos-class model made safe for general use"; Mythos itself is invite-only and not on this gateway.

### 4.3 Google Gemini (19 ids incl. image/video/embedding)

Lineage (text): 2.5 Pro / Flash / Flash-Lite (2025-06/07; Jan-2025 knowledge cutoff; no shutdown date) → 3 Flash (2025-12, preview id) → 3.1 Pro (2026-02, preview) · 3.1 Flash-Lite (2026-03, stable) → **3.5 Flash** (2026-05-19). Google has since shipped 3.5 Flash-Lite, 3.6/3.7/3.8 Flash — **not on this gateway**.

| Tier | Id | Gen | $/1M | Speed | Thinking | Pick when |
|---|---|---|---|---|---|---|
| Best overall | `gemini-3.5-flash` | current | 1.50 / 9 | ~210 tok/s, TTFT ~15 s incl. thinking | `minimal`–`high`, default medium | Quality + speed; beats 3.1 Pro on AA index at ~2x speed |
| Top reasoning | `gemini-3.1-pro-preview` / `gemini-3.1-pro` (alias) | preview | 2 / 12 (4/18 >200K) | ~108 tok/s, TTFT ~25 s | `low`–`high`, default high | Hardest reasoning/agentic coding |
| Value | `gemini-3-flash` (→ `-preview`) | previous-gen | 0.50 / 3 | fast | default high | Gemini-3-class at lowest price |
| Cheap/fast | `gemini-3.1-flash-lite` | current | 0.25 / 1.50 | ~300 tok/s | `minimal` ok | Volume, omni input at 1M ctx |
| Legacy | `gemini-2.5-pro` | previous-gen | 1.25 / 10 | slow | cannot disable | Legacy pipelines only |
| Legacy | `gemini-2.5-flash`, `gemini-2.5-flash-lite` | previous-gen | 0.30/2.50 · 0.10/0.40 | fast / very fast | Flash: budget 0 = off; Lite: off by default | Only when you need thinking **fully off** on Gemini |

All Gemini text models: 1,048,576 in / 65,536 out, omni input (image, video, audio, PDF). Image/video/embedding ids in Section 5.

### 4.4 Alibaba Qwen (45 ids; 24 text/VLM + 21 other modalities)

Lineage (hosted text): Qwen3 (`qwen3-max`, `qwen-flash`, 2025 — thinking **off** by default) → Qwen3.5 (2026-02/03; new hybrid Gated-DeltaNet + MoE, native vision, 201 languages, thinking **on** by default) → Qwen3.6 (2026-04) → Qwen3.7 (2026-05/07) → **Qwen3.8 Max** (2026-08-03). Tiers: **max** (frontier, slow, expensive) > **plus** (large, balanced) > **flash** (small, cheapest). Open-weight (Apache-2.0, 262K ctx) ids are the `*-Nb` / `*-Nb-aNb` ids.

| Tier | Id | Gen | Size | Ctx / Out | $/1M | Speed | Pick when |
|---|---|---|---|---|---|---|---|
| Max | `qwen3.8-max` | latest | 2.4T MoE | 1M / 131K | 2 / 6 | slow (~38 tok/s), verbose | Hardest tasks; IFBench 82.8, Terminal-Bench 86.6 |
| Max-prev | `qwen3.7-max` | previous-gen | frontier | 1M / 131K | 2.50 / 7.50 | fast (~152 tok/s) | When you need max-tier quality **fast** — 4x faster than 3.8 |
| Max-preview | `qwen3.6-max-preview` | preview | ~1T, text-only | 262K / 64K | 1.30 / 7.80 | medium | Avoid — no GA ever shipped; lower limits |
| Plus | `qwen3.7-plus` | latest | large | 1M / 131K | 0.40 / 1.60 | ~67 tok/s | **Qwen default**; multimodal |
| Plus-prev | `qwen3.6-plus`, `qwen3.5-plus` | previous-gen | large | 1M / 64K | 0.50/3 · 0.40/2.40 | medium | Pinned only |
| Flash | `qwen3.7-flash` | current | small | 1M / 131K | 0.03 / 0.13 (≤32K) | fast | Volume; cheapest 1M model in catalog |
| Flash-prev | `qwen3.6-flash`, `qwen3.5-flash` | previous-gen | small | 1M / 64K | 0.25/1.50 · 0.10/0.40 | fast | Pinned only |
| Open, largest | `qwen3.5-397b-a17b` | current | 397B / 17B active | 262K / 64K | 0.60 / 3.60 | medium | Self-host parity at the top |
| Open, IF | `qwen3.5-122b-a10b` | current | 122B / 10B | 262K / 64K | 0.40 / 3.20 | medium | IFEval 93.4 — strict IF on open weights |
| Open, coder | `qwen3.6-27b` | current | 27B dense | 262K / 64K | 0.60 / 3.60 | medium | Best open coder (SWE-bench V 77.2) |
| Open, small | `qwen3.6-35b-a3b`, `qwen3.5-35b-a3b`, `qwen3.5-27b` | current / prev | 3B active / 27B | 262K | ~0.25/1.50 · 0.25/2 · 0.30/2.40 | fast | Cheap workers with self-host parity |
| Legacy | `qwen3-max` | legacy | >1T, text-only | 262K | 1.20 / 6 [unverified] | medium | No — superseded twice |
| Legacy | `qwen-flash` | legacy | small, text-only | 1M / 32K | 0.05 / 0.40 | very fast | No — use `qwen3.7-flash` |
| Niche | `qwen-flash-character` | current | small | 32K | 0.05 / 0.40 | very fast | Persona/role-play consistency; no thinking |
| Coder | `qwen3-coder-flash` | legacy | 30B / 3B active, non-thinking | 1M / 64K | 0.30 / 1.50 | very fast | Fast code completion only; 3.6/3.7 general models beat it; no structured outputs intl. |

Notes: pricing is **tiered by input length** on 3.6+ (>256K input costs 3–4x). Open-weight hosted ids have no context caching, 600 RPM caps, and are **not cheaper** than `qwen3.7-plus` — choose them only for weight parity with a self-hosted deployment. Reasoning returns in `reasoning_content`.

### 4.5 DeepSeek (2 ids, `owned_by=ali`)

V4 (2026-04-24, MIT): **V4-Pro** 1.6T/49B active, **V4-Flash** 284B/13B active; both 1M ctx, 384K out, text-only, thinking on by default. 2026-09-10: **V4.1-Flash** (552B, 8B/16B active, native vision) shipped as `deepseek-flash`; `deepseek-v4-flash` became a legacy alias routed to it. DeepSeek first announced that `deepseek-v4-pro` would also be routed to V4.1-Flash from 2026-09-14, then retracted it in the same 2026-09-10 changelog: V4-Pro API service continues with billing unchanged until V4.1-Pro ships.

| Id | Effective model (upstream) | $/1M | Pick when |
|---|---|---|---|
| `deepseek-v4-flash` | V4.1-Flash (vision, DeepSWE 74.2, Terminal-Bench 2.1 90.6) | 0.30 / 1.20 | Best-value agentic coding; budget everyday |
| `deepseek-v4-pro` | V4-Pro (0813 checkpoint) — retraction confirmed; V4.1-Pro announced, not shipped | 1.32 / 3.96 | Cheapest frontier-scale deep reasoning; text-only; plan a migration path to V4.1-Pro when it lands |

### 4.6 Zhipu GLM (4 ids)

GLM-5.2 (2026-06-16, 753B/40B, 1M, MIT, thinking toggleable) → **GLM-5.3** (2026-08-14 per launch coverage; Z.ai release notes date the entry 2026-08-18; same base, post-training only, ~50% better coding, thinking always on, same $1.40/$4.40) · **GLM-5.3-Flash** (2026-08-26, a genuinely smaller 320B/18B multimodal model, $0.15/$0.50). `glm-5.2-fast-preview` = same GLM-5.2 checkpoint on faster hardware, 1.5–2x TPS at ~3x price (Model Studio only).

| Id | Pick when |
|---|---|
| `glm-5.3` | Frontier open-weight agentic coding / hard tasks at mid price; reasoning always on |
| `glm-5.3-flash` | Cheapest 1M-ctx vision model with strong tools; everyday budget |
| `glm-5.2` | Only if you need thinking **off** on a GLM (5.3 can't) |
| `glm-5.2-fast-preview` | Latency-sensitive agent loops where 5.2-quality matters more than 3x cost; preview |

### 4.7 Moonshot Kimi (3 ids)

K2.6 (2026-04, 1T/32B, 256K, vision, thinking toggleable, $0.95/$4) → K2.7-Code (2026-06, K2.6 post-trained for code, thinking forced on, 30% fewer thinking tokens, same price) → **K3** (2026-07, 2.8T/104B, 1M ctx, always-on thinking, $3/$15, custom license with >$20M-revenue clause).

| Id | Pick when |
|---|---|
| `kimi-k3` | Top open-weight capability (ties GLM-5.3 on AA); hard tasks with 1M ctx; accept ~37 tok/s |
| `kimi-k2.7-code` | Agentic coding at $0.95/$4; 256K |
| `kimi-k2.6` | General everyday/agentic at $0.95/$4 with thinking off option; 96.6% tool-call success (third-party) |

### 4.8 MiniMax (3 ids)

M2.5 (2026-02, legacy) → M2.7 (2026-03, ~230B/10B, 205K, text-only) → **M3** (2026-06, 428B/23B, 1M ctx, image+video in, toggleable thinking). All $0.30/$1.20.

| Id | Pick when |
|---|---|
| `MiniMax-M3` | Everyday budget, long docs, video input, agent loops — the only reason to pick M2.x is a pinned pipeline. Note >512K input bills $0.60/$2.40 |
| `MiniMax-M2.7` | Text-only tool-calling agents ("Agent Teams"); 205K |
| `MiniMax-M2.5` | Legacy — MiniMax lists it under "Legacy models" |

### 4.9 ByteDance Seed (12 text ids, two routes)

Lineage: Seed 1.6 (2025-06, ~230B/23B, 256K, `thinking: auto`) → 1.8 (2025-12, effort levels, 1280-frame video) → 2.0 (2026-02-14: **pro / lite / mini / code-preview**, snapshot 260215; lite & mini re-snapshotted **260428** with native audio input) → **2.1** (2026-06-23: **pro** and new **turbo**, snapshot 260628, 256K in / 256K out, flat pricing). Un-suffixed `seed-x.y` ids are BytePlus international aliases resolving to the latest snapshot; `doubao-*-YYMMDD` are pinned CN Ark snapshots.

| Tier | Id | Gen | Ctx / Out | $/1M (converted from CNY) | Pick when |
|---|---|---|---|---|---|
| Flagship | `doubao-seed-2-1-pro-260628` | latest | 256K / 256K | 0.83 / 4.14 | Hardest coding/agent tasks on Seed |
| Volume flagship | `doubao-seed-2-1-turbo-260628` | latest | 256K / 256K | 0.41 / 2.07 | **Seed default** — vendor says comparable to Pro at half price |
| Prev flagship | `doubao-seed-2-0-pro-260215` = `seed-2.0-pro` | previous-gen | 256K / 128K | 0.47 / 2.37 | Pinned only |
| Code | `doubao-seed-2-0-code-preview-260215` | preview | 256K / 128K | 0.47 / 2.37 | Claude-Code-style tooling via `anthropic` endpoint |
| Mid | `doubao-seed-2-0-lite-260428` = `seed-2.0-lite` | current | 256K / 128K | 0.09 / 0.53 | Cheap everyday with **audio input** |
| Small | `doubao-seed-2-0-mini-260428` = `seed-2.0-mini` | current | 256K / 128K | 0.03 / 0.28–0.31 | Volume; audio input |
| Legacy | `seed-1.8` | previous-gen | 256K / 64K | 0.25 / 2 | Pinned only |
| Legacy | `seed-1.6`, `seed-1.6-flash` | legacy | 256K / 16K | 0.11/1.10 · 0.075/0.30 | No |

Notes: 2.0/1.x pricing tiered by input length (~3x at 128–256K); 2.1 flat. Cache hit ~20% of input. No official USD card — figures are conversions or third-party listings.

---

## 5. Non-text modalities

### 5.1 Image generation & editing (27 ids)

Pricing here is per image or per image-token, not per text token. Ordered best-quality-first within each vendor.

| Id | Vendor (real) | What it is | Res / notes | Pick when |
|---|---|---|---|---|
| `gpt-image-2.5-sunburst` | OpenAI | Highest quality / edit precision (2026-09-08) | $5 text-in / $8 img-in / $30 img-out per 1M tokens (2x gpt-image-2); quality `low`…`max`/`auto` | Precise edits, complex compositions |
| `gpt-image-2.5-flare` | OpenAI | Fast default of the 2.5 line, ~50% lower latency than 2 | same pricing as Sunburst; generation-only on gateway | Default OpenAI image gen |
| `gpt-image-2` | OpenAI | 2026-04; reasoning/planning step, native 2K, multilingual text | $2.50 / $4 / $15; generation **and** `/images/edits` | Cheaper than 2.5; only OpenAI id with edit endpoint |
| `gpt-image-2-count` | OpenAI (gateway alias) | Same model, per-image ("count") billing [unverified] | — | If TokenKu bills per image rather than per token |
| `nano-banana-pro` = `gemini-3-pro-image-preview` | Google | Gemini 3 Pro Image — reasoning-driven, best text-in-image/infographics | $0.134 (1–2K) – $0.24 (4K) per image; **preview id shut down upstream 2026-06-25** — use `nano-banana-pro` | Text-heavy, infographics, highest fidelity |
| `nano-banana-2` = `gemini-3.1-flash-image-preview` | Google | Gemini 3.1 Flash Image — fast, thinking + grounding | $0.067 (1K) – $0.151 (4K); 131K ctx | Default Google image gen |
| `gemini-3.1-flash-lite-image` | Google | Nano Banana 2 Lite — fastest/cheapest Gemini image (2026-06) | $0.0336/image, 1K only, sub-2 s target | Volume thumbnails |
| `nano-banana` = `gemini-2.5-flash-image` | Google | Original Nano Banana | **Shutdown 2026-10-02** | Do not use |
| `seedream-5.0-pro` = `doubao-seedream-5-0-pro-260628` | ByteDance | Seedream 5.0 Pro (2026-07): pixel/layer editing, infographics | ~CNY 0.30/img + 0.02 per input image; ~74 s e2e | Layouts, precise edits |
| `doubao-seedream-5-0-260128` | ByteDance | Seedream 5.0 **Lite** (no "lite" in id); deep-thinking + web search modes | ~CNY 0.22 | Knowledge-grounded images cheaply |
| `seedream-4.5` = `doubao-seedream-4-5-251128` | ByteDance | Best 4K editing consistency/text in 4.x | ~CNY 0.25; ~17 s | Cheap 4K edits |
| `seedream-4.0` = `doubao-seedream-4-0-250828` | ByteDance | Unified gen+edit, 4K, fast | ~CNY 0.20 | High-volume budget |
| `wan2.7-image-pro` / `wan2.7-image` | Alibaba Wan | 2026-04; 4K; up to 12 consistent images per job | pricing n/a | Multi-image consistency (characters, product sets) |
| `qwen-image-2.0-pro` / `qwen-image-2.0` | Alibaba | 2026-02/03 | pricing n/a; 3.0-pro exists upstream, not here | General; Chinese/English text rendering |
| `qwen-image-edit` | Alibaba | Legacy 20B edit model | superseded by 2.0 | No |
| `z-image-turbo` | Alibaba (open, 6B) | 8-step distilled, cheapest/fastest | pricing n/a | Drafts, thumbnails |
| `grok-imagine-image-quality` | xAI | Grok Imagine Image Pro tier | **Retires 2026-11-02** → redirects to Image 2.0 low | Do not adopt |
| `mj_imagine`, `mj_blend`, `mj_reroll` | Midjourney (via Discord proxy) | Generate / blend images / re-run | Flat per-action price set by gateway; async submit→poll; V8.2 default | Aesthetic-first stills; **not** for literal prompt adherence |
| `mj_upscale`, `mj_upsample_action`, `mj_variation`, `mj_high_variation`, `mj_low_variation`, `mj_zoom`, `mj_custom_zoom`, `mj_pan`, `mj_inpaint`, `mj_edits`, `mj_modal` | Midjourney | Follow-up actions on a prior MJ job (upscale, U/V buttons, zoom out, pan, region repaint, edit, modal-confirm) | Require a parent task id; `mj_inpaint`/`mj_custom_zoom` are free because the follow-up `mj_modal` is billed | Only after `mj_imagine` |
| `mj_describe` | Midjourney | Image → prompt text | — | Reverse-prompting |

Midjourney and Suno have **no official API**; these are unofficial proxy actions (Discord/web automation) with ToS and reliability risk. Treat as best-effort, never in SLAs.

### 5.2 Video generation (20 ids)

Billing is per second of output (or per video token ∝ W×H×frames). 1080p costs ~5x 480p on Seedance.

| Id | Vendor | Capabilities | Pick when |
|---|---|---|---|
| `seedance-2.5` | ByteDance | Latest (API 2026-08-07; 1080p from 08-17). 4–30 s single pass, 30 img + 10 video + 10 audio refs, 10-bit colour, joint audio-video. ~1.5x 2.0 price | Best quality / longest clips / reference adherence |
| `seedance-2.0` = `doubao-seedance-2-0-260128` = `dreamina-seedance-2-0-260128` (= `-ep` [unverified]) | ByteDance | 4–15 s, 480/720/1080p, native synced audio, 9 img + 3 video + 3 audio refs; ~CNY 1/s at 1080p | Standard high-quality |
| `seedance-2.0-fast` = `doubao-seedance-2-0-fast-260128` = `dreamina-seedance-2-0-fast-260128` (= `-fast-ep`) | ByteDance | 480/720p only, ~20% cheaper, ~2x faster | Drafts, social clips |
| `seedance-2.0-mini` = `doubao-seedance-2-0-mini-260615` | ByteDance | 480/720p, ~50% cost, 2x faster than fast | Volume, simple prompts |
| `seedance-1.5-pro` | ByteDance | First with native lip-sync audio, 4–12 s | Legacy |
| `seedance-1.0-pro`, `seedance-1.0-pro-fast` | ByteDance | 1080p, **no audio** | Legacy only |
| `happyhorse-1.1-i2v` | Alibaba (ATH team) | 2026-06; t2v/i2v/r2v, up to 9 refs, native audio + lip-sync, 480P–1080P, 3–15 s; ~$0.14/s 720P, $0.18/s 1080P; arena-leading | Highest-fidelity image-to-video |
| `happyhorse-1.0-video-edit` | Alibaba | Instruction-edit a 3–60 s input video, output ≤15 s | Video-to-video edits |
| `veo_3_1` / `veo_3_1-fast` | Google | Veo 3.1: 4/6/8 s, 16:9 or 9:16, native audio always on, ref images, extend, interpolate; $0.40/s (4K $0.60) · fast $0.10–0.30/s; outputs retained 2 days | Google-ecosystem video; 4K |
| `grok-imagine-video-1.5-preview` | xAI | 2026-05-30 snapshot; native audio, 1080p, $0.08/$0.14/$0.25 per s; stable 1.5 id exists upstream | Mid-price with audio |
| `grok-imagine-video` | xAI | 480p $0.05/s, 720p $0.07/s, ≤15 s, t2v/i2v/edit/extend, no 1080p | Cheapest video |
| `omni-fast` / `omni-fast-v2v` | **unidentified** — best hypothesis Google Gemini Omni Flash (~$0.10/s), `-v2v` = video-input edit route [unverified] | — | Test before use |
| `mj_video` | Midjourney | Animate an existing MJ image, 5 s extendable to 21 s | Only from an MJ still |

### 5.3 Speech, audio, music (11 ids)

| Id | Type | Notes |
|---|---|---|
| `qwen-audio-3.0-realtime-plus` | speech-to-speech, WebSocket | 2026-07-28 flagship; #1 on AA speech-to-speech index; ~4 s to first audio; function calling; $0.80/$6.40 |
| `qwen-audio-3.0-realtime-flash` | speech-to-speech, WebSocket | Low-latency tier; $0.45/$4.50 |
| `qwen3.5-omni-plus-realtime` / `qwen3.5-omni-flash-realtime` | omni realtime (audio/video in, audio+text out) | 2026-03-31; function calling; 262K; voice cloning |
| `qwen3.5-omni-plus` / `qwen3.5-omni-flash` | omni, non-realtime | 113 input / 36 output languages; **no tools, no JSON mode**; `stream=True` required |
| `qwen3-omni-flash-2025-12-01` / `qwen3-omni-flash-realtime` | omni, previous-gen | 64K ctx; superseded by 3.5-omni |
| `qwen3-tts-instruct-flash-realtime` | TTS, instruction-controlled prosody | zh/en; per-character billing; newer `qwen-audio-3.0-tts-*` exist upstream, not here |
| `mimo-v2.5-asr` | ASR (Xiaomi MiMo, ~8B open) | streaming + non-streaming; mislabeled `owned_by=volcengine` |
| `suno_music` / `suno_lyrics` | Music gen / lyrics (unofficial Suno proxy) | Async; flat per-call price; consumer Suno v5.5 |

### 5.4 Embeddings & rerank (6 ids)

| Id | Dims / input | Pick when |
|---|---|---|
| `qwen3.7-text-embedding` | 256–2560 (default 1024), 128K input, $0.07 | **Default text embedding** (vendor: "recommended for most use cases") |
| `gemini-embedding-2-preview` | 128–3072, 8,192 tokens, multimodal (text/image/audio/video/PDF), $0.20 | Multimodal retrieval on Google stack; preview |
| `qwen3-vl-embedding` | default 2560, 32K, multimodal | Image+text retrieval |
| `qwen3-vl-rerank` | 120K ctx, multimodal | Only reranker in catalog |
| `text-embedding-v4` | 8,192 tokens, $0.07 | Previous-gen; existing indexes only |
| `gemini-embedding-001` | 2,048 tokens, text-only; **shutdown 2028-05-14** | Existing indexes only |

Never mix embedding models within one index.

### 5.5 Specialist text endpoints

| Id | Purpose |
|---|---|
| `qwen-mt-plus` / `-flash` / `-lite` / `-turbo` | Machine translation (Section 1.7) |
| `qwen3.5-ocr` | OCR / document parsing; $0.069/$0.275; no JSON mode |
| `gui-plus` | GUI agent: screenshot + instruction → action JSON (1000×1000 grid), desktop + mobile; 256K/32K; $0.21/$0.63; `gui-plus-2026-02-26` snapshot adds thinking |
| `qwen-flash-character` | Persona-consistent role-play; 32K; no thinking |

---

## 6. Full index (all 170 ids)

Legend — **Gen:** latest / current / previous / legacy / deprecated / preview. **Size:** frontier / large / medium / small / tiny (open-weight params where known). **Think:** always = cannot disable · opt = toggleable · off = non-reasoning · n/a = not a text model. **Speed / Cost:** relative tiers from research (VF=very fast, F, M, S, VS; VC=very cheap, C, M, E, VE). **Roles** use Section 1 vocabulary.

| # | Id | Vendor | Modality | Gen | Size | Ctx / Out | Think | Speed | Cost | $/1M in/out | Roles | Notes |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | `gpt-5.2` | OpenAI | text+vision | legacy | frontier | 400K / 125K | opt | M | M | 1.75 / 14 | coding, everyday-default | → gpt-5.4 · Snapshot gpt-5.2-2025-12-11. Base gpt-5.2 model is not on the deprecation list as of 2026-09-13 (only the -chat-latest and -codex variants were r… |
| 2 | `gpt-5.4` | OpenAI | text+vision | previous | frontier | 1.05M / 125K | opt | M | M | 2.5 / 15 | coding, agentic-coding, long-documents, everyday-default | → gpt-5.5 · Snapshot gpt-5.4-2026-03-05. 1.05M-context models: prompts >272K input tokens are billed at 2x input / 1.5x output for the whole request (docs). … |
| 3 | `gpt-5.4-mini` | OpenAI | text+vision | previous | medium | 400K / 125K | opt | F | C | 0.75 / 4.5 | coding, fast-repeatable, budget | → gpt-5.6-luna · Snapshot gpt-5.4-mini-2026-03-17. Default effort none. |
| 4 | `gpt-5.4-nano` | OpenAI | text+vision | previous | tiny | 400K / 125K | opt | VF | VC | 0.2 / 1.25 | budget, fast-repeatable | → gpt-5.6-luna · Snapshot gpt-5.4-nano-2026-03-17. Fine-tuning unavailable. |
| 5 | `gpt-5.4-pro` | OpenAI | text+vision | previous | frontier | 1.05M / 125K | always | VS | VE | 30 / 180 | deep-reasoning | → gpt-5.5-pro · Snapshot gpt-5.4-pro-2026-03-05. 1.05M-context models: prompts >272K input tokens are billed at 2x input / 1.5x output for the whole request … |
| 6 | `gpt-5.5` | OpenAI | text+vision | previous | frontier | 1.05M / 125K | opt | M | E | 5 / 30 | hard-tasks, coding, agentic-coding | → gpt-5.6-sol · Snapshot gpt-5.5-2026-04-23. Default effort is medium. 1.05M-context models: prompts >272K input tokens are billed at 2x input / 1.5x output … |
| 7 | `gpt-5.6-luna` | OpenAI | text+vision | current | small | 1.05M / 125K | opt | F | C | 0.2 / 1.2 | fast-repeatable, budget, everyday-default, coding | Official OpenAI id (NOT a gateway alias) — OpenAI's July 9, 2026 GPT-5.6 launch introduced three named tiers: Sol (flagship), Terra (mid), Luna (small/fast).… |
| 8 | `gpt-5.6-sol` | OpenAI | text+vision | current | frontier | 1.05M / 125K | opt | M | E | 4 / 20 | hard-tasks, deep-reasoning, agentic-coding, coding, long-documents, everyday-default | → gpt-6-astra · Official OpenAI id (NOT a gateway alias) — OpenAI's July 9, 2026 GPT-5.6 launch introduced three named tiers: Sol (flagship), Terra (mid), Lu… |
| 9 | `gpt-5.6-terra` | OpenAI | text+vision | current | large | 1.05M / 125K | opt | M/F | M | 2 / 12 | everyday-default, coding, agentic-coding, long-documents, strict-instruction-following | Official OpenAI id (NOT a gateway alias) — OpenAI's July 9, 2026 GPT-5.6 launch introduced three named tiers: Sol (flagship), Terra (mid), Luna (small/fast).… |
| 10 | `gpt-6-astra` | OpenAI | text+vision | latest | frontier | 1.05M / 125K | always | S | VE | 10 / 50 | hard-tasks, deep-reasoning, agentic-coding, coding, long-documents | Launched 2026-09-03 (API changelog); broad paid/API rollout 2026-09-04. Official OpenAI id (docs page exists). Released Sept 3 (limited) / Sept 4 2026 (GA), … |
| 11 | `gpt-image-2.5-flare` | OpenAI | image-gen | latest | frontier | — | n/a | F | E | 5 / 30 | image, multimodal, fast-repeatable | Genuine OpenAI model. Dated snapshot gpt-image-2.5-flare-2026-09-08. Text+image in, image out. Gateway lists only the image-generation endpoint (POST /v1/ima… |
| 12 | `gpt-image-2.5-sunburst` | OpenAI | image-edit | latest | frontier | — | n/a | M | E | 5 / 30 | image, multimodal, hard-tasks | Genuine OpenAI model. Dated snapshot gpt-image-2.5-sunburst-2026-09-08. Text+image in, image out. Gateway lists only the image-generation endpoint (POST /v1/… |
| 13 | `doubao-seedream-4-0-250828` | ByteDance | image-gen | previous | large | — | n/a | F | C | — | image, budget | → doubao-seedream-4-5-251128 · Snapshot-pinned CN id of Seedream 4.0; see seedream-4.0. ByteDance/Volcengine Ark ids carry a YYMMDD snapshot suffix (e.g. 260… |
| 14 | `doubao-seedream-4-5-251128` | ByteDance | image-gen | current | large | — | n/a | M | C | — | image, multimodal | → doubao-seedream-5-0-pro-260628 · Snapshot-pinned CN id; see seedream-4.5. ByteDance/Volcengine Ark ids carry a YYMMDD snapshot suffix (e.g. 260628 = 2026-0… |
| 15 | `doubao-seedream-5-0-260128` | ByteDance | image-gen | current | medium | — | n/a | M | C | — | image, multimodal, budget | → doubao-seedream-5-0-pro-260628 · Snapshot 260128; announced late Jan 2026 in the Doubao app, developer API opened ~2026-02-24 (dates vary by source — Jan 2… |
| 16 | `doubao-seedream-5-0-pro-260628` | ByteDance | image-gen | latest | frontier | — | n/a | S | M | — | image, multimodal, hard-tasks | Snapshot-pinned CN id; see seedream-5.0-pro. Seedream 5.0 Pro (snapshot 260628, released 2026-07-08): 'beyond generation — it understands design'; complex in… |
| 17 | `gpt-image-2` | OpenAI | image-gen | previous | frontier | — | n/a | M | M | 2.5 / 15 | image, budget, multimodal | → gpt-image-2.5-flare · Genuine OpenAI model (owned_by=openai is correct here). Text+image in, image out. Dated snapshot gpt-image-2-2026-04-21. Gateway expo… |
| 18 | `gpt-image-2-count` | OpenAI | image-gen | current | frontier | — | n/a | M | M | — | image | → gpt-image-2.5-flare · NOT found in OpenAI docs (searched developers.openai.com and web). Best-sourced hypothesis: a New API / one-api style gateway alias t… |
| 19 | `grok-imagine-image-quality` | xAI | image-gen | deprecated | large | — | n/a | M | M | — | image | Gateway lists owned_by=openai but this is NOT an OpenAI model; the gateway just routes it through its OpenAI-compatible adapter. Upstream endpoint is xAI's O… |
| 20 | `grok-imagine-video` | xAI | video-gen | previous | large | — | n/a | M | C | — | video, budget | → grok-imagine-video-1.5-preview · Gateway lists owned_by=openai but this is NOT an OpenAI model; the gateway just routes it through its OpenAI-compatible ad… |
| 21 | `grok-imagine-video-1.5-preview` | xAI | video-gen | preview | frontier | — | n/a | M | M | — | video, multimodal | Gateway lists owned_by=openai but this is NOT an OpenAI model; the gateway just routes it through its OpenAI-compatible adapter. Inputs: text, image, audio (… |
| 22 | `happyhorse-1.0-video-edit` | Alibaba (HappyHorse / ATH team — not Tongyi Wan) | video-gen | current | large (15B) | — | n/a | M | E | — | video | Gateway lists owned_by=openai but this is NOT an OpenAI model; the gateway just routes it through its OpenAI-compatible adapter. Upstream: DashScope async PO… |
| 23 | `happyhorse-1.1-i2v` | Alibaba (HappyHorse / ATH team — not Tongyi Wan) | video-gen | latest | large (15B) | — | n/a | M | E | — | video, multimodal | Gateway lists owned_by=openai but this is NOT an OpenAI model; the gateway just routes it through its OpenAI-compatible adapter. Siblings: happyhorse-1.1-t2v… |
| 24 | `mj_blend` | Midjourney | image-gen | current | frontier | — | n/a | S | C | — | image | NOT an OpenAI model and not an official Midjourney API (Midjourney has none): these mj_* ids are the billing/action names used by New API / one-api style gat… |
| 25 | `mj_custom_zoom` | Midjourney | image-edit | current | frontier | — | n/a | S | C | — | image | NOT an OpenAI model and not an official Midjourney API (Midjourney has none): these mj_* ids are the billing/action names used by New API / one-api style gat… |
| 26 | `mj_describe` | Midjourney | image-to-text | current | frontier | — | off | S | C | — | image | NOT an OpenAI model and not an official Midjourney API (Midjourney has none): these mj_* ids are the billing/action names used by New API / one-api style gat… |
| 27 | `mj_edits` | Midjourney | image-edit | current | frontier | — | n/a | S | C | — | image | NOT an OpenAI model and not an official Midjourney API (Midjourney has none): these mj_* ids are the billing/action names used by New API / one-api style gat… |
| 28 | `mj_high_variation` | Midjourney | image-edit | current | frontier | — | n/a | S | C | — | image | NOT an OpenAI model and not an official Midjourney API (Midjourney has none): these mj_* ids are the billing/action names used by New API / one-api style gat… |
| 29 | `mj_imagine` | Midjourney | image-gen | current | frontier | — | n/a | S | C | — | image | NOT an OpenAI model and not an official Midjourney API (Midjourney has none): these mj_* ids are the billing/action names used by New API / one-api style gat… |
| 30 | `mj_inpaint` | Midjourney | image-edit | current | frontier | — | n/a | S | C | — | image | NOT an OpenAI model and not an official Midjourney API (Midjourney has none): these mj_* ids are the billing/action names used by New API / one-api style gat… |
| 31 | `mj_low_variation` | Midjourney | image-edit | current | frontier | — | n/a | S | C | — | image | NOT an OpenAI model and not an official Midjourney API (Midjourney has none): these mj_* ids are the billing/action names used by New API / one-api style gat… |
| 32 | `mj_modal` | Midjourney | image-edit | current | frontier | — | n/a | S | C | — | image | NOT an OpenAI model and not an official Midjourney API (Midjourney has none): these mj_* ids are the billing/action names used by New API / one-api style gat… |
| 33 | `mj_pan` | Midjourney | image-edit | current | frontier | — | n/a | S | C | — | image | NOT an OpenAI model and not an official Midjourney API (Midjourney has none): these mj_* ids are the billing/action names used by New API / one-api style gat… |
| 34 | `mj_reroll` | Midjourney | image-gen | current | frontier | — | n/a | S | C | — | image | NOT an OpenAI model and not an official Midjourney API (Midjourney has none): these mj_* ids are the billing/action names used by New API / one-api style gat… |
| 35 | `mj_upsample_action` | Midjourney | image-edit | current | frontier | — | n/a | S | C | — | image | NOT an OpenAI model and not an official Midjourney API (Midjourney has none): these mj_* ids are the billing/action names used by New API / one-api style gat… |
| 36 | `mj_upscale` | Midjourney | image-edit | current | frontier | — | n/a | S | C | — | image | NOT an OpenAI model and not an official Midjourney API (Midjourney has none): these mj_* ids are the billing/action names used by New API / one-api style gat… |
| 37 | `mj_variation` | Midjourney | image-edit | current | frontier | — | n/a | S | C | — | image | NOT an OpenAI model and not an official Midjourney API (Midjourney has none): these mj_* ids are the billing/action names used by New API / one-api style gat… |
| 38 | `mj_video` | Midjourney | video-gen | current | frontier | — | n/a | S | M | — | image, video | NOT an OpenAI model and not an official Midjourney API (Midjourney has none): these mj_* ids are the billing/action names used by New API / one-api style gat… |
| 39 | `mj_zoom` | Midjourney | image-edit | current | frontier | — | n/a | S | C | — | image | NOT an OpenAI model and not an official Midjourney API (Midjourney has none): these mj_* ids are the billing/action names used by New API / one-api style gat… |
| 40 | `nano-banana` | Google | image-gen | deprecated | medium | 64K / 32K | n/a | F | C | 0.3 / 30 | image | → gemini-3.1-flash-lite-image · Gateway alias (owned_by=openai, openai-compatible images endpoint). 'Nano Banana' is Google's official marketing name for gem… |
| 41 | `nano-banana-2` | Google | image-gen | current | medium | 128K / 32K | n/a | F | M | 0.5 / 60 | image, multimodal | Gateway alias (owned_by=openai). Google's official name 'Nano Banana 2' = gemini-3.1-flash-image (stable, latest update Feb 2026). Mapping high-confidence; g… |
| 42 | `nano-banana-pro` | Google | image-gen | current | large | 64K / 32K | n/a | S | E | 2 / 120 | image | Gateway alias (owned_by=openai). Google's official name 'Nano Banana Pro' = gemini-3-pro-image (stable; docs latest update Nov 2025). Mapping high-confidence… |
| 43 | `omni-fast` | other (unidentified; hypothesis: Google Gemini Omni Flash) | video-gen | unverified | frontier | — | n/a | F | E | 1.5 / 17.5 | video | COULD NOT identify 'omni-fast' upstream under that exact id (searched web, gateway listings, vendor docs). owned_by=openai is a gateway artefact — OpenAI has… |
| 44 | `omni-fast-v2v` | other (unidentified; hypothesis: Google Gemini Omni Flash, video-to-video mode) | video-gen | unverified | frontier | — | n/a | F | E | — | video | COULD NOT identify 'omni-fast' upstream under that exact id (searched web, gateway listings, vendor docs). owned_by=openai is a gateway artefact — OpenAI has… |
| 45 | `suno_lyrics` | Suno (via unofficial proxy) | text | current | medium | — | off | F | VC | — | audio | NOT an OpenAI model and NOT an official Suno API (Suno has no self-serve public API as of 2026 — only a curated partner programme); owned_by=openai is a gate… |
| 46 | `suno_music` | Suno (via unofficial proxy) | audio | current | frontier | — | n/a | S | C | — | audio | NOT an OpenAI model and NOT an official Suno API (Suno has no self-serve public API as of 2026 — only a curated partner programme); owned_by=openai is a gate… |
| 47 | `veo_3_1` | Google | video-gen | deprecated | large | 1K / — | n/a | S | VE | — | video | Gateway alias (owned_by=openai) — underscores instead of dots/hyphens. Upstream id: veo-3.1-generate-preview. Text prompt limit 1,024 tokens; 1 video per req… |
| 48 | `veo_3_1-fast` | Google | video-gen | deprecated | large | 1K / — | n/a | M | E | — | video | Gateway alias (owned_by=openai). Upstream id: veo-3.1-fast-generate-preview. Quality/speed trade-off vs standard Veo 3.1. A cheaper 'veo-3.1-lite-generate-pr… |
| 49 | `gpt-4.1` | OpenAI | text+vision | deprecated | large | 1.05M / 32K | off | F | M | 2 / 8 | strict-instruction-following, fast-repeatable, long-documents | → gpt-5.4 · Snapshot gpt-4.1-2025-04-14. Only 4.1-nano is on the retirement list; 4.1 and 4.1-mini remain but are legacy. |
| 50 | `gpt-4.1-mini` | OpenAI | text+vision | legacy | medium | 1.05M / 32K | off | VF | C | 0.4 / 1.6 | budget, fast-repeatable, strict-instruction-following | → gpt-5.4-mini · Snapshot gpt-4.1-mini-2025-04-14. |
| 51 | `gpt-4o` | OpenAI | text+vision | legacy | large | 125K / 16K | off | F | M | 2.5 / 10 | legacy compatibility only | → gpt-4.1 · Alias currently points at gpt-4o-2024-08-06/2024-11-20 snapshots; gpt-4o-2024-05-13 deprecated. Vision input yes; audio only via separate realtim… |
| 52 | `gpt-4o-mini` | OpenAI | text+vision | legacy | small | 125K / 16K | off | VF | VC | 0.15 / 0.6 | budget, legacy compatibility | → gpt-4.1-mini · Single snapshot gpt-4o-mini-2024-07-18. |
| 53 | `gpt-5-mini` | OpenAI | text+vision | deprecated | medium | 400K / 125K | opt | F | VC | 0.25 / 2 | budget, fast-repeatable | → gpt-5.4-mini · Shutdown 2026-12-11 per deprecations page. Uses 'minimal' not 'none' as lowest effort. |
| 54 | `gpt-5-nano` | OpenAI | text+vision | deprecated | tiny | 400K / 125K | opt | VF | VC | 0.05 / 0.4 | budget, fast-repeatable | → gpt-5.4-nano · Shutdown 2026-12-11. Docs mark the dated snapshot deprecated; alias still resolves. |
| 55 | `gpt-5.5-pro` | OpenAI | text+vision | previous | frontier | 1.05M / 125K | always | VS | VE | 30 / 180 | deep-reasoning, hard-tasks | → gpt-5.6-sol · Snapshot gpt-5.5-pro-2026-04-23. Cannot set effort below medium. Use Responses API. Not a fit for chat-style latency budgets. |
| 56 | `claude-haiku-4-5` | Anthropic | text+vision | current | small | 200K / 64K | opt | VF | C | 1 / 5 | fast-repeatable, budget, everyday-default | ALIAS, not a snapshot. Docs: 'claude-haiku-4-5' is 'a convenience alias that resolves to the pinned snapshot claude-haiku-4-5-20251001'. Pre-4.6 naming schem… |
| 57 | `claude-haiku-4-5-20251001` | Anthropic | text+vision | current | small | 200K / 64K | opt | VF | C | 1 / 5 | fast-repeatable, budget, everyday-default | DATED SNAPSHOT (canonical pinned id) of Claude Haiku 4.5; identical model/pricing to the alias 'claude-haiku-4-5'. Bedrock: anthropic.claude-haiku-4-5; Verte… |
| 58 | `claude-opus-4-7` | Anthropic | text+vision | previous | large | 1M / 125K | opt | M | E | 5 / 25 | coding, agentic-coding, strict-instruction-following, multimodal | → claude-opus-4-8 · Dateless pinned snapshot. Claude 4.7+ models (Opus 4.7/4.8/5, Sonnet 5, Fable 5/5.1) use a newer tokenizer that produces roughly 30% more… |
| 59 | `claude-opus-4-8` | Anthropic | text+vision | previous | large | 1M / 125K | opt | M | E | 5 / 25 | coding, agentic-coding, hard-tasks, long-documents | → claude-opus-5 · Dateless pinned snapshot. Effort docs: 'Start with xhigh for coding and agentic use cases'; set a large max_tokens at xhigh/max. Fable 5's … |
| 60 | `claude-opus-5` | Anthropic | text+vision | latest | frontier | 1M / 125K | opt | M | E | 5 / 25 | everyday-default, hard-tasks, deep-reasoning, coding, agentic-coding, long-documents, multimodal, strict-instruction-following | Dateless pinned snapshot. Breaking vs 4.8: thinking on by default; disabling thinking only at effort ≤ high. Claude 4.7+ models (Opus 4.7/4.8/5, Sonnet 5, Fa… |
| 61 | `claude-sonnet-5` | Anthropic | text+vision | latest | medium | 1M / 125K | opt | F | C | 2 / 10 | everyday-default, coding, agentic-coding, fast-repeatable, long-documents, strict-instruction-following | Dateless pinned snapshot id. Drop-in upgrade from Sonnet 4.6 with three behavior changes: adaptive thinking on by default, manual extended thinking → 400, no… |
| 62 | `claude-fable-5` | Anthropic | text+vision | previous | frontier | 1M / 125K | always | S | VE | 10 / 50 | deep-reasoning, hard-tasks, agentic-coding, long-documents, multimodal | → claude-fable-5-1 · The 'Fable' tier (introduced 2026-06-09) sits ABOVE Opus: it is 'a Mythos-class model that we've made safe for general use'. Fable and M… |
| 63 | `claude-opus-4-6` | Anthropic | text+vision | previous | large | 1M / 125K | opt | M | E | 5 / 25 | coding, long-documents | → claude-opus-4-7 · Dateless pinned snapshot (4.6+ naming). Bedrock id is anthropic.claude-opus-4-6-v1. Retired predecessors Opus 4 / 4.1 pointed migrations … |
| 64 | `claude-sonnet-4-6` | Anthropic | text+vision | previous | medium | 1M / 125K | opt | F | M | 3 / 15 | everyday-default, coding, long-documents | → claude-sonnet-5 · Dateless id = pinned, fixed-weight snapshot (4.6+ naming scheme), not an evergreen alias. Assistant-message prefilling unsupported. Effor… |
| 65 | `gemini-2.5-flash` | Google | omni | deprecated | medium | 1.05M / 64K | opt | F | C | 0.3 / 2.5 | fast-repeatable, budget, translation, multimodal | → gemini-3-flash · Preview snapshots 05-20 and 09-2025 already shut down (2025-11-18, 2026-02-17). Stable id has no shutdown date. thinking_budget range stat… |
| 66 | `gemini-2.5-flash-image` | Google | image-gen | deprecated | medium | 64K / 32K | n/a | F | C | 0.3 / 30 | image | → gemini-3.1-flash-lite-image · Exact upstream stable id. Knowledge cutoff June 2025. Preview id gemini-2.5-flash-image-preview shut down 2026-01-15. Only ~3… |
| 67 | `gemini-2.5-pro` | Google | omni | deprecated | large | 1.05M / 64K | always | S | E | 1.25 / 10 | long-documents, deep-reasoning | → gemini-3.1-pro-preview · Legacy flagship. Preview snapshots (03-25, 05-06, 06-05) shut down 2025-12-02; the stable id has no announced shutdown. Uses think… |
| 68 | `gemini-3-flash` | Google | omni | preview | large | 1.05M / 64K | always | F | C | 0.5 / 3 | everyday-default, coding, agentic-coding, multimodal, long-documents, budget | → gemini-3.5-flash · Gateway id drops the '-preview' suffix; upstream only has 'gemini-3-flash-preview' (the 3.5 Flash model page lists it as the preview ver… |
| 69 | `gemini-3-pro-image-preview` | Google | image-gen | deprecated | large | 64K / 32K | n/a | S | E | 2 / 120 | image | Google's deprecations page lists gemini-3-pro-image-preview shutdown date 2026-06-25. If this gateway id still works it is presumably routed to the stable 'g… |
| 70 | `gemini-3.1-flash-image-preview` | Google | image-gen | preview | medium | 128K / 32K | n/a | F | M | 0.5 / 60 | image, multimodal | Gateway keeps the '-preview' suffix; Google's model page now lists stable 'gemini-3.1-flash-image' only. Likely the launch preview id (Feb 2026) — check whet… |
| 71 | `gemini-3.1-flash-lite` | Google | omni | current | small | 1.05M / 64K | opt | VF | C | 0.25 / 1.5 | fast-repeatable, budget, everyday-default, multimodal, long-documents | Stable id (docs latest update May 2026). Best price/latency text model in this catalog that is still current-generation. Thinking levels supported; default l… |
| 72 | `gemini-3.1-flash-lite-image` | Google | image-gen | latest | small | 64K / 4K | n/a | VF | C | 0.25 / 30 | image, budget, fast-repeatable | Exact upstream stable id. Newest image model in catalog. |
| 73 | `gemini-3.1-pro` | Google | omni | preview | frontier | 1.05M / 64K | always | S | E | 2 / 12 | hard-tasks, deep-reasoning, agentic-coding, coding, long-documents, multimodal | NOT FOUND UPSTREAM: Google's docs (models page, pricing, deprecations) only list 'gemini-3.1-pro-preview' (plus '-customtools'); ai.google.dev/gemini-api/doc… |
| 74 | `gemini-3.1-pro-preview` | Google | omni | deprecated | frontier | 1.05M / 64K | always | S | E | 2 / 12 | hard-tasks, deep-reasoning, agentic-coding, coding, long-documents, multimodal | Exact upstream id. Deprecations page: 'no shutdown date announced'. Latest docs update Feb 2026. Gemini 3.5 Pro was announced at I/O May 2026 but had no publ… |
| 75 | `gemini-3.5-flash` | Google | omni | current | frontier | 1.05M / 64K | always | F | M | 1.5 / 9 | everyday-default, hard-tasks, agentic-coding, coding, long-documents, multimodal, deep-reasoning | Newest general text model in this catalog. Stable id; docs list gemini-3-flash-preview as its preview lineage. Thinking is always on; thinking_level controls… |
| 76 | `gemini-embedding-001` | Google | embedding | deprecated | medium | 2K / — | n/a | F | VC | — | embedding | → gemini-embedding-2-preview · Keep for existing vector stores (changing models requires re-embedding). Pricing not found on current pricing page (unverified). |
| 77 | `gemini-embedding-2-preview` | Google | embedding | preview | medium | 8K / — | n/a | F | VC | 0.2 / — | embedding, multimodal | Exact upstream id. Docs refer to the line as 'gemini-embedding-2'; the API id in the models list is gemini-embedding-2-preview. Uses task instructions rather… |
| 78 | `gemini-2.5-flash-lite` | Google | omni | deprecated | small | 1.05M / 64K | opt | VF | VC | 0.1 / 0.4 | budget, fast-repeatable, classification/extraction at volume, translation | → gemini-3.1-flash-lite · Preview gemini-2.5-flash-lite-preview-09-2025 shut down 2026-03-31; stable id has no shutdown date. thinking_budget min 512 when en… |
| 79 | `deepseek-v4-flash` | DeepSeek | text | legacy | large (284B MoE, 13B active) | 1M / 375K | opt | F | VC | 0.3 / 1.2 | budget, agentic-coding, coding, fast-repeatable, long-documents, everyday-default | → deepseek-flash · Gateway lists owned_by=ali (Alibaba Model Studio), so the served checkpoint may be Alibaba's hosted V4-Flash rather than DeepSeek's V4.1-F… |
| 80 | `deepseek-v4-pro` | DeepSeek | text | current | frontier (1.6T MoE, 49B active) | 1M / 375K | opt | M | M | 1.32 / 3.96 | hard-tasks, deep-reasoning, coding, agentic-coding, long-documents | → DeepSeek-V4.1-Pro · VERIFIED 2026-09-13: DeepSeek changelog (api-docs.deepseek.com/updates) states it will continue providing V4 Pro API service after 2026… |
| 81 | `glm-5.2` | Zhipu GLM | text | previous | frontier (753B MoE, ~40B active) | 1M / 125K | opt | M | M | 1.4 / 4.4 | coding, agentic-coding, long-documents, hard-tasks | → glm-5.3 · Prefer glm-5.3 (same price, same 753B base, ~50% better coding per Z.ai). Thinking can be disabled (unlike GLM-5.3/5.3-Flash). Use reasoning_effo… |
| 82 | `glm-5.2-fast-preview` | Zhipu GLM | text | preview | frontier (753B MoE / ~40B active) | 1M / 128K | opt | F | E | — | fast-repeatable, agentic-coding, coding | → glm-5.3 · This is Alibaba Model Studio's id (gateway owned_by=ali). It is the standard GLM-5.2 checkpoint served on a faster inference stack, analogous to … |
| 83 | `gui-plus` | Alibaba Qwen | gui-agent | current | large | 250K / 32K | opt | M | C | 0.21 / 0.63 | multimodal, agentic-coding, budget | owned_by=ali on the gateway is correct (Alibaba). Upstream: OpenAI-compatible chat/completions (image_url + text) and DashScope SDK; gateway also exposes an … |
| 84 | `kimi-k2.6` | Moonshot Kimi | text+vision | current | frontier (1T MoE, 32B active, 384 experts/) | 256K / — | opt | M | C | 0.95 / 4 | everyday-default, agentic-coding, multimodal, budget, hard-tasks | → kimi-k2.7-code · Temperature 1.0 / top_p 0.95 recommended in thinking mode. Preserve reasoning across tool turns. Gateway owned_by=ali. |
| 85 | `kimi-k2.7-code` | Moonshot Kimi | text+vision | current | frontier (1T MoE, 32B active) | 256K / — | always | M | C | 0.95 / 4 | agentic-coding, coding, budget | → kimi-k3 · No general-purpose 'Kimi K2.7' was found — only K2.7 Code. Temperature 1.0 / top_p 0.95. Designed to pair with Kimi Code CLI / Claude-Code-style … |
| 86 | `MiniMax-M2.5` | MiniMax | text | legacy | large (230B MoE, 10B active) | 200K / 32K | always | F | VC | 0.3 / 1.2 | budget, fast-repeatable, coding, agentic-coding | → MiniMax-M2.7 · Only pick over M2.7 if you need identical behaviour to an existing deployment. Recommended temperature 1.0, top_p 0.95, top_k 40. Gateway ow… |
| 87 | `MiniMax-M2.7` | MiniMax | text | current | large (230B MoE, 10B active) | 200K / — | always | F | VC | 0.3 / 1.2 | budget, agentic-coding, coding, fast-repeatable | → MiniMax-M3 · Recommended temperature 1.0, top_p 0.95, top_k 40. Append full assistant message incl. reasoning back into history for tool loops. Gateway own… |
| 88 | `MiniMax-M3` | MiniMax | text+vision | latest | large (428B MoE, ~23B active) | 1.05M / 256K | opt | F | VC | 0.3 / 1.2 | everyday-default, budget, multimodal, long-documents, agentic-coding, coding, fast-repeatable | Pricing $0.30/$1.20 applies to <=512K input; >512K input bills $0.60/$2.40. Recommended temperature 1.0, top_p 0.95. Append full response (incl. reasoning_de… |
| 89 | `qwen-audio-3.0-realtime-flash` | Alibaba Qwen | audio | latest | medium | 40K / 8K | n/a | F | M | 0.45 / 4.5 | audio, budget | WebSocket Realtime API only. |
| 90 | `qwen-audio-3.0-realtime-plus` | Alibaba Qwen | audio | latest | large | 40K / 8K | n/a | M | E | 0.8 / 6.4 | audio | WebSocket Realtime API (16 kHz PCM in, 24 kHz PCM out). 'Plus' balances intelligence with dialogue rhythm; 'Flash' trades quality for latency. |
| 91 | `qwen-flash` | Alibaba Qwen | text | legacy | small | 1M / 32K | opt | VF | VC | 0.05 / 0.4 | budget, fast-repeatable | → qwen3.5-flash · Replaced qwen-turbo as the entry tier in July 2025. Snapshot qwen-flash-2025-07-28. |
| 92 | `qwen-flash-character` | Alibaba Qwen | text | current | small | 32K / 32K | off | VF | VC | 0.05 / 0.4 | fast-repeatable | Use only for companion / NPC / role-play dialogue. Release date unverified. |
| 93 | `qwen-image-2.0` | Alibaba Qwen | image-gen | current | undisclosed | — | n/a | M | C | — | image | Cheap default for text-heavy images (posters, infographics). Snapshot 2026-03-03. |
| 94 | `qwen-image-2.0-pro` | Alibaba Qwen | image-gen | current | undisclosed | — | n/a | M | M | — | image | Pro = higher fidelity than qwen-image-2.0 at ~2x price. Accepts reference images for editing. |
| 95 | `qwen-mt-flash` | Alibaba Qwen | translation | latest | undisclosed | 16K / 8K | n/a | F | VC | 0.16 / 0.49 | translation, everyday-default | Default choice for MT. Supported languages: 92 — Indonesian IS supported on all four MT models (per docs language table). Max input 8,192 tokens per request;… |
| 96 | `qwen-mt-lite` | Alibaba Qwen | translation | current | undisclosed | 16K / 8K | n/a | VF | VC | 0.12 / 0.36 | translation, fast-repeatable, budget | Latency-sensitive tier. Supported languages: 31–32 (docs vary) — Indonesian IS supported on all four MT models (per docs language table). Max input 8,192 tok… |
| 97 | `qwen-mt-plus` | Alibaba Qwen | translation | current | undisclosed | 16K / 8K | n/a | M | M | 2.46 / 7.37 | translation | Best-quality tier. Supported languages: 92 — Indonesian IS supported on all four MT models (per docs language table). Max input 8,192 tokens per request; use… |
| 98 | `qwen3-coder-flash` | Alibaba Qwen | text | legacy | small (30B-A3B-Instruct — 30B MoE, 3B a) | 1M / 64K | off | VF | C | 0.3 / 1.5 | coding, fast-repeatable | → qwen3.7-flash · Snapshot qwen3-coder-flash-2025-07-28. Open weights: https://huggingface.co/Qwen/Qwen3-Coder-30B-A3B-Instruct (native 256K, 1M via YaRN). T… |
| 99 | `qwen3-livetranslate-flash` | Alibaba Qwen | translation | previous | medium | 52K / 4K | n/a | F | M | — | translation, audio, video | → qwen3.5-livetranslate-flash-realtime · Snapshots: stable + qwen3-livetranslate-flash-2025-12-01. Release month inferred from the Sept-2025 Qwen3-Omni/LiveT… |
| 100 | `qwen3-max` | Alibaba Qwen | text | legacy | frontier (1T) | 256K / 64K | opt | M | E | 1.2 / 6 | — | → qwen3.5-plus · Legacy. Pricing in the official Model Studio page is tiered by input length; verify before use. Prefer qwen3.7-plus (cheaper, smarter) or qw… |
| 101 | `qwen3-omni-flash-2025-12-01` | Alibaba Qwen | omni | previous | medium (30B) | 64K / 16K | opt | F | M | 0.43 / 1.66 | audio, multimodal | → qwen3.5-omni-flash · Date-suffixed snapshot of qwen3-omni-flash (earlier snapshot 2025-09-15). Pinned snapshot — good for reproducibility, but 3.5-omni is … |
| 102 | `qwen3-omni-flash-realtime` | Alibaba Qwen | omni | previous | medium | 64K / 16K | off | F | E | 0.52 / 1.99 | audio | → qwen3.5-omni-flash-realtime · Snapshots 2025-09-15 and 2025-12-01. WebSocket realtime API. |
| 103 | `qwen3-tts-instruct-flash-realtime` | Alibaba Qwen | tts | current | small | — | n/a | F | M | — | audio | Billed per character, not per token. Snapshot qwen3-tts-instruct-flash-realtime-2026-01-22. Realtime (WebSocket) streaming TTS. |
| 104 | `qwen3-vl-embedding` | Alibaba Qwen | embedding | current | undisclosed | 32K / — | n/a | F | VC | 0.1 / 0 | embedding, multimodal | Default dim is 2560 (differs from text models' 1024). Release month inferred from the Jan-2026 open-source Qwen3-VL-Embedding launch — unverified. |
| 105 | `qwen3-vl-rerank` | Alibaba Qwen | rerank | current | undisclosed | 120K / — | n/a | F | VC | 0.1 / 0 | rerank, multimodal | Works fine for text-only reranking too. Release month inferred — unverified. |
| 106 | `qwen3.5-122b-a10b` | Alibaba Qwen | text+vision | current | medium (122B MoE, 10B active) | 256K / 64K | opt | M | C | 0.4 / 3.2 | strict-instruction-following, coding, multimodal | Weights: https://huggingface.co/Qwen/Qwen3.5-122B-A10B (Apache 2.0). |
| 107 | `qwen3.5-27b` | Alibaba Qwen | text+vision | previous | medium (27B dense) | 256K / 64K | opt | M | C | 0.3 / 2.4 | coding, budget, multimodal | → qwen3.6-27b · Weights: https://huggingface.co/Qwen/Qwen3.5-27B. Half the hosted price of qwen3.6-27b if you don't need the coding gains. |
| 108 | `qwen3.5-35b-a3b` | Alibaba Qwen | text+vision | previous | small (35B MoE, 3B active) | 256K / 64K | opt | F | C | 0.25 / 2 | budget, fast-repeatable, multimodal | → qwen3.6-35b-a3b · Weights: https://huggingface.co/Qwen/Qwen3.5-35B-A3B. Singapore TPM is 5M (higher than other open sizes). |
| 109 | `qwen3.5-397b-a17b` | Alibaba Qwen | text+vision | current | large (397B MoE, 17B active) | 256K / 64K | opt | M | C | 0.6 / 3.6 | coding, multimodal, translation, hard-tasks | Weights: https://huggingface.co/Qwen/Qwen3.5-397B-A17B. Same hosted price as qwen3.6-27b. Choose when you need an open-weight flagship for reproducibility / … |
| 110 | `qwen3.5-flash` | Alibaba Qwen | text+vision | previous | small | 1M / 64K | opt | F | VC | 0.1 / 0.4 | budget, fast-repeatable, long-documents | → qwen3.6-flash · Flat $0.10/$0.40 makes it the cheapest option for >32K-input workloads among Qwen flash models. Snapshot qwen3.5-flash-2026-02-23. |
| 111 | `qwen3.5-livetranslate-flash-realtime` | Alibaba Qwen | translation | latest | medium | — | n/a | F | M | — | translation, audio | Indonesian supported as a full audio+text target. Snapshot qwen3.5-livetranslate-flash-realtime-2026-05-19. |
| 112 | `qwen3.5-ocr` | Alibaba Qwen | ocr | current | small | 64K / 16K | n/a | F | VC | 0.069 / 0.275 | multimodal, budget | Use a general VLM (qwen3.7-plus) when you need JSON-structured extraction; use this for cheap bulk OCR / layout parsing. |
| 113 | `qwen3.5-omni-flash` | Alibaba Qwen | omni | latest | medium | 256K / 64K | off | F | M | 0.4 / 2.2 | audio, multimodal, budget | Snapshot qwen3.5-omni-flash-2026-03-15. Good default for audio/video understanding with optional speech output. |
| 114 | `qwen3.5-omni-flash-realtime` | Alibaba Qwen | omni | latest | medium | 256K / 64K | off | F | E | 0.55 / 3.3 | audio, multimodal, budget | Snapshot 2026-03-15. For pure speech-to-speech assistants compare with qwen-audio-3.0-realtime-flash (cheaper, #1 on AA S2S with the plus variant). |
| 115 | `qwen3.5-omni-plus` | Alibaba Qwen | omni | latest | large | 256K / 64K | off | M | E | 1.4 / 8.3 | audio, multimodal, video | API-only (no open weights, unlike Qwen3-Omni). Snapshot qwen3.5-omni-plus-2026-03-15. All omni requests must set stream=True; audio input billed at 7 tokens/s. |
| 116 | `qwen3.5-omni-plus-realtime` | Alibaba Qwen | omni | latest | large | 256K / 64K | off | M | VE | 2.1 / 12.4 | audio, multimodal | Realtime endpoint (WebSocket, OpenAI-Realtime-like) — check gateway supports it; listed with endpoints=openai only. Snapshot 2026-03-15. |
| 117 | `qwen3.5-plus` | Alibaba Qwen | text+vision | previous | large (397B) | 1M / 64K | opt | M | C | 0.4 / 2.4 | long-documents, multimodal | → qwen3.6-plus · Snapshots: qwen3.5-plus-2026-02-15, qwen3.5-plus-2026-04-20 (current default). Legacy choice; use qwen3.7-plus. |
| 118 | `qwen3.6-27b` | Alibaba Qwen | text+vision | current | medium (27B dense) | 256K / 64K | opt | M | C | 0.6 / 3.6 | coding, agentic-coding, multimodal | Open weights: https://huggingface.co/Qwen/Qwen3.6-27B (Apache 2.0). Hosted id has fixed 600 RPM / 1M TPM. For hosted use qwen3.7-plus is cheaper and stronger… |
| 119 | `qwen3.6-35b-a3b` | Alibaba Qwen | text+vision | current | small (35B MoE, 3B active) | 256K / 64K | opt | F | C | 0.248 / 1.485 | coding, fast-repeatable, budget, multimodal | Weights: https://huggingface.co/Qwen/Qwen3.6-35B-A3B. First Qwen3.6 open release (2026-04-16/17). |
| 120 | `qwen3.6-flash` | Alibaba Qwen | text+vision | previous | small | 1M / 64K | opt | F | VC | 0.25 / 1.5 | fast-repeatable, multimodal | → qwen3.7-flash · Snapshot qwen3.6-flash-2026-04-16 (supports fine-tuning; main version does not). |
| 121 | `qwen3.6-max-preview` | Alibaba Qwen | text | preview | frontier (1T) | 256K / 64K | opt | M | E | 1.3 / 7.8 | coding | → qwen3.7-max · Preview model — may be removed; a GA 'qwen3.6-max' never shipped, the line went to qwen3.7-max. No reason to pick this over qwen3.8-max/qwen3… |
| 122 | `qwen3.6-plus` | Alibaba Qwen | text+vision | previous | large | 1M / 64K | opt | M | C | 0.5 / 3 | coding, multimodal | → qwen3.7-plus · Snapshot qwen3.6-plus-2026-04-02. Prefer qwen3.7-plus unless you specifically validated 3.6 behaviour. |
| 123 | `qwen3.7-flash` | Alibaba Qwen | text+vision | current | small | 1M / 128K | opt | F | VC | 0.03 / 0.13 | fast-repeatable, budget, multimodal, long-documents | Tiered pricing by input length. Thinking ON by default — for cheap high-volume tasks turn it off. Snapshot qwen3.7-flash-2026-07-15. |
| 124 | `qwen3.7-max` | Alibaba Qwen | text+vision | previous | frontier | 1M / 128K | opt | F | E | 2.5 / 7.5 | hard-tasks, agentic-coding, coding, long-documents | → qwen3.8-max · Snapshots: qwen3.7-max-2026-05-20 (text), qwen3.7-max-2026-06-08 (adds image/video). A thinking-only qwen3.7-max-preview/2026-05-17 exists bu… |
| 125 | `qwen3.7-plus` | Alibaba Qwen | text+vision | latest | large | 1M / 128K | opt | M | C | 0.4 / 1.6 | everyday-default, coding, agentic-coding, multimodal, long-documents | Sensible default Qwen model for most workloads. Thinking ON by default → disable for chat/latency. Snapshot qwen3.7-plus-2026-05-26. |
| 126 | `qwen3.7-text-embedding` | Alibaba Qwen | embedding | latest | undisclosed | 128K / — | n/a | F | VC | 0.07 / 0 | embedding | Default dim 1024 — set `dimensions` explicitly (up to 2560). Same price as v4, so there is no cost reason to stay on v4. |
| 127 | `qwen3.8-max` | Alibaba Qwen | text+vision | latest | frontier (2.4T MoE) | 1M / 128K | opt | S | E | 2 / 6 | hard-tasks, deep-reasoning, agentic-coding, coding, long-documents, multimodal | Thinking is ON by default — pass enable_thinking=false (or a thinking_budget) for latency-sensitive use. Snapshot qwen3.8-max-0902 (2026-09-02) improves codi… |
| 128 | `text-embedding-v4` | Alibaba Qwen | embedding | previous | undisclosed | 8K / — | n/a | F | VC | 0.07 / 0 | embedding | → qwen3.7-text-embedding · Keep only if an existing index was built with it (embeddings are not compatible across models). Release month inferred from Qwen3-… |
| 129 | `wan2.7-image` | Alibaba Qwen | image-gen | latest | undisclosed | — | n/a | F | C | — | image | Best value general-purpose gen+edit model in the catalog. 300 RPM. |
| 130 | `wan2.7-image-pro` | Alibaba Qwen | image-gen | latest | undisclosed | — | n/a | S | M | — | image | Choose for brand-consistent campaigns, character sheets, 4K. 300 RPM. |
| 131 | `z-image-turbo` | Alibaba Qwen | image-gen | current | small (6B) | — | n/a | VF | VC | — | image | Pick for high-volume, low-latency generation. 120 RPM. |
| 132 | `qwen-image-edit` | Alibaba Qwen | image-edit | legacy | medium (20B) | — | n/a | M | C | — | image | → qwen-image-2.0 · Use qwen-image-2.0 / wan2.7-image for editing unless matching the open-weight Qwen-Image-Edit exactly. Release month from Aug-2025 open-so… |
| 133 | `qwen-mt-turbo` | Alibaba Qwen | translation | deprecated | undisclosed | 16K / 8K | n/a | F | VC | 0.16 / 0.49 | translation | → qwen-mt-flash · Migrate to qwen-mt-flash. Supported languages: 92 — Indonesian IS supported on all four MT models (per docs language table). Max input 8,19… |
| 134 | `doubao-seed-2-0-code-preview-260215` | ByteDance | text+vision | preview | frontier | 256K / 128K | opt | S | M | 0.47 / 2.37 | agentic-coding, coding | → doubao-seed-2-1-pro-260628 · ByteDance/Volcengine Ark ids carry a YYMMDD snapshot suffix (e.g. 260628 = 2026-06-28); the un-suffixed gateway ids (seed-2.0-… |
| 135 | `doubao-seed-2-0-lite-260428` | ByteDance | text+vision | current | medium | 256K / 128K | opt | F | VC | 0.09 / 0.53 | everyday-default, budget, multimodal, audio, fast-repeatable | → doubao-seed-2-1-turbo-260628 · ByteDance/Volcengine Ark ids carry a YYMMDD snapshot suffix (e.g. 260628 = 2026-06-28); the un-suffixed gateway ids (seed-2.… |
| 136 | `doubao-seed-2-0-mini-260428` | ByteDance | text+vision | current | small | 256K / 128K | opt | VF | VC | 0.03 / 0.28 | budget, fast-repeatable, multimodal | ByteDance/Volcengine Ark ids carry a YYMMDD snapshot suffix (e.g. 260628 = 2026-06-28); the un-suffixed gateway ids (seed-2.0-pro, seedance-2.0 ...) follow t… |
| 137 | `doubao-seed-2-0-pro-260215` | ByteDance | text+vision | previous | frontier | 256K / 128K | opt | S | M | 0.47 / 2.37 | hard-tasks, deep-reasoning, coding, multimodal | → doubao-seed-2-1-pro-260628 · ByteDance/Volcengine Ark ids carry a YYMMDD snapshot suffix (e.g. 260628 = 2026-06-28); the un-suffixed gateway ids (seed-2.0-… |
| 138 | `doubao-seed-2-1-pro-260628` | ByteDance | text+vision | latest | frontier | 256K / 256K | opt | S | M | 0.83 / 4.14 | hard-tasks, deep-reasoning, agentic-coding, coding, multimodal, long-documents | ByteDance/Volcengine Ark ids carry a YYMMDD snapshot suffix (e.g. 260628 = 2026-06-28); the un-suffixed gateway ids (seed-2.0-pro, seedance-2.0 ...) follow t… |
| 139 | `doubao-seed-2-1-turbo-260628` | ByteDance | text+vision | latest | large | 256K / 256K | opt | M | C | 0.41 / 2.07 | everyday-default, agentic-coding, coding, fast-repeatable, multimodal, long-documents | ByteDance/Volcengine Ark ids carry a YYMMDD snapshot suffix (e.g. 260628 = 2026-06-28); the un-suffixed gateway ids (seed-2.0-pro, seedance-2.0 ...) follow t… |
| 140 | `doubao-seedance-2-0-260128` | ByteDance | video-gen | current | frontier | — | n/a | S | E | — | video, multimodal | → seedance-2.5 · Snapshot-pinned CN id of Seedance 2.0. Seedance 2.0 (id snapshot 260128, launched 2026-02-12): text/image/video/audio → video with natively … |
| 141 | `doubao-seedance-2-0-fast-260128` | ByteDance | video-gen | current | large | — | n/a | M | M | — | video, fast-repeatable | → doubao-seedance-2-0-mini-260615 · Seedance 2.0 Fast: same multimodal inputs/audio/references as standard 2.0 but capped at 480p/720p (no 1080p), 4–15 s, fa… |
| 142 | `doubao-seedance-2-0-mini-260615` | ByteDance | video-gen | current | medium | — | n/a | F | C | — | video, budget, fast-repeatable | Seedance 2.0 Mini (snapshot 260615, launched 2026-06-15 on Volcengine Ark): 480p/720p only, 4–15 s, 24 fps, native audio, up to 12 references (6 images + 3 a… |
| 143 | `dreamina-seedance-2-0-260128` | ByteDance | video-gen | current | frontier | — | n/a | S | E | — | video, multimodal | → seedance-2.5 · 'dreamina-' prefixed ids are the SAME Seedance 2.0 weights exposed on BytePlus ModelArk (international) under ByteDance's Dreamina/Jimeng (即… |
| 144 | `dreamina-seedance-2-0-ep` | ByteDance | video-gen | current | frontier | — | n/a | S | E | — | video | → seedance-2.5 · '-ep' ids (dreamina-seedance-2-0-ep, dreamina-seedance-2-0-fast-ep) were NOT found in any upstream doc. Best hypothesis: gateway aliases tha… |
| 145 | `dreamina-seedance-2-0-fast-260128` | ByteDance | video-gen | current | large | — | n/a | M | M | — | video, fast-repeatable | → seedance-2.0-mini · 'dreamina-' prefixed ids are the SAME Seedance 2.0 weights exposed on BytePlus ModelArk (international) under ByteDance's Dreamina/Jime… |
| 146 | `dreamina-seedance-2-0-fast-ep` | ByteDance | video-gen | current | large | — | n/a | M | M | — | video, fast-repeatable | → seedance-2.0-mini · '-ep' ids (dreamina-seedance-2-0-ep, dreamina-seedance-2-0-fast-ep) were NOT found in any upstream doc. Best hypothesis: gateway aliase… |
| 147 | `mimo-v2.5-asr` | other | asr | current | small (8B) | — | n/a | F | VC | — | audio, budget | Called through an OpenAI-style chat-completions endpoint with base64 audio (`input_audio`), `stream=true` supported, language `auto/zh/en` (mimo.mi.com docs)… |
| 148 | `seed-1.6` | ByteDance | text+vision | legacy | large (230B total / ~23B active) | 256K / 16K | opt | M | C | 0.11 / 1.1 | budget, translation | → seed-1.8 · CN id doubao-seed-1-6-250615; sibling SKUs 1.6-thinking / 1.6-vision / 1.6-lite exist upstream but are not in this catalog. ByteDance/Volcengine… |
| 149 | `seed-1.6-flash` | ByteDance | text+vision | legacy | small | 256K / 16K | opt | VF | VC | 0.075 / 0.3 | budget, fast-repeatable | → seed-2.0-mini · CN id doubao-seed-1-6-flash-250615 (a 250715 refresh also exists upstream). ByteDance/Volcengine Ark ids carry a YYMMDD snapshot suffix (e.… |
| 150 | `seed-1.8` | ByteDance | text+vision | previous | large | 256K / 64K | opt | M | C | 0.25 / 2 | budget, multimodal, long-documents | → seed-2.0-lite · CN id doubao-seed-1-8-251228 (announced 2025-12-18; BytePlus international listing Jan 2026). ByteDance/Volcengine Ark ids carry a YYMMDD s… |
| 151 | `seed-2.0-lite` | ByteDance | text+vision | current | medium | 256K / 128K | opt | F | VC | 0.09 / 0.53 | everyday-default, budget, multimodal, fast-repeatable | → doubao-seed-2-1-turbo-260628 · Gateway alias (BytePlus naming) for the Seed 2.0 Lite line; see doubao-seed-2-0-lite-260428. ByteDance/Volcengine Ark ids ca… |
| 152 | `seed-2.0-mini` | ByteDance | text+vision | current | small | 256K / 128K | opt | VF | VC | 0.03 / 0.31 | budget, fast-repeatable, multimodal | Gateway alias (BytePlus naming) for Seed 2.0 Mini; see doubao-seed-2-0-mini-260428. ByteDance/Volcengine Ark ids carry a YYMMDD snapshot suffix (e.g. 260628 … |
| 153 | `seed-2.0-pro` | ByteDance | text+vision | previous | frontier | 256K / 128K | opt | S | M | 0.47 / 2.37 | hard-tasks, deep-reasoning, coding, multimodal | → doubao-seed-2-1-pro-260628 · Gateway alias in BytePlus naming (`seed-2.0-pro` ≈ ModelArk `seed-2-0-pro-260215`); identical weights to doubao-seed-2-0-pro-2… |
| 154 | `seedance-1.0-pro` | ByteDance | video-gen | legacy | large | — | n/a | S | M | — | video, budget | → seedance-1.5-pro · CN id doubao-seedance-1-0-pro-250528; sibling 1.0-lite (t2v/i2v) exists upstream. Duration presets unverified across routes. ByteDance/V… |
| 155 | `seedance-1.0-pro-fast` | ByteDance | video-gen | legacy | large | — | n/a | F | C | — | video, budget, fast-repeatable | → seedance-2.0-fast · ModelArk id seedance-1-0-pro-fast-251015. ByteDance/Volcengine Ark ids carry a YYMMDD snapshot suffix (e.g. 260628 = 2026-06-28); the u… |
| 156 | `seedance-1.5-pro` | ByteDance | video-gen | previous | large | — | n/a | M | M | — | video, budget | → seedance-2.0 · CN id doubao-seedance-1-5-pro-251215. ByteDance/Volcengine Ark ids carry a YYMMDD snapshot suffix (e.g. 260628 = 2026-06-28); the un-suffixe… |
| 157 | `seedance-2.0` | ByteDance | video-gen | current | frontier | — | n/a | S | E | — | video, multimodal | → seedance-2.5 · Seedance 2.0 (id snapshot 260128, launched 2026-02-12): text/image/video/audio → video with natively synchronised audio (dialogue, lip-sync,… |
| 158 | `seedance-2.0-fast` | ByteDance | video-gen | current | large | — | n/a | M | M | — | video, fast-repeatable | → seedance-2.0-mini · Seedance 2.0 Fast: same multimodal inputs/audio/references as standard 2.0 but capped at 480p/720p (no 1080p), 4–15 s, faster generatio… |
| 159 | `seedance-2.0-mini` | ByteDance | video-gen | current | medium | — | n/a | F | C | — | video, budget, fast-repeatable | Seedance 2.0 Mini (snapshot 260615, launched 2026-06-15 on Volcengine Ark): 480p/720p only, 4–15 s, 24 fps, native audio, up to 12 references (6 images + 3 a… |
| 160 | `seedance-2.5` | ByteDance | video-gen | latest | frontier | — | n/a | S | VE | — | video, multimodal, hard-tasks | Upstream id doubao-seedance-2-5-260628 (Ark) / dreamina-seedance-2-5-260628 (ModelArk). Duration may be passed as -1 to let the model choose. ByteDance/Volce… |
| 161 | `seedream-4.0` | ByteDance | image-gen | previous | large | — | n/a | F | C | — | image, budget, fast-repeatable | → seedream-4.5 · CN id doubao-seedream-4-0-250828 (same model as the gateway's doubao-seedream-4-0-250828). ByteDance/Volcengine Ark ids carry a YYMMDD snaps… |
| 162 | `seedream-4.5` | ByteDance | image-gen | current | large | — | n/a | M | C | — | image, multimodal | → seedream-5.0-pro · CN id doubao-seedream-4-5-251128 (Ark launch 2025-12-03; OpenRouter 2025-12-23). Reference-image limit reported as up to 14 — unverified… |
| 163 | `seedream-5.0-pro` | ByteDance | image-gen | latest | frontier | — | n/a | S | M | — | image, multimodal, hard-tasks | Seedream 5.0 Pro (snapshot 260628, released 2026-07-08): 'beyond generation — it understands design'; complex information/infographic visualisation, pixel-le… |
| 164 | `kimi-k3` | Moonshot Kimi | text+vision | latest | frontier (2.8T MoE, 104B active, 896 exper) | 1.05M / — | always | S | E | 3 / 15 | hard-tasks, deep-reasoning, agentic-coding, coding, long-documents, multimodal | Gateway lists owned_by=openai (different upstream than the ali-hosted K2.x). Recommended reasoning_effort=max, temperature 1.0, top_p 0.95 (1.0 for agentic).… |
| 165 | `claude-fable-5-1` | Anthropic | text+vision | latest | frontier | 1M / 125K | always | S | VE | 10 / 50 | deep-reasoning, hard-tasks, agentic-coding, long-documents, multimodal, coding | The 'Fable' tier (introduced 2026-06-09) sits ABOVE Opus: it is 'a Mythos-class model that we've made safe for general use'. Fable and Mythos share the same … |
| 166 | `claude-opus-4-5-20251101` | Anthropic | text+vision | legacy | large | 200K / 64K | opt | M | E | 5 / 25 | coding, hard-tasks | → claude-opus-4-6 · DATED SNAPSHOT under the pre-4.6 naming scheme; alias 'claude-opus-4-5' also exists upstream and resolves to this snapshot. Bedrock: anth… |
| 167 | `gpt-5.3-codex` | OpenAI | text+vision | previous | frontier | 400K / 125K | always | M | M | 1.75 / 14 | agentic-coding, coding | → gpt-5.4 · Launched Feb 5, 2026 in Codex for ChatGPT Pro first; API followed. Reasoning cannot be set to none. Best used through Responses API with apply_pa… |
| 168 | `glm-5.3` | Zhipu GLM | text | latest | frontier (753B MoE, ~40B active) | 1M / 125K | always | M | M | 1.4 / 4.4 | agentic-coding, coding, hard-tasks, deep-reasoning, long-documents | Release date: 2026-08-14 per launch coverage; Z.ai release-notes page dates the entry 2026-08-18. Same price as GLM-5.2 — always choose 5.3 over 5.2 unless y… |
| 169 | `glm-5.3-flash` | Zhipu GLM | text+vision | latest | large (320B MoE, 18B active) | 1.05M / 125K | always | F | VC | 0.15 / 0.5 | everyday-default, budget, agentic-coding, coding, multimodal, fast-repeatable, long-documents | Best price/performance in this catalog. Tested pre-release as 'ox-alpha' on OpenRouter. Recommended temperature 1, top_p 0.95, reasoning_effort max. Gateway … |
| 170 | `gpt-oss-120b` | OpenAI | text | current | large (117B MoE, 5.1B active) | 128K / 128K | always | VF | VC | — | budget, fast-repeatable, self-hosting / data-residency | Gateway lists owned_by=openai but OpenAI does not serve it via api.openai.com — the reseller is proxying a third-party host. Docs page exists for reference o… |

---

## 7. Deprecation & change calendar (act on these)

| Date | What | Action |
|---|---|---|
| (retracted) 2026-09-14 | DeepSeek had announced routing `deepseek-v4-pro` → V4.1-Flash; retracted 2026-09-10 — V4-Pro continues at unchanged billing | Nothing to do now; watch for V4.1-Pro release |
| 2026-10-02 | `gemini-2.5-flash-image` / `nano-banana` shut down | Move to `nano-banana-2` or `gemini-3.1-flash-lite-image` |
| 2026-10-15 | Earliest possible retirement of `claude-haiku-4-5` (Anthropic: "not sooner than") | Watch Anthropic deprecations; no successor Haiku in catalog yet |
| 2026-10-23 | `gpt-4.1-nano` retires upstream (not in catalog; signals 4.1 line wind-down) | Plan `gpt-4.1`/`-mini` exit |
| 2026-11-02 | `grok-imagine-image-quality` retired → redirects to Grok Imagine Image 2.0 low | Don't adopt |
| 2026-11-21 | `gpt-5.6-sol` promo pricing ends ($4/$20 → $5/$30) | Re-check cost tables |
| 2026-11-24 | Earliest retirement of `claude-opus-4-5-20251101` | Migrate to `claude-opus-5` |
| 2026-12-11 | `gpt-5-mini` and `gpt-5-nano` snapshots shut down | Migrate to `gpt-5.6-luna` (OpenAI's official target: `gpt-5.6-terra`) |
| Already dead upstream | `gemini-3-pro-image-preview` (2026-06-25), `qwen-mt-turbo` (frozen), `gpt-5.2-codex` (not in catalog) | Use `nano-banana-pro`, `qwen-mt-flash` |
| 2027-02 → 2027-09 | Earliest retirements: Opus 4.6 (02-05), Sonnet 4.6 (02-17), Opus 4.7 (04-16), Opus 4.8 (05-28), Fable 5 (06-09), Sonnet 5 (06-30), Opus 5 (07-24), Fable 5.1 (09-01) | Anthropic's one-year floors |
| 2028-05-14 | `gemini-embedding-001` shutdown | Re-embed with `gemini-embedding-2` or `qwen3.7-text-embedding` |
| Preview ids (no date, can vanish) | `gemini-3.1-pro-preview`, `gemini-3-flash`(-preview), `gemini-3.1-flash-image-preview`, `gemini-embedding-2-preview`, `qwen3.6-max-preview`, `glm-5.2-fast-preview`, `doubao-seed-2-0-code-preview-260215`, `grok-imagine-video-1.5-preview` | Pin a stable alternative in production |

---

## 8. What could not be verified (do not assume)

- `gpt-oss-120b`: not served by api.openai.com; TokenKu's host, price and throughput unknown.
- `gpt-image-2-count`: hypothesised per-image billing alias of `gpt-image-2`.
- `omni-fast`, `omni-fast-v2v`: no upstream match; Gemini Omni Flash is the best guess.
- `dreamina-seedance-2-0-ep`, `dreamina-seedance-2-0-fast-ep`: hypothesised provisioned-endpoint routes to the same 260128 weights.
- `mj_upsample_action`: not in the standard New API action map; likely the post-upscale "Upscale Subtle/Creative/2x/4x" buttons.
- `glm-5.2-fast-preview`: release date and USD price (Model Studio lists CNY 16/56 ≈ $2.20/$7.80; AIMLAPI resells at $4.55/$14.30).
- `deepseek-v4-flash` on TokenKu: whether the Alibaba-hosted (`owned_by=ali`) route mirrors DeepSeek's own V4.1-Flash remap or still serves original V4-Flash weights.
- Qwen: `qwen3-max` USD price (used AA's $1.20/$6.00); `qwen3.5-ocr`, `qwen3-vl-embedding`, `qwen3-vl-rerank` have China-region pricing only; livetranslate ids have no USD price; `qwen-flash-character` release date.
- ByteDance: no official USD price card for Seed 2.1 — figures are CNY conversions; official Volcengine pages are JS-rendered and were read via the rendered AI Hub page and third-party trackers.
- Anthropic benchmark scores are published as images — exact numbers omitted.
- All speed figures are vendor-API medians (Artificial Analysis / OpenRouter), not TokenKu measurements.
- Gateway behaviour for region-locked features (Alibaba Beijing-only function calling on `qwen3-coder-flash`, `qwen-flash`; `gui-plus` Beijing-only).

---

## 9. Sources

Primary documentation consulted (per-model URLs are in `tokenku-models-catalog.json` → `sources`):

- OpenAI: developers.openai.com/api/docs/models (per-model pages for gpt-6-astra, gpt-5.6-sol/terra/luna, gpt-5.5, gpt-5.5-pro, gpt-5.4*, gpt-5.3-codex, gpt-5.2, gpt-5-mini/nano, gpt-4.1*, gpt-4o*, gpt-image-2/2.5), openai.com/api/pricing, OpenAI deprecations page, openai.com news (GPT-6 Astra, GPT-5.6, GPT-Image-2.5), huggingface.co/openai/gpt-oss-120b.
- Anthropic: platform.claude.com/docs (models overview, pricing, model deprecations, extended/adaptive thinking, effort), anthropic.com/news (Opus 5, Sonnet 5, Fable 5 / 5.1, Opus 4.6–4.8).
- Google: ai.google.dev/gemini-api/docs/models, /pricing, /thinking, /deprecations, /image-generation, /video (Veo 3.1), /embeddings; blog.google and developers.googleblog.com launch posts (Gemini 3.5 Flash, 3.1 Pro, 3.1 Flash-Lite, Nano Banana 2 / Pro / 2 Lite).
- Alibaba: alibabacloud.com/help/en/model-studio (model list, pricing, deep-thinking, Qwen-MT, Omni, audio, TTS, livetranslate, embeddings, rerank, OCR, GUI-Plus, HappyHorse, Wan, Qwen-Image), qwen.ai blog posts, HF model cards (Qwen3.5-397B-A17B, 122B-A10B, 27B, 35B-A3B, Qwen3.6-27B, 35B-A3B, Z-Image-Turbo).
- DeepSeek: api-docs.deepseek.com (models & pricing, news 2026-04-24 V4, 2026-08-13 V4-Pro-0813, 2026-09-10 V4.1-Flash), HF DeepSeek-V4 cards.
- Zhipu: docs.z.ai (GLM-5.2, GLM-5.3, GLM-5.3-Flash, pricing, thinking), HF zai-org cards, Model Studio listing for glm-5.2-fast-preview.
- Moonshot: platform.moonshot.ai docs & pricing, HF moonshotai (Kimi-K2.6, K2.7-Code, K3), Kimi K3 license.
- MiniMax: platform.minimax.io docs & pricing, HF MiniMaxAI (M2.5, M2.7, M3).
- ByteDance: ai.volcengine.com/model (AI Hub), volcengine.com/docs/82379, docs.byteplus.com (ModelArk), seed.bytedance.com (Seed 2.0/2.1, Seedance 1.0/1.5/2.0/2.5, Seedream 4.0/4.5/5.0), HF XiaomiMiMo/MiMo-v2.5-ASR.
- xAI: docs.x.ai (Grok Imagine image/video, deprecations).
- Midjourney / Suno: github.com/QuantumNous/new-api (Midjourney and Suno relay action maps), docs.midjourney.com (V8.2, video), suno.com help.
- Cross-vendor: artificialanalysis.ai (intelligence index, tok/s, TTFT), openrouter.ai model pages (latency medians, context), lmarena.ai.

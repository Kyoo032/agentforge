# Research: Kimi and Lumina (references vs Agentforge)

Notes for product modes. **Claims** are labeled by source. **Ship** lines are Agentforge decisions from the locked plan — not guarantees about third-party products.

Canonical IA: [../../product-modes.md](../../product-modes.md).

---

## Lumina (sidebar IA reference)

### Claim (operator / plan)

Persistent left modes roughly: **Home, Image, Video, Agent, Audio, Chat, Avatar**. Image and Video are first-class **generate** products with a prompt bar, not buried only inside Chat.

- **Source:** Locked product plan + operator screenshots (not a public help URL we can cite for that exact label set).
- **Related public product (do not conflate names):** [Luma Agents](https://lumalabs.ai/app) documents a multimodal creative workspace (image, video, audio, text) with agent-driven generation and editing. Learning-center articles: [The Luma Agent](https://lumalabs.ai/learning-center/articles/about-the-luma-agent), [Brainstorm Mode](https://lumalabs.ai/learning-center/articles/brainstorm-mode). Treat Luma as a *similar industry shape*, not as proof that Agentforge’s “Lumina” screenshot labels match Luma’s current nav.

### What Agentforge v1 ships

| Reference idea | Ship? |
|----------------|-------|
| Dedicated Image / Video / Agent / Chat in the left nav | **Yes** (labels: Chat, Agents, Images, Videos, Presentation, Settings) |
| Image / Video as prompt + results (not canvas-first) | **Yes** |
| Home hub | **No** |
| Audio mode | **No** |
| Avatar mode | **No** |
| Infinite canvas / full multimodal agent orchestration | **No** |

---

## Kimi Work / Kimi Slides

### Claims (sourced)

| Claim | Source |
|-------|--------|
| Kimi Slides turns a one-sentence topic, pasted text, or uploaded document into a structured presentation with design | [Kimi Slides overview](https://www.kimi.com/help/slides/ppt-overview) |
| Multi-format input (PDF, Word, PPTX, Excel, TXT, images); template / reference-image capabilities | Same help page |
| After generation: online preview/edit; download editable PPTX; present online | Same help page; product page [kimi.ai/features/slides](https://www.kimi.ai/features/slides) |
| Entry URL `https://www.kimi.com/slides` | [Kimi Slides overview](https://www.kimi.com/help/slides/ppt-overview) |
| English help mirror (Kimi PPT naming) | [Kimi PPT overview (EN)](https://www.kimi.com/en/help/ppt/ppt-overview) |
| Adaptive (research-first) vs Visual (design-first / Nano Banana Pro) modes appear in third-party guides | e.g. [kimi-ai.chat guide](https://kimi-ai.chat/guide/kimi-slides/) — **third-party**; prefer official help when modes are confirmed in-product |

Kimi Work also surfaces office-style tools beyond Slides (Deep Research, Websites, Docs, Sheets, Design) in operator screenshots; those are **not** documented here as Agentforge scope.

### What Agentforge v1 ships

| Kimi idea | Ship? |
|-----------|-------|
| Prompt → deck outline / content | **Yes** (gateway chat → JSON outline) |
| In-app preview | **Yes** (HTML slide preview; Agentforge styling) |
| Download editable PPTX | **Yes** (`pptxgenjs`; no LibreOffice) |
| Adaptive / Visual modes | **No** |
| Nano Banana (or any image model) on every slide | **No** |
| In-browser slide editor | **No** |
| Deep Research / Docs / Sheets / Websites / Design modes | **No** |
| Full multi-format upload + template clone as v1 gate | **No** (optional paste later; not a gate) |
| Google Slides / PNG export suite | **No** |

We copy the **job** (topic → usable deck file), not the **product**.

---

## Side-by-side: reference vs Agentforge

| Concern | Lumina-shaped ref | Kimi Slides | Agentforge v1 |
|---------|-------------------|-------------|---------------|
| Primary nav | Mode rail including Image/Video | Work tools including Slides | Chat / Agents / Images / Videos / Presentation |
| Image/Video | First-class generate | N/A (slides) | Prompt + gallery on existing gateway generate tools |
| Presentations | N/A | Outline + design + online edit + PPTX | Outline + HTML preview + PPTX only |
| Chat | One of several modes | Separate from Slides | Default assistant; sessions inside Chat |
| Agents | Dedicated Agent mode | Agent can create slides as a side task | Catalog + studio + talk; not a media canvas |

---

## Refusal list (copy)

Do not implement as “parity” with references:

1. Lumina Home / Audio / Avatar  
2. Kimi Adaptive/Visual, Deep Research, Docs/Sheets/Websites/Design  
3. In-browser WYSIWYG slide editor  
4. Treating `/runs/image` or `/runs/video` as generate endpoints (see [gateway-media.md](./gateway-media.md))

---

## Open research gaps

- No stable public URL found for a product literally branded **Lumina** with Home/Image/Video/Agent/Audio/Chat/Avatar. IA for that name is plan-locked from screenshots; cite Luma Agents only as a related multimodal workspace.
- Adaptive vs Visual on Kimi: confirm against live UI if product copy depends on those mode names; v1 does not ship them either way.

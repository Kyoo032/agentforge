import { WORK_PRODUCT_MODES, type ProductMode } from "../agents/product-modes";

export type LibraryMode = "images" | "videos" | "documents" | "research" | "presentations";

export type LibraryEntry = {
  mode: LibraryMode;
  title: string;
  prompt: string;
  resultSummary: string;
};

export type WorkspaceTemplate = {
  id: string;
  label: string;
  description: string;
  productModes: ProductMode[];
};

export const TEMPLATE_LIBRARY: LibraryEntry[] = [
  {
    mode: "images",
    title: "Launch-page product hero",
    prompt: `Photorealistic product hero for a hardware landing page.

Subject: a closed matte-black wireless earbuds case, slightly open so one earbud catches the light. Sit it on a single slab of honed charcoal stone. Leave a clean left third of the frame empty for a headline.

Camera: 50mm equivalent, eye-level, shallow depth of field (subject sharp, stone falloff). Soft keyed side light from camera-left, faint warm bounce from the right, no hard specular blowouts.

Grade: muted, high-end catalog. Cool stone, warm metal hinge. 4:5 crop, generous negative space.

Must not: logos, readable UI, hands, watermarks, extra products, neon, busy backgrounds.`,
    resultSummary: "Catalog hero with a real lighting setup and a reserved type column — not a floating gadget on grey.",
  },
  {
    mode: "images",
    title: "App in a working desk",
    prompt: `Editorial photograph of software in use — not a fake floating UI.

Scene: a walnut desk, morning window light from the left. An open 14-inch laptop shows a sparse desktop app: narrow icon rail, a wide canvas with a simple dashboard (three cards, one empty chart). A ceramic cup and a closed notebook sit just out of the focal plane.

Camera: 35mm, slight overhead (15°), f/2.8 so the screen is readable and the desk drops off. No moiré, no glow that looks like a stock overlay.

Palette: slate UI, warm wood, cool window. 16:9.

Must not: real brand marks, unreadably tiny type, people, stickers on the laptop, neon gradients.`,
    resultSummary: "A believable in-situ app frame you can drop into a pitch or docs site.",
  },
  {
    mode: "images",
    title: "Lookbook material board",
    prompt: `Top-down lookbook still of materials, as if a designer laid them out for a client review.

On light oak: three folded textile swatches (sand wool, charcoal cotton, cream linen) overlapping a sheet of warm-grey chipboard, a brass clip, and a short length of natural twine. Visible weave. One swatch slightly out of square so it feels handled.

Lighting: north-window, soft, almost no shadow under the clip. Square 1:1 crop. Studio-clean but not sterile.

Must not: logos, price tags, hands, color-checker cards, text.`,
    resultSummary: "A tactile palette board with named materials and a real layout, not a texture dump.",
  },
  {
    mode: "images",
    title: "Quiet kitchen header",
    prompt: `Photoreal lifestyle still for an article header.

A pale stone counter, late-morning side light. One ceramic mug with visible steam, two citrus slices on a small plate, a folded linen napkin. Generous empty space on the right for a title.

Camera: 40mm, counter-height, shallow focus on the mug rim. Photoreal, no HDR crunch.

Palette: cream, soft orange, cool stone. 16:9 landscape.

Must not: faces, brands, cereal boxes, over-prop styling, text overlays.`,
    resultSummary: "A calm breakfast still with a reserved type area — usable as a real header.",
  },
  {
    mode: "images",
    title: "Dusk city establishing",
    prompt: `Cinematic establishing still for an evening or travel piece.

Rooftop terrace at civil dusk. Warm street lights just coming on in the mid-ground, cool leftover sky. A low concrete parapet in the foreground, empty. No people.

Camera: 35mm landscape, slight downward tilt, long shadows. Fine 35mm grain, not digital smoothness.

16:9. Moody but readable architecture.

Must not: recognizable landmark branding, drones in frame, text, crowds, car logos.`,
    resultSummary: "A dated, cinematic skyline plate with a foreground shelf — not a generic stock dusk.",
  },
  {
    mode: "images",
    title: "Macro fabric study",
    prompt: `Macro product study for a lookbook or materials page.

Fill the frame with folded wool against cotton: sand, charcoal, cream. Show the weave, a few stray fibers, a soft crease. Studio softbox from above-left, gentle specular on the wool.

Lens: 90–100mm macro feel, square crop. Neutral grade.

Must not: labels, logos, scissors, hands, drop shadows that look composited.`,
    resultSummary: "Close material evidence, not a styled flat-lay of props.",
  },
  {
    mode: "images",
    title: "Night retail window",
    prompt: `Narrative retail photograph — a window that implies a shop without showing a brand.

Evening. One wooden chair, a lit table lamp, a hanging plant behind rain-streaked glass. Interior warm; street cool. Wet pavement reflections. No mannequins.

Camera: 50mm from the sidewalk, slight angle so you see both the room and the glass reflection.

Must not: store names, neon OPEN signs, people, sale posters.`,
    resultSummary: "A story-ready window with a lighting contrast you can crop for a campaign.",
  },
  {
    mode: "images",
    title: "Fog path cover",
    prompt: `Soft nature cover plate.

A foggy pine path, wet needles, a simple wooden footbridge in the middle distance. Pale morning light, almost no sky. Landscape 16:9.

Camera: 50mm, shallow depth so the bridge is the hold. No hikers, no signage.

Must not: text, watermarks, fantasy color, sun flares that look like a filter pack.`,
    resultSummary: "A quiet path with a single structural beat — usable as a cover, not wallpaper.",
  },
  {
    mode: "images",
    title: "About-page portrait",
    prompt: `Natural-light portrait for an about or speakers page.

An adult, mid-30s to 50s, looking slightly off-camera. Linen shirt, muted olive seamless. Gentle catchlight, no beauty-dish glare. 85mm feel, head and shoulders, comfortable space above the head.

Photoreal. Neutral grade. No jewelry brands, no logos on clothes.

Must not: stock-smile, ring-light catchlights, heavy retouch, text.`,
    resultSummary: "A usable head-and-shoulders frame with a real lens and backdrop, not a selfie crop.",
  },
  {
    mode: "images",
    title: "Desk-object still",
    prompt: `Editorial object still for an essay or tools piece.

Dark walnut desktop. A brass paperweight, an uncapped fountain pen, two stacked cloth-bound notebooks. Raking side light, deep shadows, one specular on the brass.

Camera: 60mm, 30° down, tight enough that the objects feel chosen. No laptop.

Must not: brands, screens, coffee-shop clutter, floating drop shadows.`,
    resultSummary: "A quiet object study with a lighting plan — not three props on a white sweep.",
  },
  {
    mode: "videos",
    title: "Product-page turntable",
    prompt: `6-second product turntable for a PDP, not a generic spin.

Subject: a matte stainless water bottle, no logo, on seamless warm-grey infinity. Slow clockwise yaw, ~60° total, hold the last frame clean for 8 frames.

Light: two softboxes, faint floor reflection, no moving highlights that scream CGI. 16:9, 24fps feel, 720p-safe.

Audio: silence (we add our own).

Must not: text, hands, extra SKUs, snap zooms, stock-music energy.`,
    resultSummary: "A shoppable 360 with a lighting plot and an end hold — usable on a product page.",
  },
  {
    mode: "videos",
    title: "Feature walkthrough open",
    prompt: `8-second silent opener for a product film.

Camera starts on a dim oak desk, then a 2-second push onto a laptop. The screen shows a clean chat UI (composer + one short reply), UI glow only — no fake holographic overlays. Soft practical lamp in the background.

16:9, 24fps, gentle handheld (not shaky). End on a readable UI frame.

Must not: voiceover, logo sting, cursor-click spam, unreadably small type, neon.`,
    resultSummary: "A cinematic open that lands on a real-looking UI, not a logo bumper.",
  },
  {
    mode: "videos",
    title: "Before / after process",
    prompt: `6-second process cut for an ops or launch story.

Beat 1 (0–2.2s): a cluttered spreadsheet on a monitor, cool office light, slight rack. Beat 2: a hard-light wipe (not a cheesy page-curl) into a tidy kanban board on the same monitor. Hold 1.5s.

Palette: grey + one accent (dusty blue). 16:9. No faces.

Must not: stock-happy office extras, big “BEFORE/AFTER” titles, swoosh sound design.`,
    resultSummary: "A readable before/after with a timed wipe — not a meme transition.",
  },
  {
    mode: "videos",
    title: "Seamless social loop",
    prompt: `Vertical 9:16 silent loop, 8 seconds, for a social background.

Abstract: pale paper folds slowly become a paper plane that exits top-right. The first and last frames must match so it loops. Pastel paper, soft studio light, no text.

Camera: locked off, 50mm-feel macro. Seamless.

Must not: logos, captions, jump cuts, faces.`,
    resultSummary: "A true loop with a start/end match — usable under type, not a one-shot gag.",
  },
  {
    mode: "videos",
    title: "Night rain hold",
    prompt: `Seamless 8-second ambient hold.

Rain on a night window, city bokeh beyond the glass. Slow 1-meter rack from drops to the bokeh and back so frame 0 ≈ frame last. No faces, no text. 16:9.

Audio: we will add our own — picture only.

Must not: lightning jumps, horror grade, readable street signs.`,
    resultSummary: "A loopable rain plate with a rack-focus move — an intro hold, not weather B-roll.",
  },
  {
    mode: "videos",
    title: "Kitchen pour insert",
    prompt: `5-second insert for a lifestyle cut.

Close-up: dark coffee pouring into a speckled ceramic cup, visible steam, warm kitchen side light. Gentle handheld. End on the filled cup, liquid still.

16:9, shallow focus on the stream. No brands on the kettle.

Must not: faces, text, slow-mo syrup, latte art logos.`,
    resultSummary: "A timed pour that ends on a usable still — an insert, not a coffee commercial.",
  },
  {
    mode: "documents",
    title: "Decision memo",
    prompt: `Write a decision memo a director can approve in one sitting. This is a finished memo, not a skeleton.

Role: chief of staff to the operator.
Audience: the person who will pick one option today.
Deliverable: 5–7 sections, 700–1000 words. Short paragraphs. No executive-summary fluff.

Sample context (replace bracketed fields, keep the shape):
- Decision: whether [Northline] [keeps building checkout on the current gateway] or [moves the next quarter of volume to a second provider].
- Why now: [renewal in 6 weeks], [error budget at 2.1%], [one enterprise deal blocked on uptime].
- Options: stay; dual-run for 90 days; hard cutover in 30 days.
- Constraint: [one engineer-week] and [no new vendor legal review this month] unless we pick the hard cutover.

Required sections:
1. Decision in one sentence (name the pick).
2. Context and cost of waiting.
3. Options table-in-prose (cost, time, risk, reversibility — mark unknowns instead of guessing).
4. Recommendation and the two tradeoffs we are accepting.
5. What we will measure in 30 days.
6. Ask (who does what by when).

Quality bar: specific numbers from the sample or clearly tagged [sample]. No “we should consider exploring.” No “in today’s landscape.”
Do not invent statutes, customers, or quotes.`,
    resultSummary: "A one-sitting decision memo with a named pick, tradeoffs, and a 30-day measure — not empty headings.",
  },
  {
    mode: "documents",
    title: "Project one-pager",
    prompt: `Write a one-page project brief that a new teammate could execute from. Finished prose, not an outline.

Role: project lead.
Audience: the people who will do the work and the person funding it.
Deliverable: 6 sections, ~600–800 words.

Sample context (replace bracketed fields):
- Project: ship [Fieldnote] [export-to-DOCX] so [owners] can leave the studio with a file.
- Window: [three weeks].
- Success: [first 20 exports] complete without a support thread; [p95 under 8s].
- Out of scope: [collaborative editing], [cloud sync].

Required sections:
1. Outcome (one paragraph, measurable).
2. Who it is for and the job they are hiring this for.
3. In-scope / out-of-scope (two short lists).
4. Approach and the one technical risk.
5. Sequence (week 1 / 2 / 3) with a named owner per week.
6. Ask (decision or resource).

Quality bar: a stranger can tell what “done” looks like. No mission statements. No classroom jargon.
Do not invent budget line items that are not in the sample.`,
    resultSummary: "An executable one-pager with scope, a three-week sequence, and a clear ask.",
  },
  {
    mode: "documents",
    title: "Design RFC",
    prompt: `Draft a design RFC people can argue with. Write the actual argument, not a table of contents.

Role: the engineer proposing the change.
Audience: two reviewers who will stamp or block.
Deliverable: 7–8 sections, 900–1300 words.

Sample context (replace bracketed fields):
- Change: store [workspace product modes] on the [workspace row] instead of inferring them from [custom agents].
- Problem: [Home only showed Chat + Agents] until someone built an agent; job studios stayed locked.
- Constraint: do not delete [agent tables]; Chat still uses the hidden [quick-chat] agent.

Required sections:
1. Summary (what changes, what does not).
2. Problem and who feels it.
3. Proposal (data, read path, write path).
4. Alternatives considered (at least two, with why they lose).
5. Rollout and migrate (null means all work modes).
6. Risks and how we will notice them.
7. Open questions (real ones, not “TBD”).

Quality bar: a reviewer can implement from this. Name files or tables in the sample; do not invent a second schema.
No “this RFC proposes to explore.”`,
    resultSummary: "A stampable RFC with a real proposal, two rejected alternatives, and a migrate rule.",
  },
  {
    mode: "documents",
    title: "Meeting digest",
    prompt: `Turn the notes below into a digest a missing teammate can act on. Drop chatter. Keep owners and dates.

Role: the person who ran the meeting.
Audience: attendees plus two people who were not there.
Deliverable: 4 sections. Tight lists. Every action has an owner and a date.

Sample notes (replace with yours, keep this density):
- [Northline] checkout: error budget [2.1%], [Sam] wants dual-run, [Leah] says legal will not review a second vendor this month.
- [Fieldnote] export: [week 2], [Jin] owns DOCX; blocked on [filename collisions].
- Parking: [usage dashboard colors], [rename the product].
- Decision (provisional): stay on the current gateway through [renewal]; write the dual-run design this week.

Required sections:
1. Decisions (what was actually decided — if provisional, say so).
2. Action items (owner + date + the first concrete step).
3. Risks / blockers that still need a person.
4. Parking lot (one line each, no essays).

Quality bar: no “team to follow up.” If an owner is missing, write “[needs owner]”.
Do not invent attendees who are not in the notes.`,
    resultSummary: "An action digest with owners and dates — not a transcript with nicer headings.",
  },
  {
    mode: "documents",
    title: "Kickoff agenda",
    prompt: `Write a 45-minute kickoff agenda someone can run without you in the room.

Role: facilitator.
Audience: a mixed room (ops + one decision-maker).
Deliverable: timed blocks with a desired outcome per block, plus a one-paragraph purpose at the top.

Sample context (replace bracketed fields):
- Kickoff for [Fieldnote export].
- Room: [Jin] (build), [Leah] (legal), [Sam] (ops), [you].
- Must leave with: [scope locked], [week-1 owner], [the one risk we will watch].

Required blocks (keep the times, rewrite the prompts):
1. 0:00–0:05 Purpose and what “done” means this cycle.
2. 0:05–0:15 Context: who hurts today, what we will not build.
3. 0:15–0:30 Sequence and owners (week 1/2/3).
4. 0:30–0:40 Risks and the decision we need today.
5. 0:40–0:45 Wrap, parking lot, written recap owner.

For each block: time, owner, the question the room must answer, the artifact they should leave with.
Quality bar: a substitute facilitator can run this. No icebreakers. No “introductions if we have time.”`,
    resultSummary: "A run-ready 45-minute agenda with outcomes per block — not a list of topics.",
  },
  {
    mode: "documents",
    title: "Handoff pack",
    prompt: `Write a handoff a new owner can use on Monday without a call.

Role: outgoing owner.
Audience: the person picking this up cold.
Deliverable: 6 sections, checkbox lists where they help, short paragraphs where they do not.

Sample context (replace bracketed fields):
- Handing [Fieldnote export] from [Jin] to [Rafi].
- Done: [outline JSON], [DOCX download from a starter].
- In progress: [section regen with attachments].
- Known break: [filenames collide when two exports share a title].
- Where it lives: [apps/web/lib/document-generate.ts], [packages/core templates].

Required sections:
1. What this is (one paragraph).
2. Done (checkboxes, evidence of done).
3. In progress (what “good” looks like for each).
4. Who owns what after today.
5. Known risks and the first place to look.
6. Paths, credentials (none in-repo), and how to verify.

Quality bar: the new owner should not need Slack. Mark secrets as “in Settings / keychain,” never paste keys.
No “happy to hop on a call if needed” as a substitute for the pack.`,
    resultSummary: "A Monday-ready handoff with paths, risks, and proof of done — not a farewell paragraph.",
  },
  {
    mode: "research",
    title: "Competitive landscape",
    prompt: `Produce a landscape note a product lead can use in a Monday review. This is research, not a listicle.

Question: How do local-first AI workspaces differ from hosted “paste a key and chat” clients, and what actually matters to a single-operator buyer?

Method:
- Search for current product pages, recent reviews, and pricing pages (last 12 months).
- Compare at least three named products. If search misses a name, say so — do not invent a fourth.
- Prefer primary pages over roundup blogs.

Deliverable (6 notes + a summary):
1. Buyer job (what the operator is hiring the app for).
2–4. One note per product: positioning in their own words, what is actually local, where a key is required, a gap.
5. What changed in the last year (dated).
6. Open questions and weak evidence.

Quality bar: every claim has a source URL from the hits. Mark confidence (high/med/low). No “the market is rapidly evolving.”
Do not invent funding rounds or user counts.`,
    resultSummary: "A sourced landscape with a buyer job, three real products, and dated change — not three adjectives.",
  },
  {
    mode: "research",
    title: "Source synthesis",
    prompt: `Synthesize the search hits (and any attached files) into a brief a skeptic would trust.

Topic: [replace] whether a personal AI client should keep custom-agent builders in the default UI or park them.

Method:
- Cluster hits into themes. Quote or paraphrase with URLs.
- Call out disagreements instead of averaging them away.
- List evidence gaps (what we still do not know).

Deliverable:
- Summary (8–12 lines, the argument).
- 5–7 notes: each note is one theme, with body + sources.
- A final note: “What would change this recommendation.”

Quality bar: if hits are thin, the summary says so and does not pad. No invented papers.
Do not use classroom framing unless the hits are about that.`,
    resultSummary: "A theme map with disagreements and a kill-criterion — not a stacked summary of the same take.",
  },
  {
    mode: "research",
    title: "Question backlog",
    prompt: `Build a research backlog a team can work in order. Questions only — no fake answers.

Topic: [replace] what a one-person Toko Token client must prove in the first 30 days after install (key paste → first useful artifact).

Deliverable:
- Title + 6-line framing of the decision these questions serve.
- 12 questions, ranked by impact if answered.
- For each: the question, why it matters (one line), the cheapest way to answer it (search / interview / ship-and-watch), and what a good answer looks like.

Quality bar: no questions that are just “what is X.” No “explore the space.”
If search hits suggest a question is already settled, say so and demote it.`,
    resultSummary: "Twelve ranked questions with a method and a done-looks-like — not a brainstorm dump.",
  },
  {
    mode: "research",
    title: "Claim check",
    prompt: `Stress-test one claim. Do not write a general explainer.

Claim (replace): “Operators will not miss a custom-agent builder if Chat and the job studios work on Home.”

Method:
- Search for contrary product decisions, reviews that mention builders, and any data on feature discovery.
- Split evidence: supports / contradicts / not actually about this claim.

Deliverable:
- Summary: current verdict and confidence.
- Note: supporting evidence (sourced).
- Note: contradicting evidence (sourced).
- Note: category errors (hits that sound relevant but are not).
- Note: what evidence would flip the verdict.
- Note: what we should measure in-product instead of arguing.

Quality bar: steelman the other side. No “more research is needed” without naming the measurement.
Do not invent surveys.`,
    resultSummary: "A verdict on one claim with a flip-condition — not a both-sides paragraph.",
  },
  {
    mode: "research",
    title: "Options matrix",
    prompt: `Build a comparison a decision-maker can scan in two minutes, then read.

Decision (replace): how a local AI client should expose models after the owner pastes one gateway key.
Options: (A) one curated picker, (B) raw provider catalog, (C) curated + an Advanced disclosure.

Rows you must fill (mark unknown, do not guess): cost to the owner, time to first success, risk of a bad default, lock-in, reversibility, support burden.

Deliverable:
- Summary recommendation in 6 lines.
- One note per option (how it feels on day one).
- One note that is the matrix in prose (every cell).
- One note: what we would measure in week 1 to see if the pick was wrong.

Quality bar: unknowns stay unknown. No fake benchmarks.
Sources on any factual claim.`,
    resultSummary: "A scored option grid with explicit unknowns and a week-1 kill metric.",
  },
  {
    mode: "research",
    title: "Vendor diligence",
    prompt: `Write a diligence note for a single inference vendor. Skeptical. Sourced.

Vendor under review (replace): the OpenAI-compatible gateway at api.tokotokenai.com (Toko Token). Do not confuse it with other similarly named products.

Look for: auth model, rate limits, image/video endpoints, retention language, status page, pricing page, and what breaks if the key is wrong.

Deliverable:
- Summary: fit for a single-operator local client (yes / yes-with-gaps / no), plus confidence.
- Notes: product surface, pricing shape, data handling as they state it, operational risk, open questions.
- Every factual sentence needs a hit URL. If the site is silent, write “not published” — do not infer.

Quality bar: this should be safe to paste into a decision memo.
Do not invent SLAs, SOC reports, or user counts.`,
    resultSummary: "A sourced diligence note with a fit verdict and ‘not published’ gaps — not a brochure rewrite.",
  },
  {
    mode: "presentations",
    title: "Seed-stage pitch",
    prompt: `Outline a 9-slide pitch a stranger can follow without you. This is a narrative, not a label list.

Role: founder presenting to one decision-maker (not a conference).
Audience: they already use model APIs; they do not want another “agent platform.”
Deliverable: 9 slides. Each slide: a claim heading (not a topic), 3–5 complete-sentence bullets, and speaker notes that say what you argue if they push back.

Sample story (replace bracketed fields, keep the arc):
- [Kiln] is a local client for [Toko Token]. You install it, paste a key, and work in Chat plus job studios. Custom-agent Build is parked on purpose.
- Pain: buying a gateway key leaves “where do I use this?”
- Insight: the buyer is one person on one machine, not an org admin.
- Ask: [design partners for the installer] this month — not a priced round unless you change it.

Slide arc (keep this order):
1. Title — the job, not the category.
2. The moment after they buy a key.
3. Why hosted suites and tinkerer shells both miss.
4. The product: Home has every work mode; a workspace can shrink the rail.
5. How a job (Documents or Images) actually finishes.
6. Why Build is parked.
7. Proof or plan (installer exists; be honest about what is not proven).
8. The ask.
9. Next seven days.

Quality bar: no “team / traction / vision” filler slides. No one-word bullets. Notes are argument, not “keep it short.”
Do not invent revenue or logos.`,
    resultSummary: "A 9-slide pitch with claim-headings, full bullets, and pushback notes — not seven labels.",
  },
  {
    mode: "presentations",
    title: "Weekly operating review",
    prompt: `Build a 7-slide weekly review the room can finish in 15 minutes.

Role: the person who owns the desk.
Audience: two peers and one decision-maker. They have not read the tracker.
Deliverable: 7 slides. Headings are facts or asks. Bullets are complete. Notes say the one number you will defend.

Sample week (replace):
- Shipped: [workspace-owned rail], [Settings is key-only].
- Slipped: [packaged installer not rebuilt], so the installed app is still last month’s UI.
- Risk: [prompt templates were one-liners], so live jobs look cheap.
- Ask: [approve rebuilding the NSIS] or [keep using desktop:dev].

Slide list:
1. Title + the week ending date.
2. What actually shipped (evidence).
3. What slipped and the recovery date.
4. The one metric that moved (or “none — here is why”).
5. Decisions we need in this room.
6. Next week: three outcomes, not a task dump.
7. Risks we are watching.

Quality bar: a person who missed last week can vote. No “updates” as a heading.
Do not invent metrics.`,
    resultSummary: "A 15-minute operating review with evidence, a slip, and a room decision — not a status dump.",
  },
  {
    mode: "presentations",
    title: "Workshop opener",
    prompt: `Design a 6-slide opener a facilitator can run in 10 minutes, then get out of the way.

Role: facilitator.
Audience: six people who did not read the pre-read.
Deliverable: 6 slides. Working agreements and outcomes are specific enough to point at later.

Sample session (replace):
- Purpose: lock [Fieldnote export] scope for three weeks.
- Outcome: a written in/out list and a week-1 owner before lunch.
- Agreement: phones down for the first 40 minutes; park product-rename talk.

Slides:
1. Why this room, today.
2. The decision we must leave with (one sentence).
3. Timed agenda.
4. Working agreements (behaviors, not values).
5. Out of bounds for this session.
6. How we will know we succeeded at 12:00.

Quality bar: a substitute can facilitate. No icebreaker slide. No stock “be respectful.”
Notes: the sentence you say out loud, not design notes.`,
    resultSummary: "A 10-minute opener with a leave-with decision and enforceable agreements.",
  },
  {
    mode: "presentations",
    title: "Ship-day readout",
    prompt: `Outline a 8-slide launch readout for the people who will try the thing this afternoon.

Role: the person who shipped it.
Audience: support + one exec + the people who will click it.
Deliverable: 8 slides. Include limits and a support path — a launch without those is a demo.

Sample ship (replace):
- What shipped: [GTM workspace-first rail] on webdev.
- Who it is for: [the operator of this machine].
- How to try: [open /chat, confirm six work tabs, paste-key Settings].
- Known limit: [installed Electron is last build until NSIS is rebuilt].
- Support: [this repo’s Settings + doctor.mjs], not a ticket queue.

Slides:
1. What is in their hands today.
2. Who it is for (and not for).
3. The path: install or webdev → key → first job.
4. What they should see on Home.
5. What we parked and why.
6. Known limits (honest).
7. If it breaks, do this.
8. Next milestone and owner.

Quality bar: someone can try it without you. No “excited to share.” No vanity metrics.
Do not invent uptime.`,
    resultSummary: "A ship-day deck with a try-path, parked work, and a break-glass slide.",
  },
  {
    mode: "presentations",
    title: "Retro with owners",
    prompt: `Build a 6-slide retro that ends in named owners, not vibes.

Role: the person who ran the last cycle.
Audience: the people who did the work.
Deliverable: 6 slides. Bullets under eight words only if they still make a claim. Notes hold the story.

Sample cycle (replace):
- Tried: [agent-union rail], then [workspace-owned modes].
- Worked: [Home unlocks all job studios].
- Stalled: [example prompts were one-liners], so generate looked cheap.
- Change: [rewrite the template library as briefs] and [stop calling cards “examples”].

Slides:
1. The cycle we are judging (dates).
2. What we tried — facts.
3. What worked — evidence.
4. What stalled — cause, not blame.
5. What we will change next cycle (max three).
6. Owners and the first date.

Quality bar: every change has a person. No “communicate better.”
Do not invent sentiment scores.`,
    resultSummary: "A retro that closes on three changes with owners — not a mood board.",
  },
  {
    mode: "presentations",
    title: "All-hands recap",
    prompt: `Design a 7-slide recap for a room that was not in the work.

Role: the person telling the story of the last two weeks.
Audience: mixed — some will only remember one slide.
Deliverable: 7 slides. One metric. One story. One ask. Friendly, not cute.

Sample recap (replace):
- Win: [Chat is ready without Build].
- Miss: [packaged app still on the August installer].
- Metric: [first useful artifact time] — say if we did not measure it.
- Story: [someone pasted a key and could not find Documents until this week].
- Ask: [rebuild desktop] or [keep using the webdev window].

Slides:
1. Two-week title.
2. Wins (evidence).
3. Misses (ours).
4. The one metric, or an honest “we did not measure.”
5. One story from the floor.
6. Asks.
7. Thank-yous that name work, not personalities.

Quality bar: a late arriver can retell this. No roadmaps disguised as recaps.
Do not invent applause lines.`,
    resultSummary: "A room recap with one metric, one story, and a real ask — not a highlight reel.",
  },
];

export const WORKSPACE_TEMPLATES: WorkspaceTemplate[] = [
  {
    id: "general",
    label: "General",
    description: "Every work tab: chat, documents, research, images, videos, and presentation.",
    productModes: [...WORK_PRODUCT_MODES],
  },
  {
    id: "organisation",
    label: "Organisation",
    description: "Cross-team workspace with every work tab.",
    productModes: [...WORK_PRODUCT_MODES],
  },
  {
    id: "students",
    label: "Students",
    description: "Study desk: chat, documents, research, images, and presentation.",
    productModes: ["chat", "documents", "research", "images", "presentations"],
  },
  {
    id: "office",
    label: "Office",
    description: "Everyday ops: chat, documents, and presentation.",
    productModes: ["chat", "documents", "presentations"],
  },
  {
    id: "legal",
    label: "Legal",
    description: "Matter review, memos, and redlines: chat, documents, research, legal, and presentation.",
    productModes: ["chat", "documents", "research", "legal", "presentations"],
  },
  {
    id: "sales",
    label: "Sales",
    description: "Outreach and deal-room: chat, documents, images, and presentation.",
    productModes: ["chat", "documents", "images", "presentations"],
  },
  {
    id: "marketing",
    label: "Marketing",
    description: "Campaigns and creative: chat, documents, images, videos, and presentation.",
    productModes: ["chat", "documents", "images", "videos", "presentations"],
  },
  {
    id: "product",
    label: "Product",
    description: "Specs and roadmaps: chat, documents, research, and presentation.",
    productModes: ["chat", "documents", "research", "presentations"],
  },
];

const WORKSPACE_IDS = new Set(WORKSPACE_TEMPLATES.map((entry) => entry.id));

export function libraryForMode(mode: LibraryMode): LibraryEntry[] {
  return TEMPLATE_LIBRARY.filter((entry) => entry.mode === mode);
}

export function isWorkspaceTemplateId(id: string): boolean {
  return WORKSPACE_IDS.has(id);
}

export function productModesForTemplate(id: string | null | undefined): ProductMode[] {
  if (!id) {
    return ["chat"];
  }
  const template = WORKSPACE_TEMPLATES.find((entry) => entry.id === id);
  return template ? [...template.productModes] : [...WORK_PRODUCT_MODES];
}

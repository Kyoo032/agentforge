/**
 * The guide's card, rendered. Reading the markup is how a node test checks what a screen reader and a
 * keyboard will meet: the dialog role and its label, the controls every card must have (Next, a
 * visible Skip, a close button), Back everywhere but the first stop, and a decorative mascot.
 */
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it } from "vitest";
import { GuideCard, GUIDE_BODY_ID, GUIDE_PROGRESS_ID, GUIDE_TITLE_ID, type GuideCardProps } from "@/components/guide-card";
import { GuideTour } from "@/components/guide-tour";
import { applyLocale, resetLocaleForTests, t } from "./i18n";

afterEach(() => {
  resetLocaleForTests();
});

const noop = () => {};

function card(overrides: Partial<GuideCardProps> = {}): string {
  return renderToStaticMarkup(
    <GuideCard
      mode="step"
      index={1}
      total={5}
      stepId="workspaces"
      title="Add more tools any time"
      body="Open Workspaces."
      productName="Nultron"
      placement="right"
      style={{ left: 10, top: 20, width: 352 }}
      onNext={noop}
      onBack={noop}
      onSkip={noop}
      onClose={noop}
      {...overrides}
    />,
  );
}

describe("the guide card", () => {
  it("is a labelled, modal dialog described by its progress, title and body", () => {
    const markup = card();

    expect(markup).toContain('role="dialog"');
    expect(markup).toContain('aria-modal="true"');
    expect(markup).toContain('aria-label="A quick tour of Nultron"');
    expect(markup).toContain(`aria-describedby="${GUIDE_PROGRESS_ID} ${GUIDE_TITLE_ID} ${GUIDE_BODY_ID}"`);
    expect(markup).toContain(`id="${GUIDE_TITLE_ID}"`);
    expect(markup).toContain(`id="${GUIDE_BODY_ID}"`);
    expect(markup).toContain(`id="${GUIDE_PROGRESS_ID}"`);
    // Focusable by script, so focus can land on the card when the tour opens and when a step changes.
    expect(markup).toContain('tabindex="-1"');
  });

  it("says where it is in the tour, in words, and marks the current dot", () => {
    const markup = card({ index: 2 });

    expect(markup).toContain("Step 3 of 5");
    expect(markup.match(/data-current="true"/g)).toHaveLength(1);
    expect(markup).toContain('data-testid="guide-dots"');
    // The dots are decoration; the words carry the meaning.
    expect(markup).toMatch(/<ol[^>]*aria-hidden="true"[^>]*data-testid="guide-dots"/);
  });

  it("has Next, a visible Skip and a close button on a middle step, and Back too", () => {
    const markup = card({ index: 2 });

    expect(markup).toContain('data-testid="guide-next"');
    expect(markup).toContain('data-testid="guide-skip"');
    expect(markup).toContain('data-testid="guide-close"');
    expect(markup).toContain('data-testid="guide-back"');
    expect(markup).toContain(">Next<");
    expect(markup).toContain(">Skip<");
    expect(markup).toContain('aria-label="Close the guide"');
  });

  it("has no Back on the first step (absent, not disabled)", () => {
    const markup = card({ index: 0 });

    expect(markup).not.toContain('data-testid="guide-back"');
    expect(markup).toContain('data-testid="guide-next"');
    expect(markup).toContain('data-testid="guide-skip"');
    expect(markup).toContain('data-testid="guide-close"');
  });

  it("turns Next into Done on the last step", () => {
    const markup = card({ index: 4 });

    expect(markup).toContain(">Done<");
    expect(markup).not.toContain(">Next<");
    expect(markup).toContain('data-testid="guide-back"');
  });

  it("offers the tour with Start, Skip and close, no Back and no progress", () => {
    const markup = card({ mode: "offer", stepId: null, title: "Want a quick tour?", body: "Five stops." });

    expect(markup).toContain('data-guide-mode="offer"');
    expect(markup).toContain(">Show me around<");
    expect(markup).toContain('data-testid="guide-skip"');
    expect(markup).toContain('data-testid="guide-close"');
    expect(markup).not.toContain('data-testid="guide-back"');
    expect(markup).not.toContain('data-testid="guide-progress"');
    expect(markup).not.toContain('data-testid="guide-dots"');
    expect(markup).toContain(`aria-describedby="${GUIDE_TITLE_ID} ${GUIDE_BODY_ID}"`);
  });

  it("carries the mascot as decoration only, still and small", () => {
    const markup = card();

    expect(markup).toContain('data-testid="chat-mascot"');
    expect(markup).toMatch(/data-testid="chat-mascot"[^>]*aria-hidden="true"|aria-hidden="true"[^>]*data-testid="chat-mascot"/);
    expect(markup).toContain("--nx-size:36px");
    expect(markup).toContain('data-state="presenting"');
    // Never busy: nothing loops.
    expect(markup).not.toContain("data-busy");
    expect(card({ mode: "offer", stepId: null }) ).toContain('data-state="wave"');
  });

  it("is fixed above the rest of the app and carries its placement for the test drive", () => {
    const markup = card({ placement: "center" });

    expect(markup).toContain("fixed z-[100]");
    expect(markup).toContain('data-guide-placement="center"');
    expect(markup).toContain('data-guide-step="workspaces"');
    expect(markup).toContain("left:10px");
  });

  it("speaks Indonesian on an id desk", () => {
    applyLocale("id");
    const markup = renderToStaticMarkup(
      <GuideCard
        mode="step"
        index={0}
        total={5}
        stepId="modes"
        title={t("guide.steps.modes.title")}
        body="x"
        productName="Nultron"
        placement="right"
        style={{}}
        onNext={noop}
        onBack={noop}
        onSkip={noop}
        onClose={noop}
      />,
    );

    expect(markup).toContain("Alat Anda ada di sini");
    expect(markup).toContain("Langkah 1 dari 5");
    expect(markup).toContain(">Lewati<");
    expect(markup).toContain(">Lanjut<");
    expect(markup).toContain('aria-label="Tutup panduan"');
    expect(markup).toContain('aria-label="Tur singkat Nultron"');
  });
});

describe("the tour overlay while nothing is open", () => {
  it("renders nothing at all", () => {
    expect(renderToStaticMarkup(<GuideTour visibleModes={["chat"]} ready />)).toBe("");
    expect(renderToStaticMarkup(<GuideTour visibleModes={["chat"]} ready={false} />)).toBe("");
  });
});

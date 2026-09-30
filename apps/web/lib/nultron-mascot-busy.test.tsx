import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { NultronMascot } from "@/components/nultron/nultron-mascot";
import { isMascotBusy, MASCOT_STATES } from "./mascot-states";

/**
 * `data-busy` is what keeps a status mascot moving through an idle desk (`app/globals.css`, "Ambient
 * pause"), so it must follow the caller's word that a job is running, not the pose alone: a job
 * stream that drops leaves a working pose behind with nothing running.
 */
describe("NultronMascot data-busy", () => {
  it("is set for a working pose beside a job the caller says is running", () => {
    const html = renderToStaticMarkup(<NultronMascot state="thinking" busy />);
    expect(html).toContain('data-busy="true"');
  });

  it("is not set for the same pose when nothing is running", () => {
    expect(renderToStaticMarkup(<NultronMascot state="thinking" />)).not.toContain("data-busy");
    expect(renderToStaticMarkup(<NultronMascot state="writing" busy={false} />)).not.toContain("data-busy");
  });

  it("is not set for a resting or finished pose, even when the caller says busy", () => {
    for (const state of ["idle", "wave", "sleep", "celebrating", "error", "surprised", "love", "lets-go"] as const) {
      expect(renderToStaticMarkup(<NultronMascot state={state} busy />), state).not.toContain("data-busy");
    }
  });

  it("is set for the charging pose while an install or a download runs", () => {
    expect(renderToStaticMarkup(<NultronMascot state="charging" busy />)).toContain('data-busy="true"');
  });

  it("is not set on an empty desk, where a working pose is decoration", () => {
    expect(renderToStaticMarkup(<NultronMascot state="calculating" placement="empty" busy />)).not.toContain(
      "data-busy",
    );
  });

  it("agrees with isMascotBusy for every state", () => {
    for (const state of MASCOT_STATES) {
      const html = renderToStaticMarkup(<NultronMascot state={state} busy />);
      expect(html.includes('data-busy="true"'), state).toBe(isMascotBusy(state, "beside"));
    }
  });
});

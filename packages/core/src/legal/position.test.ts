import { describe, expect, it } from "vitest";
import { GENERIC_CONTRACT_PLAYBOOK } from "./playbook-generic-contract";
import { resolveLegalPlaybook } from "./position";

const doc = (name: string, preview = "") => ({ name, preview });

describe("resolveLegalPlaybook", () => {
  it("keeps a playbook the person chose", () => {
    const chosen = resolveLegalPlaybook({
      chosen: GENERIC_CONTRACT_PLAYBOOK,
      sideRole: "borrower",
      docs: [doc("mutual-nda.docx")],
    });
    expect(chosen.assumed).toBe(false);
    expect(chosen.playbook.id).toBe("generic-contract");
  });

  it("stands in the credit-agreement position for a borrower or a lender", () => {
    expect(resolveLegalPlaybook({ chosen: null, sideRole: "Borrower", docs: [] }).playbook.id).toBe(
      "credit-agreement-borrower",
    );
    expect(resolveLegalPlaybook({ chosen: null, sideRole: "lender", docs: [doc("mutual-nda.docx")] }).playbook.id).toBe(
      "credit-agreement-borrower",
    );
  });

  it("stands in the receiving-party NDA when a file says so", () => {
    const choice = resolveLegalPlaybook({
      chosen: null,
      sideRole: "buyer",
      docs: [doc("Term sheet.docx", "Non-disclosure agreement between the parties.")],
    });
    expect(choice.assumed).toBe(true);
    expect(choice.playbook.id).toBe("nda-receiving");
  });

  it("stands in the general commercial position otherwise", () => {
    const choice = resolveLegalPlaybook({ chosen: null, sideRole: "buyer", docs: [doc("services.docx", "Services")] });
    expect(choice.assumed).toBe(true);
    expect(choice.playbook.id).toBe("generic-contract");
  });
});

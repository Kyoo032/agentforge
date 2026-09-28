/**
 * A position for a matter that arrived without a playbook.
 * A playbook the person already chose is kept. Otherwise the side, then the file names, pick a built-in.
 */

import { CREDIT_AGREEMENT_BORROWER_PLAYBOOK } from "./playbook-credit-agreement";
import { GENERIC_CONTRACT_PLAYBOOK } from "./playbook-generic-contract";
import { NDA_RECEIVING_PLAYBOOK } from "./playbook-nda";
import type { Playbook } from "./types";

const CREDIT_ROLES = new Set(["borrower", "lender"]);
const NDA_HINT = /\b(nda|non-disclosure|nondisclosure|confidentiality agreement)\b/i;

export type PlaybookChoice = {
  playbook: Playbook;
  /** True when the person did not choose one and the harness stood in a built-in. */
  assumed: boolean;
};

export function resolveLegalPlaybook(input: {
  chosen: Playbook | null;
  sideRole: string;
  docs: readonly { name: string; preview: string }[];
}): PlaybookChoice {
  if (input.chosen) {
    return { playbook: input.chosen, assumed: false };
  }
  const role = input.sideRole.trim().toLowerCase();
  if (CREDIT_ROLES.has(role)) {
    return { playbook: CREDIT_AGREEMENT_BORROWER_PLAYBOOK, assumed: true };
  }
  const haystack = input.docs.map((doc) => `${doc.name}\n${doc.preview}`).join("\n");
  if (NDA_HINT.test(haystack)) {
    return { playbook: NDA_RECEIVING_PLAYBOOK, assumed: true };
  }
  return { playbook: GENERIC_CONTRACT_PLAYBOOK, assumed: true };
}

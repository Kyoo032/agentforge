/**
 * Built-in playbook: non-disclosure agreement, receiving party side.
 * Positions are stated as the Recipient's lawyer would state them. Generic wording; no party names.
 */

import type { Playbook } from "./types";

export const NDA_RECEIVING_PLAYBOOK: Playbook = {
  id: "nda-receiving",
  title: "Non-disclosure agreement, receiving party",
  contractType: "Non-disclosure agreement",
  items: [
    {
      id: "ND-01",
      title: "Definition of Confidential Information",
      keywords: ["Confidential Information", "definition", "means", "marked", "designated"],
      preferred:
        "Confidential Information limited to information marked or identified as confidential at disclosure, or reduced to writing and so identified within thirty days of oral disclosure.",
      fallback:
        "Information that a reasonable person would understand to be confidential, provided the standard exceptions apply.",
      walkAway: "All information disclosed in any form deemed confidential regardless of marking, with no exceptions.",
      required: true,
    },
    {
      id: "ND-02",
      title: "Standard exceptions",
      keywords: [
        "exceptions",
        "public domain",
        "independently developed",
        "already known",
        "third party",
        "without breach",
      ],
      preferred:
        "Exceptions for information in the public domain, already known to the Recipient, received from a third party without breach, and independently developed without reference to the Confidential Information.",
      fallback:
        "Standard exceptions with the burden on the Recipient to evidence independent development by contemporaneous records.",
      walkAway:
        "No independent-development exception, or no exception for information received lawfully from a third party.",
      required: true,
    },
    {
      id: "ND-03",
      title: "Permitted purpose and use",
      keywords: ["purpose", "permitted purpose", "use", "solely", "evaluating"],
      preferred:
        "Use permitted for the defined Purpose, described broadly enough to cover evaluation, negotiation and performance of the proposed transaction.",
      fallback:
        "A narrowly defined Purpose, provided the Recipient may use the information to perform any resulting agreement.",
      walkAway:
        "A Purpose so narrow that ordinary internal evaluation or advice from professional advisers is prohibited.",
      required: true,
    },
    {
      id: "ND-04",
      title: "Permitted recipients",
      keywords: ["representatives", "affiliates", "advisers", "employees", "disclose to", "need to know"],
      preferred:
        "Disclosure permitted to affiliates, employees, officers, professional advisers, financiers and potential co-investors on a need-to-know basis, without requiring each to sign a joinder.",
      fallback:
        "Disclosure to affiliates and advisers bound by professional duties, with other recipients bound by written obligations no less onerous than the agreement.",
      walkAway:
        "Disclosure limited to named individuals, or an obligation to procure joinder agreements from professional advisers.",
      required: true,
    },
    {
      id: "ND-05",
      title: "Compelled disclosure",
      keywords: ["required by law", "court order", "regulator", "compelled", "legal process", "stock exchange"],
      preferred:
        "Disclosure permitted where required by law, regulation, court order or stock exchange rules, with notice to the Discloser where lawful and practicable and no obligation to resist the requirement.",
      fallback:
        "Notice before disclosure where lawful, with reasonable cooperation at the Discloser's cost in seeking a protective order.",
      walkAway:
        "An obligation to resist a lawful disclosure requirement, or to obtain the Discloser's consent before complying with a court order.",
      required: true,
    },
    {
      id: "ND-06",
      title: "Term and survival",
      keywords: ["term", "survive", "survival", "years", "expiry", "duration"],
      preferred:
        "Confidentiality obligations lasting two years from disclosure, with trade secrets protected only while they remain trade secrets, and a fixed agreement term of one year.",
      fallback: "A three-year confidentiality period running from the date of the agreement.",
      walkAway:
        "Perpetual confidentiality for all information, or obligations surviving indefinitely without a trade-secret qualification.",
      required: true,
    },
    {
      id: "ND-07",
      title: "Return or destruction",
      keywords: ["return", "destroy", "destruction", "certify", "retain", "backup"],
      preferred:
        "Return or destruction at the Recipient's election within thirty days of written request, with a right to retain copies for legal, regulatory and back-up purposes and no certification by an officer.",
      fallback:
        "Destruction with written confirmation by an authorised employee, retaining archival copies subject to continuing confidentiality.",
      walkAway: "Destruction of automated back-ups, or a certificate of destruction sworn by a director.",
      required: true,
    },
    {
      id: "ND-08",
      title: "No warranty and no obligation to proceed",
      keywords: ["no warranty", "as is", "no obligation", "accuracy", "completeness", "no commitment"],
      preferred:
        "Information provided without warranty as to accuracy or completeness, and no obligation on either party to enter into any further agreement.",
      fallback: "A limited warranty that the Discloser is entitled to disclose the information.",
      walkAway:
        "A Recipient obligation to rely on the information, or an exclusivity or standstill commitment introduced through the confidentiality agreement.",
      required: true,
    },
    {
      id: "ND-09",
      title: "Remedies and liability",
      keywords: ["injunction", "injunctive relief", "equitable relief", "damages", "liquidated damages", "remedies"],
      preferred:
        "Either party may seek injunctive relief, with no liquidated damages, no indemnity, and liability limited to direct loss caused by breach.",
      fallback:
        "An acknowledgement that damages may be an inadequate remedy, without a pre-agreed entitlement to an injunction or an indemnity.",
      walkAway:
        "Liquidated damages, an indemnity for all losses, or an automatic entitlement to injunctive relief without proof.",
      required: true,
    },
    {
      id: "ND-10",
      title: "Non-solicitation and governing law",
      keywords: ["non-solicit", "solicit", "employees", "governing law", "governed by", "jurisdiction"],
      preferred: "No non-solicitation covenant, and the governing law and courts of the Recipient's home jurisdiction.",
      fallback:
        "Non-solicitation limited to employees with whom the Recipient had direct contact, for twelve months, excluding general advertising, with a neutral governing law.",
      walkAway:
        "A non-solicitation or non-compete covenant covering all employees or customers, or a foreign forum with no enforcement route.",
      required: false,
    },
  ],
};

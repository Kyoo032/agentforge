/**
 * Built-in playbook: commercial agreement, reviewed for the party receiving the counterparty's draft.
 * Positions are stated as the Client's lawyer would state them. Generic wording; no firm or party names.
 */

import type { Playbook } from "./types";

export const GENERIC_CONTRACT_PLAYBOOK: Playbook = {
  id: "generic-contract",
  title: "Commercial agreement, general review",
  contractType: "Commercial agreement",
  items: [
    {
      id: "CA-01",
      title: "Parties and recitals",
      keywords: ["parties", "recitals", "background", "whereas", "entered into"],
      preferred:
        "The parties are identified by full legal name, registration number and registered office, and the recitals describe the commercial background without imposing obligations.",
      fallback:
        "Recitals may describe the transaction in general terms provided the operative provisions state that the recitals do not create obligations.",
      walkAway:
        "Recitals that purport to impose obligations on the Client, or that name a Client affiliate as a contracting party without its consent.",
      required: true,
    },
    {
      id: "CA-02",
      title: "Definitions and interpretation",
      keywords: ["definitions", "interpretation", "means", "meaning", "defined term"],
      preferred:
        "Every capitalised term is defined once, the definitions of Services, Charges and Deliverables match the executed term sheet, and the interpretation clause provides that headings do not affect construction and that 'including' is without limitation.",
      fallback:
        "Minor definitional inconsistencies are tolerated where the operative clause is unambiguous, provided the commercial definitions match the term sheet.",
      walkAway:
        "A definition of Services, Charges or Deliverables that widens the Client's obligations beyond the agreed scope.",
      required: true,
    },
    {
      id: "CA-03",
      title: "Term and termination",
      keywords: ["term", "termination", "terminate", "expiry", "renewal", "notice period"],
      preferred:
        "A fixed initial term matching the term sheet, renewal only by mutual written agreement, and a right for the Client to terminate for material breach not remedied within thirty days and on the counterparty's insolvency.",
      fallback:
        "Automatic renewal is acceptable where the Client may opt out on not more than sixty days' notice before the renewal date.",
      walkAway:
        "Termination rights exercisable by the counterparty for a minor or remediable breach by the Client without a cure period, or automatic renewal without a Client opt-out.",
      required: true,
    },
    {
      id: "CA-04",
      title: "Termination for convenience",
      keywords: ["convenience", "without cause", "terminate at any time", "termination for convenience"],
      preferred:
        "The Client may terminate for convenience on not more than ninety days' written notice without payment of a termination fee.",
      fallback:
        "Termination for convenience subject to payment of Charges properly incurred to the termination date and unavoidable, documented third-party costs.",
      walkAway:
        "Termination for convenience granted to the counterparty alone, or a termination fee equal to the Charges for the unexpired term.",
      required: false,
    },
    {
      id: "CA-05",
      title: "Payment terms",
      keywords: ["payment", "invoice", "charges", "fees", "interest on late", "due date"],
      preferred:
        "Payment within sixty days of receipt of a valid invoice, a right to withhold amounts disputed in good faith, and late-payment interest not exceeding the statutory rate.",
      fallback:
        "Thirty-day payment terms with a dispute mechanism that suspends interest on disputed sums until the dispute is resolved.",
      walkAway:
        "Payment in advance for the full term, suspension of the Services for late payment of disputed sums, or interest above the statutory rate.",
      required: true,
    },
    {
      id: "CA-06",
      title: "Limitation of liability",
      keywords: ["limitation of liability", "aggregate liability", "liability cap", "exceed", "liable"],
      preferred:
        "The Client's aggregate liability is capped at the Charges paid in the twelve months preceding the claim; the counterparty's cap is not lower than the Client's, and the cap does not apply to the counterparty's indemnities or to breach of confidentiality or data protection obligations.",
      fallback:
        "A mutual cap at one hundred and fifty per cent of annual Charges with separate higher caps for data protection and confidentiality breaches.",
      walkAway:
        "Uncapped liability on the Client, or a counterparty cap below the Client's realistic loss exposure with no separate higher caps.",
      required: true,
    },
    {
      id: "CA-07",
      title: "Exclusion of consequential loss",
      keywords: ["consequential", "indirect loss", "loss of profit", "special damages", "loss of business"],
      preferred:
        "Mutual exclusion of indirect and consequential loss, with the Client's wasted expenditure, cost of procuring replacement services and regulatory fines expressly recoverable as direct loss.",
      fallback:
        "Mutual exclusion of indirect loss with loss of profit excluded on both sides, provided replacement-service costs remain recoverable as direct loss.",
      walkAway:
        "Exclusion of loss of data, wasted expenditure and replacement costs from the Client's recoverable loss while the counterparty's loss of profit remains recoverable.",
      required: true,
    },
    {
      id: "CA-08",
      title: "Indemnities",
      keywords: ["indemnify", "indemnity", "hold harmless", "defend", "third party claim"],
      preferred:
        "The counterparty indemnifies the Client for third-party intellectual property claims, breach of confidentiality and data protection obligations, and wilful default; the Client gives no indemnity beyond misuse of the counterparty's intellectual property.",
      fallback:
        "Mutual indemnities limited to third-party claims, each subject to a conduct-of-claims procedure and to the liability cap other than for intellectual property infringement.",
      walkAway:
        "A general indemnity from the Client for the counterparty's losses arising from the agreement, or an indemnity that is uncapped and outside the conduct-of-claims procedure.",
      required: true,
    },
    {
      id: "CA-09",
      title: "Insurance",
      keywords: ["insurance", "insurer", "insured", "policy of insurance", "cover"],
      preferred:
        "The counterparty maintains professional indemnity, public liability and cyber insurance at not less than the liability cap for the term and six years after, and produces certificates on request.",
      fallback:
        "Insurance at the counterparty's customary levels provided those levels are not below the liability cap.",
      walkAway:
        "No insurance obligation on the counterparty, or an obligation on the Client to insure the counterparty's risk.",
      required: false,
    },
    {
      id: "CA-10",
      title: "Confidentiality",
      keywords: ["confidential information", "confidentiality", "disclose", "confidential", "non-disclosure"],
      preferred:
        "Mutual confidentiality obligations surviving five years after termination, with exceptions for public information, information already held, independent development and disclosure required by law after notice.",
      fallback:
        "Confidentiality obligations of three years with trade secrets protected for as long as they remain trade secrets.",
      walkAway:
        "One-way confidentiality binding only the Client, or an obligation to keep the counterparty's information confidential in perpetuity without a trade-secret qualification.",
      required: true,
    },
    {
      id: "CA-11",
      title: "Data protection",
      keywords: ["personal data", "data protection", "processor", "controller", "data subject", "GDPR"],
      preferred:
        "The counterparty acts as processor under a data processing schedule meeting the applicable Article 28 requirements, with breach notification within twenty-four hours and audit rights for the Client.",
      fallback:
        "Breach notification within seventy-two hours and audit by an independent third party at the Client's cost.",
      walkAway:
        "The counterparty acting as an independent controller of the Client's personal data, or no restriction on international transfers.",
      required: true,
    },
    {
      id: "CA-12",
      title: "Intellectual property ownership and licence",
      keywords: ["intellectual property", "IPR", "licence", "license", "ownership", "deliverables"],
      preferred:
        "The Client owns all intellectual property in the Deliverables on creation and receives a perpetual, irrevocable, royalty-free licence of the background intellectual property needed to use them.",
      fallback:
        "The counterparty retains ownership of the Deliverables and grants the Client a perpetual, worldwide, royalty-free licence including the right to sublicense to affiliates and service providers.",
      walkAway:
        "A licence terminable on expiry of the agreement, or an assignment to the counterparty of intellectual property in the Client's own materials.",
      required: true,
    },
    {
      id: "CA-13",
      title: "Assignment and change of control",
      keywords: ["assign", "assignment", "novate", "change of control", "transfer", "subcontract"],
      preferred:
        "The Client may assign to any affiliate or successor without consent; the counterparty may not assign, novate or subcontract without the Client's prior written consent.",
      fallback:
        "Mutual assignment only with consent not to be unreasonably withheld, with a Client right to assign to affiliates on notice.",
      walkAway:
        "A counterparty right to terminate on a change of control of the Client, or free assignment by the counterparty to any person.",
      required: true,
    },
    {
      id: "CA-14",
      title: "Force majeure",
      keywords: ["force majeure", "beyond its reasonable control", "act of god", "epidemic", "industrial action"],
      preferred:
        "Force majeure excludes the counterparty's suppliers, labour disputes and failure of its own systems, requires mitigation and a continuity plan, and permits the Client to terminate after thirty days of non-performance.",
      fallback:
        "A standard force majeure clause with a sixty-day termination trigger and an obligation to implement the counterparty's business continuity plan.",
      walkAway:
        "Force majeure that excuses the counterparty's subcontractor failures or lack of funds, or that suspends the Client's termination rights indefinitely.",
      required: true,
    },
    {
      id: "CA-15",
      title: "Governing law and jurisdiction",
      keywords: ["governing law", "governed by", "jurisdiction", "courts", "laws of"],
      preferred:
        "The governing law and exclusive jurisdiction of the Client's home jurisdiction as recorded in the term sheet.",
      fallback:
        "A neutral governing law with which the firm is familiar, provided the dispute forum is convenient for the Client.",
      walkAway:
        "The governing law or courts of a jurisdiction in which judgments cannot be enforced against the counterparty.",
      required: true,
    },
    {
      id: "CA-16",
      title: "Dispute resolution and notices",
      keywords: ["dispute resolution", "escalation", "mediation", "arbitration", "notices", "notice in writing"],
      preferred:
        "Executive escalation before proceedings, with notices effective on receipt at the addresses in the agreement and email permitted with confirmation of receipt.",
      fallback: "Mediation as a non-binding step with a fixed time limit before either party may issue proceedings.",
      walkAway:
        "Mandatory arbitration in a foreign seat with the counterparty's nominee as sole arbitrator, or notices deemed served on dispatch by email without confirmation.",
      required: false,
    },
  ],
};

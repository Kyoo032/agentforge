/**
 * Built-in playbook: credit agreement, borrower side. Positions are stated as borrower's counsel would state them.
 * Generic wording modelled on syndicated facility practice; no firm, sponsor or lender names.
 */

import type { Playbook } from "./types";

export const CREDIT_AGREEMENT_BORROWER_PLAYBOOK: Playbook = {
  id: "credit-agreement-borrower",
  title: "Credit agreement, borrower side",
  contractType: "Credit agreement",
  items: [
    {
      id: "CR-01",
      title: "Definitions and Material Adverse Effect standard",
      keywords: ["Material Adverse Effect", "definitions", "means", "material adverse", "interpretation"],
      preferred:
        "Material Adverse Effect is defined by reference to the Group taken as a whole, requires a material adverse effect on the ability of the Obligors to perform their payment obligations, and is determined by the Majority Lenders acting reasonably.",
      fallback:
        "A Material Adverse Effect definition covering the business, assets or financial condition of the Group as a whole, excluding matters disclosed before signing and general market conditions.",
      walkAway:
        "Material Adverse Effect determined in the sole opinion of the Agent or any single Lender, or extending to the prospects of any individual Obligor.",
      required: true,
    },
    {
      id: "CR-02",
      title: "Conditions precedent",
      keywords: [
        "conditions precedent",
        "condition precedent",
        "initial utilisation",
        "documentary conditions",
        "agreed form",
      ],
      preferred:
        "Conditions precedent limited to the documents listed in the schedule, each in agreed form at signing, with the Agent obliged to confirm satisfaction promptly on receipt.",
      fallback:
        "Conditions precedent in form and substance satisfactory to the Agent acting reasonably, with a longstop date for confirmation.",
      walkAway:
        "Conditions precedent at the discretion of each Lender, or a condition that no Default subsists tested against representations that are not otherwise repeated on that date.",
      required: true,
    },
    {
      id: "CR-03",
      title: "Drawstop",
      keywords: [
        "drawstop",
        "utilisation request",
        "no Default",
        "further conditions",
        "conditions to each utilisation",
      ],
      preferred:
        "Each Utilisation is conditional only on the absence of an Event of Default and on the Repeating Representations being true in all material respects.",
      fallback:
        "A drawstop on any Default for the term facility after the closing date, with the revolving facility drawstopped only for an Event of Default.",
      walkAway:
        "A drawstop on any Default without a materiality qualifier, or a Lender right to refuse a Utilisation on a Material Adverse Effect determined in its sole discretion.",
      required: true,
    },
    {
      id: "CR-04",
      title: "Interest and default interest",
      keywords: ["interest", "margin", "default interest", "interest period", "rate of interest", "benchmark"],
      preferred:
        "Interest at the benchmark plus the Margin in the term sheet, with default interest of not more than one per cent above the applicable rate accruing only on overdue amounts and only while they remain unpaid.",
      fallback:
        "Default interest of two per cent applied to the overdue amount only, with a zero floor on the benchmark.",
      walkAway:
        "Default interest applied to the whole Loan on any Default, or a Margin ratchet that steps up on a Default rather than an Event of Default.",
      required: true,
    },
    {
      id: "CR-05",
      title: "Fees",
      keywords: ["commitment fee", "arrangement fee", "agency fee", "fees", "fee letter"],
      preferred:
        "Commitment fee on the undrawn Available Commitment at not more than thirty-five per cent of the Margin, arrangement and agency fees fixed in the Fee Letters, and no fee payable on cancellation.",
      fallback: "Commitment fee at forty per cent of the Margin, with fees on prepayment limited to Break Costs.",
      walkAway:
        "Fees payable on voluntary prepayment or cancellation beyond Break Costs, or fee amounts left to be agreed after signing.",
      required: true,
    },
    {
      id: "CR-06",
      title: "Mandatory prepayment",
      keywords: [
        "mandatory prepayment",
        "illegality",
        "disposal proceeds",
        "insurance proceeds",
        "excess cash",
        "prepay",
      ],
      preferred:
        "Mandatory prepayment limited to illegality and change of control, with disposal and insurance proceeds subject to a reinvestment right of twelve months and a de minimis threshold.",
      fallback:
        "An excess cashflow sweep of not more than fifty per cent stepping down with leverage, with disposal proceeds reinvestable within twelve months, extended by six months where committed.",
      walkAway:
        "Mandatory prepayment from all disposal and insurance proceeds without reinvestment rights or thresholds, or an excess cashflow sweep above seventy-five per cent.",
      required: true,
    },
    {
      id: "CR-07",
      title: "Voluntary prepayment and cancellation",
      keywords: ["voluntary prepayment", "prepayment", "cancellation", "break costs", "prepayment fee"],
      preferred:
        "Voluntary prepayment permitted on three Business Days' notice in the minimum amounts stated in the term sheet, without premium, and applied against repayment instalments as the Borrower directs.",
      fallback:
        "Voluntary prepayment on five Business Days' notice with a soft-call premium of one per cent in the first year only.",
      walkAway:
        "A prepayment premium beyond the first year, or prepayments applied pro rata across all instalments at the Lenders' election.",
      required: true,
    },
    {
      id: "CR-08",
      title: "Financial covenants and testing dates",
      keywords: ["financial covenant", "leverage", "interest cover", "test date", "relevant period", "covenant"],
      preferred:
        "Financial covenants limited to leverage and interest cover, tested quarterly on a trailing twelve-month basis with headroom of not less than thirty per cent against the base case model.",
      fallback:
        "Quarterly testing with headroom of not less than twenty-five per cent, with a springing leverage covenant only on the revolving facility when drawn above forty per cent.",
      walkAway:
        "Monthly testing, headroom below twenty per cent, or a covenant tested against projections rather than historical figures.",
      required: true,
    },
    {
      id: "CR-09",
      title: "Equity cure",
      keywords: ["equity cure", "cure amount", "cure right", "cure", "new shareholder injections"],
      preferred:
        "An equity cure right exercisable up to four times over the life of the facility and in any two consecutive quarters, with cure amounts added to EBITDA or deducted from debt at the Borrower's election, and no obligation to prepay with the cure amount.",
      fallback:
        "A cure right exercisable up to three times, not in consecutive quarters, with cure amounts deducted from Financial Indebtedness.",
      walkAway:
        "No equity cure, or cure amounts required to prepay the facility and treated as an Event of Default if not received within ten Business Days.",
      required: true,
    },
    {
      id: "CR-10",
      title: "EBITDA add-backs",
      keywords: ["EBITDA", "add-back", "add back", "exceptional items", "synergies", "pro forma"],
      preferred:
        "EBITDA add-backs for exceptional and non-recurring items without cap, and for projected cost savings and synergies expected to be realised within eighteen months capped at twenty per cent of EBITDA.",
      fallback:
        "Uncapped add-backs for exceptional items, with synergies capped at fifteen per cent and a twelve-month realisation period.",
      walkAway: "No add-back for exceptional items, or synergies excluded entirely from the calculation of EBITDA.",
      required: true,
    },
    {
      id: "CR-11",
      title: "Negative covenants and baskets",
      keywords: ["negative covenant", "basket", "permitted", "shall not", "general undertakings", "restrictions"],
      preferred:
        "Negative covenants subject to permitted baskets sized to the business plan, with a general basket of not less than five per cent of EBITDA and grower baskets scaling with total assets.",
      fallback:
        "Fixed baskets sized to the base case with a general basket of three per cent of EBITDA and carry-forward of unused amounts.",
      walkAway:
        "Negative covenants without baskets, or baskets requiring Majority Lender consent for ordinary course transactions.",
      required: true,
    },
    {
      id: "CR-12",
      title: "Restricted payments",
      keywords: ["restricted payment", "dividend", "distribution", "permitted payment", "management fees"],
      preferred:
        "Restricted payments permitted where leverage is below the level stated in the term sheet and no Event of Default is continuing, with a builder basket of fifty per cent of consolidated net income and permitted management fees.",
      fallback:
        "Dividends permitted only from excess cashflow not swept, subject to a leverage test set 0.5x inside the covenant level.",
      walkAway:
        "An absolute prohibition on distributions for the term, or a restriction on ordinary course monitoring fees payable to the Sponsor.",
      required: true,
    },
    {
      id: "CR-13",
      title: "Information covenants and frequency",
      keywords: [
        "information undertakings",
        "financial statements",
        "compliance certificate",
        "annual",
        "quarterly",
        "budget",
      ],
      preferred:
        "Audited annual financial statements within one hundred and eighty days, quarterly management accounts within sixty days, and a Compliance Certificate with each set, with no monthly reporting.",
      fallback:
        "Annual accounts within one hundred and fifty days and quarterly accounts within forty-five days, with monthly reporting only while an Event of Default is continuing.",
      walkAway:
        "Monthly reporting as a standing obligation, or delivery of any information requested by any Lender at any time.",
      required: true,
    },
    {
      id: "CR-14",
      title: "Repetition of representations",
      keywords: [
        "repeating representations",
        "repeated",
        "deemed to be made",
        "representations",
        "each utilisation date",
      ],
      preferred:
        "Only the Repeating Representations listed in the term sheet are repeated, on the first day of each Interest Period and on each Utilisation Date, by reference to the facts then existing and qualified by materiality.",
      fallback:
        "Representations repeated on each Utilisation Date only, with the no-Default representation limited to Events of Default.",
      walkAway:
        "All representations repeated daily, or a representation that no Material Adverse Effect has occurred repeated on each Interest Period.",
      required: true,
    },
    {
      id: "CR-15",
      title: "Events of default and grace periods",
      keywords: [
        "Event of Default",
        "events of default",
        "grace period",
        "remedied within",
        "acceleration",
        "business days of",
      ],
      preferred:
        "Non-payment remedied within five Business Days where caused by administrative or technical error, breach of other obligations remedied within thirty days of notice, and misrepresentation qualified by materiality and remedied within twenty Business Days.",
      fallback:
        "Non-payment remedied within three Business Days, other breaches within twenty Business Days, misrepresentation within fifteen Business Days.",
      walkAway:
        "No grace period for non-payment, or an Event of Default for any breach of any undertaking without a cure period.",
      required: true,
    },
    {
      id: "CR-16",
      title: "Cross-default thresholds",
      keywords: ["cross default", "cross-default", "cross acceleration", "Financial Indebtedness", "threshold"],
      preferred:
        "Cross-acceleration rather than cross-default, with a threshold of not less than five per cent of EBITDA and excluding intra-Group debt and amounts disputed in good faith.",
      fallback:
        "Cross-default with a threshold of two and a half per cent of EBITDA, applying only to the Obligors and Material Subsidiaries.",
      walkAway:
        "Cross-default applying to any Group member without a threshold, or triggered by a potential default under other Financial Indebtedness.",
      required: true,
    },
    {
      id: "CR-17",
      title: "Change of control threshold",
      keywords: ["change of control", "control", "sponsor", "listing", "shareholding"],
      preferred:
        "Change of control triggered only where the Sponsor ceases to control more than fifty per cent of the votes, with a permitted listing and a thirty-day consultation period before any prepayment obligation.",
      fallback:
        "Change of control on the Sponsor falling below fifty per cent, with mandatory prepayment on ten Business Days' notice from the Majority Lenders.",
      walkAway:
        "Change of control on any transfer of shares in the Borrower, or automatic acceleration without a Lender decision.",
      required: true,
    },
    {
      id: "CR-18",
      title: "Assignment and borrower consent",
      keywords: ["assignment", "transfer", "New Lender", "consent of the Borrower", "white list", "Existing Lender"],
      preferred:
        "Lender transfers require the Borrower's consent, not to be unreasonably withheld and deemed given after ten Business Days, other than to a Lender on the agreed white list or to an affiliate, with no transfers to distressed-debt investors or competitors at any time.",
      fallback:
        "Borrower consultation rather than consent, with transfers to competitors and distressed-debt investors prohibited at all times.",
      walkAway:
        "Free transferability to any person, or consent rights that fall away on any Default rather than on an Event of Default.",
      required: true,
    },
    {
      id: "CR-19",
      title: "Most favoured nation and sunset",
      keywords: ["most favoured nation", "MFN", "sunset", "incremental facility", "yield"],
      preferred:
        "Most favoured nation protection limited to incremental facilities with a margin cushion of one hundred basis points, a sunset of twelve months from closing, and no protection on maturity or other terms.",
      fallback: "A cushion of seventy-five basis points with an eighteen-month sunset.",
      walkAway:
        "Most favoured nation protection with no cushion and no sunset, applying to all indebtedness of the Group.",
      required: false,
    },
    {
      id: "CR-20",
      title: "Indemnity cap and carve-outs",
      keywords: ["indemnify", "indemnity", "indemnities", "hold harmless", "losses and expenses"],
      preferred:
        "Indemnities limited to loss actually incurred from an Event of Default, currency conversion and Agent enforcement costs, excluding loss caused by a Finance Party's own gross negligence or wilful misconduct, and limited to amounts properly documented.",
      fallback:
        "Standard syndicated-market indemnities with a carve-out for a Finance Party's gross negligence or wilful misconduct.",
      walkAway:
        "Indemnities covering consequential loss of the Finance Parties or loss caused by a Finance Party's own breach.",
      required: true,
    },
    {
      id: "CR-21",
      title: "Amendments and waivers thresholds",
      keywords: ["amendments", "waivers", "Majority Lenders", "all Lender", "consent", "unanimous"],
      preferred:
        "Amendments by Majority Lenders at sixty-six and two-thirds per cent, all-Lender matters limited to the term sheet list, and provisions to replace non-consenting Lenders and disregard non-responding Lenders.",
      fallback:
        "Majority Lenders at seventy-five per cent, with non-responding Lenders disregarded after fifteen Business Days.",
      walkAway:
        "All-Lender consent for changes to definitions or covenants, or no mechanism to replace a non-consenting Lender.",
      required: true,
    },
    {
      id: "CR-22",
      title: "Governing law and enforcement",
      keywords: ["governing law", "governed by", "jurisdiction", "courts", "enforcement"],
      preferred:
        "The governing law and exclusive jurisdiction stated in the term sheet, with the Borrower not required to waive immunity beyond its commercial assets.",
      fallback:
        "Non-exclusive jurisdiction for the benefit of the Finance Parties only, provided the Borrower may bring proceedings in the same courts.",
      walkAway:
        "The courts of any jurisdiction at the Agent's election combined with a waiver of all objections to forum.",
      required: true,
    },
  ],
};

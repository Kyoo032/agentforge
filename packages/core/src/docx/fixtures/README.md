# DOCX test fixtures

Six synthetic legal documents taken from the Harvey LAB benchmark
(https://github.com/harveyai/harvey-labs, MIT licence, © Harvey AI). They are
fictional matters written for benchmarking and contain no real parties.

| File | From task | Why it is here |
|---|---|---|
| `lender-initial-aca-draft.docx` | contracts/banking/account-control-agreement-term-negotiation | clean draft, no revisions |
| `depositary-bank-round-1-redline.docx` | same | 57 insertions, 44 deletions |
| `borrower-round-2-comments.docx` | same | 28 insertions, 17 deletions |
| `lender-round-3-counter-redline.docx` | same | 19 insertions, 37 deletions |
| `original-term-sheet.docx` | banking-finance/analyze-counterparty-markup-of-senior-secured-credit-facility-term-sheet | 3 tables, no revisions |
| `lender-markup-term-sheet.docx` | same | 3 tables, 48 insertions, 34 deletions |

Used by the docx reader, diff, and redline writer tests. Do not edit in place;
add a new file if a test needs a different shape.

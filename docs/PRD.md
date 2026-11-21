# PRD — LawOffice OS

Plan version 1.0 — 10 November 2026. Status: ready to begin phased implementation; this is not evidence that the application has been implemented or reviewed. Terminology reference: [GLOSSARY](../GLOSSARY.md).

## 1. Desired outcome

The project owner's father opens the system in the morning to see his hearings and required work, returns from court to record the outcome and next date, and accesses the file's paper location and account from the same place. Start with one office and one lawyer, separating maintenance access from the lawyer's use. A full multiemployee design is deferred until there is an actual request.

## 2. Product priorities

| Priority | Scope | Reason for ordering |
|---|---|---|
| P0 before live operation | Secure login, clients and parties, matters and proceedings, hearings, tasks and manually entered deadlines, private archive, basic search and printing, basic accounts, audit trail, tested backup | The minimum needed to organize the office and protect its data |
| P1 after the pilot stabilizes | Push or email with approval, document templates, broader import, advanced reports, QR codes for files | Saves time once the data is stable |
| P2 later | Arabic OCR, proposed AI summaries with source pages, assistants and matter-level permissions, integrations | Requires accuracy and privacy evaluation and new scope |

Outside V1: calculating appeal periods from general rules, automatic submissions to court platforms, a client portal, an accredited tax or electronic invoicing system, multioffice SaaS, a native application, or offline synchronization of confidential data.

Owner decision, 18 November 2026: office operating expenses (rent, internet, utilities and office supplies) are outside V1. Finance covers fees, matter-specific reimbursable expenses and client advances; no office-expense screen, account, command or report is required. See [ADR 0004](adr/0004-exclude-office-operating-expenses.md).

## 3. Functional requirements

| ID | Requirement | Acceptance evidence |
|---|---|---|
| FR-01 | One securely provisioned owner account, no public registration, with MFA and recovery | Login, logout, revocation of a stolen session, and a recovery trial |
| FR-02 | Manage people and organizations, with different capacities in each matter and proceeding | The same party is a client here and an opponent elsewhere without a global role change |
| FR-03 | An internal matter with a code and paper location, containing separate linked proceedings | First instance and appeal with separate hearings and documents inside one matter |
| FR-04 | Record a hearing, its result, adjournment, and preparation tasks | One operation prevents partial saves or duplication on a poor connection |
| FR-05 | Manually entered legal deadline with a source and approval status | A draft appears as unapproved and is never presented as a calculated legal deadline |
| FR-06 | Private uploads from mobile and desktop, versions, and paper-original metadata | Unauthorized document links are rejected, and failed uploads do not appear complete |
| FR-07 | Daily and weekly schedules, a calendar, and search | Searching by an Arabic name or Arabic/Latin digits returns the expected matter |
| FR-08 | Separate fees, expenses, reimbursements, and client money | An illustrative 15000/5000/1200 statement matches the accounting rules |
| FR-09 | Print hearing lists, matter summaries, administrative receipts, and account statements | Correct Arabic PDF, reasonable page breaks, and matching totals |
| FR-10 | In-app reminders distinguishing overdue and failed items | Restarting the worker does not generate the same internal reminder twice |
| FR-11 | Reusable export and batch import | Preview, error review, and batch replay without duplication |
| FR-12 | Audit trail for edits and sensitive changes | Correcting a result or reversing a payment records who, when, and why |
| FR-13 | Consistent database and file backups with isolated restoration | A matter, hearing, document, and financial transaction are actually restored |

## 4. Non-functional requirements

- `NFR-01` Native Arabic RTL presentation, with `lang=ar` and isolation of codes, numbers, and English text. Display clear Gregorian dates without day/month ambiguity; the office timezone is `Africa/Cairo`.
- `NFR-02` The interface works at 390, 768, and 1440 pixels, with keyboard use, 200% text zoom, visible focus, and errors announced and written. WCAG AA contrast is a target; do not claim it has been achieved before testing.
- `NFR-03` Plan initially for test data of 2000 matters, 20000 hearings, 30000 document records, and 100000 financial transactions/lines. These are test dataset sizes, not a description of the father's office.
- `NFR-04` Target list search below two seconds P95 in the agreed measurement environment, and opening today's schedule below 3 seconds on a mobile with a stable connection. Large-image transfers are excluded and measured separately. Record the device, dataset size, and connection rather than claiming absolute speed.
- `NFR-05` Safe retry for sensitive operations, and concurrent-edit conflicts shown to the user instead of silently overwriting an edit.
- `NFR-06` Initial operating targets: RPO up to 24 hours, and RTO up to 4 hours after a suitable replacement environment becomes available. These become accepted figures only after a documented restore drill.
- `NFR-07` No case data saved in browser storage, log files, or external analytics services by default. Live operation requires a backup plan and successful recovery.

## 5. Core user stories

1. As a lawyer, I record a client and matter even before the court case number is known, so I can organize the paper from the start of the engagement.
2. I add first instance and appeal to the same matter and identify which case number each hearing belongs to.
3. On mobile, I record "تأجيل لتقديم مذكرة" (adjourned for submission of a memorandum) and enter the next hearing and preparation task on the same screen.
4. I photograph a document and check its legibility and association before accepting it into the archive.
5. I see separate amounts answering the UI questions "الموكل عليه كام أتعاب؟ عليه كام مصروفات؟ لسه معايا كام من فلوسه للصرف؟" (what fees does the client owe, what expenses do they owe, and how much client money do I still hold for spending?).
6. I produce the week's hearing list and identify the location of each paper file I need to take.
7. After a device problem, I restore a consistent backup and verify that the documents linked to its data are present.

## 6. Boundaries and evidence

Initial-release owner exception: ClamAV is deferred under [ADR 0003](adr/0003-initial-malware-scan-deferral.md). File validation/privacy/finalization remain required; malware-scan status is explicitly NOT_SCANNED_POLICY, never a fabricated clean result. Scanner-specific evidence is deferred until an approved activation task.

The dashboard displays actual database data; any demo data is clearly labeled and never mixed with live records. API success or a successful build is insufficient evidence of usability. The project owner's father must try the daily journeys, and the project owner must review the accounts and recovery.

Before selecting an external storage location or sending a document to an AI service, the father reviews confidentiality, applicable legal and contractual obligations, and the processing location. The plan does not assume any provider automatically satisfies those obligations.

## 7. Open questions and their management

| Decision | Current working assumption | Latest resolution point |
|---|---|---|
| Hosting | Local trial with synthetic data, then a VPS with private access is recommended | Before M7 and use of real data |
| Notifications outside the app | Deferred; today's schedule and printing are the MVP foundation | After the pilot or before relying on them |
| Document sizes | 25 MB per file as an adjustable initial limit | M4 with actual photography trials |
| Identity data | Optional and collected only when needed | M2 form review |
| Gemini name | Implementation model name as requested by the user; no reliance on assumed capabilities | When opening the implementation session |
| Time and budget | No fixed duration or price promise; measure the first two tasks | After M1 |

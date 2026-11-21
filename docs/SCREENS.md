# LawOffice OS — Journeys, screens, and fields

Version: implementation plan 1, 10 November 2026. Visual reference: [DESIGN.md](../DESIGN.md). Detailed relationship and financial rules: [DATA_MODEL.md](DATA_MODEL.md) and [WORKFLOWS.md](WORKFLOWS.md). Field notation: **required** for final saving; **optional** may be completed later. Missing migration data has an explicit draft path, rather than invented defaults.

## Core journeys

| Journey | Steps | Success evidence |
|---|---|---|
| Start of the day | Login → "النهارده" (today) → today's hearings → open matter → document checklist → print agenda | Hearings without a specified time are visible, and confirmed legal deadlines are separate from tasks |
| New client and matter | Search for an existing person → add/select client → matter → court proceeding if available → specify paper location | Stable internal code, multiple clients supported, and a matter may begin as a consultation before any court case number exists |
| After court | Hearing → "تسجيل النتيجة" (record result) → decision → optional next hearing → optional tasks → review and save | The result, new hearing, and tasks all appear together, or none are saved |
| Mobile upload | Matter → "رفع مستند" (upload document) → photograph/select → preview image legibility → brief metadata → send | Validation status is clear; file unavailable until validation/finalization finish. Initial ADR 0003 displays truthful unscanned status |
| Collection | Matter → "تسجيل دفعة" (record payment) → select payer and classification → amount and allocation → review → post and issue receipt | Fees, expenses, and client money remain separate accounts |
| Appeal | Matter → "إضافة رقم قضائي مرتبط" (add linked court case number) → select previous proceeding and instance → court details | Each court case number has its own hearings and documents, with earlier history preserved |
| Month end | Accounts → period → collections/expenses/client balances → detailed statement → export | Total cash is not presented as office profit |

## Page map

| ID | Title and proposed route | Content and primary action |
|---|---|---|
| S01 | Login `/login` and `/verify` | Login, additional verification, recovery |
| S02 | Today `/today` | Hearings, confirmed deadlines, tasks, operating alerts |
| S03 | Matters `/matters` and `/matters/new` | Search, filters, and matter creation |
| S04 | Matter file `/matters/:id` | Summary and tabs for all related work |
| S05 | Court proceeding `/proceedings/:id` | One court case number, its instance, and hearings |
| S06 | Hearing `/hearings/:id` and `/hearings/:id/result` | Appointment, result, and adjournment |
| S07 | Agenda `/agenda` | List, week, month, and printing |
| S08 | Tasks and deadlines `/tasks` and `/deadlines` | Work follow-up and a distinct legal deadline |
| S09 | Parties `/parties` and `/parties/:id` | Clients, opponents, and contact details |
| S10 | Documents `/documents` and `/documents/:id` | Upload, preview, versions, and original location |
| S11 | Accounts `/finance` | Payments, expenses, client money, and statements |
| S12 | Search `/search` | Categorized results and secure links |
| S13 | Reports `/reports` | Hearing list, matter summary, client account, period report |
| S14 | Settings `/settings` | Office, account, security, reference lists, operations |
| S15 | Paper migration `/imports` | Trial import, review, and approval |

## S01 — Login and recovery

Login fields: registered email **required** `email`, password **required** `password`. There is no public registration; the office owner is set up through a defined bootstrap process. Additional verification: **required** `TOTP` code or a single-use recovery code; active device names, last use, and a terminate-device action. Failed-login messages do not reveal whether an email exists. Account recovery follows a documented operations procedure, with no backdoor button that bypasses MFA. Settings explain how to keep recovery codes outside the server and phone before accepting the account setup.

## S02 — Today

Order: today's date, today's hearings, legal deadlines needing confirmation or approaching, overdue tasks, then a weekly summary. Each hearing shows the matter name, court case number/year, court and circuit, time or "غير محددة" (not specified), required work and preparation, and a record-result action. Overlapping hearing times generate a warning for review but do not prevent saving. The owner sees a late-backup alert. Pressing "تمت" (done) does not close a legal deadline; each item type has its own explicit action.

## S03 and S04 — Matter list and matter file

**Matter list:** matter name, code, primary client with the number of others, type, status, next hearing, and paper location. Filters: active/archived, type, court, client, hearing date range, incomplete data. Search preserves filters when returning from details. Sort by the next hearing while clearly identifying matters without an appointment.

**Matter form:**

| Field | Type and requirement | Validation / default |
|---|---|---|
| Matter title | Text, required | Readable description; proposed limit of 200 characters |
| Matter code | Display-only, generated | Stable and unique; not the court case number |
| Matter `kind` | Selection, required | Litigation `LITIGATION` / consultation `CONSULTATION` / contract `CONTRACT` / other `OTHER` |
| Case/work category | Selection, optional | Civil/criminal/family/commercial/administrative/other; manageable reference list, separate from matter kind |
| Clients | Multiple selection, required for an approved matter | Existing party or add during the journey; identify the primary contact |
| Opponents and other parties | Multiple, optional | May be added later; party role and legal capacity are separate |
| Subject summary | Long text, optional | Prefer understandable wording; no unsafe HTML |
| Status | Selection, required | Default "نشط" (active); archiving has a separate path |
| Paper file location | Selection/text, optional at creation | Cabinet/shelf/number; required before approving paper migration |
| Date the office opened the matter | Date, required | Today suggested and editable; separate from the court case year |
| Notes | Text, optional | With an edit history |

Matter details use the literal tabs "نظرة عامة، الأرقام القضائية، الجلسات، المستندات، المهام والمواعيد، الحسابات، سجل الإجراءات" (overview, court case numbers, hearings, documents, tasks and deadlines, accounts, activity history). The latest action and next hearing are derived values. The chronological timeline identifies the author and source; editing a note is different from changing the original event. QR support is **deferred to P1**: it opens the matter link after login, includes no client name, national ID, or access authorization, and is not a V1 delivery condition.

## S05 — Court proceeding and links

Fields: matter **required**; proceeding type and instance **required**; court case number **required to approve a complete registration**, stored as text; year `yearLabel` **required with the number**, as reference text that is not always assumed to be a Gregorian year; court **required even for a draft proceeding to identify the hearing's court**; registration/docket type **required to approve a complete registration**; circuit **optional**; parent proceeding **optional**; proceeding status **required**; parties' legal capacities in the proceeding **optional for completing the file**. Prevent self-parenting and parent/child cycles. Similar number, year, court, and registration type produce a review warning, never automatic deletion or merging. If the number is still unknown, record an explicit draft proceeding with missing fields, without `0000`. If the court itself is unknown, save the matter only and defer the proceeding; never select a default court.

Actions: add hearing, upload a document for this proceeding, add an appeal/linked proceeding, view the sequence. "محجوز للحكم" (reserved for judgment) applies to the proceeding; completing one proceeding does not archive the entire matter.

## S06 — Hearing and result

**Create appointment:** proceeding **required**; hearing date **required**; time **optional with no default**; court and circuit shown from the proceeding, with the hearing location recorded if different; purpose/required work **optional**; attendance location **optional**; optional reminders following office settings; hearing roll number **optional as text**. A past appointment may be added for historical migration with a warning; there is no blanket prohibition.

**Record result:** decision/result **required**; summary of what happened **optional**; is there a new date? **required**, with yes/no/not yet determined choices; new date **required if yes**, with optional time; required-work list **optional**, each task having a title and a due date if known; decision document **optional**; proceeding-status update **explicit and optional**. A new date before the current hearing date is a potential error requiring correction, while the appropriate path still allows documenting a historical date correction. Do not calculate an appeal deadline from the decision.

Before saving, show the literal summary "هتسجل النتيجة، وتضيف جلسة بتاريخ…، و… مهام" (you will record the result, add a hearing on…, and… tasks). Correcting a saved result shows the previous version and reason. Changing an appointment for a hearing that has not taken place is labeled "تعديل الموعد" (change appointment), not "إثبات انعقاد" (record that the hearing took place). Preserve the previous appointment reference and create the replacement according to WORKFLOWS without deleting change history. Cancelling a hearing records the reason and updates its reminders.

## S07 and S08 — Agenda, tasks, and legal deadlines

The agenda begins with a simple mobile list, with week/month as alternatives. Provide court/type filters and printing for selected days. A hearing, legal deadline, and task have distinct symbols and labels. Daily view groups appointments with no specified time separately, not at midnight.

**Task:** title **required**; linked matter/proceeding **optional**; description **optional**; priority **required**, default normal; due date **optional**; status **required**, default open; checklist **optional**; reminder **optional**. It does not automatically create a legal deadline.

**Legal deadline:** title **required**; matter **required**; proceeding **optional**; final date **required for approval**; time **optional**; source of the deadline/review notes **required for approval**; source document **optional**; status **required**, using "مسودة تحتاج مراجعة/مؤكد/تم الإجراء/ألغي" (draft requiring review/confirmed/action completed/cancelled). Approval requires the explicit action "راجعت الموعد واعتمده" (I reviewed and approve the deadline), with the approver's name and timestamp. Changing the date after approval invalidates the previous confirmation and requires a new review with a reason. Completion requires a description of what was done and optional evidence; a reminder is not proof of execution.

## S09 — Parties and client profile

Person/organization type **required**; name **required**; phone numbers **optional**, with a primary number; email **optional**, in a valid format; address **optional**; national ID/organization identifier **optional and sensitive**, never a prerequisite for entry; contact relationship **optional**; notes **optional**. Client/opponent role is assigned within the matter, so the same person can have a different role elsewhere. Similar names/phone numbers suggest opening an existing record but do not prohibit distinct people with similar information.

Party tabs: details, matters, powers of attorney, general documents, communication, account statement. Power of attorney: number, year, and issuing office **required when recording it as complete data**; issue date **optional**; scope/description **optional**; document copy **optional**; review status **required**. Expiry is not inferred automatically from a general date. Communication record: date **required**; channel **required**; summary **required**; linked matter **optional**; follow-up **optional**.

## S10 — Documents

Digital file **required**; title **required**, suggested from the filename; type **required**; link to a matter or party **required**, with proceeding/hearing **optional** and consistent with the matter; document date **optional**; paper-original location **optional**; is the original in the office? **optional**, with yes/no/unknown choices; description **optional**; sensitivity **required**, default confidential.

Upload accepts the formats and size defined by security, showing limits before selection. Start with PDF, JPEG, and PNG and a proposed 25 MB limit per version. V1 permits selecting or capturing an image when supported by the browser, previewing legibility before sending, and previewing PDF pages after upload. Cropping, rotating, reordering images, and combining them into a multipage document are **optional enhancements outside the V1 delivery condition**; a mobile scanner can produce a ready PDF. Preserve the uploaded original. Initial ADR 0003 states: "بيترفع، جاري التحقق من الملف، جاهز، مرفوض، الرفع غير مكتمل" (uploading, validating, ready, rejected, incomplete). File details show "لم يُفحص ضد الفيروسات"; do not claim a clean malware scan. If scanning is activated later, show its actual pending/result state. A rejected file shows a safe reason and retry action; a new version never silently replaces the original. Preview and download require authorization every time. A matching file hash produces a duplication warning. No `OCR` or approved extracted text in the MVP.

## S11 — Accounts

The interface has three clear literal sections: "الأتعاب، مصاريف القضايا، أموال الموكل" (fees, matter expenses, client money). Office operating expenses are excluded by [ADR 0004](adr/0004-exclude-office-operating-expenses.md): no fourth section, entry form or report. Reports distinguish "المستحق" (due), "المحصل" (collected), and "المتاح بالصندوق" (available cash).

| Form | Core fields |
|---|---|
| Fee agreement | Matter and responsible client, agreement description, EGP amount, and date required; installments with amounts and dates optional; change a posted agreement using an adjustment entry with a reason |
| Receive money | Payer, date, amount, payment method, cash/account, classification, and allocation required; transfer reference and note optional; allocated total equals the amount |
| Matter expense | Matter, date, amount, description/category, funding source, and whether reimbursable by the client required; receipt and linked proceeding optional |
| Client advance / expense deposit | Client and matter, amount, date, and collection method required; balance is client money, not fee revenue |
| Full transaction reversal | Original transaction, date, and reason required; display-only amount matches the entire original, with no partial edit; preview reversal effects and dependencies before posting; prohibit repeated reversal |
| Actual refund | Original transaction/source of money, beneficiary, refund amount, date, disbursement method, and reason required; may be partial within available limits; show whether it reopens a receivable or reduces an advance according to the original type |

Review before posting shows the effect on fees, expenses, and client money. A reversal corrects the accounting record and does not itself prove that money was actually returned; returning money is a separate disbursement operation linked to the original. Detailed rules and dependencies are in WORKFLOWS. If an allocation exceeds fees due, the excess never automatically becomes revenue; require explicit classification. Posted documents are read-only, receipt numbers are sequential and never reused, and printed copies remain linked to the original and any reversal. Do not describe the receipt as an accredited tax document.

## S12 and S13 — Search and reports

Unified search by name, matter code, court case number/year, court, and document title, with result-type filters. Results never reveal an unauthorized document or amount. Scanned-PDF contents are not searchable in the MVP; only their metadata is searchable.

Reports: hearings within a period, matter summary, client statement showing each category and its balance, period collections and expenses, and matters with incomplete data. Report fields: period **required where applicable**; matter/client/court **optional depending on the report**; include financial details **optional according to authorization**. Preview before printing/export, with generation time, filters, and creator. Arabic PDF text is readable, properly joined, and correctly directed. CSV exports UTF-8 and handles cells that could become formulas.

## S14 and S15 — Settings and migration

Settings: office name **required**; contact information **optional**; EGP currency and Cairo timezone for display; reminder policies; management of courts, circuits, types, and paper locations; security-session management; backup status and latest restore test. Reference entries already in use are disabled rather than deleted in a way that breaks earlier matters. Server restoration belongs in operations, not a dangerous button in the daily interface.

Migration: select CSV template → upload → map columns → preview and review errors → approve valid rows → report what was recorded. Source fields: row code/identifier, matter title, parties, case number/year/court where available, next hearing, paper location, review source. Ambiguous dates stop for review rather than being guessed. Replaying the same batch does not duplicate matters. The incomplete-data screen shows "البيانات لسه محتاجة مراجعة" (the data still needs review), who reviewed it and when. Upcoming cases are checked against paper with the project owner's father before approval.

## Pilot acceptance scenario with the project owner's father

Use synthetic data: one client with two matters, one matter with two clients, first instance and appeal, a hearing without a time, a 20-page document, a long title, and an allocated payment. The father opens the matter, records a result and adjournment, uploads an image, and records a payment without continual help. Test loss of connectivity during saving, opening the same matter on two devices, and navigating away from an unsaved form. Speed targets in DESIGN.md are provisional; actual acceptance requires accurate data, clear failure handling, and no duplication before speed.

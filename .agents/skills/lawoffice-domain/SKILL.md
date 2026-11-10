---
name: lawoffice-domain
description: Implements LawOffice OS party, matter, proceeding, hearing, deadline, job, and import rules. Use for domain commands and relational migrations; financial posting uses lawoffice-finance.
---

# LawOffice domain behavior

Read [GLOSSARY](../../../GLOSSARY.md), then only assigned entities/workflows in [DATA_MODEL](../../../docs/DATA_MODEL.md) and [WORKFLOWS](../../../docs/WORKFLOWS.md). [ARCHITECTURE](../../../docs/ARCHITECTURE.md) names the Module Interfaces. These govern the final model; the task card determines which slice exists now.

- `Matter` is the internal file; `Proceeding` is a court docket/instance. Appeals create linked proceedings rather than overwriting earlier numbers. Enforce same-matter links and reject parent cycles.
- Scope office roles through `MatterParty` and judicial capacities through `ProceedingParty`. A Party is not globally a client/opponent. Preserve original values, normalize derived search fields only, and never merge similar people automatically.
- Drafts retain genuine unknowns. Active matters require a client; draft proceedings require court. If court is unknown, retain only the matter. Never invent a docket/year/time.
- Store date-only hearing/deadline values as dates with optional separate time. Display in `Africa/Cairo`; unknown time is not midnight or a default court hour.
- `recordHearingResult` commits result, next hearing, chosen tasks, audit, and durable outbox together. Apply version checks and scoped idempotency; preserve correction/rescheduling history.
- Legal deadlines need the lawyer's confirmation and source. Date changes return confirmed deadlines to draft and cancel old reminders. Reminder delivery or task completion is not evidence of a legal procedure.
- `JobRun` is the durable outbox/queue row created in the business transaction. When worker implementation is in scope, use atomic leases and idempotent handling. No speculative Redis or second event-bus table.
- Archive guards must protect scheduled hearings and open confirmed deadlines as those entities are introduced; debt/noncritical-task reporting remains visible.
- Imports use reviewed previews and persistent source links across batches. Never infer ambiguous dates, silently overwrite linked records, or cascade-delete batches with later activity.

Create only required dependent schema. Disable optional capabilities until their owning module exists, and wire them in the assigned later task. Do not present placeholders as working features. Verify relationships and transactions through the public Module Interface with real PostgreSQL.

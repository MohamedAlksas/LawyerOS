# Planning package review

Review date: November 10, 2026. Scope: document consistency and conversion into implementable assignments. This is not application-code review, a security certification, or an observed usability test.

## Coverage of the project owner's request

| Requested area | Canonical reference |
|---|---|
| PRD, objectives, scope, priorities, acceptance | PRODUCT.md; docs/PRD.md |
| User journeys, screens, fields, failure states | docs/SCREENS.md; DESIGN.md |
| Data model, relationships, constraints, dates, money | GLOSSARY.md; docs/DATA_MODEL.md |
| Hearings, proceedings, documents, finance | docs/WORKFLOWS.md |
| Stack and home Ubuntu versus VPS hosting | docs/ARCHITECTURE.md; docs/SECURITY_OPERATIONS.md |
| Authorization, security, backup, recovery | docs/SECURITY_OPERATIONS.md; docs/DATA_LIFECYCLE.md |
| Paper migration and the lawyer's pilot | docs/MIGRATION.md |
| Milestones and implementable assignments | docs/ROADMAP.md; docs/PROMPTS.md |
| Codex/Gemini roles, submission, review, fixes | GEMINI.md; AGENTS.md; docs/REVIEW_PROTOCOL.md |

## Changes resulting from plan review

- Separate internal matters from court proceedings and distinguish draft from complete dockets.
- Scope party roles to matters and separate the actual payer from the debtor.
- Distinguish an actual refund from reversing an erroneous entry; prevent duplicate cash outflow; split T15 into three smaller reviews.
- Distinguish overall matter kind from practice area, known from missing data, and never invent a hearing time.
- Assign PWA and settings implementation to specific tasks rather than leaving them unowned descriptions.
- Apply ACs within task scope/dependencies rather than requiring an early task to test features that do not exist yet.
- Choose an actual local file scanner and include its cost in proposed server resources.
- Add recovery of old encryption keys/MFA and a restore mode preventing sending and cleanup.
- Add expiry policies for staging, exports, and incomplete uploads; approved office documents are excluded from generic cleanup.
- Prevent archiving from hiding a future hearing or open confirmed legal deadline.

## Source verification

Technology choices are planning recommendations. Changeable facts were checked against official documentation, particularly [Next.js self-hosting](https://nextjs.org/docs/app/guides/self-hosting), [Next.js data security](https://nextjs.org/docs/app/guides/data-security), [Better Auth Prisma](https://better-auth.com/docs/adapters/prisma), [Better Auth 2FA](https://better-auth.com/docs/plugins/2fa), [PostgreSQL SQL Dump](https://www.postgresql.org/docs/current/backup-dump.html), [Tailscale Serve](https://tailscale.com/docs/features/tailscale-serve), [restic](https://restic.readthedocs.io/en/stable/045_working_with_repos.html), and [ClamAV Docker](https://docs.clamav.net/manual/Installing/Docker.html).

This verification does not replace compatibility checks at implementation time. No service prices or real-data hosting location are settled, and the named Gemini model's availability/tool integration has not been verified.

## Work not yet performed

No application has been built, operational database/accounts created, client documents uploaded, or server deployed. Application tests, restore drills, and the lawyer's pilot have not run. No passing performance/accessibility report exists. These are future ticket requirements; submissions must provide actual evidence.

## Current assessment

The plan is ready for T01 using synthetic data, with open production decisions identified in PRD. After T01, review tool compatibility and checks, then write T02 against the actual state. Completing documentation does not pre-approve later milestones.

## Delivery-package validation

The package includes the canonical planning documents, Antigravity setup guide, 23 task-specific prompt cards, and 7 project-local skills. Packaging checks verify file existence, UTF-8 encoding, balanced code fences, local link targets, and SHA-256 agreement between each ZIP entry and its source. The report is `outputs/Planning-Validation.json`. This verifies documents and packaging only, not the future application.

The GitHub edition also includes the Git workflow, PR template, local push guard, maintained PowerShell scripts, and planning-validation CI configuration. Local scratch snapshots and the historical translation-only validator are excluded from version control.

## English edition

The project owner requested an English planning package. Canonical documentation, implementation prompts, and handoff copies have been translated while retaining task/acceptance identifiers, technical decisions, and application localization requirements. The application remains Arabic RTL. Arabic is retained only where needed for domain terms or literal UI/localization examples. The original Arabic sources are preserved internally under `work/arabic-plan-original/`; they are not competing canonical documents or part of the handoff ZIP.

## Task-specific Antigravity edition

The owner requested specific prompts that identify which skills Antigravity must use. The milestone templates were replaced with 23 bounded cards. Seven instruction-only project skills are installed at `.agents/skills/` and included in the ZIP; prompts name exact files and require reporting which were loaded. Antigravity discovery in the owner's running session remains untested. Its [official skill documentation](https://antigravity.google/docs/skills/) supports this workspace layout.

Independent read-only forward testing found that T01 can begin without predecessor evidence, T14 stops when accepted T13 is absent, and T18/T19 do not authorize unknown live destinations. Cross-task review assigned previously implicit audit/idempotency setup to T05, document metadata search/link wiring to T12, and a reviewed opening-balance command to T15c before T21 can use it. These are ownership clarifications for existing requirements; no application code has been implemented.

## GitHub collaboration edition

The owner selected `MohamedAlksas/LawyerOS` and authorized checkpoint pushes with each new feature on its own branch. Repository inspection found a private, empty repository and authenticated push permissions. The initial stable branch receives only repository bootstrap files; planning is submitted on `docs/project-plan-and-git-workflow`. Every task card now names a dedicated feature branch and requires branch/base/local-head/verified-pushed-head/PR evidence. T01 has no predecessor implementation task, but normally waits for the planning PR to be integrated into main. No implementation or automatic merge is implied by repository setup.

Independent review clarified the initial planning-merge dependency, reviewed implementation SHA versus later report-only commits, and single-writer/worktree isolation. The local pre-push guard is not a claim of configured server-side protection. GitHub Actions results and actual published commit/ref verification are checked separately from static planning validation.

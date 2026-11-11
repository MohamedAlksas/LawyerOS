# Antigravity implementation prompts — one task at a time

Each linked card contains one complete, copyable prompt. Give Antigravity only the currently assigned card. Codex plans and reviews; the selected Gemini model implements. English documentation and Arabic RTL application requirements remain unchanged.

## Start now

Open `D:\Lawyer` in Antigravity and copy the full prompt in [T01](tasks/T01.md). It explicitly loads `lawoffice-delivery` and `lawoffice-foundation` from their actual `.agents/skills/` files. T01 is the only task without a predecessor acceptance requirement. The generated output `LawOffice-OS-Antigravity-T01.md` contains the same prompt.

It also selects the lead and supports from their installed SKILL.md paths and requires real native invocation through the bundled `.agents/agents/` definitions. Same-session persona passes are not a fallback. The following table maps every task to its profiles. See [Agency usage](AGENCY_AGENTS.md) and [the routing registry](AGENCY_AGENT_ROUTING.json) for the capability/evidence contract. Static validation does not claim actual execution in Antigravity.

## Task and skill map

Every task loads `lawoffice-delivery`. Additional skills are listed below; every card includes their exact paths. See [Antigravity setup](ANTIGRAVITY.md) for the bundled skills. Do not load all skills or execute all cards together. Each predecessor refers to an actual `docs/reviews/<ID>-review.md` decision stating `ACCEPTED`, with delivered files inspected. A submission is not acceptance.

| Task | Exact card | Required predecessor | Agency lead | Agency support | Additional project skills |
|---|---|---|---|---|---|
| T01 | [T01](tasks/T01.md) | None — first task | `agency-software-architect` | `agency-devops-automator` | `lawoffice-foundation` |
| T02 | [T02](tasks/T02.md) | T01 | `agency-devops-automator` | `agency-backend-architect`, `agency-test-automation-engineer` | `lawoffice-foundation`, `lawoffice-testing` |
| T03 | [T03](tasks/T03.md) | T02 | `agency-identity-access-engineer` | `agency-application-security-engineer`, `agency-test-automation-engineer` | `lawoffice-security-operations`, `lawoffice-testing` |
| T04 | [T04](tasks/T04.md) | T03 | `agency-frontend-developer` | `agency-accessibility-auditor`, `agency-test-automation-engineer` | `lawoffice-arabic-ui`, `lawoffice-testing` |
| T05 | [T05](tasks/T05.md) | T04 | `agency-backend-architect` | `agency-application-security-engineer`, `agency-test-automation-engineer` | `lawoffice-domain`, `lawoffice-arabic-ui`, `lawoffice-testing` |
| T06 | [T06](tasks/T06.md) | T05 | `agency-backend-architect` | `agency-database-optimizer`, `agency-test-automation-engineer` | `lawoffice-domain`, `lawoffice-arabic-ui`, `lawoffice-testing` |
| T07 | [T07](tasks/T07.md) | T06 | `agency-backend-architect` | `agency-frontend-developer`, `agency-test-automation-engineer` | `lawoffice-domain`, `lawoffice-arabic-ui`, `lawoffice-testing` |
| T08 | [T08](tasks/T08.md) | T07 | `agency-backend-architect` | `agency-frontend-developer`, `agency-test-automation-engineer` | `lawoffice-domain`, `lawoffice-arabic-ui`, `lawoffice-testing` |
| T09 | [T09](tasks/T09.md) | T08 | `agency-backend-architect` | `agency-frontend-developer`, `agency-test-automation-engineer` | `lawoffice-domain`, `lawoffice-arabic-ui`, `lawoffice-testing` |
| T10 | [T10](tasks/T10.md) | T09 | `agency-backend-architect` | `agency-devops-automator`, `agency-test-automation-engineer` | `lawoffice-domain`, `lawoffice-arabic-ui`, `lawoffice-testing` |
| T11 | [T11](tasks/T11.md) | T10 | `agency-backend-architect` | `agency-application-security-engineer`, `agency-test-automation-engineer` | `lawoffice-security-operations`, `lawoffice-arabic-ui`, `lawoffice-testing` |
| T12 | [T12](tasks/T12.md) | T11 | `agency-backend-architect` | `agency-application-security-engineer`, `agency-test-automation-engineer` | `lawoffice-domain`, `lawoffice-security-operations`, `lawoffice-testing` |
| T13 | [T13](tasks/T13.md) | T12 | `agency-backend-architect` | `agency-database-optimizer`, `agency-test-automation-engineer` | `lawoffice-finance`, `lawoffice-arabic-ui`, `lawoffice-testing` |
| T14 | [T14](tasks/T14.md) | T13 | `agency-backend-architect` | `agency-database-optimizer`, `agency-test-automation-engineer` | `lawoffice-finance`, `lawoffice-arabic-ui`, `lawoffice-testing` |
| T15a | [T15a](tasks/T15a.md) | T14 | `agency-backend-architect` | `agency-database-optimizer`, `agency-test-automation-engineer` | `lawoffice-finance`, `lawoffice-arabic-ui`, `lawoffice-testing` |
| T15b | [T15b](tasks/T15b.md) | T15a | `agency-backend-architect` | `agency-database-optimizer`, `agency-test-automation-engineer` | `lawoffice-finance`, `lawoffice-arabic-ui`, `lawoffice-testing` |
| T15c | [T15c](tasks/T15c.md) | T15b | `agency-backend-architect` | `agency-database-optimizer`, `agency-test-automation-engineer` | `lawoffice-finance`, `lawoffice-arabic-ui`, `lawoffice-testing` |
| T16 | [T16](tasks/T16.md) | T15c | `agency-frontend-developer` | `agency-document-generator`, `agency-application-security-engineer` | `lawoffice-security-operations`, `lawoffice-arabic-ui`, `lawoffice-testing` |
| T17 | [T17](tasks/T17.md) | T16 | `agency-backend-architect` | `agency-frontend-developer`, `agency-test-automation-engineer` | `lawoffice-domain`, `lawoffice-arabic-ui`, `lawoffice-testing` |
| T18 | [T18](tasks/T18.md) | T17 | `agency-devops-automator` | `agency-security-architect`, `agency-test-automation-engineer` | `lawoffice-security-operations`, `lawoffice-testing` |
| T19 | [T19](tasks/T19.md) | T18 | `agency-database-reliability-engineer` | `agency-devops-automator`, `agency-test-automation-engineer` | `lawoffice-security-operations`, `lawoffice-testing` |
| T20 | [T20](tasks/T20.md) | T19 | `agency-reality-checker` | `agency-accessibility-auditor`, `agency-frontend-developer` | `lawoffice-arabic-ui`, `lawoffice-testing` |
| T21 | [T21](tasks/T21.md) | T20 | `agency-database-reliability-engineer` | `agency-technical-writer`, `agency-test-automation-engineer` | `lawoffice-domain`, `lawoffice-security-operations`, `lawoffice-testing` |

## What every prompt specifies

- One exact task ID and accepted-predecessor gate.
- Required skill names and actual `SKILL.md` paths to read before editing.
- Relevant plan files/sections, owned code paths, and exclusions.
- Concrete implementation steps, domain invariants, positive and negative checks.
- Exact submission report path, actual command exit statuses, and `NOT RUN` limitations.
- A stop for Codex review, without implementing missing predecessors or the next task.

These cards are specific to the planned architecture. Ordinary file-layout details must be reconciled with the accepted checkout, not an imagined scaffold. If Codex accepts a documented design change, it updates the affected card before dispatch. Do not weaken the plan to fit an incomplete implementation.

## Submission and review

The implementer uses the exact `docs/reviews/Txx-submission.md` path named by its card and the format in [REVIEW_PROTOCOL](REVIEW_PROTOCOL.md), including loaded skill paths. Codex reviews actual changes and evidence and writes the matching `*-review.md`. On `CHANGES_REQUESTED`, the implementer fixes that same task's findings, reruns affected checks, updates its submission, and stops again. Do not fill in a review decision on Codex's behalf.

Future production/pilot cards do not authorize unknown destinations, credentials, service purchases, or guessed data. Missing actual prerequisites are reported honestly; prepare independent authorized work and mark unexecuted checks `NOT RUN`.

## Corrections to staged dependencies

T05 introduces the shared audit/idempotency foundation for business writes. T08 adds minimal Task and durable outbox structures without a worker. T09 supplies deadline/task screens. T10 supplies dispatch. T12 connects existing POA/hearing/deadline records to documents and adds document metadata to search. T15c supplies the reviewed opening-balance command before T21 can use it. Each card states its own boundary; no later feature is silently claimed complete early.

## GitHub publication for every task

The canonical origin is `https://github.com/MohamedAlksas/LawyerOS.git`. Every card specifies its exact dedicated feature branch and requires reading [GIT_WORKFLOW](GIT_WORKFLOW.md). Commit and push coherent updates on that same branch, update its draft PR, and report the verified remote SHA. Do not create a new branch for every save or push feature work directly to main. The initial planning PR and later task prerequisites must normally be reviewed and integrated into origin/main before dependent work; no automatic merge is implied.

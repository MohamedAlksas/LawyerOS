# LawOffice OS

Implementation plan for a private system serving the project owner's father's law office in Egypt: one lawyer, varied legal work, a paper-based workflow today, and desktop/mobile use. Current status: **planning documents only**. No application has been built or deployed, and no operational acceptance tests have passed.

## Start here

1. Read [PRODUCT](PRODUCT.md), then [PRD](docs/PRD.md) and [GLOSSARY](GLOSSARY.md).
2. Understand journeys and screens in [SCREENS](docs/SCREENS.md), and the visual direction in [DESIGN](DESIGN.md).
3. For implementation: [ARCHITECTURE](docs/ARCHITECTURE.md), [DATA_MODEL](docs/DATA_MODEL.md), and [WORKFLOWS](docs/WORKFLOWS.md).
4. For operations: [SECURITY_OPERATIONS](docs/SECURITY_OPERATIONS.md), [DATA_LIFECYCLE](docs/DATA_LIFECYCLE.md), and [MIGRATION](docs/MIGRATION.md).
5. For delivery management: [ROADMAP](docs/ROADMAP.md) and [REVIEW_PROTOCOL](docs/REVIEW_PROTOCOL.md).
6. Open this workspace in Antigravity, read [the skill setup](docs/ANTIGRAVITY.md), then give the implementer **only [T01](docs/tasks/T01.md)**. [PROMPTS](docs/PROMPTS.md) indexes all 23 task-specific cards; each names its required local skills.

Codex plans and reviews; Gemini 3.8 Flash implements, using the model name requested by the project owner. No automatic integration between the tools is assumed. Production environment, budget, and device decisions remain open; they do not prevent starting with synthetic data.

## Milestone order

`M0 Environment → M1 Identity and UI → M2 Matters → M3 Hearings → M4 Documents → M5 Finance → M6 Printing and migration tools → M7 Operations and recovery → M8 Office pilot`.

There are 21 main task numbers, initially divided into 23 delivery assignments after splitting T15. Acceptance criteria and review gates apply before dependent work proceeds. The MVP remains experimental until security, recovery, and the lawyer's pilot have been completed.

## Plan status and limits

Estimates, colors, sizes, and resource figures are recommendations to validate. The lawyer reviews legal deadlines and real data. No VPS provider, location, or offsite backup service has been selected. Paper records and originals are not automatically retired.

Canonical references live at the repository root and in `docs/`. [outputs](outputs/) contains derived reading and handoff packages. The current plan review is in [PLAN_REVIEW](docs/PLAN_REVIEW.md) and is updated as checks are completed.

The documentation is in English. The product remains an Arabic RTL application for an Egyptian law office.

## Agency specialists during implementation

Every task card explicitly selects one installed Agency Agent lead and the relevant supporting profiles, in addition to its LawOffice skills. Read [AGENCY_AGENTS](docs/AGENCY_AGENTS.md); [the routing registry](docs/AGENCY_AGENT_ROUTING.json) maps all 23 tasks to 14 locally verified Agency profiles. T01 uses `agency-software-architect` with `agency-devops-automator`; frontend, identity, backend, and recovery tasks have their own appropriate leads. Supporting profiles are scoped role passes, not an unsupported claim of spawned agents or Codex approval. Missing required profiles are reported before dependent implementation.

## GitHub workflow

Canonical repository: [MohamedAlksas/LawyerOS](https://github.com/MohamedAlksas/LawyerOS). `main` holds the stable integration baseline. The initial plan is published on `docs/project-plan-and-git-workflow`; merge its reviewed PR before starting T01 from `origin/main`. Each task card names its own `feature/` branch, and subsequent checkpoint commits are pushed to that same branch and PR. Read [GIT_WORKFLOW](docs/GIT_WORKFLOW.md). Codex reviews; a push does not itself approve or merge a task.

For each new clone, enable the local accidental-main-push guard with `git config core.hooksPath .githooks`. This is a local convenience, not a GitHub branch-protection guarantee.

Regenerate and validate the maintained package with PowerShell 7:

```powershell
pwsh -File scripts/Add-TaskGitInstructions.ps1
pwsh -File scripts/Update-AgencyAgentPrompts.ps1
pwsh -File scripts/Build-TaskPromptIndex.ps1
pwsh -File scripts/Validate-AntigravityKit.ps1
pwsh -File scripts/Validate-AgencyAgentRouting.ps1
pwsh -File scripts/Build-PlanningKit.ps1
```

The planning validation GitHub Actions workflow checks the instructions and generated text deliverables; application CI is implemented later in T02. `work/`, credentials, and runtime client files are excluded from Git. Project skills and generated planning deliverables are tracked.

Locally, `pwsh -File scripts/Validate-AgencyAgentRouting.ps1 -VerifyInstalled` additionally checks the named global profile files/frontmatter/hashes. CI runs portable checks only; a successful portable check does not prove Antigravity loaded a profile. Global Agency installations are not modified or copied by this package.

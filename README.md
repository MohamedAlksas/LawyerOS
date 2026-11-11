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

## Local development startup

Follow these steps to run LawOffice OS locally for development and testing:

1. **Prerequisites**:
   - Node.js 26 Active LTS (`^26.13.0`) and npm 11.x
   - Docker Desktop with Docker Compose v2+
   - Git

2. **Environment configuration**:
   - Copy the synthetic environment template:
     ```powershell
     cp .env.example .env.local
     ```
   - In `.env.local`, review loopback variables:
     - Development database URL (default host port `5432` on Linux/CI, or `6432` on Windows to avoid Hyper-V excluded port ranges):
       ```env
       DATABASE_URL="postgresql://lawoffice_user:lawoffice_dev_secret@127.0.0.1:6432/lawoffice_dev?schema=public"
       ```
     - Isolated test database URL (default host port `5433` on Linux/CI, or `6433` on Windows):
       ```env
       TEST_DATABASE_URL="postgresql://lawoffice_user:lawoffice_dev_secret@127.0.0.1:6433/lawoffice_test?schema=public"
       ```
   - Vitest automatically loads `TEST_DATABASE_URL` from `.env.local` or `.env.test` via `vitest.config.mjs`, or from the active shell environment.

3. **Start local PostgreSQL services**:
   - **Development database** (persistent volume `lawoffice_pgdata`):
     ```powershell
     # On Windows (specifying PGPORT):
     $env:PGPORT="6432"
     docker compose -f ops/docker-compose.yml up -d
     ```
   - **Isolated test database** (disposable tmpfs storage):
     ```powershell
     # On Windows (specifying TEST_PGPORT):
     $env:TEST_PGPORT="6433"
     docker compose -f ops/docker-compose.test.yml up -d
     ```
   - Verify container health status:
     ```powershell
     docker compose -f ops/docker-compose.yml ps
     docker compose -f ops/docker-compose.test.yml ps
     ```

4. **Run tests & quality checks**:
   ```powershell
   npm ci
   npm run lint             # ESLint flat configuration check
   npm run typecheck        # Strict TypeScript typechecking
   npm run test             # Unit tests (environment, pool lifecycle, and health routes)
   npm run test:integration # Real PostgreSQL readiness probe & failure mode checks
   npm run build            # Production compilation
   ```
   *Note on `npm run test:e2e`:* E2E browser tests (Playwright) are deferred to Milestones M1 (T04) and M6 (T16) and intentionally exit non-zero (`NOT RUN`) in T02.

5. **Start development server**:
   ```powershell
   npm run dev
   ```
   - Placeholder page: `http://localhost:3000` (Arabic RTL, `lang="ar-EG"`)
   - Liveness probe: `http://localhost:3000/api/health/live` (HTTP 200)
   - Readiness probe: `http://localhost:3000/api/health/ready` (HTTP 200 when DB is connected, HTTP 503 when down)

6. **Safe teardown**:
   - To stop the disposable test database:
     ```powershell
     docker compose -f ops/docker-compose.test.yml down
     ```
   - To stop the development database while preserving persistent data:
     ```powershell
     docker compose -f ops/docker-compose.yml down
     ```
     *(Note: Do not pass `-v` unless an explicit database reset is intended).*

## Agency specialists during implementation

Every task card selects one Agency lead and relevant supports alongside its LawOffice skills. [The routing registry](docs/AGENCY_AGENT_ROUTING.json) maps 23 tasks to 14 profiles and native definitions in `.agents/agents/`; profiles are selected from 155 project-local copies. [The complete catalogue](docs/AGENCY_AGENT_CATALOG.md) separates scheduled roles, general/specialized technical roles, and business/professional/creative roles. After this policy is integrated, the next assignment requires actual delegated sessions for the lead and every support, with distinct invocation IDs, checkpoint SHAs, and returned results. Same-session role passes are not a substitute. Read [AGENCY_AGENTS](docs/AGENCY_AGENTS.md); unavailable native execution is `BLOCKED_NATIVE_AGENTS`. Prepared definitions and static validation do not prove execution or Codex acceptance. Preserve extra installed profiles; the managed-skill validator checks only its seven LawOffice skills.

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

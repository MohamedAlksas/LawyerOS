# T01 — Prove dependency compatibility and create the minimum build

Copy the complete block into Antigravity. This is the first implementation task; it has no predecessor review.

```text
Git delivery contract (required):
- Read docs/GIT_WORKFLOW.md. Canonical origin is https://github.com/MohamedAlksas/LawyerOS.git.
- Use the dedicated branch feature/t01-toolchain-foundation. Inspect current changes, origin, and latest origin/main before editing. Do not switch a dirty/shared checkout or stage another agent's work. Use an isolated worktree if another task is active.
- Start from updated origin/main only after the planning baseline and this task's required predecessor are accepted and merged. A stacked base requires an explicit Codex decision naming that base; do not choose one yourself.
- Commit each coherent task update and push it to this same task branch. The first push sets upstream; later updates use that branch's upstream. Inspect staged files and exclude work/, secrets, client data, and unrelated changes. Never force-push or push directly to main.
- Open one draft pull request from this branch to main when there is a reviewable checkpoint; update that PR for subsequent commits rather than creating a new branch for every save. Missing GitHub credentials/access is reported honestly, not treated as a successful push.
- The submission must include branch, base SHA, local HEAD SHA, verified remote pushed SHA, upstream, PR URL, and actual checks. Stop for Codex review. No main merge without the owner's current merge authorization.

Implement LawOffice OS Task T01 only in D:\Lawyer. You are the Antigravity implementation agent using the owner's selected Gemini model; Codex is the planner and reviewer. Do not build the application features.

Required skills — read these exact files before editing:
- .agents/skills/lawoffice-delivery/SKILL.md
- .agents/skills/lawoffice-foundation/SKILL.md
Report the files actually loaded. If a required file cannot be read, report its path; do not pretend the skill ran or silently substitute another workflow.

Read GEMINI.md, PRODUCT.md, GLOSSARY.md, docs/PRD.md sections 1–4 and 7, docs/ARCHITECTURE.md sections 1, 4, and 5, M0 in docs/ROADMAP.md, and the submission format in docs/REVIEW_PROTOCOL.md. No previous task acceptance is required for T01. Inspect the existing folder and installed tools; do not assume the folder is empty or Git is configured.

Allowed edits: docs/DEPENDENCIES.md, package.json, one corresponding lockfile, necessary TypeScript/Next.js/build/lint configuration, .gitignore, a minimal src/app layout/page and styles, and docs/reviews/T01-submission.md. Preserve the canonical plan. Do not add a database, authentication, clients, matters, financial logic, Docker deployment, or a dashboard with fabricated records.

1. Record the actual runtime/package-manager versions and existing file changes. Prefer npm if no package manager is established; preserve an existing compatible choice rather than creating a second lockfile.
2. Verify supported Node LTS and compatible exact Next.js/React, Prisma 7 CLI/client/driver adapter, Better Auth/Prisma adapter, Tailwind, and Playwright versions using official documentation. Recheck the documented Prisma 8 compatibility issue. Record URLs, date, and chosen versions in docs/DEPENDENCIES.md; do not resolve a conflict by switching the agreed stack independently.
3. Pin/install the packages needed for the minimum scaffold. Document compatible later-task dependencies without implementing their features. Configure TypeScript strict, lint, typecheck, and build commands. Render only a clearly labeled Arabic project placeholder with lang=ar-EG and dir=rtl.
4. Run dependency installation, lint, typecheck, and production build. Demonstrate a clean reinstall using the chosen lockfile without deleting existing work or unrelated folders. Record commands, exit codes, and actual output; unavailable checks are NOT RUN.
5. Check there is exactly one lockfile, no embedded credentials, no client records, and no unintended application modules. Do not invent tests for the trivial placeholder or claim database/auth tests ran.

Write docs/reviews/T01-submission.md with loaded skills, actual base commit or recorded snapshot, changed files, dependency evidence, executed checks, limits, and reproduction steps. Submit T01 and stop. Do not start T02 or approve your own work.
```

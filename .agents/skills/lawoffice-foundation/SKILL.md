---
name: lawoffice-foundation
description: Establish LawOffice OS tool compatibility and its reproducible development foundation for T01 or T02, without implementing application features.
---

# Foundation

Implement only the assigned foundation ticket. Use the current project state and preserve existing planning documents and other contributors' work. This skill does not authorize deployment, real-data use, or a stack change.

## Read the relevant references

- Start with [implementer instructions](../../../GEMINI.md) and the assigned T01 or T02 entry in [ROADMAP](../../../docs/ROADMAP.md).
- Read the stack, compatibility constraint, and project layout in [ARCHITECTURE](../../../docs/ARCHITECTURE.md).
- For environment and operational configuration, read the applicable sections of [SECURITY_OPERATIONS](../../../docs/SECURITY_OPERATIONS.md).
- Use the submission format in [REVIEW_PROTOCOL](../../../docs/REVIEW_PROTOCOL.md). Other plan documents remain canonical; load only sections needed for this task.

## T01 — Prove compatibility

Inspect available tools and the repository before changing files. Consult official documentation for compatible supported Node LTS, Next.js/React, Prisma, Better Auth and its Prisma adapter, Tailwind, and Playwright versions. Recheck the documented Prisma 7/Better Auth compatibility constraint at execution time; do not assume Prisma 8 support or independently replace the chosen stack.

Record exact versions, evidence links, verification date, and constraints in `docs/DEPENDENCIES.md`. Maintain one package-manager lockfile. Production image versions must not float through `latest`.

Create only the minimum package/configuration and application placeholder needed to demonstrate installation, typechecking, and building. Do not implement authentication, case management, finances, or a fake login. Actual PostgreSQL setup and complete CI belong to T02; do not claim database validation in T01. Report a genuine incompatibility with evidence and options before changing a core technology.

## T02 — Reproducible local operation

Begin after T01 acceptance. Configure TypeScript strict mode, validated environment variables, local PostgreSQL, sanitized health checks, and CI within the assignment. Missing required configuration must fail clearly without exposing secrets. `.env.example` contains synthetic examples only. Keep a disposable test database separate from any operational database.

Provide the project's agreed check commands, accurately documenting those whose tests do not yet exist. Verify installation and startup from a clean checkout/install and run appropriate checks. Do not create placeholder tests or return fake success to imply coverage. No client forms or authentication features are included.

## Submit

Report actual changed files, exact commands and exit results, compatibility evidence, startup instructions, and unresolved limitations. Mark unexecuted checks `NOT RUN` with reasons. Submit the assigned ticket using the review protocol, then stop for independent review; this skill does not approve its own implementation.

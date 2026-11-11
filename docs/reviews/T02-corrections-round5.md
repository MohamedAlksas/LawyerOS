# Antigravity — T02 correction round 5

Continue **T02 only**, branch `feature/t02-runtime-ci`, same [draft PR #4](https://github.com/MohamedAlksas/LawyerOS/pull/4). Decision remains **CHANGES_REQUESTED**. No main merge, T03, deployment, real data, model change, tool upgrade or cleanup of owner assets.

## Read and preserve

Read `AGENTS.md`, `GEMINI.md`, `PRODUCT.md`, `GLOSSARY.md`, `docs/PRD.md`, `docs/tasks/T02.md`, `docs/AGENCY_AGENTS.md`, `docs/AGENCY_AGENT_ROUTING.json`, `docs/REVIEW_PROTOCOL.md`, `docs/GIT_WORKFLOW.md` and `docs/reviews/T02-review-round5.md`.

Load and record actual project skill paths:

- `.agents/skills/lawoffice-delivery/SKILL.md`
- `.agents/skills/lawoffice-foundation/SKILL.md`
- `.agents/skills/lawoffice-testing/SKILL.md`

Inspected published head: `867b312c8dcec847dc18df7784dc382b5e0c911d`; application checkpoint: `712c3b43ad4d9879dbddb2f1302eb604c9982ccc`; integrated main: `66d314f0c6c01d5522098a70329de6b3190c0c28`, via `d37d84e1e86c4631ca44fe8ebcaa82aa29f6c22d`. Safely fetch/fast-forward the incoming Codex review and regenerated ZIP. Preserve both this report and previous history. Inspect current main; integrate only new incoming changes if any. No reset, forced checkout, force push, deletion or automatic stash of another agent's work. Use an isolated checkout if necessary.

## Native assignment

Required actual lead/support remain:

| Role | Canonical definition | Runtime alias | Installed profile |
|---|---|---|---|
| Lead | `.agents/agents/agency-devops-automator.md` | `lawoffice-native-devops-automator` | `.agents/skills/engineering-devops-automator/SKILL.md` |
| Backend | `.agents/agents/agency-backend-architect.md` | `lawoffice-native-backend-architect` | `.agents/skills/engineering-backend-architect/SKILL.md` |
| Test | `.agents/agents/agency-test-automation-engineer.md` | `lawoffice-native-test-automation-engineer` | `.agents/skills/testing-test-automation-engineer/SKILL.md` |

Reuse verified native sessions only if the running tool exposes them: lead `ffa3f50c-55cb-4a01-ac7e-1a67bc69d248`, backend `3bb23a5f-3ea7-42a9-a3a8-4dfe952c3413`, test `db5fe921-b956-41a0-8960-044838a849d9`. Otherwise use the existing bounded registration procedure to launch proper children. Record actual IDs, aliases/runtime definition paths when exposed, profile names/paths/hashes, current SHA and ownership. Each returns an updated read-only preflight before source edits. The lead implements, both supports inspect a newly committed frozen checkpoint, and the lead reconciles. No coordinator bypass or nested children; inherit the owner's model. A required execution failure is `BLOCKED_NATIVE_AGENTS` before dependent edits. Earlier native execution is already verified; do not invent replacement evidence or repeat an unrelated diagnosis.

## R16 — Disable the driver's whole-string repair branch through a bounded grammar

The remaining defect is one preprocessing mismatch, not a need for more URL features. Installed `pg-connection-string/index.js:20–22` calls `encodeURI` on the **whole original string** when it sees a raw ASCII space or certain malformed percent escapes. This changes other database escapes before the driver decodes them. The application's `new URL` path currently skips that repair.

Adopt the following explicit configuration-input policy **before constructing a URL or serializing/decoding the original input**. Apply it to both original `DATABASE_URL` and `TEST_DATABASE_URL` before comparison or replacement:

1. Reject raw whitespace and control characters. A suitable lexical check is `/[\s\u0000-\u001f\u007f]/u`. Spaces needed inside credentials or query values must be properly percent-encoded, such as `%20`.
2. Reject any `%` not followed by exactly two hexadecimal digits at that position: `/%(?![0-9A-Fa-f]{2})/`. This check examines the complete original string, including credentials, query and fragment, rather than only the database path.
3. Keep current protocol/nonempty authority/database/valid port checks, encoded-host rejection, and case-insensitive routing-key rejection for every occurrence. Retain single database decoding with `decodeURI` and ordinary supported `%HH` sequences. Do not pre-decode or reserialize the full URL before checking its raw syntax.
4. Keep helper/documentation claims bounded to this supported grammar. If the extraction helper directly receives unsupported syntax, it must not claim that its partial `new URL` interpretation is a driver-effective identity. A small shared lexical guard is acceptable; no parser framework or dependency is requested.

This intentionally rejects ambiguous configuration syntax instead of reproducing the driver's permissive repair. It does not change office workflows or authorize new product scope. Document the supported encoding rule briefly in README's existing configuration instructions. Do not introduce external parser calls that can read SSL key/certificate files merely to compare identity.

### Regression matrix — prove the cause together

Use operational base `postgresql://synthetic:synthetic@127.0.0.1:5432/law%6fffice_test` and test URL `postgresql://synthetic:synthetic@127.0.0.1:5432/law%256fffice_test`. Appending any of these to the operational base currently makes public `validateEnv` accept identical actual driver targets:

- `?application_name=synthetic name`
- `?application_name=%zz`
- `?application_name=%0z`
- `#%zz`

Raw spaces in a synthetic username/password trigger the same branch. Compare installed `new pg.Client({ connectionString }).connectionParameters` host/port/database **without calling connect**: both identities are `127.0.0.1:5432`, database `law%6fffice_test`. Add focused parameterized public-boundary regressions for this shared cause, demonstrating rejection on either original input. Use actual driver identity for the equivalence proof rather than only the application's helper.

Also reject malformed trailing `%`/`%a`, without claiming these independently trigger this installed repair regex. Raw tabs/newlines alone were not established as this bypass; their rejection is part of the strict supported grammar. Preserve valid encoded spaces (`%20`), ordinary credential/path escapes, distinct disposable databases/ports, IPv6, documented `?schema=public` / `?sslmode=disable`, and all five earlier alias regressions. Avoid tests that merely copy the proposed regex; verify the public configuration behavior.

Allowed application scope: `src/lib/env.ts`, focused `tests/unit/env.test.ts`, the existing README configuration paragraph, and the submission report. **R21 is resolved; no further pool implementation or pool-test rewrite is requested.** No auth/domain code, dependencies, unrelated UI or parser feature expansion.

## R22 and planning evidence

Update `docs/reviews/T02-submission.md` to preserve inspectable evidence:

- Record the real integration command/result and exact hosted run/head references. If local integration was not run in a phase, state that explicitly; hosted success can still be reported accurately. Current verified application run is `43050622492`, planning run `43050622427`, both at `867b312...`; do not relabel them as checks on new code.
- Label retained startup/HTTP results with their original date and inspected checkpoint, or state that the old checkpoint is unavailable rather than inventing it. Check current-policy startup using an actual `next start`/`npm.cmd run start` process after a successful current build: a valid synthetic URL should start, rejected raw syntax should fail with sanitized actionable errors. `npm run build` alone does not prove startup validation. Stop only a process/container owned by this task.
- Mark remaining limits, including actual-pool saturation and E2E. Do not claim that tests can never access operational targets while the new boundary remains unverified.
- Codex already regenerated the stale merge-resolved ZIP (R23): preserve it. Run planning generation again when sources change; do not resolve output conflicts by keeping an older ZIP. Use a compatible PowerShell 7 host, not Windows PowerShell 5 where `Path.GetRelativePath` is unavailable. If `pwsh` is absent from Antigravity's PATH, locate the existing runtime; do not install tools to bypass the native preflight. Codex's observed host is `C:/Program Files/WindowsApps/OpenAI.CodexPrimaryRuntime.v26-1105-1297-0_26.1105.1297.0_x64__3k8sg7r9htsxt/dependencies/native/powershell/pwsh.exe`; verify that path before use. Record real exit statuses and compare ZIP entry source hashes.

## Checks and delivery

Run lint, typecheck, units locally and with explicit `CI=true`, disposable real PostgreSQL integration, build/current startup checks, both planning validators and regeneration. Use `npm.cmd` on Windows to avoid the blocked `npm.ps1`. Set CI in the current shell rather than passing an interpolated nested PowerShell command; verify the actual setting. Keep E2E deferred/nonzero. Both hosted workflows must succeed at the new published head.

Record exact skills/profiles read, current native preflight and real ownership, supported grammar and regression results, frozen support findings and reconciliation, actual commands/exits/limits, implementation/base/published SHAs from Git and external publication metadata without self-referential hashing. Use the existing PR/branch, no force push or merge. Stop for Codex's independent review.

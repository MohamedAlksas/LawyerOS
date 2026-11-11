# Native Agency execution and profile recovery

Prepared by Codex, 11 November 2026, Africa/Cairo. Status: **READY FOR OWNER REVIEW — native Antigravity execution NOT RUN**.

## Request, scope, and integration

The owner requires actual agents rather than one model performing sequential personas. This documentation/configuration assignment adds that prospective execution requirement, recovers deleted project-local profile instructions, and prevents the managed-skill validator from rejecting unrelated installed profiles.

- Canonical origin: `https://github.com/MohamedAlksas/LawyerOS.git`.
- Branch: `docs/native-agency-subagents`, targeting `main`.
- Base: `d3fd8f8b5e110858605092553d05911c2914ba37`.
- Isolated checkout: `C:/Users/Alksas/Documents/Codex/LawyerOS-native-agents`.
- The final publication message and PR record the pushed SHA. This report does not approve T02, merge main, deploy anything, or claim native runtime execution.

The active `D:/Lawyer` checkout contains in-progress T02 application fixes. No file there was changed by this assignment. Apply this policy to the next assignment/correction round after owner-approved integration, preserving current work. Prior task reports remain historical evidence.

## Deletion evidence

Codex first observed untracked `.codex/agents` and `.opencode/agents` in the active checkout, then observed them absent. Read-only inspection of the active Antigravity session database found completed command records:

- Steps 981/982: `git clean -f -d .agents/skills`, summary "Clean extraneous skills".
- Steps 989/990: `Remove-Item -Path .codex, .opencode -Recurse -Force -ErrorAction SilentlyContinue`, summary "Remove untracked .codex and .opencode".

These records establish that Antigravity issued the deletion commands; this is not merely an inference from missing folders. No complete conversation, hidden reasoning, credentials, or unrelated log content is copied into this report. The old `Validate-AntigravityKit.ps1` enumerated every `SKILL.md` and rejected counts other than seven. That was incompatible with extra owner-installed profiles; the revised validator counts managed `lawoffice-*` skills separately. The command summaries indicate cleanup intent, but do not establish that this validator was the sole reason for deletion.

## Delivered behavior

- 149 Agency profile files copied byte-for-byte from the surviving user installation into project-local `.agents/skills/`. Every copy's SHA-256 was checked against its source; see `outputs/Agency-Profile-Recovery.json`. The original deleted Codex/OpenCode wrapper files were **not** reconstructed.
- Upstream Agency license retained in `docs/third-party/agency-agents-LICENSE.txt`. Global installed files were read, not modified.
- 14 generated `.agents/agents/<profile-name>.md` definitions with `subagent: true`, `mainAgent: false`, inherited model selection, documented tool names, and scoped instructions to load project-local profiles.
- All 23 task cards require real lead/support invocations, distinct observable IDs, owned paths, pinned support-review checkpoints, returned findings, and lead reconciliation. The parent coordinates publication; children cannot self-approve, merge, or spawn recursively.
- Missing native capability is `BLOCKED_NATIVE_AGENTS` before dependent implementation. Same-session persona fallback is disabled; no unrequested model switch or upgrade is allowed.
- Preservation rules explicitly cover owner-installed untracked agent folders. A validator failure never authorizes deletion.
- Native definitions, project-local profile routing, prompts, delivery skill, implementer instructions, review format, and ZIP/readable handoffs are synchronized. CI verifies local profile metadata and generated definition freshness without claiming runtime execution.

## Actual validation

| Check | Result |
|---|---|
| Recoverable profile inventory and copy hashes | 149 byte-identical files; PASS |
| `Update-AgencyAgentPrompts.ps1` | Exit 0; generated 14 definitions and 23 assignments |
| `Build-TaskPromptIndex.ps1` | Exit 0 |
| `Validate-AntigravityKit.ps1` with all recovered profiles present | Exit 0; 7 managed project skills, 23 cards, zero issues |
| `Validate-AgencyAgentRouting.ps1 -VerifyInstalled` | Exit 0; 14 project-local profiles and native definitions; metadata and actual hashes read |
| Isolated baseline fixture before negative mutation | Exit 0 |
| Enable sequential fallback | Exit 1 as required; PASS |
| Set `subagent: false` | Exit 1 as required; PASS |
| Override inherited model with `pro` | Exit 1 as required; PASS |
| Remove T02's native invocation gate | Exit 1 as required; PASS |
| `Build-PlanningKit.ps1` | Initial exit 0: 69 reading sources, 230 ZIP entries, all ZIP/source hashes match, zero broken local links. The later 155-role catalogue update has 70 reading sources and 237 ZIP entries |

Negative scenarios ran against copied fixtures under ignored `work/`; they did not modify global profiles or the active application checkout. `outputs/Native-Agent-Policy-Validation.json` contains their results. The existing earlier Agency negative-check report is historical, not relabeled as a new runtime test.

Regenerating native definitions, prompts, and maintained text again produced no unstaged difference: the freshness check passed. Project-authored staged changes passed `git diff --check`. The full check flags preserved upstream trailing spaces and a decorative `=======` line inside one profile's example, so it is not reported as a clean full-tree check; recovered profile contents were intentionally preserved byte-for-byte.

A credential-pattern scan matched two bare PEM header examples in the public security profile. Read-only inspection found no key body, no complete PEM private-key block, and zero long Base64-only lines. The same pattern list was verified in the public upstream source; `outputs/Agency-Profile-Secret-Review.json` records this resolved false positive. Automatic approval initially rejected packaging on that signal; packaging was approved after the specific content and upstream evidence were checked. No actual credential was found or published.

Runtime discovery, tool compatibility in the owner's installed Antigravity, actual child execution, and resolved model availability are **NOT RUN**. Definitions use the current [official custom-subagent schema](https://antigravity.google/docs/subagents), but that does not prove the active installation exposes the capability. The first native task must show real invocation results or stop visibly. Application tests are outside this documentation change; T02 keeps its independent review gate.

## Recovery and limits

Commit the recovered profiles and definitions through this PR before they are used for the next assignment. Normal untracked-file cleanup will then leave those tracked files, but explicit deletion/reset can still remove them; the preservation rule remains essential. Do not restore files into an actively cleaning checkout or discard T02 work. The owner was advised to pause the current Antigravity run before restoration/integration.

The full roster is available as source material, not an instruction to launch every agent. Only the task's lead and at most two routed supports run. Codex continues independent review. Rollback is a scoped Git revert of this documentation/configuration change, preserving any task work; no database migration or real-data operation exists here.

## Reinstalled roster and classification update

After the owner reinstalled the agents, direct inspection found 155 Agency skill files, 155 corresponding Codex definitions, and 155 corresponding OpenCode definitions. These are three formats of the same 155 roles, plus the seven LawOffice skills. The original 149 recovered profile copies match the new installation by SHA-256; six additional installed profile files were copied into this isolated branch without changing the active checkout.

The complete `docs/AGENCY_AGENT_CATALOG.md` and `outputs/Agency-Agent-Catalog.json` classify every role exactly once: 14 scheduled LawOffice roles, 32 broadly reusable technical roles, 61 specialized technical roles, and 48 business/professional/creative roles. Classification uses actual installed descriptions and existing task routing; it does not launch agents, add them to task routing, or authorize new features. Legal domain profiles are distinguished from software implementers, and technology-specific roles remain conditional. No installed agent files were removed or moved.

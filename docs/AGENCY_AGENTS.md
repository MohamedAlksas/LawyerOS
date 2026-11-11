# Agency Agents: native execution contract

## Decision and scope

The owner requested actual delegated agents on 11 November 2026. From the next implementation assignment or correction round after this policy is integrated, each assigned Agency lead and support must run in a distinct native Antigravity session. Same-session persona passes no longer satisfy the contract. Earlier submissions remain historical evidence and must not be rewritten to claim delegation that did not occur. This changes delivery and evidence requirements, not product scope or the stack.

Agency's Antigravity integration supplies profiles as skills. A skill file alone is not a running agent. [Agency integration source](https://github.com/msitarzewski/agency-agents/blob/main/integrations/antigravity/README.md).

Current Antigravity documentation provides `invoke_subagent` and workspace definitions in `.agents/agents/`, with `subagent: true` and inherited model selection. The repository now supplies thin definitions for its 14 selected installed profiles. [Official custom-subagent documentation](https://antigravity.google/docs/subagents). These definitions are prepared configuration, not proof of execution in the owner's installed session.

## Sources of truth

- [AGENCY_AGENT_ROUTING.json](AGENCY_AGENT_ROUTING.json) names the task's default lead/support profiles and required execution policy. A later explicit Codex-authored slice assignment may refine role ownership under the routing rule below; the implementer cannot choose a different profile silently.
- `.agents/agents/<profile-name>.md` is the generated native definition, using the same name as the profile. Regenerate it with `scripts/Update-AgencyAgentPrompts.ps1`; do not hand-edit derived definitions.
- `.agents/skills/<registered-folder>/SKILL.md` is the project-local profile source. Read it in each delegated session, verify its frontmatter name, and record the loaded SHA-256. The current roster has 155 profiles: 149 recovered from the surviving global installation and six from the owner's subsequent reinstallation. All copied files match their observed source hashes. Only the 14 routed specialties receive native definitions. The global installation remains unchanged. [Recovery inventory](../outputs/Agency-Profile-Recovery.json), [complete classified catalogue](AGENCY_AGENT_CATALOG.md).
- Every LawOffice project skill listed by the task remains mandatory. Project rules govern generic Agency suggestions.

Retain [the upstream MIT license](third-party/agency-agents-LICENSE.txt) with redistributed profiles. Do not automatically update the recovered files or load the entire roster for a single task. The planning ZIP includes the project-local profiles and native definitions; the consolidated reading document omits the full roster's instruction bodies.

Observed profile hashes are inventory snapshots. Record drift, read the actual file, and escalate a substantive conflict; drift alone is not a missing-profile failure. A missing, unreadable, or misnamed required profile stops dependent work with an exact path/name report.

## Route the actual implementation slice

The owner requested specialty-appropriate assignments on 11 November 2026. This applies prospectively to new assignments/corrections. Codex chooses the lead from the behavior being changed and the expertise it needs, then names the exact profile/definition paths, owned files, acceptance checks and support responsibilities in the assignment. A broad task label such as T02 does not make its original lead the implementation owner of every subsequent correction. This refines the default routing contract without changing product scope, stack, native execution requirements or independent acceptance.

Use these existing installed specialties as the starting map:

| Actual work | Implementation specialty | Relevant support when required by scope |
|---|---|---|
| Docker, CI, service startup, process lifecycle and operational configuration | `agency-devops-automator` | Backend for application boundaries; test automation for observed process behavior |
| Application commands, API behavior, domain rules, configuration validation and database-target identity | `agency-backend-architect` | Security for sensitive boundaries; test automation for regression quality |
| Authentication, sessions, identity lifecycle and authorization | `agency-identity-access-engineer` | Application security and backend |
| Arabic RTL screens, responsive interactions and frontend behavior | `agency-frontend-developer` | Accessibility and relevant backend interfaces |
| A separately assigned test harness, regression suite or test infrastructure | `agency-test-automation-engineer` | The relevant application/operations specialist to review what the tests prove |
| Schema constraints, query/index design and database concurrency | `agency-database-optimizer` | Backend and relevant behavioral verification |
| Backup/restore consistency and recovery procedures | `agency-database-reliability-engineer` | DevOps and application-data correctness |
| Architecture decisions and decomposition | `agency-software-architect` | The implementation specialties affected by the decision |
| A separately assigned documentation slice | `agency-technical-writer` | The specialist who can verify its technical claims |

The selected application author may add focused regression tests for their change. Test specialists design/check meaningful evidence and may own a distinct testing slice; writing every assertion does not require a separate agent. DevOps may write application-language startup helpers when the behavior is operational. Choose by behavior, responsibility and risk, rather than file extension or a rigid ban on writing code.

Before each new slice, Codex records:

1. **Scope and reason:** the concrete behavior, why this specialty fits, and what is outside the slice.
2. **Actual assignment:** lead profile, canonical native definition and exact project-skill/profile paths; named supports and their bounded responsibilities.
3. **Ownership and evidence:** owned paths, base SHA, acceptance checks and expected outputs. Each write phase has one named owner per file.
4. **Routing decision:** retain task defaults, or explicitly state the roles being refined and why. A correction may use another already-routed specialist as lead, with the original lead supporting only the relevant operational concerns. The written Codex decision takes precedence over the generic task default for that slice; all unchanged requirements remain binding.

If work spans specialties, split it into small explicit implementation phases with an ownership handoff and committed checkpoint. For example, a backend slice owns connection-target validation, an operations slice owns the service launcher, and a test slice can own a process harness. One writer owns each phase/file; independent supports inspect the frozen result read-only. An author must not be presented as the independent reviewer of their own changes. Preserve the normal maximum of three active children and use only relevant specialists.

Antigravity may identify a mismatch and propose a better assignment to Codex, but cannot silently broaden an agent's role, change the selected model, replace required profiles, or use this rule as a fallback after native preflight fails. If a needed specialty lacks a registered definition, Codex must prepare its routing/definition before dependent implementation. Existing profile and native-execution checks remain mandatory. Portable validators check the default registry and generated cards; Codex separately verifies the written slice decision and its actual execution.

Current in-flight assignments retain their explicit ownership until Codex issues a new slice. In particular, T02's current startup/process-lifecycle correction remains appropriately led by DevOps. Earlier execution history is not retroactively reassigned. Codex will use this rule when issuing the next assignment, even when it remains under the same task ID and PR.

## Capability preflight

Before dependent implementation, the parent coordinator checks that its actual session exposes `invoke_subagent`, discovers every assigned `.agents/agents/<profile-name>.md`, and supports the definition's declared tool names. The definitions use the documented `view_file`, `grep_search`, `run_command`, and `replace_file_content` names. Antigravity warns that unrecognized tool names can hang a subagent; do not guess an alternative tool schema. [Official tool configuration](https://antigravity.google/docs/subagents#frontmatter-configuration-yaml).

Use the bounded canonical-or-registration procedure below. If native invocation, permissions, or model inheritance is still unavailable after that procedure, report **BLOCKED_NATIVE_AGENTS** with the installed version if observable, missing capability/error, affected task/roles, and the last successful step. Stop dependent implementation. Do not simulate children with role headings, invent IDs, install or upgrade tools, change models, or continue application implementation directly. Prepared configuration and portable CI cannot establish execution.

The owner selected the main implementation model; definitions use `model: inherit`. Record the resolved model if the environment exposes it, otherwise mark it unobserved. Do not substitute another model merely to obtain delegation. Actual launch is the decisive discovery check, and any launch failure remains visible.

### Bounded native registration compatibility

The running Antigravity session rejected the canonical `agency-*` invocation names. Read-only tool-result inspection also established a successful `define_subagent` registration under `subagent-agency-devops-automator`, followed by a real `invoke_subagent` result with conversation ID `f76008ec-e87c-4ad6-80ad-bef3c14c6edf`. That was only an echo probe, not execution of the T02 lead/support assignments. It proves a native registration path existed; it does not establish a general skill-name collision or absent file discovery as the root cause. Do not report total native unavailability from canonical-name failures alone.

1. Read the required canonical `.agents/agents/<profile-name>.md` and installed profile. Try its discovered invokable type if present. If that succeeds, retain the canonical type and record actual evidence.
2. If the canonical type is rejected and the live tool schema exposes `define_subagent`, register a separate runtime name: `lawoffice-native-` plus the profile name without its leading `agency-`. Preserve the profile name and its source hash. This runtime name is an invocation alias, not a replacement specialty or a new model. Never redefine/delete an unrelated existing customization. If the alias already exists, inspect and reuse it only if its definition matches; otherwise report the conflict instead of overwriting it.
3. Use the actual live `define_subagent` schema. The observed successful call used `Name`, `Description`, `SystemPrompt`, `EnableWriteTools`, `EnableMCPTools`, and `EnableSubagentTools`. Supply the canonical definition's Markdown instruction body after its YAML frontmatter, plus an explicit requirement to read the actual assigned profile/project skills. Do not copy YAML tool names as claims about available runtime tools. Keep nested-agent creation disabled, preserve inherited permissions, and grant only task-needed tools. Do not blindly copy IDE-only tool names into a different runtime's registration schema.
4. Actually invoke the registered alias with `invoke_subagent`, inherited model, assigned role, bounded prompt, and task-owned workspace. The observed call used `TypeName`, `Role`, `Prompt`, `Model`, and `Workspace`. Names/registration success alone are insufficient: obtain a distinct child conversation ID and its returned preflight result reading the required instructions. Before application edits, all required children must pass that read-only preflight. Then the lead owns implementation and supports examine the frozen checkpoint under the normal contract.
5. At most one canonical attempt and one owned alias registration/invocation attempt per role are needed. If required execution still fails, stop dependent implementation and report the exact failure. Do not probe unrelated built-in agents, repeatedly create renamed types, or continue directly. A killed or echo-only probe is not a completed role.

Report the canonical source-definition path, runtime definition path returned by the tool, actual alias/TypeName, profile name/path/hash, conversation ID, returned findings/checks, inspected SHA, and reconciliation. The alias mechanism is documented as supported by the observed session and [the official transient-subagent API](https://antigravity.google/docs/subagents); the next task still needs its own actual role-level execution proof. Same-session persona fallback remains disabled.

## Coordinator, implementation, and review ownership

1. The parent inspects Git state and prerequisites, reads the task/required references, and assigns one real lead child and each routed support child. It coordinates the task and publication; it does not satisfy the lead assignment by taking that persona itself.
2. Give every child a complete bounded assignment: task ID, role/profile, required project skills/references, base or reviewed SHA, workspace, owned/examined paths, allowed actions, acceptance criteria, checks, and report destination. Native children may start without the parent's conversation history, so passing a role name alone is insufficient.
3. The lead owns only the assigned implementation slice. One writer owns a file at a time. Children preserve existing changes and do not switch the parent's branch, stage unrelated files, publish, merge, or spawn nested agents. The parent handles coherent commits/pushes on the task's existing feature branch.
4. Before support review, the parent creates a committed checkpoint and freezes application source. Each support examines that exact SHA in its own session; support review does not edit application source. Give build/test runs separate worktrees when generated files, ports, databases, or watchers could conflict. Independent support reviews may run concurrently; dependent implementation and reconciliation stay ordered.
5. Supports return concrete findings and test evidence. The lead reconciles them; the parent records dispositions. If implementation changes, commit a new checkpoint and rerun the affected support checks against it. A report about an older SHA does not verify new code.
6. Normally use one lead plus at most two routed supports, at most three active children. Do not load or launch the entire Agency roster. Use the task's default routing or its explicit Codex-authored slice refinement; that written assignment remains the scope limit. Supports can finish with no findings but must state what they examined and what remains untested.
7. Codex independently reviews the published implementation. Native delegation, a support verdict, a green build, and a successful portable validator never grant task acceptance, a main merge, or the next assignment.

## Required execution evidence

Extend `docs/reviews/Txx-submission.md` with one row per required child:

| Role/profile | Native invocation or conversation ID | Definition path | Loaded profile path/name/hash | Owned/examined paths | Inspected SHA | Result and evidence |
|---|---|---|---|---|---|---|
| Assigned lead or support | Actual tool result or observable UI reference | Actual discovered file | Actual file read, metadata, SHA-256 and drift | Explicit scope | Exact code checkpoint | Findings/actions, commands/exits, artifacts or NOT RUN |

IDs must be distinct and attributable to native tool/UI output. Retain a concise invocation record and the returned result/artifact reference; if no durable log is exposed, state that limit and provide the observable conversation reference. Do not request hidden reasoning or publish full conversations containing secrets. Record lead reconciliation and which checks were rerun after changes.

Missing execution evidence is **NOT RUN**, not a completed Agency requirement. Profile reading and SHA lists remain useful but cannot replace native invocation records. Synthetic data only; no credentials or client records in Git, logs, or reports.

## Integration with active work

Prepare this policy on its own documentation branch/PR from `origin/main`; do not change the active task's checkout or mix in its application fixes. After owner-approved integration into main, safely integrate the policy into the existing task branch at a clean checkpoint before assigning the next correction round. No automatic stash, reset, force-push, or branch switch beneath another agent. Current uncommitted work is preserved, and earlier sequential execution is never retroactively relabeled as native delegation.

Owner-installed agent assets are owned work even before a Git commit. Never clean/delete `.agents/`, `.codex/`, or `.opencode/` content merely because it is untracked or a validator expects fewer files. The project validator checks its seven `lawoffice-*` skills separately from Agency profiles. Resolve a mismatch by checking validator scope and preserving additions. Deletion requires an explicit owner assignment naming the target. Native definitions and recovered profiles are committed so normal untracked-file cleanup cannot remove them, but Git tracking does not prevent every deletion and does not replace this rule.

# Stitch reference audit and T04 design handoff

Date: 2026-11-16. Status: usable visual reference; incomplete implementation specification.

## Selected source

The owner explicitly selected https://stitch.google.com/projects/10964447413466098333 . Use this project only. Another similarly named project is not an approved alternate design source.

Local exports: `docs/design/stitch/10964447413466098333/`. Screen HTML is stored by source screen ID; `inventory.json` maps IDs to Arabic titles, device type, dimensions and original resources. `today.png` and `login.png` are representative original screenshots. The HTML is a reference snapshot, not application source. It contains external CDN/font dependencies and relative/prototype links and is not guaranteed to render fully offline.

## Sufficiency decision

The connector returned 36 screens, all classified DESKTOP with width 2560. Coverage includes login/MFA, dashboard, matters/proceedings, hearings/results, deadlines/tasks, parties/documents and finance, with multiple versions of some screens. This establishes substantial visual exploration, not 36 approved unique application journeys.

For T04 it is enough to establish a candidate desktop visual direction, but not enough to approve responsive/accessible implementation. Dedicated 390/768 layouts, real navigation behavior, empty/loading/error/offline/session-expiry states, 200% reflow, keyboard/focus behavior, and installation/cache privacy require implementation and evidence. A screenshot cannot establish those properties. Broader business screens remain future-task references; T04 must not implement fake records, totals or those modules.

Initial source inspection found:

- `f5121cf7b0f049b1929c82686417540c` (S01a login) includes a demonstration account and autofill affordance, invented office/person/support information, an invented version and an unsupported certified-encryption claim. Do not copy these into the application or change accepted authentication behavior to match them.
- `05beab390fca4bf29826ed4ac95e7a91` and `aa569cb252a14924b610a09335fcc396` show dashboard variations with synthetic hearings/totals and many future actions. T04 uses real available routes and genuine empty states; these examples are not operational data or authorizations for new modules.
- Exports use Tailwind v3 CDN scripts, remote Google fonts/Material Symbols and duplicated links. Rebuild using the pinned local stack and locally hosted licensed Arabic font/icons, following DESIGN.md. Do not paste export scripts/configuration into production.
- Some login HTML requests Noto Sans while claiming an Arabic-font design. Verify actual Arabic glyph font selection rather than assuming a heading/comment proves it.
- The exported dashboard screenshot explicitly displays local unsynchronized mode and automatic local saving for a private note. This conflicts with V1's prohibition on confidential browser persistence/offline synchronization. Remove those promises; unsent confidential text may remain only in current page memory with honest connectivity feedback.
- The screenshot's legal-deadline card states a specific remaining legal period and combines review/approval with completion wording. Do not infer legal rules from mockups; retain manual deadline review and separate approval from evidence that the legal action was completed.
- Stitch's generated colors and font choices can drift from canonical DESIGN.md. Keep DESIGN.md authoritative; record any proposed change and its impact before replacing agreed tokens.

Visual review is limited to representative exported screenshots and source samples, plus the full metadata inventory. This is not acceptance of every screen, contrast, installation or accessibility.

## Recommended approach

Use Stitch as candidate A and adapt its useful hierarchy to DESIGN.md, T04 scope and existing secure implementation. Do not commission a full application redesign from scratch merely to implement the shell. For a useful alternative, ask Gemini for one bounded candidate B before committing the visual implementation; compare only equivalent representative screens and states. Neither candidate is selected by this report on the owner's behalf.

## Controlled A/B comparison

1. Freeze the brief and synthetic content for both candidates: desktop shell/home with genuine empty state, mobile shell/home, and one shared error/offline state. Use the same available routes, Arabic text, actions and data; omit future business functions.
2. Candidate A follows the selected Stitch hierarchy, corrected for the issues above. Candidate B is independently designed from PRODUCT.md, DESIGN.md and the same brief. If independence matters, create B before showing its designer A's screenshots. Keep the same required visual tokens unless comparing tokens is explicitly requested.
3. Store prototypes under `docs/design/comparison/a-stitch/` and `docs/design/comparison/b-gemini/`, outside production routes. These are optional design experiments, not a second application or permission to replace auth. Preserve A unchanged when preparing B. Record exact input references and versions.
4. Render both at 390, 768 and 1440 with identical content, font loading and zoom. Export matched screenshots and short interactive walkthroughs; a fixed 2560 screenshot scaled down is not a mobile layout. OpenCode tests the same requirements against each candidate after they are runnable.
5. Score clarity of primary action/navigation, Arabic readability, information density, mobile reachability, empty/error clarity, keyboard/focus, reflow, contrast and implementation complexity. Accessibility/privacy/function failures are gates, not compensated by visual appeal. Do not claim screen-reader compliance from DOM checks alone.
6. Have the owner, preferably also the lawyer, find security settings, navigate home, and explain the error/offline state on both. Record observations; choose one direction, then implement only that direction in the canonical T04 branch. Code acceptance and the lawyer pilot remain separate.

## Skills and agents

All paths are resolved relative to each isolated worktree. Both coordinators read these project skills in full:

- `.agents/skills/lawoffice-delivery/SKILL.md`
- `.agents/skills/lawoffice-arabic-ui/SKILL.md`
- `.agents/skills/lawoffice-testing/SKILL.md`

| Owner/phase | Native profile | Skill | Definition | Owned work |
|---|---|---|---|---|
| Gemini: design adaptation and frontend implementation | agency-frontend-developer | `.agents/skills/engineering-frontend-developer/SKILL.md` | `.agents/agents/agency-frontend-developer.md` | Candidate/contract, shell/navigation/PWA presentation, permitted frontend paths |
| OpenCode: browser evidence | agency-test-automation-engineer | `.agents/skills/testing-test-automation-engineer/SKILL.md` | `.agents/agents/agency-test-automation-engineer.md` | New T04 browser tests and test report only |
| Gemini: independent accessibility support at frozen checkpoint | agency-accessibility-auditor | `.agents/skills/testing-accessibility-auditor/SKILL.md` | `.agents/agents/agency-accessibility-auditor.md` | Read-only rendered UI/accessibility findings |
| Gemini: independent test support at frozen checkpoint | agency-test-automation-engineer, distinct invocation from OpenCode's author | `.agents/skills/testing-test-automation-engineer/SKILL.md` | `.agents/agents/agency-test-automation-engineer.md` | Read-only review of test adequacy/results |

These three native definition files were verified present. A UI Designer skill exists, but `.agents/agents/agency-ui-designer.md` was not present at inspection; it is not assigned as an available native agent. Do not fabricate invocation or silently replace a required role. The existing frontend lead is sufficient for this bounded design adaptation. Record actual invocation IDs, loaded paths/hashes, checkpoint and returned results when execution occurs; this routing is not evidence that agents have already run.

Follow `docs/assignments/T04-parallel-assignment.md` for branches, isolated worktrees, single-writer ownership, shared interface contract and integration. Gemini owns application changes; OpenCode owns tests. Reference exports are frozen inputs, not shared working files to edit concurrently. The coordinators must include this report and selected-project reference exports in their worktrees before dependent implementation; untracked files in the original checkout are not automatically present in a new worktree.

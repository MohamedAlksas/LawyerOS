# Start LawOffice OS

The plan is ready in `D:\Lawyer`. It currently contains documentation only; no application code or deployment.

## Who does what?

- **Codex:** planning, assignments, implementation/test review, and prioritizing corrections.
- **Gemini 3.8 Flash:** implement one task, provide evidence, and fix review findings. The name follows your choice; runtime and folder access have not been tested.
- **You and your father:** hosting and real-data decisions, deadline/balance accuracy, and usability validation.

## First implementation step

First integrate the reviewed planning PR from `docs/project-plan-and-git-workflow` into `main`. T01 then branches from updated `origin/main` as `feature/t01-toolchain-foundation`. Do not treat an unmerged local planning branch as the normal base; a stacked workflow requires an explicit Codex decision. See `docs/GIT_WORKFLOW.md`.

Open `D:\Lawyer` as the Antigravity workspace and start a fresh agent conversation. Copy the single prompt in `docs/tasks/T01.md`, also delivered as `outputs/LawOffice-OS-Antigravity-T01.md`. It explicitly names the two skills to read: `lawoffice-delivery` and `lawoffice-foundation`, with their `.agents/skills/` paths. See `docs/ANTIGRAVITY.md` for skill loading. If local files are unavailable, attach the T01 references and required skills from the kit, not real client files. Actual discovery in your Antigravity session has not been tested here.

Task cards also name Agency leads/supports with exact project-local SKILL.md paths. The native-agent policy requires distinct delegated sessions using bundled `.agents/agents/` definitions, with observable invocation IDs and results. The ZIP includes 149 recovered profile copies and the 14 routed native definitions. See `docs/AGENCY_AGENTS.md` for preflight and evidence. Integrate this policy through its reviewed documentation PR, preserve active uncommitted work, and apply it to the next assignment/correction round; never rewrite prior execution history. If native invocation is unavailable, report `BLOCKED_NATIVE_AGENTS` before dependent implementation.

T01 establishes tool compatibility and a minimal build foundation; it does not build the entire system. After submission, return `docs/reviews/T01-submission.md` here for review, with the changes if they are not visible in the shared folder. We then prepare the next assignment or a fix request.

## Intended system

An Arabic desktop/mobile UI with today's agenda, internal matters, linked court proceedings, clients, hearings, documents, tasks/deadlines, and separate tracking for fees, expenses, and client advances. Paper files retain their codes and storage locations; migration starts with near-term hearings.

The plan contains 9 milestones, 21 main task numbers initially divided into 23 delivery units, 15 screens, and 18 acceptance scenarios. Post-V1 work includes external reminders, QR labels, templates, and OCR/AI after separate assessment.

## Reading and handoff files

- `outputs/LawOffice-OS-Master-Plan.md`: consolidated reading copy.
- `outputs/LawOffice-OS-Gemini-Prompts.md`: implementation prompts and submission instructions.
- `outputs/LawOffice-OS-Antigravity-T01.md`: the exact first prompt, ready to copy.
- `outputs/LawOffice-OS-Planning-Kit.zip`: canonical references in the project folder structure, ready to attach or transfer.
- Root files and `docs/` remain the sources to edit; regenerate `outputs/` when they change.

Your father reviews legal deadlines. Finance is not accepted until its examples are tested, and real data starts only after protection, backup, and recovery checks pass. VPS versus home-server hosting remains an operational decision; the plan explains both options and their responsibilities.

The planning package is in English. The intended application remains Arabic RTL for use in Egypt.

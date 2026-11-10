# LawOffice OS — Project instructions

- The project owner delegated planning and review to Codex and application implementation to Gemini. The current deliverable is planning documentation; its existence does not authorize deployment or use of real client data.
- Read `PRODUCT.md`, `GLOSSARY.md`, and `docs/PRD.md`, then the references for the assigned task. `GEMINI.md` governs the implementer; `docs/REVIEW_PROTOCOL.md` governs submission and review.
- Planning documents, implementation prompts, and review reports are in English. Code and domain identifiers are in English. The application remains Arabic RTL for an Egyptian law office; preserve Arabic UI examples and locale requirements. Do not reopen settled user facts.
- Each task needs a clear scope, acceptance criteria, and evidence. Review the actual implementation; do not accept another model's report without appropriate inspection.
- Antigravity assignments live in `docs/tasks/`. Every card names exact project-local skills under `.agents/skills/`; load them and record actual paths read. See `docs/ANTIGRAVITY.md`. Skill use does not replace Codex's independent acceptance.
- Critical rules: Matter differs from Proceeding; Party roles are scoped to a matter; legal deadlines require manual review; fees, reimbursable expenses, and client advances remain separate; posted financial entries are immutable; documents are private; backups must be restorable.
- Changes to an agreed rule must explain their impact and update its source documents. Do not add SaaS, offline synchronization, or document AI to V1 tasks.
- Use synthetic test data. Never put credentials or real client documents into Git, logs, or review reports.
- `outputs/` contains derived reading and handoff copies. Root documents and `docs/` are the canonical sources. Regenerate deliverables whenever the plan changes to avoid conflicting versions.
- Use `https://github.com/MohamedAlksas/LawyerOS.git` as the canonical GitHub origin. Follow `docs/GIT_WORKFLOW.md`: one branch per feature/assignment, push coherent updates to its existing branch, and review through that branch's PR. Verify branch/remote/head and preserve other agents' changes. No direct-main feature pushes, force pushes, or automatic merges. Report branch/base/pushed SHA/PR URL with submissions; dependent tasks normally require accepted predecessors integrated into `origin/main`.

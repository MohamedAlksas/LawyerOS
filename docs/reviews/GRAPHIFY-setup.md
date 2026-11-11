# Graphify setup evidence

Date: 11 November 2026. Scope: optional developer tooling and documentation; no application behavior, deployment, data migration, or T02 acceptance.

## Source and installation

- Integration branch: `codex/graphify-integration`; base `62494bad3eca1480d874e578e3cc5cd4926c6e40` from `origin/main`.
- CLI: `uv tool install graphifyy==0.9.106 --python C:/Users/Alksas/AppData/Local/Python/bin/python.exe`, exit 0. uv reported an existing isolated `0.9.104` installation and upgraded it to `0.9.106`; the executable was not on PATH.
- Skill: `graphify install --project --platform agents`, exit 0, in the isolated integration checkout and in `D:/Lawyer`. The latter is an owner-installed local asset, outside the active T02 tracked changes; it must be preserved during later branch changes. No existing Graphify skill directory was replaced in either checkout.
- Actual upstream skill read: `.agents/skills/graphify/SKILL.md` and its `references/query.md`; implementation inspection also used the installed distribution's `install.py`, `cli.py`, `export.py`, and `report.py`.
- Skill SHA-256: `995d067cc2994d2207d5233eea0fcdaa52a25ad86305a5e68c79f00d7d67962e`. The project skill body is the distribution's unmodified `skill-agents.md`.
- No global assistant settings, Git hooks, watcher, MCP server, model selection, or LLM provider setup was installed. Application dependencies were unchanged.

## Actual graph experiment

`scripts/Build-CodeGraph.ps1 -SourceRepository D:/Lawyer -SourceRef e4b2b68cdb87cca44139a04354ea31aad278fe1a` completed with exit 0 using the final helper behavior. This is a committed T02 work checkpoint, not an accepted integration or a review of its application changes. The source checkout was not switched, staged, or edited by graph generation.

The final local run is `work/graphify/e4b2b68cdb87-64ba8300/`: 14 detected code files, no docs/papers/images, **115 nodes, 175 edges, 9 communities**. Extraction and `cluster-only --no-label` both exited 0. The report records **0 input and 0 output LLM tokens**. `SOURCE.json` and final `graph.json` both identify the full source SHA above; the report displays its prefix `e4b2b68c`. Generated graph, HTML, report, archive, and source copy remain ignored local artifacts.

An initial experiment revealed that upstream detects the enclosing helper repository's HEAD when a source archive is nested inside another worktree. The helper now sets the graph's provenance to the actual archived SHA before generating the report. A fresh full run verified the corrected stamp; no upstream package code was patched.

Vocabulary selected from actual node labels: `validate`, `env`. The following queries completed with exit 0 using the final graph:

- `graphify query "validate env" --graph <generated graph.json> --budget 1000`: returned source nodes and relationships. The tool warned that its complete result exceeded the requested budget; the budget is not a strict output cap.
- `graphify explain "validateEnv" --graph <generated graph.json>`: resolved `src/lib/env.ts:L199`, including calls from `getEnv` at L314, `validateStartupEnv` at L325, and `createValidatedTestPool` at `tests/integration/db-readiness.test.ts:L15`.
- `graphify affected "validateEnv" --graph <generated graph.json> --depth 2`: included the test-pool constructor and `getDbPool` via `getEnv`. The cited calls were checked against the archived source, rather than inferred as test results.

## Limits and validation

The extractor warned that four unit-test files yielded no modeled symbols: `config-loading.test.ts`, `db-pool.test.ts`, `env.test.ts`, and `health.test.ts`. File/import nodes still exist, but test-body behavior and complete test coverage cannot be inferred. Root Vitest configuration is outside the archived corpus even where an import reference appears as a node. Working edits, other commits, schema, CI, and planning documents are outside this graph's claim.

- `git check-ignore` confirmed both the generated graph under `work/` and a conventional `graphify-out/graph.json` are ignored.
- `git diff --check`: exit 0.
- `scripts/Validate-AntigravityKit.ps1`: exit 0, 23 cards / 7 project skills / no issues.
- `scripts/Validate-AgencyAgentRouting.ps1`: exit 0.
- `scripts/Build-PlanningKit.ps1`: exit 0, 71 source documents, 253 ZIP entries, matching source hashes, zero broken local links.
- Application lint/tests/build: **NOT RUN for this independent tooling assignment**; no application source/dependency changes were made here, and this evidence grants no acceptance to the indexed T02 checkpoint.
- Antigravity runtime skill loading or graph queries: **NOT OBSERVED**. Native Agency invocation rules remain unchanged; this tool cannot satisfy them.

Rollback: stop using the optional helper/skill; no application migration is needed. Preserve owner-installed assets. Do not run upstream bulk uninstall/cleanup as part of a task correction.

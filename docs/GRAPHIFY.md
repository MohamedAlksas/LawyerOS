# Graphify — local code navigation

Graphify is optional development tooling for Codex and Antigravity. It maps source symbols and relationships to help select files for inspection and trace change impact. It adds no application feature, runtime dependency, database service, SaaS scope, or task acceptance. The source code and project requirements remain authoritative; missing graph edges do not establish that a dependency does not exist.

## Installation and provenance

Use the official [Graphify-Labs/graphify](https://github.com/Graphify-Labs/graphify) project. Its Python distribution is **graphifyy** (two trailing `y` characters); the executable is `graphify`. The tested release is **0.9.106**, installed with `uv tool install graphifyy==0.9.106`. This isolates its dependencies from the application's Node dependencies. Do not automatically upgrade it during an assigned implementation.

The upstream project-scoped skill is installed at `.agents/skills/graphify/SKILL.md`, with its `references/` and `.graphify_version` sidecars. It was copied by `graphify install --project --platform agents` from that pinned distribution; upstream does not expose a GitHub directory containing a ready-to-copy `SKILL.md`. License and notice copies are in `docs/third-party/`. The upstream skill is preserved verbatim. Apply the project-specific limits below before following its general multi-format pipeline.

Windows installations may place the CLI at `$env:USERPROFILE\.local\bin\graphify.exe` without adding it to PATH. The build helper checks PATH, then that location. To query manually, use the full executable path or a session-local PATH change. No global settings, automatic Git hooks, MCP server, watcher, provider key, or paid service is needed for this workflow. Host discovery of a newly installed skill may require a new conversation; installation does not prove Antigravity loaded it.

## Build a reproducible graph

Run from the checkout containing this helper:

```powershell
./scripts/Build-CodeGraph.ps1
```

The default source is this checkout's committed `HEAD`. To inspect another existing checkout or a particular task checkpoint, pass its path and a full commit SHA explicitly:

```powershell
./scripts/Build-CodeGraph.ps1 -SourceRepository D:/Lawyer -SourceRef HEAD
```

The helper resolves the reference to a full SHA first, then archives only committed JavaScript/TypeScript files under `src/` and `tests/`, plus `package.json` and `tsconfig.json` for resolution context. Fixture directories are excluded. It never reads the source checkout's untracked or modified file contents. It does not change branches, stage files, connect to PostgreSQL, or delete previous graphs. Generated snapshots, caches, JSON, report, and HTML stay under ignored `work/graphify/<sha>-<run>/` in the helper's checkout. `SOURCE.json` records the exact source commit and selected files. Confirm that the recorded source SHA is the intended task head before using any result.

Extraction uses `--code-only`, and report generation uses `--no-label`. There is no semantic document extraction or LLM community labeling. Do not replace these with bare `/graphify .`, scan the whole repository, or use `--postgres`, cloud upload, global graphs, document/PDF/image processing, or an external provider as part of this setup. Agent profile collections and planning bundles are outside the code corpus. Never add client data or credentials to the corpus. The HTML may load visualization libraries from external CDNs; use JSON/report queries if browser network access is unwanted. No extraction call uploads the code in this configured mode.

Working edits and later commits make a graph incomplete or stale relative to the current task. Rebuild at the new committed checkpoint instead of presenting the old graph as current. Uncommitted review still requires direct diff/source inspection. The helper deliberately creates a separate run directory, so exclusions and deleted symbols cannot silently survive from an older graph.

The helper sets the graph's `built_at_commit` to the archived source SHA before generating the report. Without this correction, upstream Git detection discovers the enclosing helper checkout and can label a graph from another checkpoint with the wrong commit. `SOURCE.json` and the final report must agree. The helper also verifies the recorded Graphify version before producing the final report.

## Query and verify

Replace `GRAPH_JSON_PATH` with the actual `graphify-out/graph.json` path printed by the helper:

```powershell
graphify query "validateEnv" --graph GRAPH_JSON_PATH --budget 1200
graphify explain "validateEnv" --graph GRAPH_JSON_PATH
graphify affected "validateEnv" --graph GRAPH_JSON_PATH --depth 2
```

If the executable is not on PATH, prefix it with `&` and its full quoted path. The query searches graph vocabulary; it does not prove runtime behavior. Ambiguous names exit 3 and list candidates; absent names exit 4. Select the exact symbol/file rather than inventing an answer. Read the returned source files at `SOURCE.json`'s commit and run the relevant behavioral checks before reporting a finding or accepting a correction. Dynamic imports, framework conventions, aliases, and generated Prisma code may be incomplete. This graph does not cover all root configuration, CI, Prisma schema, docs, or Git history.

## Antigravity instruction

Use this addition alongside the current task card, never as a replacement assignment:

```text
Use Graphify as a supplementary code-navigation tool for the current LawOffice OS task. Read docs/GRAPHIFY.md and .agents/skills/graphify/SKILL.md; record the actual paths read. Preserve the task card's required project skills and distinct native Agency lead/support invocations. Graphify is a tool, not a replacement agent or native-agent preflight.

At a committed checkpoint, run scripts/Build-CodeGraph.ps1 for the assigned checkout and explicit checkpoint SHA. Inspect SOURCE.json and record its sourceCommit. Query the generated graph for the affected symbols, then inspect the actual source/diff and run the task's required checks. Rebuild after relevant commits. State that working edits are excluded. Missing symbols or edges require direct source investigation; they never justify an approval.

Keep extraction local and code-only with no LLM labeling. Do not scan documents, agent collections, credentials, uploads, or client data. Do not install hooks, register an MCP server, upload the corpus, add provider keys, change the selected model, or upgrade tooling. If Graphify is unavailable or fails, record the limitation and continue ordinary source inspection; the existing BLOCKED_NATIVE_AGENTS rule still applies independently. Submit graph source SHA, selected query and result limitations alongside the actual code/test and native-agent evidence. Codex retains independent acceptance.
```

## Scope and checks

This tooling assignment succeeds when the pinned CLI and project skill are present, a graph/report/HTML can be generated from an identified committed code snapshot, at least one query returns real source symbols, generated files remain ignored, and existing planning validation passes. It does not certify a pending task or claim that Antigravity has invoked the skill. See the [setup evidence](reviews/GRAPHIFY-setup.md) for observed results.

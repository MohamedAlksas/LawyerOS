# LawOffice OS application audit remediation

The owner assigned this follow-up directly to Codex. The implementation starts from PR #14 at `dce533fed9b861163592e50fbcbc5e31dfa61465` on `feature/t06-matters-proceedings`. The existing T06 branch carries the fixes so the combined application can be reviewed in its current draft PR. The main baseline at the start was `8e7c773c39a97ff5a0e634be9b6eb0b145b4985d`.

## Changes and acceptance checks

| Area | Changes | Checks |
|---|---|---|
| Identity data | Suppress whole identifiers from ordinary masks and audit metadata. Preserve authenticated encryption and authorized reveal. Scope new Party replay digests with a versioned HMAC, and upgrade compatible legacy digests on replay. Add a forward migration to redact unsafe metadata while preserving ciphertext and audit event attribution. | Synthetic short and long identifiers, signed-in reads and reveal, audit payloads, same-key replay, fresh and upgrade migration paths |
| Identity and sessions | Reset elapsed MFA failure windows. Align active-session filters with the idle and absolute limits. Record redacted recovery, session-revocation and sign-in MFA outcomes. Parse the provider's supported form-encoded email sign-in before credential-version capture. Enforce page permissions before protected forms and lookups render. | PostgreSQL Identity fixtures, cooldown and recovery, session controls, loaded action manifest and denied/accepted HTTP sessions |
| Powers of attorney | Add an edit path to the existing form with optimistic version checks. Preserve review status on omission, clear its current metadata on explicit reset, and retain the original payload for an uncertain save. Version new retry digests to preserve legacy replay without conflating omission with an explicit reset for new writes. | Omitted status, explicit review/reset, legacy and current replay, concurrency conflict and browser Party journeys |
| Matter and Proceeding | Settle stale similarity requests, keep fields coherent while saving, protect unsaved or pending operations when using shell navigation, and focus invalid fields. Use list-specific query results and omit relationship notes from linked-matter summaries. Correct empty-offset recovery and failed-page retry. | Guarded navigation on three viewports, committed-response retry and exact claim, similar proceedings ordering, authorization and synthetic private-note removal |
| Office settings and Arabic shell | Lock fields during initial save and reconciliation. Show every replaced field in conflict review. Use the new snapshot before subsequent edits. Restore drawer focus to the actual opener, and wrap long Matter titles with a visible focus indicator. | Held request, two-tab conflict, 320px reflow, long mixed title, 200% text scaling, selected contrast and touch targets |
| Setup and dependencies | Add local migration and Owner enrollment to the startup instructions. Pin the patched Effect and minimatch leaves in the relevant dependency chains. | Fresh synthetic database, production build, lint and npm audit |

## Verification scope

- Local verification uses isolated synthetic databases and a production build. The 232 unit tests and 264 PostgreSQL integration tests passed across two runs, including three dedicated startup-process cases. Integration covers authorization for all 16 T06 Server Actions. The POA fixture verifies that retained older claims replay and new commands distinguish an omitted status from an explicit reset.
- The audit remediation baseline passed 60 Identity, 46 Arabic shell, 21 Party and 66 Matter Chromium cases. The Matter total combined 63 passes from the full run with three focused rechecks after correcting the reference command label in the assertion.
- The metadata migration targets the active database. Retained backups follow the existing recovery policy. Retain the Party idempotency signing secret with those backups. Historical unkeyed claims are upgraded as they are replayed.
- This is a correction candidate in draft PR #14. The finance-scope planning decision lives on its existing branch pending integration. Production migration and PR acceptance require the project's separate release and review steps.

## Browser history follow-up

The private shell retains Matter, Proceeding and Power of Attorney drafts across same-document Back and Forward navigation. Each draft is scoped to the authorized owner and the form URL in the current tab. A pending write preserves the exact request body and retry key before the first network request. Reopening the form can retry that operation and leaves background responses outside the active page's navigation. Dirty edits retain their original record version. A confirmed form cancellation discards the draft.

The browser checks traverse real history, exercise a response lost after commit and compare the retained database claim and record after retry. They also cover a Proceeding save whose committed response is still in flight when the user leaves, explicit cancellation and isolation from a second tab. Drafts use the shell's JavaScript memory and last for the lifetime of the private application document.

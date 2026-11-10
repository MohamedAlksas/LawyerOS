# Data Lifecycle and Staging Files

This policy is a technical proposal for V1, not a determination of the legal retention period for law-office files. Your father establishes the policy for originals and approved data before launch. Never automatically delete a case, approved document, or financial posting to free space.

| Type | Proposal | Implementation and verification |
|---|---|---|
| Ready private export | Expire 24 hours after becoming ready | Check download permission every time; cleanup deletes only the output, retaining the audit record and scope; regenerate on request |
| Original import CSV and raw staging rows | Retain for up to 7 days after the batch is closed or permanently fails | Delete private staging after producing the results report; retain source IDs, hashes, redacted errors, and mapping references without a complete PII copy |
| Abandoned, unapproved import | Expire 7 days after the last modification | Show a warning before expiration and allow re-upload; never accept data automatically |
| Incomplete/expired upload | Clean up 24 hours after the attempt expires | Never delete `READY` files or an object listed in a backup pin; cleanup checks state and identifiers |
| File rejected by scanning | Protected quarantine until 24 hours after the result | No download or external transmission; after cleanup, retain only the hash and redacted reason unless there is an explicit incident hold |
| Orphan file without metadata | A 7-day grace period with reconciliation | Produce a report before deletion; exclude backup-pinned versions and files undergoing finalization; never delete based on filename alone |
| Idempotency for financial operations or hearings | Retain the event reference and key with the record | Never reuse the key; a temporary payload may be removed after 30 days while retaining its hash and result ID to prevent duplicate execution |
| Technical logs | An initial proposal of 30 days | No PII or tokens; rotation, a size limit, and redaction before forwarding |
| Financial and professional audit records | Follow the approved office policy | No automatic cleanup in V1 and no modification by application roles |
| Approved data and documents | Archive in V1 | Permanent deletion is a separate procedure that accounts for relationships, obligations, and backups |

All cleanup periods are configurable through documented operations and are independent of user-session lifetime. The worker uses UTC expiration timestamps, leases, idempotency, retries, and a record of file counts, sizes, and reasons without confidential content. Before approving cleanup, test that it cannot delete an active upload, a backup pin, or current/previous document versions.

Backups may retain older copies of a file that has been removed from staging; do not promise its immediate removal from every backup. Old encryption keys remain recoverable throughout the lifetime of retained backups. Any actual legal erasure requirement is reviewed as a separate procedure, including its effects on backups and their keys.

In `RESTORE_MODE`, all cleanup, dispatch, and jobs are stopped. Review overdue jobs after recovery before releasing them. An old cleanup job must not delete files whose recovered integrity is still being established.

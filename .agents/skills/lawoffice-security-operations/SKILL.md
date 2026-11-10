---
name: lawoffice-security-operations
description: Apply LawOffice OS authentication, private-document, export, retention, deployment, and recovery requirements to assigned T03, T11, T12, T16, T18, T19, or T21 work.
---

# Security and operations

Use synthetic data unless the current assignment explicitly authorizes production work. Loading this skill does not authorize deployment, paid services, secret use, or real-client-data migration. Work only on the assigned ticket and submit evidence for independent review.

## Route to canonical requirements

Read [GEMINI](../../../GEMINI.md), the assigned [ROADMAP](../../../docs/ROADMAP.md) entry, and the relevant [REVIEW_PROTOCOL](../../../docs/REVIEW_PROTOCOL.md) criteria. Select applicable sections of [SECURITY_OPERATIONS](../../../docs/SECURITY_OPERATIONS.md): authentication/keys for T03; document protection for T11/T12; hosting/runtime for T18; backups/monitoring/recovery for T19. Use [DATA_LIFECYCLE](../../../docs/DATA_LIFECYCLE.md) for staging/export cleanup, [WORKFLOWS](../../../docs/WORKFLOWS.md) for export behavior, and [MIGRATION](../../../docs/MIGRATION.md) for T21. Do not load every document by default or replace their detailed rules with this summary.

## Authentication and access

Use the compatible Better Auth setup, controlled owner bootstrap, disabled public registration, TOTP/recovery, and revocable sessions. Check authentication, authorization, and record scope at every server entry point, including direct requests and Server Actions. `OWNER` and `MAINTAINER` follow least privilege; maintenance access does not include client content. Distinguish application restrictions from privileged server/database administration. Protect secrets and audit records; never log credentials, tokens, identity values, or document bodies.

## Documents, exports, and retention

Keep private files outside public/static storage. Validate allowed content types, actual signatures, size, and server-generated storage keys. Quarantine before local ClamAV scanning; failure, timeout, inconclusive results, or stale definitions prevent `READY`. The proposed stale threshold is 72 hours; verify configuration against the canonical policy. Keep the scanner private and monitor updates. Scan success does not eliminate preview isolation or download authorization.

Approved versions are immutable. Coordinate file/database finalization and retries without broken references. Cleanup must respect active uploads, current/previous versions, and backup pins. Enforce canonical expiry and retention rules rather than inventing schedules. Export only authorized content, keep outputs private and expiring, and prevent CSV formula injection. Confidential pages, responses, and files must not persist in Service Worker/browser caches; public assets and an offline screen are allowed.

## Deployment and recovery

Use the approved pinned Compose layout, private database/scanner services, private HTTPS access, sanitized health checks, and measured resources. Do not expose infrastructure ports or infer public access from a deployment ticket.

Backups coordinate a consistent database dump with referenced immutable files, a manifest, and deletion pins or a complete staging snapshot. Verify files and checksums; keep encrypted off-server and disconnected copies. Restore requires independently recoverable current/old field-encryption and Auth keys, including key retention for older backups.

Drill recovery in a clean environment. `RESTORE_MODE` blocks dispatch, jobs, backups, and cleanup until reviewed. Verify dates, financial totals, attachments, synthetic identity decryption, MFA, old-session revocation, missing/corrupt-file detection, and measured RPO/RTO. Test worker/backup failure and external monitoring; image rollback alone does not restore schema/data. For T21, follow the approved paper cutover and reconciliation gates.

Record actual evidence and `NOT RUN` limits. Never describe an untested deployment, backup, or recovery as accepted.

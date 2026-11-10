# LawOffice OS — Security, Operations, and Recovery

Document status: proposed implementation plan, not evidence that the system has already been secured or deployed. The operational time zone is `Africa/Cairo`. Real data must not be introduced before the operational checks in this document pass. The office has one lawyer; a technical maintenance account does not provide routine permission to read client files.

## 1. Hosting decision

| Option | Suitable for | Requirements and limitations | Proposed decision |
|---|---|---|---|
| Ubuntu at home/in the office | Development and testing with synthetic data, followed by a limited pilot | Healthy storage, stable electricity and a UPS, internet access, a machine kept running, and someone monitoring it | Start the pilot through a private network |
| VPS | Daily desktop and mobile use outside the office | Recurring subscription, updates, monitoring, backups outside the server, and review of the data-storage location | Default production choice after reviewing whether it is suitable for the office's files |

The VPS choice is an operational recommendation. It does not decide the hosting country or data processor on the user's behalf. Before introducing real data, your father reviews file confidentiality and retention obligations and any conditions concerning storage outside Egypt or external services. If external hosting is unsuitable, the same application runs locally with an electricity, internet, and recovery plan. Choosing a hosting company is not a certificate of legal compliance.

Initial access path: the desktop and phone join `Tailscale`, and the application is accessed through `Tailscale Serve` using `HTTPS`, with access rules restricted to the required devices. `Serve` shares the service inside the private network; public sharing is a different service, `Funnel`, which is outside this plan. [Tailscale Serve documentation](https://tailscale.com/docs/features/tailscale-serve).

If a public interface on a domain is chosen later, place `Caddy` in front of the application with `HTTPS`, configured headers, and request limits. Server administration stays on the private network. Next.js documentation recommends a reverse proxy for self-hosting; changing the access path requires complete testing, rather than simply opening a port. [Self-hosting documentation](https://nextjs.org/docs/app/guides/self-hosting).

## 2. Runtime layout and resources

`Docker Compose` runs `app`, a `worker` using the same code and release, `postgres`, a local `ClamAV` scanning service, and a separate backup job. `Caddy` is optional for public access; for private access, `Tailscale Serve` provides the HTTPS endpoint. PostgreSQL and the scanner stay on an internal network without internet-published ports. Files live in a private volume that is never served as a static folder.

Kubernetes and Redis are unnecessary initially. Jobs are stored in PostgreSQL with `lease_until`, `attempt_count`, `next_attempt_at`, and a key preventing duplication of the same job. A crashed worker's job can be reclaimed after its lease expires, and every handler must tolerate retries. Write the `outbox` within the business transaction, then let the worker perform side effects afterward; this is not a promise of exactly-once delivery.

Proposed starting resources, subject to measurement: `2 vCPU`, `8 GB RAM`, and an `80–120 GB` SSD for a single-user machine/server running local scanning and PDF generation in jobs with limited concurrency, plus external backup capacity. ClamAV's own documentation specifies `3 GiB` minimum and `4 GiB` preferred for scanning, with additional consumption during virus-signature updates. Therefore, `4 GB` for the entire server is not an automatically acceptable production baseline. [ClamAV Docker resource requirements](https://docs.clamav.net/manual/Installing/Docker.html). These proposed resources are not a performance guarantee. Measure peak consumption during scanning, signature updates, PDF generation, and backups, then increase resources or reduce job concurrency as indicated.

Document volume is the main disk-sizing factor. Illustrative estimate: `20,000` pages averaging `0.5 MB` per page produce approximately `10 GB` of images, before original attachments and versions. Reserve capacity for data, the database, staging, and logs, plus at least 30% free headroom; calculate external backups separately. If the average page size differs, recalculate using an actual sample.

Cost categories: a VPS or electricity/UPS and local storage, external backup capacity, a USB drive for the disconnected copy, an optional domain, and optional monitoring or notification services. Do not fix a monthly price before selecting a provider, capacity, and actual hosting location.

## 3. Authentication and permissions

Use `Better Auth` rather than building a custom password or verification-code system. The proposal is an owner account with a password and `TOTP`, with recovery codes stored away from the device. The library supports TOTP and backup codes, but configuring them and testing account recovery remain implementation tasks. [2FA documentation](https://better-auth.com/docs/plugins/2fa).

| Role | Allowed | Restrictions |
|---|---|---|
| `OWNER` | Office files, documents, finances, exports, and session management | Recovery, full exports, and MFA changes require reauthentication |
| `MAINTAINER` | Operational status, application releases, last-backup time, disk space, and redacted error messages | No case search, document downloads, client statements, or exports |
| Future assistant | Outside V1; requires a clearly defined file scope | Having an account does not grant implicit access |

Technical support begins with system status and redacted data. Any intervention requiring actual production-data access must have a documented reason, duration, and scope approved by the office owner. Application permissions must be distinguished from `root` or database-administrator access: someone with full server administration can technically access its data; hidden buttons and application audit records do not prevent that.

Implementation requirements: disable public registration; create the first owner through a controlled setup tool and then disable it; use login messages that do not reveal whether an account exists; rate-limit login, verification, and recovery attempts; use `HttpOnly` and `Secure` cookies with appropriate `SameSite` settings; and support server-side session revocation. Initial targets: lock after 30 minutes of inactivity and a maximum session duration of 12 hours, testing that these do not obstruct field use. Revoke other sessions after a password change or suspected device compromise.

Every server call checks identity, permission, and record scope, including calls from direct links or Server Actions. Apply Origin/CSRF checks and request validation at the appropriate entry point; hiding a page is not protection. Keep secrets outside Git and example files, restrict read permissions, and never print them in logs or error messages.

### Encryption keys and identity recovery

`PartyIdentity` is optional. If the full identity number is needed, encrypt it in the application using a reviewed cryptographic library and a documented authenticated algorithm, with the key stored outside the database; do not invent an encryption protocol. The record contains `ciphertext`, `keyId`, `encryptionVersion`, and the nonce/tag required by the library. Trailing digits may be displayed as needed; no general index may contain the original number or a normalized copy. Exact-match identity-number search requires a separate decision rather than automatically leaking a searchable copy.

Maintain an operational key register: one current write key and older read keys during rotation. Every backup records the required `keyId` values without publishing the keys. A separate encrypted key-recovery bundle holds field-encryption keys, all Auth decryption secrets/settings required by the pinned Better Auth version, required service keys, and emergency codes under the access policy. The secret that decrypts this bundle must not have its only copy in the same repository or on the same server. The office owner has a documented way to access the emergency bundle when the technical maintainer is unavailable.

Key rotation is not simply replacing an environment variable: install the new key, test reads with old and new keys, re-encrypt in retry-safe batches, and verify before retiring the old key. Keep an old key for as long as a retained backup needs it. Restoring an old backup must demonstrate decryption of a complete synthetic identity value and successful TOTP/recovery login under the library's policy, while revoking old sessions. The presence of ciphertext in the database is not a successful recovery. A missing key or unknown `keyId` blocks acceptance and raises an error; it must not silently turn the identity into an empty value.

## 4. Document and data protection

Uploads pass through `quarantine → validation/scan → available`. Failures leave the file unavailable with a clear message and a retry option. Validate size, the actual content-type signature, and a safely generated storage name. Initially allow PDF, JPEG, and PNG; executables, HTML, SVG, and archives are outside V1. The proposed initial limit is `25 MB` per file, with multiple-image uploads. Changes to this limit must be checked against proxy limits and storage capacity.

The proposed scanner is local `ClamAV`, with `freshclam` for signature updates and `clamd` in an isolated service. The worker sends quarantine content over a private socket without sending documents to an external scanning provider. The `clamd` TCP protocol does not add authentication, so it must not be exposed to the internet or an untrusted network. [ClamAV scanning documentation](https://docs.clamav.net/manual/Usage/Scanning.html). Pin the image version during implementation and monitor signature age. The proposed initial stale-signature threshold is 72 hours, subject to operational review. A timeout, unavailable scanner, inconclusive result, or signatures older than the threshold prevents transition to `READY`; provide a clear retry instead of bypassing scanning. A successful scan does not guarantee that a document is free of every threat; isolation and preview restrictions remain necessary. Test detection with a safe standard test sample, and test scanner outages, timeouts, and signature updates.

Approved originals and versions are immutable, each with a `checksum`. Downloads undergo server-side permission checks. Previews use an explicitly configured content type and an isolated environment; types unsafe for preview are downloaded as attachments. There are no permanent public links and no caching of financial data, files, or case pages in a Service Worker or public CDN. Sensitive responses use a policy preventing caching; the PWA caches only public assets and the offline screen. Removing the mobile application or signing out does not automatically delete files that the user deliberately downloaded to the device; explain this at download time.

Record file creation, modification, and archival; hearing results; financial postings and reversals; data downloads and exports; permission changes; and sensitive authentication attempts. Audit records contain the actor, time, action identifier, reason, and necessary field changes, without passwords, tokens, or complete document text. Application users cannot edit this log; that does not make it immune to a database administrator. If stronger tamper detection is needed later, add an independent logging destination with separate permissions.

Encryption in transit is mandatory. Document disk/provider encryption according to the environment, recognizing that a running server needs to decrypt data. Encrypt backups with a separate key. Disk encryption alone is neither a backup nor protection against deletion by the owner or compromise of the application account.

## 5. Backup policy

Proposed targets are `RPO ≤ 24 hours` and `RTO ≤ 4 hours`: at most one working day of targeted data loss, with recovery targeted within four hours. Establish these through a recovery drill using the actual data volume; they are not guarantees before measurement. If the last healthy backup is older than 24 hours, show a clear failure and start remediation, even if the next scheduled job is not yet due.

Keep three copies including the original: production data, an encrypted daily copy outside the server, and an encrypted weekly copy on a disconnected drive, rotating two drives. A copy on the production disk does not provide the required protection. Initial retention proposal: the latest 14 daily, 8 weekly, and 12 monthly backups. Review this against capacity and the office's approved retention/deletion policy.

### A consistent database-and-file backup

1. Only one job starts, using a distributed lock, with a `backup_id` and trackable status. Display a short maintenance window; pause application writes, upload finalization, and the worker; then wait for in-flight transactions to finish within a defined timeout. If the timeout is exceeded, cancel the attempt, reopen the system, and record failure.
2. Create a `pg_dump` in an appropriate restore format and a manifest of every approved file version referenced at that point, including size and checksum. `pg_dump` supplies a consistent database snapshot, but does not copy application documents stored outside the database. [SQL Dump documentation](https://www.postgresql.org/docs/current/backup-dump.html).
3. Before allowing writes again, pin the listed files against deletion and cleanup until copying completes; their bytes/versions are immutable. Store the pin list with `backup_id` and verify its validity before reopening the system. New files can then be uploaded after the window without changing those required by the backup. If pinning is not implemented, stay in maintenance until a complete staging copy is ready; measure the window instead of calling it short without evidence.
4. Send the package, pinned files, manifest, application release, migrations, and restore instructions to an encrypted external `restic` repository. Include essential runtime configuration under appropriate encryption; keep recovery keys separately. Verify that every required file exists and that checksums match, then approve the backup and release the pins. Temporary and quarantined files are not substitutes for approved documents.
5. Command success alone does not mean backup success: record package sizes/identifiers and file counts/completeness, then perform periodic repository checks and read actual data. `restic check` supports repository-integrity verification; full or partial data reads require appropriate scheduling. [restic repository documentation](https://restic.readthedocs.io/en/stable/045_working_with_repos.html).

Prefer append-only permissions for the daily backup writer, or a policy preventing deletion of previous copies; keep delete/`prune` permission separate. Providers do not all support this in the same way, so do not record it as a fact before testing. The disconnected copy protects against deletion of all backups through a single account. Keep the backup password and recovery codes in a password manager and a sealed recovery copy in a separate location, with clear instructions enabling your father to access them when the technical maintainer is unavailable.

## 6. Monitoring and notifications

| Condition | Check and action |
|---|---|
| Backup failure or last healthy copy older than 24 hours | Immediate technical alert from an off-server monitor, with status visible to the office owner; retry without treating the old copy as current |
| Disk usage reaches 75%, then 85% | Early warning followed by urgent action; never automatically delete client files to free space |
| Application or worker stopped | Periodic external checks and the last job heartbeat; controlled restart followed by investigation |
| Clock out of sync | Alert because TOTP, appointments, and leases depend on time; synchronize with NTP |
| Certificate or private-network access nearing expiration | Alert and test an alternative device before access is lost |

External monitoring receives only general status and a technical identifier. Do not send client names or case numbers in alerts or health-check links. Define daily schedules in local time with the correct zone, prevent duplicate executions when daylight-saving time changes, and record execution timestamps in UTC.

V1 in-app hearing reminders are checked when the application is opened; there is no promise of delivery while it is closed. Show the last refresh clearly and list reminders that became due during downtime. Generic email/push may be added later through explicit opt-in. Denied permission or provider failure appears as failure/retry, and successful sending does not mean the lawyer read the notification. Your father reviews and manually confirms legal deadlines.

## 7. Failure and recovery procedures

**Home electricity/internet outage:** the application shows that it is offline and does not claim an edit was saved. Use a printed hearing list for the coming days; review temporary notes and enter them once when connectivity returns. For a prolonged outage, follow recovery on a replacement machine. Do not allow a second database to accept independent writes and create conflicting histories.

**Suspected compromise/lost phone:** revoke the device's sessions and private-network access, and rotate exposed secrets. Preserve evidence before cleanup and determine the last trusted point in time. If using a backup, select a pre-compromise copy and restore into a clean environment; do not restore a contaminated copy merely because it is the newest. Review the impact on office files with their owner based on the actual facts.

**Full recovery:** prepare clean Ubuntu, block user access, install the release corresponding to the backup, and restore the database, files, essential configuration, and independent key bundle. Review the manifest and all references, case/hearing counts, financial totals, samples of multipage documents, decryption of a synthetic identity value, and authentication/MFA after revoking old sessions. Start the recovery environment in `RESTORE_MODE`, which blocks email/Push/webhook delivery, backups, cleanup, and all automatic jobs until review. Review outbox states and leases, then deliberately lift the block after addressing overdue work, without automatically resending old notifications. Begin with owner login and a read/write test, then reopen use and record elapsed recovery time and the data time gap.

Run a recovery drill before introducing the first real data, then monthly in an isolated environment and after a significant storage/backup change. Check the repository weekly and periodically read the full dataset according to its size. The drill covers total server loss and loss of access to the technical maintainer; restoring a single table is insufficient.

## 8. Production launch gate

- [ ] Choose the hosting location and review its suitability for office files; document the maintainer and contact route.
- [ ] Test login, TOTP, recovery, session/device revocation, and closure of public registration and database ports.
- [ ] Test a document link without login and using the maintenance account: rejection is consistent, with no cache exposing content.
- [ ] Test a forbidden file type, an oversized file, and scanner failure; no document is available before approval completes.
- [ ] Have a consistent off-server backup, a disconnected copy, and a timed full recovery, with the separate key bundle accessible. Synthetic identity decryption and MFA login succeed after recovery; dispatch and jobs remain blocked until review.
- [ ] Test backup failure, a full disk, internet loss, and a stopped worker; confirm actual external-alert delivery.
- [ ] Use pinned system/package releases, retain the previous release image, and take a backup before any production migration; reverting the image does not automatically revert data.
- [ ] Train your father on the daily hearing list, outages, deadline review, and who to contact during a failure.

Mark every untested item `NOT TESTED`; never convert it into a success mark in the delivery report.

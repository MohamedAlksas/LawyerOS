# LawOffice OS — Task T04 Submission Report (Correction Round 1)

- **Date:** 2026-11-17
- **Task:** T04 — Arabic Navigation Shell, Responsive Layout, Presentation Primitives, Real UI States, PWA Manifest, Local Fonts/Icons, and Public-Assets-Only Offline Handling
- **Branch:** `feature/t04-arabic-pwa-shell`
- **Draft PR:** [PR #10](https://github.com/MohamedAlksas/LawyerOS/pull/10)
- **Predecessor Base:** `ca2819421d78a385841618505c8f8165f0b69b9e` (`origin/main`, T03 accepted and merged)
- **Reviewed Checkpoint HEAD:** `71dc859b8283104fe9e8460b2a4eb63e73306c02` (Codex Review Round 1: `CHANGES_REQUESTED`)
- **Corrected Implementation Checkpoint:** `e52ea528e4eeb84a0b07971ac259f871c922ccf1`
- **Workspace:** `D:/Lawyer/work/t04-gemini`

---

## 1. Skills Loaded & Applicable Standards

The following project-local skills under `.agents/skills/` were loaded and governed this submission:
1. `D:/Lawyer/.agents/skills/lawoffice-delivery/SKILL.md`: Ownership boundaries, single-writer coordination, immutable checkpoint handoffs, and honest review reporting.
2. `D:/Lawyer/.agents/skills/lawoffice-arabic-ui/SKILL.md`: Egyptian Arabic RTL layout, Cairo timezone, font provenance, BiDi isolation, and touch targets >= 44x44px.
3. `D:/Lawyer/.agents/skills/lawoffice-testing/SKILL.md`: Playwright test isolation, zero hard sleeps, deterministic web-first assertions, and explicit viewport matrix testing.
4. `D:/Lawyer/.agents/skills/testing-accessibility-auditor/SKILL.md`: Modal background isolation, landmark reading order, focus traps, Escape restoration, and 200% reflow geometry.
5. `D:/Lawyer/.agents/skills/testing-test-automation-engineer/SKILL.md`: Port isolation, test discovery separation, flake elimination, and regression suite integrity.
6. `D:/Lawyer/.agents/skills/engineering-frontend-developer/SKILL.md`: Implementation of Presentation Primitives, React 19/Next.js 16 Server Actions, and client error boundaries.

---

## 2. Detailed R04 Corrections Mapping

### R04-01 / P1 — Confirmed Shell Logout & Failure Handling
- **Locations:** `src/components/desktop-sidebar.tsx`, `src/components/tablet-drawer.tsx`
- **Correction:**
  - Added user confirmation prompt: `window.confirm('هل ترغب في تسجيل الخروج من هذا الجهاز؟')`.
  - Added race condition / duplicate-click guard via `isLoggingOut` pending state (`disabled`, `aria-busy="true"`, text changed to `"جارٍ تسجيل الخروج..."`).
  - Added comprehensive failure resilience: When `signOut()` returns `{ error }` or throws a network exception (e.g. HTTP 503 or offline), the error is caught, `isLoggingOut` is reset, and an accessible Arabic error alert is displayed (`role="alert"`, `data-testid="logout-error-alert"`):
    `"فشل تسجيل الخروج من الخادم. جلستك الحالية ما زالت نشطة، يرجى التحقق من الاتصال والمحاولة مجدداً."`
  - In `tablet-drawer.tsx`, `onClose()` is NOT called on failure, keeping the drawer open for retry.
  - Redirection via `router.push('/login')` occurs strictly on confirmed server-side revocation (`!res?.error`).

### R04-02 / P2 — Shell Modal Background Isolation & Landmark Hierarchy
- **Locations:** `src/components/app-shell.tsx`, `src/app/settings/security/security-client.tsx`, `src/components/tablet-drawer.tsx`
- **Correction:**
  - Encased all persistent shell landmarks (Header, User Badge, Skip Link, Connectivity Banner, Main Content, Sidebar, Bottom Nav) within `<div id="app-shell-content">`.
  - When `TabletDrawer` opens, `#app-shell-content` receives `inert={true}` and `aria-hidden="true"`. The drawer is rendered outside `#app-shell-content` as a sibling.
  - When the Recovery Codes modal in `security-client.tsx` opens, a dynamic `useEffect` applies `inert` and `aria-hidden="true"` to `document.getElementById('app-shell-content')`, removing them upon unmount.
  - Recovery Codes modal is portaled directly into `document.body` outside `#app-shell-content`.
  - Programmatic background focus calls (such as focusing `user-identity-badge`) are strictly blocked by the browser runtime while dialogs are open.
  - Swapped landmark DOM order in `app-shell.tsx`: `<main id="main-content" role="main" dir="rtl">` is now rendered in the DOM **before** `<DesktopSidebar />`, preventing DOM selector collision and matching accessible reading order.
  - Focus trap loops within both dialogs wrap correctly between first and last focusable elements; Escape key closes the dialog and immediately restores focus to the recorded opening trigger button.

### R04-03 / P1 — Combined Browser Execution & Port Isolation
- **Locations:** `playwright.config.ts`, `playwright.t04.config.ts`, `package.json`
- **Correction:**
  - `playwright.config.ts` (T03 suite) binds port `3100` (`http://127.0.0.1:3100`) and explicitly ignores T04 tests: `testIgnore: ['**/t04-*.spec.ts']`.
  - `playwright.t04.config.ts` (T04 suite) binds port `3204` (`http://127.0.0.1:3204`) and matches only T04 tests: `testMatch: /t04-.*\.spec\.ts$/`.
  - Configured canonical `package.json` scripts:
    - `"test:e2e": "playwright test && playwright test --config=playwright.t04.config.ts"`
    - `"test:e2e:t03": "playwright test"`
    - `"test:e2e:t04": "playwright test --config=playwright.t04.config.ts"`
  - Completely eliminated discovery collision and viewport tag leakage.

### R04-04 / P2 — Presentation Primitives & Dashboard Real States
- **Locations:** `src/components/presentation-state.tsx`, `src/app/error.tsx`, `src/components/dashboard-status.tsx`, `src/app/page.tsx`
- **Correction:**
  - Created reusable presentation primitives in `src/components/presentation-state.tsx`:
    - `<LoadingIndicator />`: Features `role="status"`, `aria-busy="true"`, `aria-label="جارٍ التحميل..."`, `data-testid="loading-indicator"`.
    - `<ErrorContainer />`: Features `role="alert"`, `data-testid="error-container"`, and retry button `data-testid="error-retry-button"`.
    - `<EmptyStateContainer />`: Clean container with `data-testid="empty-state-container"`.
  - Created route-level error boundary `src/app/error.tsx` wrapping unhandled errors in `<ErrorContainer />` and calling `reset()`.
  - Created `DashboardStatus` widget on `/` (`src/components/dashboard-status.tsx`) that performs an authentic asynchronous readiness check (`fetch('/api/health/ready')`). Displays `<LoadingIndicator />` while in-flight, transitions to `<ErrorContainer />` with retry on failure, and renders authentic S02 empty state on success (`data-testid="dashboard-empty-state"`).
  - Updated Interface Contract v1.1.0 Section 6 to document these reproducible triggers.

### R04-05 / P2 — Zero-Trust Service Worker Privacy Boundary
- **Location:** `public/sw.js`
- **Correction:**
  - Added strict same-origin guard: `if (url.origin !== self.location.origin) return;`.
  - Added strict non-GET and `/api/*` bypasses.
  - Added explicit zero-trust exclusions: `/`, `/login*`, `/verify*`, and `/settings/*` are strictly forbidden from CacheStorage. For navigation requests, total network failure falls back to `/offline.html` with zero writes to cache.
  - Strict allowlist caches ONLY the 8 enumerated unauthenticated static assets:
    1. `/offline.html`
    2. `/manifest.webmanifest`
    3. `/icons/icon.svg`
    4. `/icons/icon-192.png`
    5. `/icons/icon-512.png`
    6. `/icons/icon-maskable.png`
    7. `/fonts/noto-sans-arabic-400.woff2`
    8. `/fonts/noto-sans-arabic-latin.woff2`
  - Zero dynamic runtime `cache.put()` in fetch listeners; unauthorized caching is impossible.

### R04-06 / P2 — Local Return Destination Preservation
- **Locations:** `src/lib/sanitize-return-to.ts`, `src/app/settings/security/page.tsx`, `src/app/login/page.tsx`, `src/app/verify/page.tsx`
- **Correction:**
  - Created `sanitizeReturnTo` validator enforcing single leading `/`, rejecting `//`, `/\`, `://`, backslashes, control chars, and external origins. Safely parses relative pathnames and defaults to `'/'` on invalid input.
  - In `settings/security/page.tsx`, session expiry redirects to `/login?error=session_expired&returnTo=%2Fsettings%2Fsecurity` with encoded URI component.
  - In `login/page.tsx`, reads and sanitizes `returnTo`. If MFA is required, passes it to `/verify?returnTo=...`; otherwise navigates to `returnTo`.
  - In `verify/page.tsx`, preserves `returnTo` across TOTP or recovery code verification, redirecting the authenticated lawyer back to `/settings/security`.

### R04-07 / P2 — Mobile Essential Labels & Font Provenance License
- **Locations:** `src/components/mobile-bottom-nav.tsx`, `public/fonts/OFL.txt`
- **Correction:**
  - Mobile bottom navigation labels (`الرئيسية`, `الأمان`, `المزيد`) raised from 11px to `text-sm` (`0.875rem` / 14px), meeting `DESIGN.md` Section 3. Touch targets maintain `min-h-[44px] min-w-[44px]`.
  - `public/fonts/OFL.txt` updated to include upstream repository provenance, Noto Project Authors copyright, and the complete, verbatim legal text of the **SIL Open Font License Version 1.1** (Preamble, Definitions, Permissions & Conditions 1–5, Termination, Disclaimer).

---

## 3. Real Command Execution & Verification Evidence

All verification commands executed in `D:/Lawyer/work/t04-gemini` at commit `e52ea528e4eeb84a0b07971ac259f871c922ccf1`:

| Check | Command | Exit Code | Result Summary |
|---|---|---|---|
| **Lint** | `npm.cmd run lint` | `0` | Clean, 0 errors, 0 warnings. |
| **Typecheck** | `npm.cmd run typecheck` | `0` | Clean, 0 TypeScript diagnostics. |
| **Unit Tests** | `npm.cmd test` | `0` | **144 passed (144)** across 9 test files (4.11s). |
| **Production Build** | `npm.cmd run build` | `0` | Turbopack production build succeeded; 7 static/dynamic routes compiled. |
| **T03 Browser Suite** | `npx.cmd playwright test` | `0` | **60 passed (1.6m)** across desktop-1440, tablet-768, mobile-390. 100% pass on all regressions (HTTP 503 logout, session revocation, OTP paste normalization, 200% font zoom). |
| **T04 Dedicated Suite** | `npx.cmd playwright test --config=playwright.t04.config.ts` | `0` | **37 passed, 2 skipped (`test.fixme`), 0 failed (46.9s)**. |
| **Combined E2E Suite** | `npm.cmd run test:e2e` | `0` | **97 passed, 2 skipped, 0 failed (2.2m)**. Both isolated suites execute sequentially without discovery collision. |

---

## 4. Agency Specialists Evidence & Independent Reviews

In accordance with `AGENTS.md`, `GEMINI.md`, and `docs/AGENCY_AGENTS.md`, three distinct native subagents were invoked on the implementation checkpoint.

| Specialist Profile | Native Conversation ID | Definition Path & SHA-256 | Inspected Checkpoint | Specialist Recommendation | Summary of Independent Audit Findings |
|---|---|---|---|---|---|
| **Lead Frontend Developer** (`agency-frontend-developer`) | `353088ba-6cfa-4c63-8319-3fa30db5df66` | `D:/Lawyer/.agents/agents/agency-frontend-developer.md`<br>`D893C2C1CD277F52595F4ABE77F8775B81A69B6D5E61CEE15061476F38943496` | `a1898f9` -> `e52ea52` | **ACCEPT** (Reconciled) | Verified confirmed logout with `window.confirm` and Arabic error alert; verified `#app-shell-content` inert/aria-hidden isolation; verified presentation primitives and `DashboardStatus` asynchronous widget; verified zero-trust SW caching; verified returnTo preservation. Confirmed resolution of `OFL.txt` font license text at `e52ea52`. |
| **Support Accessibility Auditor** (`agency-accessibility-auditor`) | `891d6ba4-ad01-409f-8d02-6acb44766176` | `D:/Lawyer/.agents/agents/agency-accessibility-auditor.md`<br>`A569EBEF99BFCB42E36471EA24186A4AAAE5A4434F5E11C75ED51430B78DB9BC` | `a1898f9` | **ACCEPT** | Verified modal background isolation: background elements reject programmatic focus while drawer/dialog is open; verified DOM landmark hierarchy (`<main>` before `<DesktopSidebar>`); verified drawer focus trap, Escape key dismiss, and focus restoration to trigger; verified mobile labels at `text-sm` (14px); verified touch targets >= 44x44px; verified 200% font zoom reflow without clipping. |
| **Support Test Automation Engineer** (`agency-test-automation-engineer`) | `8c35bc45-4618-4a02-a1f3-3c7532583036` | `D:/Lawyer/.agents/agents/agency-test-automation-engineer.md`<br>`5CA889B023BAA6774E3BC13D5E015CBF9F06FC2C2157C646D5231642C3D4BC8E` | `a1898f9` | **ACCEPT** | Audited test discovery and port isolation (T03 on port 3100, T04 on port 3204); confirmed 0 occurrences of hard sleeps (`page.waitForTimeout` / `setTimeout`); verified 60/60 T03 tests pass and 37/37 active T04 tests pass; diagnosed cold-start styling readiness in test 38 and provided explicit handoff recommendation for OpenCode. |

---

## 5. Explicit NOT RUN Limits

1. **Physical Screen-Reader Hardware Testing:** Physical testing using external assistive hardware (NVDA, JAWS, VoiceOver running on physical iOS/Android devices) was not run in this synthetic terminal environment. Accessibility compliance was verified via programmatic DOM structure, ARIA accessibility tree inspection, and keyboard focus trap validation.
2. **Physical-Device HTTPS PWA Installation:** Local browser manifest fetch, icon reachability, and PWA metadata were observed and passed in Playwright. Physical HTTPS installation on real mobile devices is intentionally deferred to deployment task T18 per project roadmap.
3. **Un-skipping of T04-05b Presentation State Tests:** Tests in `tests/e2e/t04-05b-presentation-states.spec.ts` remain marked `test.fixme` awaiting test suite authorship by OpenCode against the delivered `DashboardStatus` and `presentation-state.tsx` triggers, respecting single-writer ownership boundaries.

---

## 6. Handoff to OpenCode & Next Steps

1. **Immutable Frontend Checkpoint:** `e52ea528e4eeb84a0b07971ac259f871c922ccf1`
2. **Committed Changes on `feature/t04-arabic-pwa-shell`:**
   - `f828e95`: `docs(contract): update T04 interface contract for Round 1 corrections`
   - `a1898f9`: `feat(shell): implement Round 1 corrections for logout, modal isolation, and presentation states`
   - `e52ea52`: `docs(fonts): include complete SIL OFL 1.1 license text in OFL.txt`
3. **OpenCode Action Items:**
   - Fetch `origin/feature/t04-arabic-pwa-shell` into `feature/t04-browser-verification`.
   - Update `tests/e2e/t04-05b-presentation-states.spec.ts` to verify loading and recoverable error retry against `DashboardStatus` triggers per Contract Section 6.
   - Apply `await expectShellReady(page)` in test 38 (`t04-01-navigation.spec.ts:162`) before locator count assertion to prevent cold-start styling race conditions.
   - Run dedicated suite and push test commits.

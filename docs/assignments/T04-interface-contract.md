# LawOffice OS — T04 Interface Contract

**Document Version:** 1.0.0  
**Date:** 2026-11-16  
**Status:** Canonical Interface Contract for T04 Parallel Execution  
**Base Commit:** `ca2819421d78a385841618505c8f8165f0b69b9e` (`origin/main`, T03 accepted and merged)  
**Gemini Branch & Worktree:** `feature/t04-arabic-pwa-shell` (`D:/Lawyer/work/t04-gemini`)  
**OpenCode Branch & Worktree:** `feature/t04-browser-verification` (`D:/Lawyer/work/t04-opencode`)  

---

## 1. Overview and Purpose

This contract establishes the shared architectural, layout, semantic, and selector specification between:
1. **T04-A (Gemini coordinator + native `agency-frontend-developer` lead)**: Implementation of Arabic navigation shell, responsive layout, presentation primitives, real UI states, PWA manifest, local fonts/icons, and public-only offline behavior.
2. **T04-B (OpenCode coordinator + native `agency-test-automation-engineer` lead)**: Authoring and execution of behavioral browser tests (`tests/e2e/t04-*.spec.ts`, helpers, and Playwright configuration).

Neither writer modifies the other's files. Both teams verify against this stable contract.

---

## 2. Route Hierarchy and Scope Boundaries

### 2.1 Available Routes in T04
Only the following routes are active and functional in T04:
- `/`: Home / Main Dashboard — Displays genuine empty state (S02) when logged in; redirects to `/login` if unauthenticated.
- `/login`: Lawyer authentication screen (S01, established in T03).
- `/verify`: MFA OTP verification screen (established in T03).
- `/settings/security`: Security settings, password change, and MFA management (established in T03).
- `/offline`: Public static offline fallback view (or `/offline.html`).

### 2.2 Future Modules (Unimplemented in T04)
Per `AGENTS.md`, `PRODUCT.md`, and `docs/tasks/T04.md`:
- Matters (`/matters`), Proceedings (`/proceedings`), Hearings (`/hearings`), Finance (`/finance`), and Client Directory (`/clients`) are **strictly unbuilt** in T04.
- **Rule:** The navigation shell must NOT render fake interactive metrics, fabricated case counts, mockup financial balances, or broken links that pretend to open unimplemented business screens. Any future module indicators in navigation must be non-interactive or clearly disabled with accessible indication (`aria-disabled="true"`).

---

## 3. HTML Document & RTL Configuration

### 3.1 Root Document Attributes
- `<html lang="ar-EG" dir="rtl">` on the root layout (`src/app/layout.tsx`).
- `<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">`.
- `<meta name="theme-color" content="#14566B">`.
- `<link rel="manifest" href="/manifest.webmanifest">`.

### 3.2 Typography & Local Font
- Primary Font Family: `'Noto Sans Arabic', Tahoma, Arial, sans-serif`.
- Font files bundled locally under `public/fonts/` (zero external CDN requests).
- Declared in `src/app/globals.css` with `@font-face` and `font-display: swap`.

### 3.3 BiDi (Bidirectional) Text Isolation
- Egyptian Arabic is the primary language.
- Numbers, dates, phone numbers, email addresses, technical identifiers, reference numbers, and code snippets must be wrapped in `<bdi>` or `dir="ltr"` to prevent punctuation reversal and RTL puncture:
  - Example: `<bdi className="font-mono" dir="ltr">{technicalId}</bdi>`
  - Dates and timestamps are formatted using Africa/Cairo timezone with Egyptian Arabic locale (`ar-EG`).

---

## 4. Semantic Landmarks and Responsive Shell Layout

The application shell provides responsive scaffolding across three primary viewports:
- **Desktop (1440px target, min-width: 1024px)**: Fixed 232px right-side sidebar navigation.
- **Tablet (768px target, min-width: 640px and max-width: 1023px)**: Header with hamburger button that opens an accessible modal slide-over drawer.
- **Mobile (390px target, max-width: 639px)**: Fixed bottom navigation bar with accessible icons and labels; header with user status and breadcrumb.

### 4.1 Accessibility & Landmark Selectors

| Component | Semantic HTML Tag | Required Attributes | Test Selector / ID | Purpose |
|---|---|---|---|---|
| **Skip Link** | `<a>` | `href="#main-content"` | `data-testid="skip-to-content"` | Allows keyboard users to skip navigation directly to main content. |
| **App Header** | `<header>` | `role="banner"` | `data-testid="app-header"` | Top navigation bar containing office title, breadcrumbs, user session badge, and drawer trigger. |
| **Drawer Trigger** | `<button>` | `type="button"`, `aria-label="فتح القائمة"`, `aria-expanded="false\|true"`, `aria-controls="tablet-drawer"` | `data-testid="drawer-toggle-button"` | Toggles tablet/mobile slide-over drawer navigation. |
| **Desktop Sidebar** | `<aside>` or `<nav>` | `role="navigation"`, `aria-label="التنقل الرئيسي"` | `data-testid="desktop-sidebar"` | 232px right-side fixed sidebar visible on desktop viewports (≥1024px). |
| **Desktop Nav** | `<nav>` | `aria-label="التنقل الرئيسي"` | `data-testid="desktop-nav"` | Navigation link container inside sidebar. |
| **Tablet Drawer** | `<div role="dialog">` | `aria-modal="true"`, `aria-label="قائمة التنقل"`, `id="tablet-drawer"` | `data-testid="tablet-drawer"` | Modal slide-over drawer for tablet viewports; traps focus, closes on `Escape` or backdrop click. |
| **Drawer Close** | `<button>` | `type="button"`, `aria-label="إغلاق القائمة"` | `data-testid="drawer-close-button"` | Closes the tablet drawer and restores focus to the toggle button. |
| **Drawer Backdrop** | `<div>` | `aria-hidden="true"` | `data-testid="drawer-backdrop"` | Semi-transparent overlay behind the drawer. |
| **Mobile Bottom Nav**| `<nav>` | `role="navigation"`, `aria-label="التنقل السفلي"` | `data-testid="mobile-bottom-nav"` | Fixed bottom navigation bar on mobile viewports (<640px). |
| **Main Content** | `<main>` | `id="main-content"`, `role="main"` | `data-testid="main-content"` | Primary document content area. |
| **User Identity Badge**| `<div>` or `<a>`| `aria-label="حساب المستخدم"` | `data-testid="user-identity-badge"` | Displays authenticated lawyer's name/email and link to `/settings/security`. |
| **Connectivity Banner**| `<div>` | `role="status"`, `aria-live="polite"` | `data-testid="connectivity-banner"` | Appears when network connection is lost (`navigator.onLine === false`). |

### 4.2 Navigation Items & Active State
Every navigation link provides:
- Meaningful Egyptian Arabic label.
- `href` pointing to an available route (`/`, `/settings/security`, etc.).
- Active link marked with `aria-current="page"`.
- Focusable with visible focus ring (`ring-2 ring-[#14566B] ring-offset-2`).
- Touch target minimum 44×44px (`min-h-[44px] min-w-[44px]`).

Navigation routes:
1. **الرئيسية / اليوم (Home / Today)**: `href="/"`, icon: Calendar/Today icon, testid: `nav-link-home`.
2. **إعدادات الأمان (Security Settings)**: `href="/settings/security"`, icon: Shield/Lock icon, testid: `nav-link-security`.
3. **تسجيل الخروج (Sign Out)**: Action button triggering Better Auth signout, testid: `nav-button-logout`.

---

## 5. Design Tokens (Authoritative `DESIGN.md`)

- **Primary Brand Color:** `#14566B` (deep teal / petrol blue) — used for primary actions, active navigation indicator, brand header accents.
- **Page Background:** `#F4F6F7` (soft cool grey) — high contrast, calm legal reading surface.
- **Card / Surface Background:** `#FFFFFF` (clean white) with soft border `#D5DFE3`.
- **Text Color (Primary):** `#172A35` (deep charcoal navy) — ensures WCAG AAA contrast on `#FFFFFF` (ratio > 11:1).
- **Text Color (Secondary / Muted):** `#4D606A` (slate grey) — WCAG AA compliant on white (ratio > 4.5:1).
- **Border / Divider:** `#D5DFE3`.
- **Status Colors:**
  - Danger / Error: `#A4262C` (crimson red)
  - Warning: `#7A4A00` (amber / bronze)
  - Success: `#176449` (forest green)
- **Border Radius:** `rounded-[6px]` (6px radius throughout).
- **Interactive States:**
  - Focus Ring: `ring-2 ring-[#14566B] ring-offset-2` (2px solid, 2px offset).
  - Hover: subtle surface darken or primary tint (`hover:bg-[#E8EEF1]`).
  - Active: `bg-[#14566B] text-white`.
  - Reduced Motion: `@media (prefers-reduced-motion: reduce)` disables smooth slide transitions.

---

## 6. Real State Specifications

### 6.1 S02 Empty State (Home `/`)
When an authenticated lawyer lands on `/`:
- **Heading (`<h1>`):** `"مكتب المحامي — لوحة المتابعة"` (LawOffice OS — Operational Dashboard).
- **Subheading / Badge:** Genuine welcome and status in Egyptian Arabic.
- **Empty State Container:** `data-testid="dashboard-empty-state"`.
- **Informative Copy:** Clearly communicates that no active cases or hearings are loaded yet, as the office management modules (القضايا والجلسات) will be activated in upcoming phases.
- **Primary Action:** Directs the lawyer to review their account security:
  - Button/Link: `"مراجعة إعدادات الأمان"` (Review Security Settings) -> `href="/settings/security"`, testid: `empty-state-security-action`.
- **Invariant:** NO mock numbers, fake hearings, dummy financial balances, or fictional client statistics.

### 6.2 Loading State
- Containers undergoing asynchronous data retrieval render a skeleton placeholder or spinner.
- Container attributes: `role="status"`, `aria-busy="true"`, `aria-label="جاري التحميل..."`, `data-testid="loading-indicator"`.

### 6.3 Error and Retry State
- Recoverable errors render:
  - Error container: `role="alert"`, `data-testid="error-container"`.
  - Clear Arabic error description.
  - Retry button: `<button type="button" data-testid="error-retry-button">إعادة المحاولة</button>`.

### 6.4 Disconnected (Offline) Banner
- Monitored via `window.addEventListener('online')` / `window.addEventListener('offline')` and `navigator.onLine`.
- When offline:
  - Element: `<div role="status" aria-live="polite" data-testid="connectivity-banner" className="...">`.
  - Exact Arabic text: `"النت مقطوع. التعديلات مش محفوظة"`.
  - Fixed or top-pinned visible alert styling (warning/danger background, high contrast).
  - Automatically dismisses when `online` event fires.

### 6.5 Session Expiry Feedback
- When an API call returns `401 Unauthorized` or session cookie is invalid:
  - User is redirected to `/login?error=session_expired`.
  - Login page renders alert message: `"انتهت الجلسة. يرجى تسجيل الدخول مرة أخرى."` (`data-testid="session-expired-alert"`).

---

## 7. PWA Manifest and Static Public Assets

### 7.1 Web App Manifest
- Path: `/manifest.webmanifest` (served as `application/manifest+json`).
- Specification:
  ```json
  {
    "name": "مكتب المحامي — LawOffice OS",
    "short_name": "مكتب المحامي",
    "description": "نظام إدارة مكتب المحاماة — النسخة التشغيلية الأولى",
    "start_url": "/",
    "display": "standalone",
    "orientation": "any",
    "dir": "rtl",
    "lang": "ar-EG",
    "background_color": "#F4F6F7",
    "theme_color": "#14566B",
    "icons": [
      {
        "src": "/icons/icon-192.png",
        "sizes": "192x192",
        "type": "image/png",
        "purpose": "any"
      },
      {
        "src": "/icons/icon-512.png",
        "sizes": "512x512",
        "type": "image/png",
        "purpose": "any"
      },
      {
        "src": "/icons/icon-maskable.png",
        "sizes": "512x512",
        "type": "image/png",
        "purpose": "maskable"
      },
      {
        "src": "/icons/icon.svg",
        "sizes": "any",
        "type": "image/svg+xml",
        "purpose": "any"
      }
    ]
  }
  ```

### 7.2 Service Worker & Privacy Invariants (`docs/SECURITY_OPERATIONS.md`)
- **Strict Public-Assets-Only Policy:**
  - If a Service Worker is registered (`public/sw.js`), it MUST maintain an explicit static allowlist:
    - `/` (only the public shell or fallback)
    - `/offline` or `/offline.html`
    - `/manifest.webmanifest`
    - `/icons/*`
    - `/fonts/*`
    - Bundled static CSS/JS chunks (`/_next/static/*`)
  - **Forbidden Caching (Zero-Trust):**
    - MUST NOT cache any `/api/*` endpoints.
    - MUST NOT cache `/login`, `/verify`, or authenticated dynamic pages containing client data.
    - MUST NOT store sensitive client documents, session tokens, passwords, MFA secrets, or financial records in `CacheStorage`, `localStorage`, `sessionStorage`, or `IndexedDB`.
    - Service worker network fetch handler must use Network-Only for all API and non-allowlisted routes.
- **Offline Fallback Page (`/offline.html` or `/offline`):**
  - Informative static Arabic page explaining that the system is offline and no changes will be made or saved while disconnected.
  - Zero confidential or authenticated data leaked into the offline page.

---

## 8. Test Environment and Port Allocation

- **Gemini Worktree (`D:/Lawyer/work/t04-gemini`)**:
  - Application Server: `http://localhost:3100` (port 3100)
  - `BETTER_AUTH_URL=http://localhost:3100`
  - Synthetic database: separate test database per standard test configuration.
- **OpenCode Worktree (`D:/Lawyer/work/t04-opencode`)**:
  - Browser Suite Server: `http://localhost:3204` (port 3204)
  - Dedicated Playwright config: `playwright.t04.config.ts`
  - `BETTER_AUTH_URL=http://localhost:3204`
  - Synthetic database: separate test database (never shared concurrently with Gemini port 3100).
- **Rule:** Both suites run strictly against synthetic fixtures; process cleanup must terminate only task-owned PIDs.

---

## 9. Acceptance Criteria Mapping

| Acceptance ID | Specification Requirement | Verification Method |
|---|---|---|
| **T04-01** | Desktop right navigation (232px), tablet drawer, mobile bottom bar with available routes only. | Visual/DOM verification at 1440px, 768px, 390px; active link states; no dummy links. |
| **T04-02** | `lang="ar-EG"`, `dir="rtl"`, local licensed font, BiDi isolation (`<bdi>`/`dir="ltr"`), Cairo timezone. | Inspect root HTML, computed styles, font requests (local only), mixed-text rendering. |
| **T04-03** | 390px, 768px, 1440px viewports; 200% text scaling without horizontal clipping; touch targets ≥ 44×44px. | Playwright responsive viewport tests, CSS overflow check at 200% font zoom, bounding box checks. |
| **T04-04** | Keyboard tab order, drawer focus trap & Escape restoration, semantic landmarks, WCAG AA contrast. | Tab sequence automation, Escape key dispatch, Axe / Lighthouse accessibility audit. |
| **T04-05** | Real empty state S02 on `/`, loading indicator, recoverable error/retry, offline banner (`"النت مقطوع"`), session expiry redirect. | DOM assertions for S02 copy; simulate `offline` event and check banner; simulate 401 redirect. |
| **T04-06** | Valid `/manifest.webmanifest`, reachable icons (192, 512, maskable, svg), standalone display. | Manifest fetch and JSON validation; verify icon HTTP 200 responses and dimensions. |
| **T04-07** | Strict public-assets-only storage/cache; zero client data, auth tokens, or API responses in CacheStorage/Storage. | Inspect browser storage and CacheStorage after navigating authenticated routes; verify API exclusion. |
| **T04-08** | No mockup account autofill, invented security claims, or false sync guarantees. | Static inspection and browser text content audit. |
| **T04-09** | Existing T03 auth, MFA, Origin/Host guards, session lifecycle, and migration tests pass unchanged. | Full execution of existing integration and unit test suite. |
| **T04-10** | Exact-head integrated tests, native Agency support reviews returned and reconciled, coherent PR. | Final consolidated test run on combined checkpoint and documented submission. |

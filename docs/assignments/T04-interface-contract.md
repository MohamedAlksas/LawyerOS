# LawOffice OS — T04 Interface Contract

**Document Version:** 1.1.0 (Round 1 Corrections)  
**Date:** 2026-11-17  
**Status:** Canonical Interface Contract for T04 Parallel Execution & Acceptance  
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
- `/offline`: Public static offline fallback view (and `/offline.html`).

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

### 3.2 Typography, Provenance & Licensing
- Primary Font Family: `'Noto Sans Arabic', Tahoma, Arial, sans-serif`.
- Font files bundled locally under `public/fonts/` (zero external CDN requests).
- Declared in `src/app/globals.css` with `@font-face` and `font-display: swap`.
- License and Provenance: Complete SIL Open Font License Version 1.1 text and Noto Project Authors provenance preserved in `public/fonts/OFL.txt`.

### 3.3 BiDi (Bidirectional) Text Isolation
- Egyptian Arabic is the primary language.
- Numbers, dates, phone numbers, email addresses, technical identifiers, reference numbers, and code snippets must be wrapped in `<bdi>` or `dir="ltr"` to prevent punctuation reversal and RTL puncture:
  - Example: `<bdi className="font-mono" dir="ltr">{technicalId}</bdi>`
  - Dates and timestamps are formatted using Africa/Cairo timezone with Egyptian Arabic locale (`ar-EG`).

---

## 4. Semantic Landmarks, Responsive Shell Layout, and Modal Isolation

The application shell provides responsive scaffolding across three primary viewports:
- **Desktop (1440px target, min-width: 1024px)**: Fixed 232px right-side sidebar navigation (`desktop-sidebar.tsx`).
- **Tablet (768px target, min-width: 640px and max-width: 1023px)**: Header with hamburger button that opens an accessible modal slide-over drawer (`tablet-drawer.tsx`).
- **Mobile (390px target, max-width: 639px)**: Fixed bottom navigation bar with accessible icons and labels (`mobile-bottom-nav.tsx`); header with user status and breadcrumb.

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
| **Mobile Bottom Nav**| `<nav>` | `role="navigation"`, `aria-label="التنقل السفلي"` | `data-testid="mobile-bottom-nav"` | Fixed bottom navigation bar on mobile viewports (<640px). Minimum label size `0.875rem` (`text-sm`). |
| **Main Content** | `<main>` | `id="main-content"`, `role="main"` | `data-testid="main-content"` | Primary document content area. |
| **User Identity Badge**| `<div>` or `<a>`| `aria-label="حساب المستخدم"` | `data-testid="user-identity-badge"` | Displays authenticated lawyer's name/email and link to `/settings/security`. |
| **Connectivity Banner**| `<div>` | `role="status"`, `aria-live="polite"` | `data-testid="connectivity-banner"` | Appears when network connection is lost (`navigator.onLine === false`). |

### 4.2 Navigation Items & Active State
Every navigation link provides:
- Meaningful Egyptian Arabic label (Mobile essential labels meet `DESIGN.md` minimum of `0.875rem`).
- `href` pointing to an available route (`/`, `/settings/security`, etc.).
- Active link marked with `aria-current="page"`.
- Focusable with visible focus ring (`ring-2 ring-[#14566B] ring-offset-2`).
- Touch target minimum 44×44px (`min-h-[44px] min-w-[44px]`).

Navigation routes:
1. **الرئيسية / اليوم (Home / Today)**: `href="/"`, icon: Calendar/Today icon, testid: `nav-link-home`.
2. **إعدادات الأمان (Security Settings)**: `href="/settings/security"`, icon: Shield/Lock icon, testid: `nav-link-security`.
3. **تسجيل الخروج (Sign Out)**: Action button triggering confirmed Better Auth signout, testid: `nav-button-logout`.

### 4.3 Modal Background Isolation Contract (R04-02)
To guarantee rigorous accessibility and prevent background interaction when any modal layer is open (e.g. Recovery Codes dialog or Tablet Slide-over Drawer):
1. **Background Exclusion:**
   - The primary application content container (`#app-shell-content`, encompassing Header, User Identity Badge, Sidebar, Main Content, and Mobile Bottom Nav) must have `inert={true}` and `aria-hidden="true"` applied whenever a modal dialog is active.
   - Programmatic focus calls to background elements (such as `user-identity-badge`) must be strictly rejected by the browser runtime while the modal is open.
2. **Non-Inert Modal Mount:**
   - Active modal dialogs mount outside `#app-shell-content` (as siblings or via portal into `document.body`) so that the modal itself is never trapped inside an inert ancestor.
3. **Focus Lifecycle & Containment:**
   - On open: Focus moves automatically to the primary action/field in the modal without arbitrary delays.
   - During interaction: Tab and Shift+Tab wrap strictly within focusable elements inside the dialog.
   - On close: Pressing `Escape` or clicking the backdrop dismisses the dialog and restores focus reliably to the trigger control that opened it.

### 4.4 Confirmed Logout Contract (R04-01)
To prevent phantom logouts where the UI navigates away while the server session remains active:
1. **Pending State & Throttling:**
   - When the user activates `nav-button-logout`:
   - Duplicate clicks are prevented: the button enters pending state (`disabled`, `aria-busy="true"`).
2. **Failure Handling & Arabic Feedback:**
   - The handler calls Better Auth `signOut()`.
   - If the request fails (e.g. server returns 500/503 or throws a network error):
     - The application MUST NOT navigate to `/login`.
     - In the drawer, the drawer MUST NOT close.
     - The component displays clear Arabic error feedback:
       `"تعذر تسجيل الخروج من الخادم. جلستك الحالية ما زالت نشطة، يرجى المحاولة مجدداً."` (`role="alert"`, `data-testid="logout-error-alert"`).
     - The user is allowed to retry the logout operation.
3. **Confirmed Success:**
   - ONLY when `signOut()` confirms successful server-side revocation (`!error`) does the application redirect to `/login`.

---

## 5. Design Tokens (Authoritative `DESIGN.md`)

- **Primary Brand / Deep Teal:** `#14566B` (hover: `#0F4354`, active/selected: `#14566B`, tint: `#E8F1F3`).
- **Surface / Background:** `#F4F6F7` (app shell background), `#FFFFFF` (card / sidebar / dialog background).
- **Text & Neutral Contrast:**
  - Dark Primary Text: `#172A35` (meets WCAG AAA >10:1 on white).
  - Muted Secondary Text: `#4D606A` (meets WCAG AA >4.5:1 on white).
  - Borders: `#D5DFE3` (dividers and card borders).
- **Status & Alerts:**
  - Warning Banner: `#7A4A00` text on `#FFF8E1` background with `#FFE082` border.
  - Destructive / Error: `#A4262C` text on `#FDF3F2` background with `#F8D7DA` border.
  - Success: `#176449` text on `#E8F5E9` background with `#C8E6C9` border.
- **Focus Rings:** `outline-none ring-2 ring-[#14566B] ring-offset-2`.
- **Motion:** Standard transitions `150ms ease-in-out`; `@media (prefers-reduced-motion: reduce)` disables all transitions and animations (`transition: none !important`).

---

## 6. Real State Specifications & Reproducible Triggers (R04-04)

### 6.1 S02 Empty State (Home `/`)
When an authenticated lawyer lands on `/`:
- **Heading (`<h1>`):** `"مكتب المحامي — لوحة المتابعة"` (LawOffice OS — Operational Dashboard).
- **Subheading / Badge:** Genuine welcome and status in Egyptian Arabic.
- **Empty State Container:** `data-testid="dashboard-empty-state"`.
- **Informative Copy:** Clearly communicates that no active cases or hearings are loaded yet, as the office management modules (القضايا والجلسات) will be activated in upcoming phases.
- **Primary Action:** Directs the lawyer to review their account security:
  - Button/Link: `"مراجعة إعدادات الأمان"` (Review Security Settings) -> `href="/settings/security"`, testid: `empty-state-security-action`.
- **Invariant:** NO mock numbers, fake hearings, dummy financial balances, or fictional client statistics.

### 6.2 Loading State (R04-04)
- **Presentation Primitive (`src/components/presentation-state.tsx`):**
  - Component: `<LoadingIndicator />`
  - Attributes: `role="status"`, `aria-busy="true"`, `aria-label="جارٍ التحميل..."`, `data-testid="loading-indicator"`.
- **Reproducible Triggers on Current Surfaces:**
  1. **Route Transition Boundary:** `src/app/loading.tsx` renders `<LoadingIndicator />` during Next.js server component resolution.
  2. **Dashboard Status Widget on `/`:** The dashboard agenda status widget (`src/components/dashboard-status.tsx`) executes an initial asynchronous readiness/session verification. While the request is in-flight, it renders `<LoadingIndicator />`. Once settled, the indicator disappears and the settled empty state is revealed.

### 6.3 Recoverable Error and Retry State (R04-04)
- **Presentation Primitive (`src/components/presentation-state.tsx`):**
  - Component: `<ErrorContainer />`
  - Attributes: `role="alert"`, `data-testid="error-container"`.
  - Retry Action: `<button type="button" data-testid="error-retry-button">إعادة المحاولة</button>`.
- **Reproducible Triggers on Current Surfaces:**
  1. **Route Error Boundary:** `src/app/error.tsx` renders `<ErrorContainer />` with `reset()` bound to `error-retry-button`.
  2. **Dashboard Status Retrieval Failure on `/`:** If the asynchronous status check on `/` encounters a network error (e.g. simulated network failure or 500 error in Playwright route intercept):
     - It renders `<ErrorContainer />` displaying `"تعذر تحميل بيانات لوحة المتابعة. يرجى التحقق من الاتصال والمحاولة مجدداً."`.
     - Clicking `error-retry-button` retries the asynchronous fetch. When the simulated network failure is cleared, the retry succeeds, `<ErrorContainer />` is hidden, and settled content appears.

### 6.4 Disconnected (Offline) Banner
- Monitored via `window.addEventListener('online')` / `window.addEventListener('offline')` and `navigator.onLine`.
- When offline:
  - Element: `<div role="status" aria-live="polite" data-testid="connectivity-banner" className="...">`.
  - Exact Arabic text: `"النت مقطوع. التعديلات مش محفوظة"`.
  - Top-pinned visible alert styling (warning background, high contrast).
  - Automatically dismisses when `online` event fires.

### 6.5 Session Expiry Feedback & Return Destination (R04-06)
- **Expiry Detection:** When a session is revoked or expired:
  - User is redirected to `/login?error=session_expired&returnTo=<validated-local-path>`.
  - Login page renders alert message: `"انتهت الجلسة. يرجى تسجيل الدخول مرة أخرى."` (`data-testid="session-expired-alert"`).
- **Return Destination Validation:**
  - `returnTo` must be an explicitly validated local route (starting with a single `/`, strictly rejecting `//`, `/\`, `javascript:`, or protocol strings `://`).
  - The validated destination is preserved through password entry and MFA verification (`/verify?returnTo=...`), navigating to the originally requested route (e.g. `/settings/security`) upon successful re-authentication.

---

## 7. PWA Manifest and Static Public Assets (R04-05)

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

### 7.2 Service Worker & Zero-Trust Privacy Invariants (R04-05)
- **Same-Origin Requirement:**
  - `public/sw.js` must strictly ignore any cross-origin requests (`url.origin !== self.location.origin`).
- **Enumerated Public-Only Allowlist:**
  - `public/sw.js` caches ONLY explicitly enumerated, unauthenticated public static assets:
    - `/manifest.webmanifest`
    - `/offline.html`
    - `/icons/icon.svg`
    - `/icons/icon-192.png`
    - `/icons/icon-512.png`
    - `/icons/icon-maskable.png`
    - `/fonts/noto-sans-arabic-400.woff2`
    - `/fonts/noto-sans-arabic-latin.woff2`
- **Strictly Forbidden Caching (Zero-Trust):**
  - Authenticated `/` (Home page) MUST NOT be cached in `CacheStorage`. Stale contract allowances for caching `/` are revoked.
  - MUST NOT cache any `/api/*` endpoints.
  - MUST NOT cache `/login`, `/verify`, or `/settings/*`.
  - MUST NOT store sensitive client documents, session tokens, passwords, MFA secrets, or financial records in `CacheStorage`, `localStorage`, `sessionStorage`, or `IndexedDB`.
  - Unallowlisted paths use Network-Only with zero caching.
- **Offline Navigation Fallback:**
  - For requests with `mode === 'navigate'`, if network fetch fails, serve `/offline.html`.
  - `/offline.html` and `/offline` must contain zero private lawyer or client data.

---

## 8. Test Environment, Port Allocation & Discovery Routing (R04-03)

- **Gemini Worktree (`D:/Lawyer/work/t04-gemini`)**:
  - Application Server: `http://localhost:3100` (port 3100)
  - `BETTER_AUTH_URL=http://localhost:3100`
  - Synthetic database: separate test database per standard test configuration.
- **OpenCode Worktree (`D:/Lawyer/work/t04-opencode`)**:
  - Browser Suite Server: `http://localhost:3204` (port 3204)
  - Dedicated Playwright config: `playwright.t04.config.ts`
  - `BETTER_AUTH_URL=http://localhost:3204`
  - Synthetic database: separate test database (`lawoffice_t04_opencode_test`).
- **Playwright Suite Routing & Discovery:**
  - `playwright.config.ts` (port 3100) executes T03 auth browser regressions (`auth*.spec.ts`).
  - `playwright.t04.config.ts` (port 3204) executes T04 shell, presentation, and PWA specs (`t04-*.spec.ts`) with project viewport grep tags (`@desktop`, `@tablet`, `@mobile`, `@once`, `@shell`, `@matrix`).
  - Canonical `npm run test:e2e` and hosted CI must execute both suites with appropriate project routing so that no viewport tag collisions occur.

---

## 9. Acceptance Criteria Mapping

| Acceptance ID | Specification Requirement | Verification Method |
|---|---|---|
| **T04-01** | Desktop right navigation (232px), tablet drawer, mobile bottom bar with available routes only. Confirmed logout handling (R04-01). | Visual/DOM verification at 1440px, 768px, 390px; active link states; error alert on failed logout without redirect. |
| **T04-02** | `lang="ar-EG"`, `dir="rtl"`, local licensed font, BiDi isolation (`<bdi>`/`dir="ltr"`), Cairo timezone. Full font license (R04-07). | Inspect root HTML, computed styles, font requests (local only), mixed-text rendering, `OFL.txt` content. |
| **T04-03** | 390px, 768px, 1440px viewports; 200% text scaling without horizontal clipping; touch targets ≥ 44×44px; mobile label size ≥ 0.875rem (R04-07). | Playwright responsive viewport tests, CSS overflow check at 200% font zoom, bounding box checks, font size checks. |
| **T04-04** | Keyboard tab order, drawer/dialog focus containment, Escape restoration, semantic landmarks, WCAG AA contrast. Complete shell inert modal isolation (R04-02). | Tab sequence automation, background focus exclusion assertion on `user-identity-badge`, Escape key dispatch. |
| **T04-05** | Real empty state S02 on `/`, genuine loading indicator, recoverable error/retry, offline banner (`"النت مقطوع"`), session expiry return destination (R04-04, R04-06). | DOM assertions for S02 copy; pending-to-settled and error-to-retry tests on `/`; expiry return navigation test. |
| **T04-06** | Valid `/manifest.webmanifest`, reachable icons (192, 512, maskable, svg), standalone display. Local browser installability observation (R04-08). | Manifest fetch and JSON validation; verify icon HTTP 200 responses; browser installability API observation. |
| **T04-07** | Strict same-origin public-assets-only storage/cache; zero client data, auth tokens, or API responses in CacheStorage/Storage; `/` excluded from cache (R04-05). | Inspect browser storage and CacheStorage after navigating authenticated routes; verify API and `/` exclusion. |
| **T04-08** | No mockup account autofill, invented security claims, or false sync guarantees. | Static inspection and browser text content audit. |
| **T04-09** | Existing T03 auth, MFA, Origin/Host guards, session lifecycle, and migration tests pass unchanged. | Full execution of existing integration and unit test suite. |
| **T04-10** | Exact-head integrated tests, native Agency support reviews returned and reconciled, coherent PR. | Final consolidated test run on combined checkpoint and documented submission report. |

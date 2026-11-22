/**
 * T04 interface-contract constants.
 *
 * Every value here is copied from `docs/assignments/T04-interface-contract.md`
 * (v1.0.0, commit 69950dc). Tests import these names instead of scattering
 * Arabic copy and test ids, so a contract revision has one place to update.
 */

export const T04_TEST_IDS = {
  skipLink: 'skip-to-content',
  appHeader: 'app-header',
  drawerToggle: 'drawer-toggle-button',
  desktopSidebar: 'desktop-sidebar',
  desktopNav: 'desktop-nav',
  tabletDrawer: 'tablet-drawer',
  drawerClose: 'drawer-close-button',
  drawerBackdrop: 'drawer-backdrop',
  mobileBottomNav: 'mobile-bottom-nav',
  mainContent: 'main-content',
  userIdentityBadge: 'user-identity-badge',
  connectivityBanner: 'connectivity-banner',
  emptyState: 'dashboard-empty-state',
  emptyStateSecurityAction: 'empty-state-security-action',
  loadingIndicator: 'loading-indicator',
  errorContainer: 'error-container',
  errorRetryButton: 'error-retry-button',
  sessionExpiredAlert: 'session-expired-alert',
  navHome: 'nav-link-home',
  navMatters: 'nav-link-matters',
  navParties: 'nav-link-parties',
  navReference: 'nav-link-reference',
  navSecurity: 'nav-link-security',
  navSearch: 'nav-link-search',
  navLogout: 'nav-button-logout',
} as const;

export type T04TestId = (typeof T04_TEST_IDS)[keyof typeof T04_TEST_IDS];

export const T04_ROUTES = {
  home: '/',
  login: '/login',
  verify: '/verify',
  matters: '/matters',
  parties: '/parties',
  reference: '/settings/reference',
  security: '/settings/security',
  search: '/search',
  offline: '/offline',
  offlineHtml: '/offline.html',
  manifest: '/manifest.webmanifest',
} as const;

/** Routes that exist and are reachable in T04/T05/T06/T07 (section 2.1). */
export const T04_AVAILABLE_ROUTES: readonly string[] = [
  T04_ROUTES.home,
  T04_ROUTES.login,
  T04_ROUTES.verify,
  T04_ROUTES.matters,
  T04_ROUTES.parties,
  T04_ROUTES.reference,
  T04_ROUTES.security,
  T04_ROUTES.search,
  T04_ROUTES.offline,
  T04_ROUTES.offlineHtml,
];

/** The only destinations the navigation shell may expose (section 4.2). */
export const T04_ALLOWED_NAV_HREFS: readonly string[] = [
  T04_ROUTES.home,
  T04_ROUTES.matters,
  T04_ROUTES.parties,
  T04_ROUTES.security,
  T04_ROUTES.reference,
  T04_ROUTES.search,
];

/**
 * Business modules that are strictly unbuilt (section 2.2). The shell
 * must not link to them and pretend they open a working screen.
 */
export const T04_FORBIDDEN_MODULE_ROUTES: readonly string[] = [
  '/proceedings',
  '/hearings',
  '/finance',
  '/clients',
  '/today',
  '/agenda',
  '/tasks',
  '/deadlines',
  '/documents',
  '/reports',
  '/settings',
];

export const T04_COPY = {
  desktopNavLabel: 'التنقل الرئيسي',
  bottomNavLabel: 'التنقل السفلي',
  drawerLabel: 'قائمة التنقل',
  openDrawer: 'فتح القائمة',
  closeDrawer: 'إغلاق القائمة',
  signOut: 'تسجيل الخروج',
  emptyStateHeading: 'مكتب المحامي — لوحة المتابعة',
  emptyStateSecurityAction: 'مراجعة إعدادات الأمان',
  sessionExpired: 'انتهت الجلسة. يرجى تسجيل الدخول مرة أخرى.',
  offlineBanner: 'النت مقطوع. التعديلات مش محفوظة',
  loadingLabel: 'جارٍ التحميل...',
  errorRetry: 'إعادة المحاولة',
} as const;

/** Contract section 7.1, authoritative manifest values. */
export const T04_MANIFEST = {
  path: T04_ROUTES.manifest,
  name: 'مكتب المحامي — LawOffice OS',
  shortName: 'مكتب المحامي',
  description: 'نظام إدارة مكتب المحاماة — النسخة التشغيلية الأولى',
  startUrl: '/',
  display: 'standalone',
  orientation: 'any',
  dir: 'rtl',
  lang: 'ar-EG',
  backgroundColor: '#F4F6F7',
  themeColor: '#14566B',
  icons: [
    { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
    { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
    { src: '/icons/icon-maskable.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    { src: '/icons/icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' },
  ],
} as const;

/**
 * Service-worker allowlist strictly matching public/sw.js STATIC_ALLOWLIST (R04-07).
 * Strictly limited to the 8 enumerated public static assets.
 */
export const T04_SW_EXACT_ALLOWED_PATHS: readonly string[] = [
  '/offline.html',
  '/manifest.webmanifest',
  '/icons/icon.svg',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
  '/icons/icon-maskable.png',
  '/fonts/noto-sans-arabic-400.woff2',
  '/fonts/noto-sans-arabic-latin.woff2',
];

export const T04_SW_ALLOWED_PATHS: readonly RegExp[] = [
  /^\/offline\.html$/,
  /^\/manifest\.webmanifest$/,
  /^\/icons\/icon\.svg$/,
  /^\/icons\/icon-192\.png$/,
  /^\/icons\/icon-512\.png$/,
  /^\/icons\/icon-maskable\.png$/,
  /^\/fonts\/noto-sans-arabic-400\.woff2$/,
  /^\/fonts\/noto-sans-arabic-latin\.woff2$/,
];

export const T04_SW_FORBIDDEN_PATHS: readonly RegExp[] = [
  /^\/$/,
  /^\/api\//,
  /^\/login(?:\/|$)/,
  /^\/verify(?:\/|$)/,
  /^\/settings(?:\/|$)/,
];

import { test, expect } from '../helpers/t04-fixtures';
import { T04_COPY, T04_ROUTES, T04_TEST_IDS } from '../helpers/t04-constants';
import { expectShellReady } from '../helpers/t04-layout';
import { countSessionsForUser, currentTotp, revokeAllSessionsForUser } from '../helpers/t04-auth';
import { expectHtmlResponse, findOfflineRoute } from '../helpers/t04-assets';
import { sanitizeReturnTo } from '../../src/lib/sanitize-return-to';

/**
 * T04-05 — office overview, offline banner and server-side session expiry.
 *
 * The expiry test deletes the real `session` rows for a fresh owner and then
 * performs a real server navigation; nothing is mocked at the HTTP layer.
 */

test('authenticated home renders the office overview @once', async ({ t04Page: page }) => {
  await page.goto(T04_ROUTES.home);
  await expectShellReady(page);

  const heading = page.getByRole('heading', { level: 1 });
  await expect(heading).toHaveText(T04_COPY.emptyStateHeading);

  const emptyState = page.getByTestId(T04_TEST_IDS.emptyState);
  await expect(emptyState).toBeVisible();

  await expect(emptyState.getByRole('heading')).toHaveText('مساحة عمل المكتب');
  await expect(emptyState).toContainText('أقسام النظام المتاحة لحسابك');

  const action = page.getByTestId(T04_TEST_IDS.emptyStateSecurityAction);
  await expect(action).toBeVisible();
  await expect(action).toHaveAttribute('href', T04_ROUTES.security);

  await expect(page.getByTestId(T04_TEST_IDS.loadingIndicator)).toBeHidden();
  await expect(page.getByTestId(T04_TEST_IDS.errorContainer)).toBeHidden();
});

test('offline banner appears and dismisses with the real connectivity events @once', async ({
  t04Page: page,
}) => {
  await page.goto(T04_ROUTES.home);
  await expectShellReady(page);

  const banner = page.getByTestId(T04_TEST_IDS.connectivityBanner);
  await expect(banner).toBeHidden();

  await page.context().setOffline(true);
  try {
    await expect(banner).toBeVisible();
    await expect(banner).toHaveText(T04_COPY.offlineBanner);
    await expect(banner).toHaveAttribute('role', 'status');
    await expect(banner).toHaveAttribute('aria-live', 'polite');
    expect(await page.evaluate(() => navigator.onLine)).toBe(false);
  } finally {
    await page.context().setOffline(false);
  }

  await expect(banner).toBeHidden();
});

test('revoked session redirects to login with expiry feedback and returnTo @once', async ({
  t04OwnerPage: page,
  t04Owner,
}) => {
  await page.goto(T04_ROUTES.home);
  await expectShellReady(page);
  expect(await countSessionsForUser(t04Owner.id)).toBeGreaterThan(0);

  const revoked = await revokeAllSessionsForUser(t04Owner.id);
  expect(revoked, 'The synthetic owner had no session to revoke').toBeGreaterThan(0);

  await page.goto(T04_ROUTES.security);

  await expect(page).toHaveURL(
    (url) =>
      url.pathname === T04_ROUTES.login &&
      url.searchParams.get('error') === 'session_expired' &&
      url.searchParams.get('returnTo') === T04_ROUTES.security
  );

  const alert = page.getByTestId(T04_TEST_IDS.sessionExpiredAlert);
  await expect(alert).toBeVisible();
  await expect(alert).toHaveText(T04_COPY.sessionExpired);
});

test('public offline fallback is reachable and leaks no owner data @once', async ({
  request,
  t04WorkerSession,
}) => {
  const { path, response } = await findOfflineRoute(request);
  expect([T04_ROUTES.offline, T04_ROUTES.offlineHtml]).toContain(path);
  expectHtmlResponse(response);

  const html = await response.text();
  expect(html, 'The offline fallback must contain Arabic guidance').toMatch(/[\u0600-\u06FF]/);
  expect(html, 'The public offline page must not contain the owner email').not.toContain(
    t04WorkerSession.owner.email
  );
  expect(html, 'The public offline page must not contain the owner name').not.toContain(
    t04WorkerSession.owner.name
  );
  expect(html, 'The public offline page must not contain the owner id').not.toContain(
    t04WorkerSession.owner.id
  );
});

test('login with malicious returnTo sanitizes safely to root without open redirect @once', async ({
  browser,
  t04Owner,
}, testInfo) => {
  const baseURL = testInfo.project.use.baseURL;
  expect(baseURL, 'Playwright project must configure baseURL').toBeTruthy();
  const origin = new URL(baseURL!).origin;
  const context = await browser.newContext({ baseURL });
  const page = await context.newPage();
  try {
    // Navigate to login with protocol-relative external returnTo vector
    await page.goto('/login?returnTo=//evil.com/phish');
    await page.locator('#email').fill(t04Owner.email);
    await page.locator('#password').fill(t04Owner.password);
    await page.locator('button[type="submit"]').click();

    // Verify step to 2FA does not preserve an open redirect target
    await expect(page.getByRole('heading', { level: 1 })).toContainText('التحقق الثنائي');
    expect(page.url()).not.toContain('evil.com');

    // Complete TOTP verification
    const code = await currentTotp(t04Owner.totpSecret);
    await page.locator('#totpCode').fill(code);
    await page.locator('button[type="submit"]').click();

    // Settle at local root '/' — must not redirect to evil.com
    await page.waitForURL((url) => url.pathname === '/' && !url.hostname.includes('evil.com'));
    expect(new URL(page.url()).origin).toBe(origin);
    expect(new URL(page.url()).pathname).toBe('/');
  } finally {
    await context.close();
  }
});

test('navigating to verify with dot-segment open-redirect returnTo settles safely on root (T04-R2-01) @once', async ({
  page,
  t04Owner,
}, testInfo) => {
  const baseURL = testInfo.project.use.baseURL;
  expect(baseURL, 'Playwright project must configure baseURL').toBeTruthy();
  const origin = new URL(baseURL!).origin;
  await page.route('**://redirect.invalid/**', (route) =>
    route.fulfill({ status: 200, contentType: 'text/html', body: '<title>Controlled redirect observer</title>' })
  );
  await page.goto('/login');
  await page.locator('#email').fill(t04Owner.email);
  await page.locator('#password').fill(t04Owner.password);
  await page.locator('button[type="submit"]').click();
  await expect(page).toHaveURL(/\/verify/);

  // Navigate to /verify with crafted dot-segment returnTo vector
  await page.goto('/verify?returnTo=' + encodeURIComponent('/x/..//redirect.invalid/phish'));
  await page.locator('#totpCode').fill(await currentTotp(t04Owner.totpSecret));
  await page.locator('button[type="submit"]').click();

  // Assert browser settles safely on local root '/' and NOT external redirect.invalid
  await page.waitForURL((url) => url.origin === origin && url.pathname === '/');
  expect(page.url()).toBe(`${origin}/`);
  expect(page.url()).not.toContain('redirect.invalid');
});

test('expired session return journey redirects through login and verify back to security @once', async ({
  t04OwnerPage: page,
  t04Owner,
}, testInfo) => {
  const baseURL = testInfo.project.use.baseURL;
  expect(baseURL, 'Playwright project must configure baseURL').toBeTruthy();
  const origin = new URL(baseURL!).origin;
  await page.goto(T04_ROUTES.home);
  await expectShellReady(page);
  expect(await countSessionsForUser(t04Owner.id)).toBeGreaterThan(0);

  // Revoke session so the browser holds an expired session cookie
  const revoked = await revokeAllSessionsForUser(t04Owner.id);
  expect(revoked, 'The synthetic owner had no session to revoke').toBeGreaterThan(0);

  // 1. Visit /settings/security with expired session -> redirects to /login?error=session_expired&returnTo=%2Fsettings%2Fsecurity
  await page.goto(T04_ROUTES.security);
  await expect(page).toHaveURL((url) => {
    return (
      url.pathname === '/login' &&
      url.searchParams.get('error') === 'session_expired' &&
      url.searchParams.get('returnTo') === '/settings/security'
    );
  });

  const alert = page.getByTestId(T04_TEST_IDS.sessionExpiredAlert);
  await expect(alert).toBeVisible();

  // 2. Submit owner credentials -> redirects to /verify?returnTo=%2Fsettings%2Fsecurity
  await page.locator('#email').fill(t04Owner.email);
  await page.locator('#password').fill(t04Owner.password);
  await page.locator('button[type="submit"]').click();

  await expect(page).toHaveURL((url) => {
    return (
      url.pathname === '/verify' &&
      url.searchParams.get('returnTo') === '/settings/security'
    );
  });

  // 3. Submit valid TOTP code -> browser settles back at http://127.0.0.1:3204/settings/security
  const code = await currentTotp(t04Owner.totpSecret);
  await page.locator('#totpCode').fill(code);
  await page.locator('button[type="submit"]').click();

  await page.waitForURL((url) => url.origin === origin && url.pathname === '/settings/security');
  expect(page.url()).toBe(`${origin}/settings/security`);

  // 4. Assert displaying "الأمان وإدارة الجلسات"
  const heading = page.getByRole('heading', { level: 1 });
  await expect(heading).toContainText('الأمان وإدارة الجلسات');
});

test('returnTo sanitization neutralizes open redirect vectors and preserves safe relative paths @once', async () => {
  const maliciousVectors = [
    '//evil.com',
    '//evil.com/attack',
    '///evil.com',
    'javascript:alert(document.cookie)',
    '/\\evil.com',
    '/\\/evil.com',
    '\\evil.com',
    'https://evil.com',
    'http://evil.com',
    'data:text/html,<script>alert(1)</script>',
    '/evil\0test',
    '/x/..//redirect.invalid/phish',
    '/..//evil.com',
    '/x/../\\evil.com',
  ];

  for (const vector of maliciousVectors) {
    const sanitized = sanitizeReturnTo(vector);
    expect(sanitized, `Malicious vector "${vector}" must sanitize safely to "/" without open redirect`).toBe('/');
  }

  // Safe relative paths must be preserved
  expect(sanitizeReturnTo('/settings/security')).toBe('/settings/security');
  expect(sanitizeReturnTo('/settings/security?tab=audit')).toBe('/settings/security?tab=audit');
  expect(sanitizeReturnTo('/')).toBe('/');
  expect(sanitizeReturnTo(null)).toBe('/');
  expect(sanitizeReturnTo(undefined)).toBe('/');
});

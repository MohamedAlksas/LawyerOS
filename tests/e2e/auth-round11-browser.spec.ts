import { test, expect, type Page, type Request, type Locator } from '@playwright/test';
import { hashPassword, symmetricEncrypt } from 'better-auth/crypto';
import { createOTP } from '@better-auth/utils/otp';
import { base32 } from '@better-auth/utils/base32';
import { randomUUID, createHash } from 'crypto';
import { createValidatedTestPool, cleanupTrackedFixtures } from '../helpers/test-db';

const runId = `${Date.now()}.${randomUUID().slice(0, 8)}`;
let testEmail: string;
const TEST_PASSWORD = 'E2EPassword2026!';
const TOTP_SECRET = 'SZ7CE4ZHNWC37XUUQ5S4HNQLL6SNJ6XT';
const BACKUP_CODE = 'bkp01-code2';

const trackedFixtureUserIds: string[] = [];
let testUserId: string | null = null;

test.beforeEach(async () => {
  // 1. Strictly validate test environment before connecting (R07)
  const { pool, env } = createValidatedTestPool();
  const client = await pool.connect();
  try {
    const hashedPassword = await hashPassword(TEST_PASSWORD);
    const secretKey = env.BETTER_AUTH_SECRET;
    // R01: Authenticator Enrollment Key Alignment: Prefix Base32 secret with "base32:"
    const encryptedSecret = await symmetricEncrypt({ key: secretKey, data: 'base32:' + TOTP_SECRET });
    const encryptedBackupCodes = await symmetricEncrypt({
      key: secretKey,
      data: JSON.stringify([BACKUP_CODE, 'bkp02-code3', 'bkp03-code4']),
    });

    testEmail = `lawyer.r14.${runId}.${randomUUID()}@office.eg`;
      testUserId = randomUUID();
      trackedFixtureUserIds.push(testUserId);
      await client.query(
        'INSERT INTO "user" (id, name, email, "emailVerified", role, "twoFactorEnabled", "createdAt", "updatedAt") VALUES ($1, $2, $3, true, $4, true, NOW(), NOW())',
        [testUserId, 'المحامي التجريبي للمرحلة 14', testEmail, 'OWNER']
      );
      await client.query(
        'INSERT INTO "account" (id, "userId", "providerId", "accountId", password, "createdAt", "updatedAt") VALUES ($1, $2, $3, $4, $5, NOW(), NOW())',
        [randomUUID(), testUserId, 'credential', testUserId, hashedPassword]
      );
      await client.query(
        'INSERT INTO "twoFactor" (id, "userId", secret, "backupCodes", verified) VALUES ($1, $2, $3, $4, true)',
        [randomUUID(), testUserId, encryptedSecret, encryptedBackupCodes]
      );
  } finally {
    client.release();
    await pool.end();
  }
});

test.afterAll(async () => {
  // Scoped cleanup of strictly owned synthetic E2E test data by ID (R07)
  if (trackedFixtureUserIds.length > 0) {
    const { pool } = createValidatedTestPool();
    await cleanupTrackedFixtures(pool, { userIds: trackedFixtureUserIds });
    await pool.end();
  }
});

async function loginAndCompleteMfa(page: Page) {
  await page.goto('/login');
  await page.fill('#email', testEmail);
  await page.fill('#password', TEST_PASSWORD);
  await page.click('button[type="submit"]');

  await page.waitForURL('**/verify*');

  const clientSecretBytes = base32.decode(TOTP_SECRET.toUpperCase());
  const otpHelper = createOTP(clientSecretBytes, { period: 30, digits: 6 });
  const totpCode = await otpHelper.totp();

  await page.fill('#totpCode', totpCode);
  await page.click('button[type="submit"]');

  await page.waitForURL((url: URL) => !url.pathname.includes('/verify') && !url.pathname.includes('/login'));
}

const regenerateLabel = 'إعادة توليد رموز الاسترداد';
const generateLabel = 'توليد رموز جديدة';
const savedLabel = 'تم الحفظ والإغلاق';

function isRecoveryAction(request: Request): boolean {
  return request.method() === 'POST' &&
    new URL(request.url()).pathname === '/settings/security' &&
    Boolean(request.headers()['next-action']);
}

async function storedRecoveryCodes(): Promise<string> {
  const { pool } = createValidatedTestPool();
  try {
    const result = await pool.query<{ backupCodes: string }>(
      'SELECT "backupCodes" FROM "twoFactor" WHERE "userId" = $1', [testUserId]
    );
    expect(result.rowCount).toBe(1);
    return result.rows[0].backupCodes;
  } finally {
    await pool.end();
  }
}

async function installActionConsumptionObserver(page: Page) {
  // Observe the actual browser reader reaching EOF, not only network arrival.
  // The action payload and its authentication semantics are left unchanged.
  await page.addInitScript(() => {
    const state = window as unknown as { completedActionBodies: number };
    state.completedActionBodies = 0;
    const originalFetch = window.fetch.bind(window);
    window.fetch = async (...args: Parameters<typeof fetch>) => {
      const response = await originalFetch(...args);
      const headers = new Headers(args[1]?.headers);
      if (!headers.has('next-action') || !response.body) return response;
      const observedBody = response.body.pipeThrough(new TransformStream({
        transform(chunk, controller) { controller.enqueue(chunk); },
        flush() { state.completedActionBodies += 1; },
      }));
      return new Response(observedBody, {
        status: response.status,
        statusText: response.statusText,
        headers: response.headers,
      });
    };
  });
}

async function waitForActionConsumption(page: Page, count: number) {
  await page.waitForFunction((expected) =>
    (window as unknown as { completedActionBodies: number }).completedActionBodies === expected,
  count);
  // Let React render the consumed action result before checking absence of stale UI.
  await page.evaluate(() => new Promise<void>((resolve) =>
    requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
}

async function assertDialogReflow(page: Page, dialog: Locator) {
  await expect(dialog).toBeVisible();
  const geometry = await dialog.evaluate((element) => {
    const box = element.getBoundingClientRect();
    return {
      left: box.left, right: box.right, top: box.top, bottom: box.bottom,
      width: innerWidth, height: innerHeight,
      dialogScroll: element.scrollWidth, dialogClient: element.clientWidth,
      documentScroll: document.documentElement.scrollWidth,
      documentClient: document.documentElement.clientWidth,
    };
  });
  expect(geometry.left).toBeGreaterThanOrEqual(0);
  expect(geometry.right).toBeLessThanOrEqual(geometry.width + 1);
  expect(geometry.top).toBeGreaterThanOrEqual(0);
  expect(geometry.bottom).toBeLessThanOrEqual(geometry.height + 1);
  expect(geometry.dialogScroll).toBeLessThanOrEqual(geometry.dialogClient + 1);
  expect(geometry.documentScroll).toBeLessThanOrEqual(geometry.documentClient + 1);

  // Vertical scrolling is allowed. Every relevant control/text must be reachable,
  // horizontally contained, and hit-testable rather than merely present.
  const contents = dialog.locator('h3, p, input, button, [role="alert"], [dir="ltr"] > div');
  for (const item of await contents.all()) {
    await item.scrollIntoViewIfNeeded();
    await expect(item).toBeInViewport();
    const reachable = await item.evaluate((element) => {
      const box = element.getBoundingClientRect();
      const parentBox = element.closest('[role="dialog"]')!.getBoundingClientRect();
      const hit = document.elementFromPoint((box.left + box.right) / 2, (box.top + box.bottom) / 2);
      return box.left >= parentBox.left && box.right <= parentBox.right + 1 &&
        (element === hit || element.contains(hit));
    });
    expect(reachable).toBe(true);
  }
  const controls = dialog.locator('button:not([disabled]), input:not([disabled])');
  await controls.first().focus();
  for (let i = 0; i <= await controls.count(); i++) {
    await page.keyboard.press('Tab');
    expect(await dialog.evaluate((element) => element.contains(document.activeElement))).toBe(true);
  }
}

test.describe('LawOffice OS — Round 11 Browser Journeys & Regression Evidence (R11-04)', () => {
  test('logout HTTP 503 leaves user on page with Arabic error; successful retry navigates and revokes access', async ({ page }) => {
    await loginAndCompleteMfa(page);

    await page.goto('/settings/security');
    await expect(page.locator('h1')).toContainText('الأمان وإدارة الجلسات');

    // Intercept /api/auth/sign-out to return HTTP 503 on the first attempt
    let signOutAttempts = 0;
    await page.route('**/api/auth/sign-out', async (route) => {
      signOutAttempts++;
      if (signOutAttempts === 1) {
        await route.fulfill({
          status: 503,
          contentType: 'application/json',
          body: JSON.stringify({ message: 'Service Unavailable' }),
        });
      } else {
        await route.continue();
      }
    });

    // Handle the window.confirm confirmation dialog
    page.once('dialog', async (dialog) => {
      expect(dialog.message()).toContain('تسجيل الخروج');
      await dialog.accept();
    });

    // Click "تسجيل الخروج" for the current session
    await page.click('button:has-text("تسجيل الخروج")');

    // Assert user remains on /settings/security
    await expect(page).toHaveURL(/\/settings\/security/);

    // Assert the Arabic error alert is displayed
    const errorAlert = page.locator('div[role="alert"]:has-text("فشل تسجيل الخروج من الخادم")');
    await expect(errorAlert).toBeVisible();

    // Now retry logout
    page.once('dialog', async (dialog) => {
      await dialog.accept();
    });

    await page.click('button:has-text("تسجيل الخروج")');

    // Assert navigation to /login succeeds
    await page.waitForURL('**/login*');
    await expect(page.locator('h1')).toContainText('تسجيل الدخول');

    // Verify session is revoked: attempting to navigate back to /settings/security redirects to /login
    await page.goto('/settings/security');
    await page.waitForURL('**/login*');
    await expect(page.locator('h1')).toContainText('تسجيل الدخول');
  });

  test('wrong-password expected Server Action errors remain Arabic in production', async ({ page }) => {
    await loginAndCompleteMfa(page);

    await page.goto('/settings/security');
    await expect(page.locator('h1')).toContainText('الأمان وإدارة الجلسات');

    // Open regeneration modal
    await page.click('button:has-text("إعادة توليد رموز الاسترداد")');
    const dialog = page.locator('div[role="dialog"]');
    await expect(dialog).toBeVisible();

    // Enter wrong password
    await page.fill('#currentPassword', 'WrongPass999!');
    await page.click('button[type="submit"]:has-text("توليد رموز جديدة")');

    // Assert error alert is rendered in Arabic without English text or exception dump
    const alert = dialog.locator('div[role="alert"]');
    await expect(alert).toBeVisible();
    await expect(alert).toContainText('كلمة المرور الحالية غير صحيحة');
    const alertText = await alert.innerText();
    expect(alertText).not.toContain('Invalid password');
    expect(alertText).not.toContain('Error:');
    expect(alertText).not.toContain('stack');
  });

  test('OTP validation rejects malformed, short and long codes', async ({ page }) => {
    await page.goto('/login');
    await page.fill('#email', testEmail);
    await page.fill('#password', TEST_PASSWORD);
    await page.locator('button[type="submit"]').click();
    await page.waitForURL('**/verify*');
    for (const [input, message] of [
      ['abc123', 'رمز التحقق يجب أن يحتوي على أرقام فقط.'],
      ['123', 'رمز التحقق غير مكتمل'],
      ['1234567', 'رمز التحقق يجب ألا يتجاوز 6 أرقام.'],
    ]) {
      await page.locator('#totpCode').fill(input);
      await page.locator('button[type="submit"]').click();
      await expect(page.locator('main div[role="alert"]')).toContainText(message);
    }
    const otp = createOTP(base32.decode(TOTP_SECRET), { period: 30, digits: 6 });
    const counter = Math.floor(Date.now() / 30000);
    const valid = await Promise.all([-1, 0, 1, 2].map((offset) => otp.hotp(counter + offset)));
    let wrong = '000000';
    while (valid.includes(wrong)) wrong = String(Number(wrong) + 1).padStart(6, '0');
    await page.locator('#totpCode').fill(wrong);
    await page.locator('button[type="submit"]').click();
    await expect(page.locator('main div[role="alert"]')).toContainText('رمز التحقق غير صحيح أو انتهت صلاحيته.');
  });

  for (const numeral of [{ name: 'Latin', zero: 0x30 }, { name: 'Arabic-Indic', zero: 0x0660 }, { name: 'Persian', zero: 0x06f0 }]) {
    test('authenticates genuine leading-zero ' + numeral.name + ' TOTP with native paste', async ({ page, context }) => {
      await context.grantPermissions(['clipboard-read', 'clipboard-write']);
      await page.goto('/login');
      await page.fill('#email', testEmail);
      await page.fill('#password', TEST_PASSWORD);
      await page.locator('button[type="submit"]').click();
      await page.waitForURL('**/verify*');
      // Deterministic fixture search at real time. Provider +/-1 verification keeps
      // this genuine code valid across the next 30-second boundary.
      const counter = Math.floor(Date.now() / 30000);
      let secret: Uint8Array = new Uint8Array();
      let code = '';
      for (let candidate = 0; candidate < 10000; candidate++) {
        secret = createHash('sha256').update('r14:' + counter + ':' + candidate).digest();
        code = await createOTP(secret, { period: 30, digits: 6 }).hotp(counter);
        if (code.startsWith('0')) break;
      }
      expect(code).toMatch(/^0[0-9]{5}$/);
      const { pool, env } = createValidatedTestPool();
      try {
        const encrypted = await symmetricEncrypt({ key: env.BETTER_AUTH_SECRET, data: 'base32:' + base32.encode(secret).replace(/=/g, '') });
        await pool.query('UPDATE "twoFactor" SET secret = $1 WHERE "userId" = $2', [encrypted, testUserId]);
      } finally { await pool.end(); }
      const localized = code.replace(/[0-9]/g, (digit) => String.fromCharCode(numeral.zero + Number(digit)));
      expect(localized.startsWith(String.fromCharCode(numeral.zero))).toBe(true);
      await page.evaluate((text) => navigator.clipboard.writeText(text), localized);
      await page.locator('#totpCode').focus();
      await page.keyboard.press(process.platform === 'darwin' ? 'Meta+v' : 'Control+v');
      await expect(page.locator('#totpCode')).toHaveValue(localized);
      await expect(page.getByText('6/6', { exact: true })).toBeVisible();
      expect(Math.floor(Date.now() / 30000) - counter).toBeLessThanOrEqual(1);
      await page.locator('button[type="submit"]').click();
      await page.waitForURL((url) => !['/login', '/verify'].includes(url.pathname));
      await page.goto('/settings/security');
      await expect(page.getByRole('heading', { level: 1 })).toContainText('الأمان وإدارة الجلسات');
    });
  }

  for (const result of ['success', 'error'] as const) {
    test('discards committed held ' + result + ' after dismissal and permits a fresh retry', async ({ page }) => {
      await installActionConsumptionObserver(page);
      await loginAndCompleteMfa(page);
      await page.goto('/settings/security');
      await page.getByRole('button', { name: regenerateLabel, exact: true }).click();
      const dialog = page.getByRole('dialog');
      const before = await storedRecoveryCodes();
      let release!: () => void;
      const hold = new Promise<void>((resolve) => { release = resolve; });
      let complete!: () => void;
      let fail!: (error: unknown) => void;
      const committed = new Promise<void>((resolve, reject) => { complete = resolve; fail = reject; });
      let intercepted = 0;
      await page.route('**/settings/security', async (route) => {
        if (!isRecoveryAction(route.request())) return route.continue();
        intercepted++;
        try {
          const response = await route.fetch();
          expect(response.status()).toBe(200);
          const body = await response.text();
          if (result === 'success') {
            expect(body).toContain('"success":true');
            expect(body).toContain('"backupCodes":[');
            expect(await storedRecoveryCodes()).not.toBe(before);
          } else {
            expect(body).toContain('"success":false');
            expect(body).toContain('INVALID_PASSWORD');
            expect(await storedRecoveryCodes()).toBe(before);
          }
          complete();
          await hold;
          await route.fulfill({ response });
        } catch (error) { fail(error); throw error; }
      });
      try {
        await dialog.getByLabel('كلمة المرور الحالية').fill(result === 'success' ? TEST_PASSWORD : 'WrongPass999!');
        await dialog.getByRole('button', { name: generateLabel, exact: true }).click();
        await committed;
        expect(intercepted).toBe(1);
        await expect(dialog.getByRole('button', { name: 'جارٍ التحقق...' })).toBeDisabled();
        await page.keyboard.press('Escape');
        await expect(dialog).not.toBeVisible();
        await expect(page.getByRole('button', { name: regenerateLabel, exact: true })).toBeFocused();
        await page.getByRole('button', { name: regenerateLabel, exact: true }).click();
        await expect(dialog.getByLabel('كلمة المرور الحالية')).toHaveValue('');
        const delivered = page.waitForResponse((response) => isRecoveryAction(response.request()));
        release();
        expect(await (await delivered).finished()).toBeNull();
        await waitForActionConsumption(page, 1);
        await expect(dialog.getByRole('alert')).toHaveCount(0);
        await expect(dialog.getByRole('button', { name: savedLabel })).toHaveCount(0);
        await expect(dialog.locator('[dir="ltr"]')).toHaveCount(0);
        await expect(dialog.getByLabel('كلمة المرور الحالية')).toHaveValue('');
      } finally { release(); await page.unroute('**/settings/security'); }
      // The next genuine action on the same client queue also proves the earlier
      // action completed and did not leave the modal stuck or stale.
      await dialog.getByLabel('كلمة المرور الحالية').fill(TEST_PASSWORD);
      await dialog.getByRole('button', { name: generateLabel, exact: true }).click();
      await expect(dialog.getByRole('button', { name: savedLabel })).toBeVisible();
      await expect(dialog.locator('[dir="ltr"] > div')).toHaveCount(10);
      await waitForActionConsumption(page, 2);
      await expect(dialog.getByRole('alert')).toHaveCount(0);
      await dialog.getByRole('button', { name: savedLabel }).click();
      await expect(dialog).not.toBeVisible();
    });
  }

  test('navigation after backend commit discards held recovery response', async ({ page }) => {
    await loginAndCompleteMfa(page);
    await page.goto('/settings/security');
    const before = await storedRecoveryCodes();
    let release!: () => void;
    const hold = new Promise<void>((resolve) => { release = resolve; });
    let complete!: () => void;
    let fail!: (error: unknown) => void;
    const committed = new Promise<void>((resolve, reject) => { complete = resolve; fail = reject; });
    let delivered!: () => void;
    const delivery = new Promise<void>((resolve) => { delivered = resolve; });
    await page.route('**/settings/security', async (route) => {
      if (!isRecoveryAction(route.request())) return route.continue();
      try {
        const response = await route.fetch();
        expect(response.status()).toBe(200);
        expect(await response.text()).toContain('"success":true');
        expect(await storedRecoveryCodes()).not.toBe(before);
        complete();
        await hold;
        await route.fulfill({ response }).catch((error: Error) => {
          expect(error.message).toMatch(/closed|cancel|invalid interception|target/i);
        });
        delivered();
      } catch (error) { fail(error); throw error; }
    });
    try {
      await page.getByRole('button', { name: regenerateLabel, exact: true }).click();
      await page.getByLabel('كلمة المرور الحالية').fill(TEST_PASSWORD);
      await page.getByRole('button', { name: generateLabel, exact: true }).click();
      await committed;
      await page.goto('/');
      release();
      await delivery;
    } finally { release(); await page.unroute('**/settings/security'); }
    await page.goto('/settings/security');
    await page.getByRole('button', { name: regenerateLabel, exact: true }).click();
    await expect(page.getByLabel('كلمة المرور الحالية')).toHaveValue('');
    await expect(page.getByRole('button', { name: savedLabel })).toHaveCount(0);
  });

  test('security dialog error and success reflow at 200% with keyboard focus and Escape', async ({ page }, testInfo) => {
    await loginAndCompleteMfa(page);
    await page.goto('/settings/security');
    const securityMain = page.getByTestId('main-content');
    await expect(securityMain).toBeVisible();
    await expect(securityMain).toHaveAttribute('dir', 'rtl');
    await page.evaluate(() => { document.documentElement.style.fontSize = '200%'; });
    await page.getByRole('button', { name: regenerateLabel, exact: true }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog.getByLabel('كلمة المرور الحالية')).toBeFocused();
    await dialog.getByLabel('كلمة المرور الحالية').fill('WrongPass999!');
    await dialog.getByRole('button', { name: generateLabel, exact: true }).click();
    await expect(dialog.getByRole('alert')).toContainText('كلمة المرور الحالية غير صحيحة');
    await assertDialogReflow(page, dialog);
    await page.screenshot({ path: 'work/t03-r14-fix/dialog-error-' + testInfo.project.name + '.png' });
    await page.keyboard.press('Escape');
    await expect(dialog).not.toBeVisible();
    await expect(page.getByRole('button', { name: regenerateLabel, exact: true })).toBeFocused();
    await page.getByRole('button', { name: regenerateLabel, exact: true }).click();
    await dialog.getByLabel('كلمة المرور الحالية').fill(TEST_PASSWORD);
    await dialog.getByRole('button', { name: generateLabel, exact: true }).click();
    await expect(dialog.getByRole('button', { name: savedLabel })).toBeVisible();
    await expect(dialog.locator('[dir="ltr"] > div')).toHaveCount(10);
    await assertDialogReflow(page, dialog);
    await page.screenshot({ path: 'work/t03-r14-fix/dialog-success-' + testInfo.project.name + '.png' });
    await page.keyboard.press('Escape');
    await expect(dialog).not.toBeVisible();
    await expect(page.getByRole('button', { name: regenerateLabel, exact: true })).toBeFocused();
  });
});

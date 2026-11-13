import { test, expect } from '@playwright/test';
import { hashPassword, symmetricEncrypt } from 'better-auth/crypto';
import { createOTP } from '@better-auth/utils/otp';
import { base32 } from '@better-auth/utils/base32';
import { randomUUID } from 'crypto';
import { createValidatedTestPool } from '../helpers/test-db';

const TEST_EMAIL = 'lawyer.e2e@office.eg';
const TEST_PASSWORD = 'E2EPassword2026!';
const TOTP_SECRET = 'SZ7CE4ZHNWC37XUUQ5S4HNQLL6SNJ6XT';
const BACKUP_CODE = 'bkp01-code2';

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

    const existing = await client.query('SELECT id FROM "user" WHERE email = $1', [TEST_EMAIL]);
    let userId: string;
    if (existing.rows.length === 0) {
      userId = randomUUID();
      await client.query(
        'INSERT INTO "user" (id, name, email, "emailVerified", role, "twoFactorEnabled", "createdAt", "updatedAt") VALUES ($1, $2, $3, true, $4, true, NOW(), NOW())',
        [userId, 'المحامي التجريبي', TEST_EMAIL, 'OWNER']
      );
      await client.query(
        'INSERT INTO "account" (id, "userId", "providerId", "accountId", password, "createdAt", "updatedAt") VALUES ($1, $2, $3, $4, $5, NOW(), NOW())',
        [randomUUID(), userId, 'credential', userId, hashedPassword]
      );
      await client.query(
        'INSERT INTO "twoFactor" (id, "userId", secret, "backupCodes", verified) VALUES ($1, $2, $3, $4, true)',
        [randomUUID(), userId, encryptedSecret, encryptedBackupCodes]
      );
    } else {
      userId = existing.rows[0].id;
      await client.query('UPDATE "account" SET password = $1 WHERE "userId" = $2', [
        hashedPassword,
        userId,
      ]);
      await client.query(
        'UPDATE "twoFactor" SET secret = $1, "backupCodes" = $2, verified = true WHERE "userId" = $3',
        [encryptedSecret, encryptedBackupCodes, userId]
      );
    }
  } finally {
    client.release();
    await pool.end();
  }
});

test.afterAll(async () => {
  // Scoped cleanup of owned synthetic E2E test data only (R07)
  const { pool } = createValidatedTestPool();
  const client = await pool.connect();
  try {
    const existing = await client.query('SELECT id FROM "user" WHERE email = $1', [TEST_EMAIL]);
    if (existing.rows.length > 0) {
      const userId = existing.rows[0].id;
      await client.query('DELETE FROM "twoFactor" WHERE "userId" = $1', [userId]);
      await client.query('DELETE FROM "session" WHERE "userId" = $1', [userId]);
      await client.query('DELETE FROM "account" WHERE "userId" = $1', [userId]);
      await client.query('DELETE FROM "user" WHERE id = $1', [userId]);
    }
  } finally {
    client.release();
    await pool.end();
  }
});


test.describe('LawOffice OS — Authentication & Security Journeys (T03)', () => {
  test('invalid login credentials display generic sanitized error without disclosing user existence', async ({ page }) => {
    await page.goto('/login');

    // Verify Arabic RTL layout requirements
    const mainEl = page.locator('main');
    await expect(mainEl).toHaveAttribute('dir', 'rtl');
    await expect(mainEl).toHaveAttribute('lang', 'ar-EG');

    await page.fill('#email', 'nonexistent.user@example.com');
    await page.fill('#password', 'WrongPassword123');
    await page.click('button[type="submit"]');

    const alert = page.locator('div[role="alert"]:not(#__next-route-announcer__)');
    await expect(alert).toBeVisible();
    await expect(alert).toContainText('البريد الإلكتروني أو كلمة المرور غير صحيحة');
  });

  test('direct unauthenticated request to protected security settings redirects to /login', async ({ page }) => {
    await page.goto('/settings/security');
    // Expect redirect to /login
    await page.waitForURL('**/login*');
    await expect(page.locator('h1')).toContainText('تسجيل الدخول');
  });

  test('responsive reflow verification across mobile, tablet, and desktop viewports', async ({ page }) => {
    const viewports = [
      { width: 390, height: 844 },
      { width: 768, height: 1024 },
      { width: 1440, height: 900 },
    ];

    for (const vp of viewports) {
      await page.setViewportSize(vp);
      await page.goto('/login');

      await expect(page.locator('#email')).toBeVisible();
      await expect(page.locator('#password')).toBeVisible();
      await expect(page.locator('button[type="submit"]')).toBeVisible();

      // Ensure no horizontal scrollbar overflow
      const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
      const clientWidth = await page.evaluate(() => document.documentElement.clientWidth);
      expect(scrollWidth).toBeLessThanOrEqual(clientWidth + 1);
    }
  });

  test('completes two-factor verification via single-use backup recovery code and enters security settings', async ({ page }) => {
    await page.goto('/login');
    await page.fill('#email', TEST_EMAIL);
    await page.fill('#password', TEST_PASSWORD);
    await page.click('button[type="submit"]');

    // Better Auth redirects to /verify because 2FA is enabled
    await page.waitForURL('**/verify*');
    await expect(page.locator('h1')).toContainText('التحقق الثنائي');

    // Switch to backup code tab
    await page.click('button:has-text("رمز استرداد للطوارئ")');

    // Enter single-use recovery code
    await page.fill('#backupCode', BACKUP_CODE);
    await page.click('button[type="submit"]');

    // On verification, navigates to root or protected page
    await page.waitForURL((url) => !url.pathname.includes('/verify') && !url.pathname.includes('/login'));

    // Navigate to security settings
    await page.goto('/settings/security');
    await expect(page.locator('h1')).toContainText('الأمان وإدارة الجلسات');
    await expect(page.locator('text=حالة الحماية: مفعلة ومحمية')).toBeVisible();
  });

  test('revocation of session from a second browser context evicts access', async ({ browser }) => {
    // Context A (Current session)
    const contextA = await browser.newContext();
    const pageA = await contextA.newPage();

    // Login Context A
    await pageA.goto('/login');
    await pageA.fill('#email', TEST_EMAIL);
    await pageA.fill('#password', TEST_PASSWORD);
    await pageA.click('button[type="submit"]');
    await pageA.waitForURL('**/verify*');
    await pageA.click('button:has-text("رمز استرداد للطوارئ")');
    await pageA.fill('#backupCode', 'bkp02-code3');
    await pageA.click('button[type="submit"]');
    await pageA.waitForURL((url) => !url.pathname.includes('/verify'));

    // Context B (Secondary device)
    const contextB = await browser.newContext();
    const pageB = await contextB.newPage();

    // Login Context B
    await pageB.goto('/login');
    await pageB.fill('#email', TEST_EMAIL);
    await pageB.fill('#password', TEST_PASSWORD);
    await pageB.click('button[type="submit"]');
    await pageB.waitForURL('**/verify*');
    await pageB.click('button:has-text("رمز استرداد للطوارئ")');
    await pageB.fill('#backupCode', 'bkp03-code4');
    await pageB.click('button[type="submit"]');
    await pageB.waitForURL((url) => !url.pathname.includes('/verify'));

    // Context B is on /settings/security
    await pageB.goto('/settings/security');
    await expect(pageB.locator('h1')).toContainText('الأمان وإدارة الجلسات');

    // In Context A, go to /settings/security and terminate all other sessions
    await pageA.goto('/settings/security');
    await expect(pageA.locator('h1')).toContainText('الأمان وإدارة الجلسات');

    const terminateOthersBtn = pageA.locator('button:has-text("إنهاء جميع الجلسات الأخرى")');
    if (await terminateOthersBtn.isVisible()) {
      pageA.once('dialog', (dialog) => dialog.accept());
      await terminateOthersBtn.click();
      await expect(pageA.locator('text=تم إنهاء')).toBeVisible();
    }

    // Now reload pageB in Context B: session was revoked, must redirect to /login
    await pageB.reload();
    await pageB.waitForURL('**/login*');
    await expect(pageB.locator('h1')).toContainText('تسجيل الدخول');

    await contextA.close();
    await contextB.close();
  });

  test('completes two-factor verification via RFC 6238 TOTP code and enters security settings (R01)', async ({ page }) => {
    await page.goto('/login');
    await page.fill('#email', TEST_EMAIL);
    await page.fill('#password', TEST_PASSWORD);
    await page.click('button[type="submit"]');

    await page.waitForURL('**/verify*');
    await expect(page.locator('h1')).toContainText('التحقق الثنائي');

    // Derive RFC 6238 TOTP code from the 20-byte decoded secret
    const clientSecretBytes = base32.decode(TOTP_SECRET.toUpperCase());
    const otpHelper = createOTP(clientSecretBytes, { period: 30, digits: 6 });
    const totpCode = await otpHelper.totp();

    await page.fill('#totpCode', totpCode);
    await page.click('button[type="submit"]');

    await page.waitForURL((url) => !url.pathname.includes('/verify') && !url.pathname.includes('/login'));

    await page.goto('/settings/security');
    await expect(page.locator('h1')).toContainText('الأمان وإدارة الجلسات');
    await expect(page.locator('text=حالة الحماية: مفعلة ومحمية')).toBeVisible();
  });

  test('password change in Context A evicts Context B sessions unconditionally (R04)', async ({ browser }) => {
    const contextA = await browser.newContext();
    const pageA = await contextA.newPage();

    // Login Context A
    await pageA.goto('/login');
    await pageA.fill('#email', TEST_EMAIL);
    await pageA.fill('#password', TEST_PASSWORD);
    await pageA.click('button[type="submit"]');
    await pageA.waitForURL('**/verify*');
    await pageA.click('button:has-text("رمز استرداد للطوارئ")');
    await pageA.fill('#backupCode', BACKUP_CODE);
    await pageA.click('button[type="submit"]');
    await pageA.waitForURL((url) => !url.pathname.includes('/verify'));

    // Login Context B
    const contextB = await browser.newContext();
    const pageB = await contextB.newPage();

    await pageB.goto('/login');
    await pageB.fill('#email', TEST_EMAIL);
    await pageB.fill('#password', TEST_PASSWORD);
    await pageB.click('button[type="submit"]');
    await pageB.waitForURL('**/verify*');
    await pageB.click('button:has-text("رمز استرداد للطوارئ")');
    await pageB.fill('#backupCode', 'bkp02-code3');
    await pageB.click('button[type="submit"]');
    await pageB.waitForURL((url) => !url.pathname.includes('/verify'));

    // Context B is on security settings
    await pageB.goto('/settings/security');
    await expect(pageB.locator('h1')).toContainText('الأمان وإدارة الجلسات');

    // Context A changes password
    const newPassword = 'NewSecretPassword2026!#';
    const pwChangeRes = await pageA.request.post('/api/auth/change-password', {
      data: {
        currentPassword: TEST_PASSWORD,
        newPassword: newPassword,
      },
    });
    expect(pwChangeRes.status()).toBe(200);

    // Context B is evicted upon next navigation / reload
    await pageB.reload();
    await pageB.waitForURL('**/login*');
    await expect(pageB.locator('h1')).toContainText('تسجيل الدخول');

    // Restore original password for clean teardown
    await pageA.request.post('/api/auth/change-password', {
      data: {
        currentPassword: newPassword,
        newPassword: TEST_PASSWORD,
      },
    });

    await contextA.close();
    await contextB.close();
  });

  test('direct navigation to /settings/security by MAINTAINER user renders access denied', async ({ page }) => {
    const { pool } = createValidatedTestPool();
    const client = await pool.connect();
    const maintainerEmail = 'maintainer.e2e@office.eg';
    const maintainerId = randomUUID();
    const hashedPassword = await hashPassword(TEST_PASSWORD);
    try {
      await client.query(
        'INSERT INTO "user" (id, name, email, "emailVerified", role, "twoFactorEnabled", "createdAt", "updatedAt") VALUES ($1, $2, $3, true, $4, false, NOW(), NOW())',
        [maintainerId, 'مسؤول الصيانة', maintainerEmail, 'MAINTAINER']
      );
      await client.query(
        'INSERT INTO "account" (id, "userId", "providerId", "accountId", password, "createdAt", "updatedAt") VALUES ($1, $2, $3, $4, $5, NOW(), NOW())',
        [randomUUID(), maintainerId, 'credential', maintainerId, hashedPassword]
      );
    } finally {
      client.release();
      await pool.end();
    }

    try {
      await page.goto('/login');
      await page.fill('#email', maintainerEmail);
      await page.fill('#password', TEST_PASSWORD);
      await page.click('button[type="submit"]');

      // Maintainer has no 2FA configured, navigates directly to app
      await page.waitForURL((url) => !url.pathname.includes('/login'));

      // Direct navigation to protected security settings
      await page.goto('/settings/security');
      await expect(page.locator('text=وصول مرفوض')).toBeVisible();
      await expect(page.locator('text=لا تمتلك الصلاحيات الكافية لإدارة إعدادات الأمان والجلسات')).toBeVisible();
    } finally {
      const { pool: p2 } = createValidatedTestPool();
      const c2 = await p2.connect();
      try {
        await c2.query('DELETE FROM "session" WHERE "userId" = $1', [maintainerId]);
        await c2.query('DELETE FROM "account" WHERE "userId" = $1', [maintainerId]);
        await c2.query('DELETE FROM "user" WHERE id = $1', [maintainerId]);
      } finally {
        c2.release();
        await p2.end();
      }
    }
  });

  test('keyboard accessibility: form submission via Enter key and logical focus flow', async ({ page }) => {
    await page.goto('/login');

    await page.focus('#email');
    await page.keyboard.type(TEST_EMAIL);
    await page.keyboard.press('Tab');

    await expect(page.locator('#password')).toBeFocused();
    await page.keyboard.type(TEST_PASSWORD);

    await page.keyboard.press('Enter');

    await page.waitForURL('**/verify*');
    await expect(page.locator('h1')).toContainText('التحقق الثنائي');
  });

  test('accessibility reflow and text scaling: 200% font zoom renders without horizontal scroll overflow (R10)', async ({ page }) => {
    await page.setViewportSize({ width: 720, height: 450 });
    await page.goto('/login');

    // Baseline font size inspection
    const baselineHeadingSize = await page.evaluate(() => {
      const h1 = document.querySelector('h1');
      return h1 ? parseFloat(window.getComputedStyle(h1).fontSize) : 24;
    });

    // Apply 200% text scaling via root style
    await page.evaluate(() => {
      document.documentElement.style.fontSize = '200%';
    });

    const scaledHeadingSize = await page.evaluate(() => {
      const h1 = document.querySelector('h1');
      return h1 ? parseFloat(window.getComputedStyle(h1).fontSize) : 48;
    });

    // Verify actual font size scaling occurred (at least 1.8x baseline to accommodate rounding)
    expect(scaledHeadingSize).toBeGreaterThanOrEqual(baselineHeadingSize * 1.8);

    await expect(page.locator('#email')).toBeVisible();
    await expect(page.locator('#password')).toBeVisible();
    await expect(page.locator('button[type="submit"]')).toBeVisible();

    const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
    const clientWidth = await page.evaluate(() => document.documentElement.clientWidth);
    expect(scrollWidth).toBeLessThanOrEqual(clientWidth + 1);
  });
});
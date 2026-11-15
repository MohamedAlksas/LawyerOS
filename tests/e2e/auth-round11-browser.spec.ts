import { test, expect, type Page } from '@playwright/test';
import { hashPassword, symmetricEncrypt } from 'better-auth/crypto';
import { createOTP } from '@better-auth/utils/otp';
import { base32 } from '@better-auth/utils/base32';
import { randomUUID, randomBytes } from 'crypto';
import { createValidatedTestPool, cleanupTrackedFixtures } from '../helpers/test-db';

const runId = `${Date.now()}.${randomUUID().slice(0, 8)}`;
const TEST_EMAIL = `lawyer.r11.${runId}@office.eg`;
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

    if (!testUserId) {
      testUserId = randomUUID();
      trackedFixtureUserIds.push(testUserId);
      await client.query(
        'INSERT INTO "user" (id, name, email, "emailVerified", role, "twoFactorEnabled", "createdAt", "updatedAt") VALUES ($1, $2, $3, true, $4, true, NOW(), NOW())',
        [testUserId, 'المحامي التجريبي للمرحلة 11', TEST_EMAIL, 'OWNER']
      );
      await client.query(
        'INSERT INTO "account" (id, "userId", "providerId", "accountId", password, "createdAt", "updatedAt") VALUES ($1, $2, $3, $4, $5, NOW(), NOW())',
        [randomUUID(), testUserId, 'credential', testUserId, hashedPassword]
      );
      await client.query(
        'INSERT INTO "twoFactor" (id, "userId", secret, "backupCodes", verified) VALUES ($1, $2, $3, $4, true)',
        [randomUUID(), testUserId, encryptedSecret, encryptedBackupCodes]
      );
    } else {
      await client.query('UPDATE "account" SET password = $1 WHERE "userId" = $2', [
        hashedPassword,
        testUserId,
      ]);
      await client.query(
        'UPDATE "twoFactor" SET secret = $1, "backupCodes" = $2, verified = true, "failedVerificationCount" = 0, "lockedUntil" = null WHERE "userId" = $3',
        [encryptedSecret, encryptedBackupCodes, testUserId]
      );
    }
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
  await page.fill('#email', TEST_EMAIL);
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

  test('Latin, Arabic-Indic, and Persian OTP input, leading zeroes, complete long/malformed/paste feedback and protected login', async ({ page, context }) => {
    // Grant clipboard permissions for genuine clipboard paste testing
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);

    await page.goto('/login');
    await page.fill('#email', TEST_EMAIL);
    await page.fill('#password', TEST_PASSWORD);
    await page.click('button[type="submit"]');

    await page.waitForURL('**/verify*');
    await expect(page.locator('h1')).toContainText('التحقق الثنائي');

    // 1. Malformed non-digit letters feedback
    await page.fill('#totpCode', 'abc123');
    await page.click('button[type="submit"]');
    let alert = page.locator('div[role="alert"]:not(#__next-route-announcer__)');
    await expect(alert).toBeVisible();
    await expect(alert).toContainText('رمز التحقق يجب أن يحتوي على أرقام فقط.');

    // 2. Too short feedback (< 6 digits)
    await page.fill('#totpCode', '123');
    await page.click('button[type="submit"]');
    alert = page.locator('div[role="alert"]:not(#__next-route-announcer__)');
    await expect(alert).toBeVisible();
    await expect(alert).toContainText('رمز التحقق غير مكتمل');

    // 3. Too long feedback (> 6 digits)
    await page.fill('#totpCode', '1234567');
    await page.click('button[type="submit"]');
    alert = page.locator('div[role="alert"]:not(#__next-route-announcer__)');
    await expect(alert).toBeVisible();
    await expect(alert).toContainText('رمز التحقق يجب ألا يتجاوز 6 أرقام.');

    // 4. Invalid 6-digit code feedback
    await page.fill('#totpCode', '999999');
    await page.click('button[type="submit"]');
    alert = page.locator('div[role="alert"]:not(#__next-route-announcer__)');
    await expect(alert).toBeVisible();
    await expect(alert).toContainText('رمز التحقق غير صحيح أو انتهت صلاحيته.');

    // 5. Deterministic genuine Base32 secret whose current window TOTP code starts with '0'
    let zeroSecretB32 = '';
    let leadingZeroTotp = '';
    for (let i = 0; i < 100; i++) {
      const raw = randomBytes(20);
      const b32 = base32.encode(raw).replace(/=/g, '');
      const otp = createOTP(raw, { period: 30, digits: 6 });
      const code = await otp.totp();
      if (code.startsWith('0')) {
        zeroSecretB32 = b32;
        leadingZeroTotp = code;
        break;
      }
    }
    expect(leadingZeroTotp.startsWith('0')).toBe(true);

    // Update user's twoFactor secret in PostgreSQL to the verified leading-zero secret
    const { pool, env } = createValidatedTestPool();
    const client = await pool.connect();
    try {
      const encryptedSecret = await symmetricEncrypt({
        key: env.BETTER_AUTH_SECRET,
        data: 'base32:' + zeroSecretB32,
      });
      await client.query(
        'UPDATE "twoFactor" SET secret = $1, verified = true, "failedVerificationCount" = 0, "lockedUntil" = null WHERE "userId" = $2',
        [encryptedSecret, testUserId]
      );
    } finally {
      client.release();
      await pool.end();
    }

    // 6. Test genuine clipboard paste via navigator.clipboard and native keyboard shortcut
    await page.locator('#totpCode').fill('');
    await page.evaluate((text) => navigator.clipboard.writeText(text), leadingZeroTotp);
    await page.locator('#totpCode').focus();
    const pasteKey = process.platform === 'darwin' ? 'Meta+v' : 'Control+v';
    await page.keyboard.press(pasteKey);
    await expect(page.locator('#totpCode')).toHaveValue(leadingZeroTotp);
    await expect(page.locator('text=6/6')).toBeVisible();

    // 7. Test Eastern Arabic-Indic numerals with leading zero (٠xxxxx)
    const easternArabicLeadingZero = leadingZeroTotp.replace(/\d/g, (d) =>
      String.fromCharCode(0x0660 + parseInt(d, 10))
    );
    expect(easternArabicLeadingZero.startsWith('٠')).toBe(true);
    await page.fill('#totpCode', easternArabicLeadingZero);
    await expect(page.locator('#totpCode')).toHaveValue(easternArabicLeadingZero);

    // 8. Test Persian numerals with leading zero (۰xxxxx) and authenticate
    const persianLeadingZero = leadingZeroTotp.replace(/\d/g, (d) =>
      String.fromCharCode(0x06f0 + parseInt(d, 10))
    );
    expect(persianLeadingZero.startsWith('۰')).toBe(true);
    await page.fill('#totpCode', persianLeadingZero);
    await page.click('button[type="submit"]');

    // Successfully authenticates and navigates to protected application
    await page.waitForURL((url: URL) => !url.pathname.includes('/verify') && !url.pathname.includes('/login'));

    await page.goto('/settings/security');
    await expect(page.locator('h1')).toContainText('الأمان وإدارة الجلسات');
  });

  test('committed generation response held across dismissal and reopen', async ({ page }) => {
    await loginAndCompleteMfa(page);

    await page.goto('/settings/security');
    await expect(page.locator('h1')).toContainText('الأمان وإدارة الجلسات');

    // 1. Test committed delayed success response across dismissal and reopen
    await page.click('button:has-text("إعادة توليد رموز الاسترداد")');
    const dialog = page.locator('div[role="dialog"]');
    await expect(dialog).toBeVisible();

    // Fill valid current password
    await page.fill('#currentPassword', TEST_PASSWORD);

    // Set up route interception barrier using route.fetch() to observe backend execution/commit
    let releaseBarrier: (() => void) | null = null;
    const responseBarrier = new Promise<void>((resolve) => {
      releaseBarrier = resolve;
    });

    await page.route('**/*', async (route) => {
      const req = route.request();
      const url = req.url();
      const isAction =
        req.method() === 'POST' &&
        (url.includes('/settings/security') || url.includes('generate-backup-codes'));
      if (isAction) {
        // Fetch real backend response first (observes backend execution and commit)
        const response = await route.fetch();
        // Hold response at barrier
        await responseBarrier;
        await route.fulfill({ response });
      } else {
        await route.continue().catch(() => {});
      }
    });

    // Actually submit the request to generate backup codes
    await page.click('button[type="submit"]:has-text("توليد رموز جديدة")');

    // While response is held in-flight at barrier, dismiss modal via Escape key
    await page.keyboard.press('Escape');
    await expect(dialog).not.toBeVisible();

    // Reopen modal
    await page.click('button:has-text("إعادة توليد رموز الاسترداد")');
    await expect(dialog).toBeVisible();

    // Assert modal is reset with empty password and enabled submit button
    await expect(page.locator('#currentPassword')).toHaveValue('');
    await expect(dialog.locator('button[type="submit"]:has-text("توليد رموز جديدة")')).toBeEnabled();

    // Release the held backend response
    if (releaseBarrier) {
      (releaseBarrier as () => void)();
    }
    await page.waitForTimeout(600);

    // Assert late response is discarded:
    // Zero recovery codes rendered (count === 0), no confirmation button rendered
    expect(await dialog.locator('button:has-text("تم الحفظ بنجاح، إغلاق النافذة")').count()).toBe(0);
    expect(await dialog.locator('code').count()).toBe(0);

    // 2. Test late expected error handling across dismissal and reopen
    await page.unroute('**/*');

    let releaseErrBarrier: (() => void) | null = null;
    const errorBarrier = new Promise<void>((resolve) => {
      releaseErrBarrier = resolve;
    });

    await page.route('**/*', async (route) => {
      const req = route.request();
      const url = req.url();
      const isAction =
        req.method() === 'POST' &&
        (url.includes('/settings/security') || url.includes('generate-backup-codes'));
      if (isAction) {
        const response = await route.fetch();
        await errorBarrier;
        await route.fulfill({ response });
      } else {
        await route.continue().catch(() => {});
      }
    });

    // Enter wrong password
    await page.fill('#currentPassword', 'WrongPass999!');
    await page.click('button[type="submit"]:has-text("توليد رموز جديدة")');

    // Dismiss modal while error response is held
    await page.keyboard.press('Escape');
    await expect(dialog).not.toBeVisible();

    // Reopen modal
    await page.click('button:has-text("إعادة توليد رموز الاسترداد")');
    await expect(dialog).toBeVisible();

    // Release error barrier
    if (releaseErrBarrier) {
      (releaseErrBarrier as () => void)();
    }
    await page.waitForTimeout(600);

    // Assert late error is discarded: no alert shown, password input is empty, and new attempt can be made
    expect(await dialog.locator('div[role="alert"]').count()).toBe(0);
    await expect(page.locator('#currentPassword')).toHaveValue('');
    await expect(dialog.locator('button[type="submit"]:has-text("توليد رموز جديدة")')).toBeEnabled();

    await page.unroute('**/*');
  });

  test('responsive reflow with focus containment, Escape key, and 200% text scaling across 1440px, 768px, and 390px viewports', async ({ page }) => {
    await loginAndCompleteMfa(page);

    const viewports = [
      { width: 1440, height: 900, name: 'desktop' },
      { width: 768, height: 1024, name: 'tablet' },
      { width: 390, height: 844, name: 'mobile' },
    ];

    for (const vp of viewports) {
      await page.setViewportSize({ width: vp.width, height: vp.height });
      await page.goto('/settings/security');
      await expect(page.locator('h1')).toContainText('الأمان وإدارة الجلسات');

      // Verify RTL layout attribute
      const mainEl = page.locator('main');
      await expect(mainEl).toHaveAttribute('dir', 'rtl');

      // Open the modal dialog
      await page.click('button:has-text("إعادة توليد رموز الاسترداد")');
      const dialog = page.locator('div[role="dialog"]');
      await expect(dialog).toBeVisible();

      // Test focus containment inside dialog (Tab cycling stays within dialog elements)
      await page.locator('#currentPassword').focus();
      for (let i = 0; i < 5; i++) {
        await page.keyboard.press('Tab');
        const isContained = await dialog.evaluate((el) => el.contains(document.activeElement));
        expect(isContained).toBe(true);
      }

      // Test Escape key dismisses the dialog
      await page.keyboard.press('Escape');
      await expect(dialog).not.toBeVisible();

      // Reopen dialog to test 200% text scaling on dialog, inputs, and error alerts
      await page.click('button:has-text("إعادة توليد رموز الاسترداد")');
      await expect(dialog).toBeVisible();

      // Trigger an error alert in modal
      await page.fill('#currentPassword', 'WrongPass123!');
      await page.click('button[type="submit"]:has-text("توليد رموز جديدة")');
      const alert = dialog.locator('div[role="alert"]');
      await expect(alert).toBeVisible();

      // Apply 200% text scaling on the security modal dialog
      await page.evaluate(() => {
        document.documentElement.style.fontSize = '200%';
      });
      await page.waitForTimeout(100);

      // Verify dialog and alert remain visible and properly reflowed without overflow clipping
      await expect(dialog).toBeVisible();
      await expect(alert).toBeVisible();
      await expect(dialog.locator('#currentPassword')).toBeVisible();
      await expect(dialog.locator('button[type="submit"]')).toBeVisible();

      // Reset zoom
      await page.evaluate(() => {
        document.documentElement.style.fontSize = '';
      });

      // Dismiss dialog
      await page.keyboard.press('Escape');
      await expect(dialog).not.toBeVisible();

      // Test 200% text scaling on login screen
      await page.goto('/login');
      await page.evaluate(() => {
        document.documentElement.style.fontSize = '200%';
      });

      // Verify zero horizontal scroll overflow blowout on login page
      const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
      const clientWidth = await page.evaluate(() => document.documentElement.clientWidth);
      expect(scrollWidth).toBeLessThanOrEqual(clientWidth + 1);

      await expect(page.locator('#email')).toBeVisible();
      await expect(page.locator('#password')).toBeVisible();
      await expect(page.locator('button[type="submit"]')).toBeVisible();

      // Reset zoom
      await page.evaluate(() => {
        document.documentElement.style.fontSize = '';
      });
    }
  });
});


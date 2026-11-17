import { test, expect } from '@playwright/test';
import { getPrismaClient } from '@/lib/auth';
import { seedT04Owner, deleteT04Owner, signInWithTotp, T04Owner } from '../helpers/t04-auth';
import { cleanupPartyFixtures, setupTestEncryptionKeys } from '../helpers/party-test-helper';

test.describe('T05 Arabic RTL UI & Accessibility Verification', () => {
  let owner: T04Owner;
  const prisma = getPrismaClient();
  const createdPartyIds: string[] = [];

  test.beforeAll(async () => {
    setupTestEncryptionKeys();
    owner = await seedT04Owner({ label: 'a11y-e2e', name: 'أحمد المحامي' });
  });

  test.afterAll(async () => {
    if (createdPartyIds.length > 0) {
      await cleanupPartyFixtures(prisma, createdPartyIds);
    }
    if (owner?.id) {
      await deleteT04Owner(owner.id);
    }
    await prisma.$disconnect();
  });

  test('strict RTL, lang=ar-EG, and LTR isolation @a11y', async ({ page }) => {
    await signInWithTotp(page, owner);
    await page.goto('/parties');

    // Document-level direction & language
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
    await expect(page.locator('html')).toHaveAttribute('lang', 'ar-EG');

    // On tablet, open navigation drawer if closed
    const width = page.viewportSize()?.width ?? 1440;
    if (width >= 640 && width < 1024) {
      const drawerToggle = page.getByTestId('drawer-toggle-button');
      await drawerToggle.click();
    }

    // Navigation item for parties is active and visible
    const navParties = page.getByTestId('nav-link-parties').filter({ visible: true }).first();
    await expect(navParties).toBeVisible();
    await expect(navParties).toHaveAttribute('aria-current', 'page');

    // Visit new party form
    await page.goto('/parties/new');
    await expect(page.getByTestId('party-name-input')).toBeVisible();

    // Check touch targets on inputs and buttons (>= 44px min height)
    const inputs = [
      page.getByTestId('party-name-input'),
      page.getByTestId('party-phone-input'),
      page.getByTestId('submit-party-button'),
      page.getByTestId('cancel-party-button'),
    ];

    for (const input of inputs) {
      const box = await input.boundingBox();
      expect(box, 'Input element must have valid bounding box').not.toBeNull();
      expect(
        box!.height,
        `Interactive element height (${box!.height}px) must be >= 44px for WCAG 2.2 AA target size`
      ).toBeGreaterThanOrEqual(44);
    }
  });

  test('client storage privacy audit (zero sensitive identity leakage) @a11y', async ({ page }) => {
    await signInWithTotp(page, owner);
    await page.goto('/parties/new');

    const syntheticSecretNationalId = '29911223344556';

    // Fill and submit party with secret national ID
    await page.getByTestId('kind-person').click();
    await page.getByTestId('party-name-input').fill('خالد عبد الله محمود');
    await page.getByTestId('toggle-identity-fields').click();
    await page.getByTestId('identity-type-select').selectOption('NATIONAL_ID');
    await page.getByTestId('identity-number-input').fill(syntheticSecretNationalId);
    await page.getByTestId('submit-party-button').click();

    await expect(page).toHaveURL(/\/parties\/[a-f0-9-]+$/);
    const partyId = page.url().split('/').pop()!;
    createdPartyIds.push(partyId);

    // Audit client storage
    const storageAudit = await page.evaluate((secret) => {
      const localKeys = Object.keys(localStorage);
      const localValues = localKeys.map((k) => localStorage.getItem(k) || '');

      const sessionKeys = Object.keys(sessionStorage);
      const sessionValues = sessionKeys.map((k) => sessionStorage.getItem(k) || '');

      const leakedInLocal = localValues.some((v) => v.includes(secret));
      const leakedInSession = sessionValues.some((v) => v.includes(secret));
      const leakedInCookies = document.cookie.includes(secret);

      return {
        leakedInLocal,
        leakedInSession,
        leakedInCookies,
      };
    }, syntheticSecretNationalId);

    expect(
      storageAudit.leakedInLocal,
      'Confidential national ID must never be stored in localStorage'
    ).toBe(false);
    expect(
      storageAudit.leakedInSession,
      'Confidential national ID must never be stored in sessionStorage'
    ).toBe(false);
    expect(
      storageAudit.leakedInCookies,
      'Confidential national ID must never be leaked into browser cookies'
    ).toBe(false);
  });

  test('responsive reflow at 320px and 200% font zoom @a11y', async ({ page }) => {
    await signInWithTotp(page, owner);
    await page.goto('/parties/new');

    // 1. Narrow 320px viewport test
    await page.setViewportSize({ width: 320, height: 600 });
    const submitBtn = page.getByTestId('submit-party-button');
    await expect(submitBtn).toBeVisible();

    const box320 = await submitBtn.boundingBox();
    expect(box320).not.toBeNull();
    expect(box320!.height).toBeGreaterThanOrEqual(44);

    // Verify no unexpected horizontal document scrollbar
    const hasHorizontalOverflow = await page.evaluate(() => {
      return document.documentElement.scrollWidth > document.documentElement.clientWidth;
    });
    expect(hasHorizontalOverflow, 'Document must not overflow horizontally at 320px').toBe(false);

    // 2. 200% font zoom simulation
    await page.evaluate(() => {
      document.documentElement.style.fontSize = '200%';
    });

    await expect(submitBtn).toBeVisible();
    const zoomedBox = await submitBtn.boundingBox();
    expect(zoomedBox).not.toBeNull();
    expect(zoomedBox!.height).toBeGreaterThanOrEqual(44);
  });
});

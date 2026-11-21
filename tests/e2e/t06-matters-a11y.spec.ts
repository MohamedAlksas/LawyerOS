import { test, expect } from '@playwright/test';
import { getPrismaClient } from '@/lib/auth';
import { seedT04Owner, deleteT04Owner, signInWithTotp, T04Owner } from '../helpers/t04-auth';
import { cleanupMatterFixtures } from '../helpers/matter-test-helper';

test.describe('T06 Matters Accessibility, RTL & Viewport Ergonomics @a11y', () => {
  let owner: T04Owner;
  const prisma = getPrismaClient();
  const createdMatterIds: string[] = [];

  test.beforeAll(async () => {
    owner = await seedT04Owner({ label: 'matters-a11y-e2e', name: 'أحمد المحامي' });

    // Seed one matter with fileCode
    const matter = await prisma.matter.create({
      data: {
        fileCode: '2026/7777',
        title: 'دعوى اختبار المعايير وإمكانية الوصول الرقمي',
        kind: 'LITIGATION',
        status: 'ACTIVE',
        createdById: owner.id,
        updatedById: owner.id,
      },
    });
    createdMatterIds.push(matter.id);
  });

  test.afterAll(async () => {
    if (createdMatterIds.length > 0) {
      await cleanupMatterFixtures(prisma, createdMatterIds);
    }
    if (owner?.id) {
      await deleteT04Owner(owner.id);
    }
  });

  test('verifies strict RTL attributes and BDI isolation @matters @a11y', async ({
    page,
  }) => {
    test.setTimeout(90_000);
    await signInWithTotp(page, owner);

    await page.goto('/matters');
    await expect(page).toHaveURL(/\/matters/);

    // Document-level direction and language
    const htmlDir = await page.getAttribute('html', 'dir');
    const htmlLang = await page.getAttribute('html', 'lang');
    expect(htmlDir).toBe('rtl');
    expect(htmlLang).toBe('ar-EG');

    // BDI isolation for fileCode (select the visible instance across responsive breakpoints)
    const bdiLocator = page.locator('bdi[dir="ltr"]:visible').filter({ hasText: '2026/7777' });
    await expect(bdiLocator).toBeVisible();
  });

  test('responsive behavior across 1440px desktop, 768px tablet, 390px mobile, and 320px reflow @matters @a11y', async ({
    page,
  }) => {
    test.setTimeout(120_000);
    await signInWithTotp(page, owner);

    // 1. Desktop 1440px
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/matters');
    await expect(page.getByTestId('desktop-sidebar')).toBeVisible();
    await expect(page.getByTestId('matters-table')).toBeVisible();

    // Verify desktop active link
    const desktopMattersLink = page.getByTestId('desktop-sidebar').getByTestId('nav-link-matters');
    await expect(desktopMattersLink).toBeVisible();
    await expect(desktopMattersLink).toHaveAttribute('aria-current', 'page');

    // 2. Tablet 768px
    await page.setViewportSize({ width: 768, height: 1024 });
    await expect(page.getByTestId('desktop-sidebar')).toBeHidden();

    // 3. Mobile 390px
    await page.setViewportSize({ width: 390, height: 844 });
    await expect(page.getByTestId('mobile-bottom-nav')).toBeVisible();

    // Verify mobile navigation has matters link
    const mobileMattersLink = page.getByTestId('mobile-bottom-nav').getByTestId('nav-link-matters');
    await expect(mobileMattersLink).toBeVisible();
    await expect(mobileMattersLink).toHaveAttribute('aria-current', 'page');
    await expect(mobileMattersLink).toHaveAccessibleName(/الملفات/);
    const touchBounds = await mobileMattersLink.boundingBox();
    expect(touchBounds?.height).toBeGreaterThanOrEqual(44);
    expect(touchBounds?.width).toBeGreaterThanOrEqual(44);

    // Verify mobile cards visible, desktop table hidden
    await expect(page.getByTestId('matters-table')).toBeHidden();
    await expect(page.locator('[data-testid^="matter-card-"]').first()).toBeVisible();

    // 4. 320px Reflow Check (WCAG SC 1.4.10)
    await page.setViewportSize({ width: 320, height: 568 });
    const hasHorizontalOverflow = await page.evaluate(() => {
      return document.documentElement.scrollWidth > window.innerWidth;
    });
    expect(hasHorizontalOverflow).toBe(false);

    const longTitle = `ملف ${'اختبارA12'.repeat(18)}`;
    await prisma.matter.update({ where: { id: createdMatterIds[0] }, data: { title: longTitle } });
    try {
      await page.reload();
      await page.addStyleTag({ content: 'html { font-size: 200% !important; }' });
      const card = page.getByTestId(`matter-card-${createdMatterIds[0]}`);
      const title = card.getByRole('link', { name: longTitle, exact: true });
      await expect(title).toBeVisible();
      await title.focus();
      await expect(title).toBeFocused();
      const contrast = await title.evaluate((element) => {
        const luminance = (color: string) => {
          const channels = Array.from(color.matchAll(/\d+/g)).slice(0, 3).map(([value]) => Number(value) / 255);
          return channels.reduce((total, channel, index) => total + [0.2126, 0.7152, 0.0722][index]
            * (channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4), 0);
        };
        const foreground = luminance(getComputedStyle(element).color);
        const background = luminance(getComputedStyle(element.closest('[data-testid^="matter-card-"]')!).backgroundColor);
        return (Math.max(foreground, background) + 0.05) / (Math.min(foreground, background) + 0.05);
      });
      expect(contrast).toBeGreaterThanOrEqual(4.5);
      expect(await title.evaluate((element) => {
        const cardBounds = element.closest<HTMLElement>('[data-testid^="matter-card-"]')!.getBoundingClientRect();
        const textRange = document.createRange();
        textRange.selectNodeContents(element);
        return Array.from(textRange.getClientRects()).every((line) =>
          line.left >= cardBounds.left - 1 && line.right <= cardBounds.right + 1
        );
      })).toBe(true);
      await test.info().attach('320px reflow at 200% text size', {
        body: await page.screenshot(), contentType: 'image/png',
      });
    } finally {
      await prisma.matter.update({
        where: { id: createdMatterIds[0] },
        data: { title: 'دعوى اختبار المعايير وإمكانية الوصول الرقمي' },
      });
    }
  });

  test('keyboard accessibility and visible focus indication @matters @a11y', async ({
    page,
  }) => {
    test.setTimeout(90_000);
    await signInWithTotp(page, owner);

    await page.goto('/matters/new');
    await expect(page).toHaveURL(/\/matters\/new/);

    // Focus the title input
    const titleInput = page.getByTestId('matter-title-input');
    await titleInput.focus();
    await expect(titleInput).toBeFocused();

    // Tab into kind select
    await page.keyboard.press('Tab');
    const kindSelect = page.getByTestId('matter-kind-select');
    await expect(kindSelect).toBeFocused();
  });
});


import { test, expect } from '../helpers/t04-fixtures';
import { T04_COPY, T04_ROUTES, T04_TEST_IDS } from '../helpers/t04-constants';
import {
  expectShellReady,
  expectVisibleFocus,
  expectWcagContrast,
  tabThrough,
  tabToTestId,
} from '../helpers/t04-layout';

/**
 * T04-04 — landmarks, keyboard order, drawer focus management and contrast.
 *
 * Contrast is measured from computed styles on the rendered shell, not from the
 * token table alone. Focus rings are verified after real Tab presses because
 * `:focus-visible` is the contract's keyboard affordance.
 */

test('required landmarks and the skip link target exist @desktop', async ({ t04Page: page }) => {
  await page.goto(T04_ROUTES.home);
  await expectShellReady(page);

  await expect(page.getByRole('banner')).toBeVisible();
  const header = page.getByTestId(T04_TEST_IDS.appHeader);
  await expect(header).toBeVisible();
  await expect(header).toHaveAttribute('role', 'banner');
  await expect(page.getByRole('main')).toHaveCount(1);

  await expect(page.getByTestId(T04_TEST_IDS.desktopSidebar)).toBeVisible();
  await expect(page.getByTestId(T04_TEST_IDS.desktopNav)).toBeVisible();

  const main = page.getByTestId(T04_TEST_IDS.mainContent);
  await expect(main).toHaveAttribute('id', 'main-content');
  await expect(main).toHaveAttribute('role', 'main');

  const skip = page.getByTestId(T04_TEST_IDS.skipLink);
  await expect(skip).toHaveAttribute('href', '#main-content');

  const primaryNavs = page.getByRole('navigation', { name: T04_COPY.desktopNavLabel });
  const navCount = await primaryNavs.count();
  expect(navCount, 'Desktop navigation landmark is missing').toBeGreaterThanOrEqual(1);
  if (navCount > 1) {
    test.info().annotations.push({
      type: 'contract-ambiguity',
      description: `The contract specifies both the desktop sidebar and the inner desktop nav with aria-label="${T04_COPY.desktopNavLabel}", producing ${navCount} navigation landmarks with the same accessible name. This is recorded rather than failed because the contract itself prescribes both labels.`,
    });
  }

  const badge = page.getByTestId(T04_TEST_IDS.userIdentityBadge);
  await expect(badge).toBeVisible();
  await expect(badge).toHaveAttribute('aria-label', 'حساب المستخدم');

  await expect(page.getByTestId(T04_TEST_IDS.mobileBottomNav)).toBeHidden();
});

test('skip link is first and moves focus to main content @desktop', async ({ t04Page: page }) => {
  await page.goto(T04_ROUTES.home);
  await expectShellReady(page);

  await page.keyboard.press('Tab');
  const skip = page.getByTestId(T04_TEST_IDS.skipLink);
  await expect(skip).toBeFocused();
  await expectVisibleFocus(page, skip);

  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/#main-content$/);
  await expect(page.getByTestId(T04_TEST_IDS.mainContent)).toBeInViewport();
});

test('keyboard tab order reaches navigation with visible focus @desktop', async ({
  t04Page: page,
}) => {
  await page.goto(T04_ROUTES.home);
  await expectShellReady(page);

  const stops = (await tabThrough(page, 24)).filter(
    (stop) => stop.tagName !== 'body' && stop.tagName !== 'html'
  );
  expect(stops.length, 'No keyboard stops were recorded').toBeGreaterThanOrEqual(4);
  expect(stops[0]?.testId, 'The skip link must be the first tab stop').toBe(
    T04_TEST_IDS.skipLink
  );

  for (const stop of stops) {
    expect(
      stop.hasVisibleIndicator,
      `Tab stop "${stop.accessibleHint}" (${stop.tagName}) has no visible focus indicator: outline="${stop.outline}", box-shadow="${stop.boxShadow}"`
    ).toBe(true);
  }

  const reachedHome = stops.some((stop) => stop.testId === T04_TEST_IDS.navHome);
  const reachedSecurity = stops.some((stop) => stop.testId === T04_TEST_IDS.navSecurity);
  expect(reachedHome, 'Tab order never reaches the home navigation link').toBe(true);
  expect(reachedSecurity, 'Tab order never reaches the security navigation link').toBe(true);
});

test('navigation links show the contract focus ring after keyboard focus @desktop', async ({
  t04Page: page,
}) => {
  await page.goto(T04_ROUTES.home);
  await expectShellReady(page);

  const reached = await tabToTestId(page, T04_TEST_IDS.navHome);
  expect(reached, 'Home navigation link is unreachable by Tab').toBe(true);

  const home = page.getByTestId(T04_TEST_IDS.navHome).filter({ visible: true });
  await expectVisibleFocus(page, home);
});

test('primary text and navigation meet WCAG AA contrast @desktop', async ({ t04Page: page }) => {
  await page.goto(T04_ROUTES.home);
  await expectShellReady(page);

  const heading = page.getByRole('heading', { level: 1 });
  await expectWcagContrast(heading);

  const emptyState = page.getByTestId(T04_TEST_IDS.emptyState);
  await expect(emptyState).toBeVisible();
  await expectWcagContrast(emptyState);

  const action = page.getByTestId(T04_TEST_IDS.emptyStateSecurityAction);
  await expect(action).toBeVisible();
  await expectWcagContrast(action);

  const navHome = page.getByTestId(T04_TEST_IDS.navHome).filter({ visible: true });
  await expectWcagContrast(navHome);

  const badge = page.getByTestId(T04_TEST_IDS.userIdentityBadge);
  await expectWcagContrast(badge);
});

test('drawer traps focus, closes on Escape and restores focus @tablet', async ({
  t04Page: page,
}) => {
  await page.goto(T04_ROUTES.home);
  await expectShellReady(page);

  const toggle = page.getByTestId(T04_TEST_IDS.drawerToggle);
  const drawer = page.getByTestId(T04_TEST_IDS.tabletDrawer);
  await toggle.focus();
  await toggle.click();
  await expect(drawer).toBeVisible();

  const focusIsInside = async (): Promise<boolean> =>
    drawer.evaluate((element) => element.contains(document.activeElement));
  expect(await focusIsInside(), 'Opening the drawer must move focus into the dialog').toBe(true);

  for (let step = 0; step < 8; step += 1) {
    await page.keyboard.press('Tab');
    expect(
      await focusIsInside(),
      `Tab ${step + 1} escaped the open drawer dialog`
    ).toBe(true);
  }

  for (let step = 0; step < 4; step += 1) {
    await page.keyboard.press('Shift+Tab');
    expect(
      await focusIsInside(),
      `Shift+Tab ${step + 1} escaped the open drawer dialog`
    ).toBe(true);
  }

  await page.keyboard.press('Escape');
  await expect(drawer).toBeHidden();
  await expect(toggle).toBeFocused();
  await expect(toggle).toHaveAttribute('aria-expanded', 'false');
});

test('drawer close button and backdrop both dismiss and restore focus @tablet', async ({
  t04Page: page,
}) => {
  await page.goto(T04_ROUTES.home);
  await expectShellReady(page);

  const toggle = page.getByTestId(T04_TEST_IDS.drawerToggle);
  const drawer = page.getByTestId(T04_TEST_IDS.tabletDrawer);
  const backdrop = page.getByTestId(T04_TEST_IDS.drawerBackdrop);
  const close = page.getByTestId(T04_TEST_IDS.drawerClose);

  await toggle.click();
  await expect(drawer).toBeVisible();
  await expect(backdrop).toHaveAttribute('aria-hidden', 'true');
  await close.click();
  await expect(drawer).toBeHidden();
  await expect(toggle).toBeFocused();

  await toggle.click();
  await expect(drawer).toBeVisible();
  const backdropBox = await backdrop.boundingBox();
  const drawerBox = await drawer.boundingBox();
  expect(backdropBox, 'Drawer backdrop must render a box').not.toBeNull();
  expect(drawerBox, 'Drawer must render a box').not.toBeNull();

  const drawerCentre = drawerBox!.x + drawerBox!.width / 2;
  const backdropCentre = backdropBox!.x + backdropBox!.width / 2;
  const clickX =
    drawerCentre > backdropCentre ? backdropBox!.x + 8 : backdropBox!.x + backdropBox!.width - 8;
  await page.mouse.click(clickX, backdropBox!.y + backdropBox!.height / 2);

  await expect(drawer).toBeHidden();
  await expect(toggle).toBeFocused();
});

test('mobile bottom navigation exposes accessible link names @mobile', async ({
  t04Page: page,
}) => {
  await page.goto(T04_ROUTES.home);
  await expectShellReady(page);

  const bottomNav = page.getByRole('navigation', { name: T04_COPY.bottomNavLabel });
  await expect(bottomNav).toHaveCount(1);
  await expect(bottomNav).toBeVisible();

  const homeLink = bottomNav.getByTestId(T04_TEST_IDS.navHome);
  const securityLink = bottomNav.getByTestId(T04_TEST_IDS.navSecurity);
  // The contract names the destination "الرئيسية / اليوم"; either Arabic label
  // satisfies it, and the test id remains the stable selector.
  await expect(homeLink).toHaveAccessibleName(/الرئيسية|اليوم/);
  await expect(securityLink).toHaveAccessibleName(/إعدادات الأمان/);
});

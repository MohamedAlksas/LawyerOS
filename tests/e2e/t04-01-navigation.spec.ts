import { test, expect } from '../helpers/t04-fixtures';
import {
  T04_ALLOWED_NAV_HREFS,
  T04_FORBIDDEN_MODULE_ROUTES,
  T04_ROUTES,
  T04_TEST_IDS,
} from '../helpers/t04-constants';
import {
  expectNoPageOverflow,
  expectShellReady,
  expectTouchTarget,
  shellModeForViewport,
} from '../helpers/t04-layout';

/**
 * T04-01 — responsive navigation shell at the three contract viewports.
 *
 * Project tags keep each assertion at its intended width:
 *   @desktop -> 1440 project, @tablet -> 768 project, @mobile -> 390 project,
 *   @shell -> adaptive test executed in all three projects.
 */

function viewportWidth(): number {
  const width = test.info().project.use.viewport?.width;
  if (!width) throw new Error('T04 project must define a viewport');
  return width;
}

async function openNavigationIfTablet(page: import('@playwright/test').Page): Promise<void> {
  if (shellModeForViewport(viewportWidth()) === 'tablet') {
    await page.getByTestId(T04_TEST_IDS.drawerToggle).click();
    await expect(page.getByTestId(T04_TEST_IDS.tabletDrawer)).toBeVisible();
  }
}

test('desktop shell fixes a 232px sidebar to the right edge @desktop', async ({ t04Page: page }) => {
  await page.goto(T04_ROUTES.home);
  await expectShellReady(page);

  const sidebar = page.getByTestId(T04_TEST_IDS.desktopSidebar);
  await expect(sidebar).toBeVisible();

  const box = await sidebar.boundingBox();
  expect(box, 'Desktop sidebar must render a box').not.toBeNull();
  expect(Math.abs(box!.width - 232), `Sidebar width is ${box!.width}px`).toBeLessThanOrEqual(2);

  const rightGap = await sidebar.evaluate(
    (element) => document.documentElement.clientWidth - element.getBoundingClientRect().right
  );
  expect(rightGap, 'Desktop sidebar must sit against the inline-end edge').toBeLessThanOrEqual(2);

  const position = await sidebar.evaluate((element) => getComputedStyle(element).position);
  expect(position, 'The contract specifies a fixed desktop sidebar').toBe('fixed');

  await expect(page.getByTestId(T04_TEST_IDS.mobileBottomNav)).toBeHidden();
});

test('tablet drawer is a labelled modal tied to its trigger @tablet', async ({ t04Page: page }) => {
  await page.goto(T04_ROUTES.home);
  await expectShellReady(page);

  await expect(page.getByTestId(T04_TEST_IDS.desktopSidebar)).toBeHidden();

  const toggle = page.getByTestId(T04_TEST_IDS.drawerToggle);
  await expect(toggle).toBeVisible();
  await expect(toggle).toHaveAttribute('type', 'button');
  await expect(toggle).toHaveAttribute('aria-expanded', 'false');
  await expect(toggle).toHaveAttribute('aria-controls', 'tablet-drawer');
  await expect(toggle).toHaveAttribute('aria-label', 'فتح القائمة');
  await expect(page.getByTestId(T04_TEST_IDS.tabletDrawer)).toBeHidden();

  await toggle.click();

  const drawer = page.getByTestId(T04_TEST_IDS.tabletDrawer);
  await expect(drawer).toBeVisible();
  await expect(drawer).toHaveAttribute('role', 'dialog');
  await expect(drawer).toHaveAttribute('aria-modal', 'true');
  await expect(drawer).toHaveAttribute('id', 'tablet-drawer');
  await expect(drawer).toHaveAttribute('aria-label', 'قائمة التنقل');
  await expect(toggle).toHaveAttribute('aria-expanded', 'true');
  await expect(page.getByTestId(T04_TEST_IDS.drawerBackdrop)).toBeVisible();

  await expect(drawer.getByTestId(T04_TEST_IDS.navHome)).toBeVisible();
  await expect(drawer.getByTestId(T04_TEST_IDS.navSecurity)).toBeVisible();

  await page.getByTestId(T04_TEST_IDS.drawerClose).click();
  await expect(drawer).toBeHidden();
  await expect(toggle).toHaveAttribute('aria-expanded', 'false');
});

test('mobile shell uses a fixed bottom navigation bar @mobile', async ({ t04Page: page }) => {
  await page.goto(T04_ROUTES.home);
  await expectShellReady(page);
  await expectNoPageOverflow(page);

  const bottomNav = page.getByTestId(T04_TEST_IDS.mobileBottomNav);
  await expect(bottomNav).toBeVisible();
  await expect(bottomNav).toHaveAttribute('role', 'navigation');
  await expect(bottomNav).toHaveAttribute('aria-label', 'التنقل السفلي');

  const position = await bottomNav.evaluate((element) => getComputedStyle(element).position);
  expect(position).toBe('fixed');

  const bottomGap = await bottomNav.evaluate(
    (element) => document.documentElement.clientHeight - element.getBoundingClientRect().bottom
  );
  expect(bottomGap, 'Bottom navigation must be pinned to the viewport bottom').toBeLessThanOrEqual(
    2
  );

  await expect(page.getByTestId(T04_TEST_IDS.desktopSidebar)).toBeHidden();
  await expect(bottomNav.getByTestId(T04_TEST_IDS.navHome)).toBeVisible();
  await expect(bottomNav.getByTestId(T04_TEST_IDS.navSecurity)).toBeVisible();
  await expectTouchTarget(bottomNav.getByTestId(T04_TEST_IDS.navHome));
  await expectTouchTarget(bottomNav.getByTestId(T04_TEST_IDS.navSecurity));
});

test('visible navigation targets only available routes @shell', async ({ t04Page: page }) => {
  await page.goto(T04_ROUTES.home);
  await expectShellReady(page);
  await openNavigationIfTablet(page);

  const mode = shellModeForViewport(viewportWidth());
  const container =
    mode === 'desktop'
      ? page.getByTestId(T04_TEST_IDS.desktopSidebar)
      : mode === 'tablet'
        ? page.getByTestId(T04_TEST_IDS.tabletDrawer)
        : page.getByTestId(T04_TEST_IDS.mobileBottomNav);

  await expect(container).toBeVisible();

  const links = container.locator('a');
  const linkCount = await links.count();
  expect(linkCount, 'Navigation must expose at least a home link').toBeGreaterThan(0);

  for (let index = 0; index < linkCount; index += 1) {
    const href = await links.nth(index).getAttribute('href');
    expect(href, `Navigation link ${index} has no href`).not.toBeNull();
    const path = new URL(href!, 'http://t04.invalid').pathname;
    expect(
      T04_ALLOWED_NAV_HREFS,
      `Navigation link "${href}" points outside the available T04 routes`
    ).toContain(path);
  }

  // No visible anchor anywhere in the shell may pretend to open an unbuilt module.
  const visibleAnchors = page.locator('a').filter({ visible: true });
  const anchorCount = await visibleAnchors.count();
  for (let index = 0; index < anchorCount; index += 1) {
    const href = await visibleAnchors.nth(index).getAttribute('href');
    if (!href) continue;
    const path = new URL(href, 'http://t04.invalid').pathname;
    expect(
      T04_FORBIDDEN_MODULE_ROUTES,
      `The shell exposes a dummy link to unbuilt module "${path}"`
    ).not.toContain(path);
  }
});

test('active navigation state follows the current route @shell', async ({ t04Page: page }) => {
  await page.goto(T04_ROUTES.security);
  await openNavigationIfTablet(page);

  const securityLinks = page.getByTestId(T04_TEST_IDS.navSecurity).filter({ visible: true });
  await expect(securityLinks).toHaveCount(1);
  await expect(securityLinks).toHaveAttribute('aria-current', 'page');

  const homeLinks = page.getByTestId(T04_TEST_IDS.navHome).filter({ visible: true });
  await expect(homeLinks).toHaveCount(1);
  await expect(homeLinks).not.toHaveAttribute('aria-current', 'page');

  await page.goto(T04_ROUTES.home);
  await openNavigationIfTablet(page);

  const homeOnHome = page.getByTestId(T04_TEST_IDS.navHome).filter({ visible: true });
  await expect(homeOnHome).toHaveCount(1);
  await expect(homeOnHome).toHaveAttribute('aria-current', 'page');

  const securityOnHome = page.getByTestId(T04_TEST_IDS.navSecurity).filter({ visible: true });
  await expect(securityOnHome).toHaveCount(1);
  await expect(securityOnHome).not.toHaveAttribute('aria-current', 'page');
});

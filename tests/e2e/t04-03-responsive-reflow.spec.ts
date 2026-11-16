import { test, expect } from '../helpers/t04-fixtures';
import { T04_ROUTES, T04_TEST_IDS } from '../helpers/t04-constants';
import {
  expectNoElementOverflow,
  expectNoPageOverflow,
  expectShellReady,
  expectTouchTarget,
  nextPaint,
} from '../helpers/t04-layout';

/**
 * T04-03 — responsive reflow and 200% text scaling.
 *
 * One test drives all three contract widths explicitly, so the measurements are
 * comparable and the suite does not triple the work by running the same matrix
 * once per project. `html { font-size: 200% }` is the text-resize stimulus from
 * WCAG 1.4.4; no zoom or device emulation is involved.
 */

const VIEWPORTS = [
  { label: 'mobile 390', width: 390, height: 844 },
  { label: 'tablet 768', width: 768, height: 1024 },
  { label: 'desktop 1440', width: 1440, height: 900 },
] as const;

const NAV_CONTROL_SELECTOR = [
  `[data-testid="${T04_TEST_IDS.desktopSidebar}"] a`,
  `[data-testid="${T04_TEST_IDS.desktopSidebar}"] button`,
  `[data-testid="${T04_TEST_IDS.mobileBottomNav}"] a`,
  `[data-testid="${T04_TEST_IDS.mobileBottomNav}"] button`,
  `[data-testid="${T04_TEST_IDS.drawerToggle}"]`,
].join(', ');

test('shell reflows at 390, 768 and 1440 without horizontal clipping @matrix', async ({
  t04Page: page,
}) => {
  for (const viewport of VIEWPORTS) {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await page.goto(T04_ROUTES.home);
    await expectShellReady(page);

    await expectNoPageOverflow(page);
    await expectNoElementOverflow(page.getByTestId(T04_TEST_IDS.mainContent));

    const heading = page.getByRole('heading', { level: 1 });
    await expect(heading).toBeVisible();
    await expectNoElementOverflow(heading);

    const controls = page.locator(NAV_CONTROL_SELECTOR).filter({ visible: true });
    const controlCount = await controls.count();
    expect(controlCount, `No visible navigation control at ${viewport.label}`).toBeGreaterThan(0);

    for (let index = 0; index < controlCount; index += 1) {
      await expectTouchTarget(controls.nth(index));
    }
  }
});

test('200% text scaling keeps content inside the viewport at every width @matrix', async ({
  t04Page: page,
}) => {
  for (const viewport of VIEWPORTS) {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await page.goto(T04_ROUTES.home);
    await expectShellReady(page);

    // Doubling the delivered root size is the 200% stimulus, independent of
    // whether the application ships 14px, 16px or 18px as its base. A literal
    // `font-size: 200%` would reset to twice the UA default instead.
    const baselineFontSize = await page.evaluate(() =>
      Number.parseFloat(getComputedStyle(document.documentElement).fontSize)
    );
    await page.addStyleTag({
      content: `html { font-size: ${baselineFontSize * 2}px !important; }`,
    });
    await page.evaluate(async () => {
      await document.fonts.ready;
    });
    await nextPaint(page);

    const rootFontSize = await page.evaluate(() =>
      Number.parseFloat(getComputedStyle(document.documentElement).fontSize)
    );
    expect(
      rootFontSize,
      `The 200% root font-size stimulus did not apply to ${baselineFontSize}px`
    ).toBeCloseTo(baselineFontSize * 2, 1);

    const bodyFontSize = await page.evaluate(() =>
      Number.parseFloat(getComputedStyle(document.body).fontSize)
    );
    expect(
      bodyFontSize,
      `Body text did not scale with the root font (${bodyFontSize}px at 200%)`
    ).toBeGreaterThanOrEqual(baselineFontSize * 1.5);

    await expectNoPageOverflow(page);
    await expectNoElementOverflow(page.getByTestId(T04_TEST_IDS.mainContent));

    const heading = page.getByRole('heading', { level: 1 });
    await expect(heading).toBeVisible();
    await expectNoElementOverflow(heading);

    const action = page.getByTestId(T04_TEST_IDS.emptyStateSecurityAction);
    await expect(action).toBeVisible();
    await expectNoElementOverflow(action);
  }
});

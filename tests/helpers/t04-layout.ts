import { expect, type Locator, type Page } from '@playwright/test';

export type ShellMode = 'desktop' | 'tablet' | 'mobile';

export interface ContrastSample {
  text: string;
  foreground: string;
  background: string;
  fontSize: number;
  fontWeight: number;
  ratio: number;
}

export interface FocusIndicator {
  focusVisible: boolean;
  hasVisibleIndicator: boolean;
  outline: string;
  boxShadow: string;
}

export interface TabStop extends FocusIndicator {
  index: number;
  tagName: string;
  testId: string | null;
  accessibleHint: string;
}

/** Width thresholds in contract section 4. */
export function shellModeForViewport(width: number): ShellMode {
  if (width >= 1024) return 'desktop';
  if (width >= 640) return 'tablet';
  return 'mobile';
}

export async function nextPaint(page: Page): Promise<void> {
  // Two animation frames are a rendering condition, not a wall-clock timeout.
  await page.evaluate(
    () =>
      new Promise<void>((resolve) => {
        requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
      })
  );
}

/** Waits for the delivered shell and the document-level Arabic/RTL contract. */
export async function expectShellReady(page: Page): Promise<void> {
  await expect(page.getByTestId('main-content')).toBeVisible();
  await expect(page.locator('html')).toHaveAttribute('lang', 'ar-EG');
  await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
}

export async function expectNoPageOverflow(page: Page): Promise<void> {
  const metrics = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
    bodyScrollWidth: document.body.scrollWidth,
  }));
  expect(
    metrics.scrollWidth,
    `Page-level horizontal overflow: documentElement.scrollWidth=${metrics.scrollWidth}, clientWidth=${metrics.clientWidth}`
  ).toBeLessThanOrEqual(metrics.clientWidth + 2);
  expect(
    metrics.bodyScrollWidth,
    `Body-level horizontal overflow: body.scrollWidth=${metrics.bodyScrollWidth}, clientWidth=${metrics.clientWidth}`
  ).toBeLessThanOrEqual(metrics.clientWidth + 2);
}

export async function expectNoElementOverflow(locator: Locator): Promise<void> {
  const metrics = await locator.evaluate((element) => ({
    scrollWidth: element.scrollWidth,
    clientWidth: element.clientWidth,
  }));
  expect(
    metrics.scrollWidth,
    `Element scrollWidth=${metrics.scrollWidth} exceeds clientWidth=${metrics.clientWidth}`
  ).toBeLessThanOrEqual(metrics.clientWidth + 2);
}

export async function expectTouchTarget(locator: Locator, minimum = 44): Promise<void> {
  await expect(locator).toBeVisible();
  const box = await locator.boundingBox();
  expect(box, 'Visible control must have a bounding box').not.toBeNull();
  expect(box!.width, `Touch target width ${box!.width}px is below ${minimum}px`).toBeGreaterThanOrEqual(minimum - 0.5);
  expect(box!.height, `Touch target height ${box!.height}px is below ${minimum}px`).toBeGreaterThanOrEqual(minimum - 0.5);
}

/**
 * Focuses the control, scrolls it into view, and proves that the element at the
 * control's centre is the control itself. This catches sticky headers/bottom
 * bars covering a focused field or button.
 */
export async function expectNotCovered(page: Page, locator: Locator): Promise<void> {
  await locator.scrollIntoViewIfNeeded();
  await locator.focus();
  await nextPaint(page);
  const result = await locator.evaluate((element) => {
    const rect = element.getBoundingClientRect();
    const x = rect.left + rect.width / 2;
    const y = rect.top + rect.height / 2;
    const hit = document.elementFromPoint(x, y);
    return {
      top: rect.top,
      bottom: rect.bottom,
      innerHeight: window.innerHeight,
      innerWidth: window.innerWidth,
      hitOk: hit === element || (hit !== null && element.contains(hit)),
    };
  });
  expect(result.top, 'Focused control is above the viewport').toBeGreaterThanOrEqual(-1);
  expect(result.bottom, 'Focused control is below the viewport').toBeLessThanOrEqual(result.innerHeight + 1);
  expect(result.hitOk, 'A sticky/overlapping layer covers the focused control').toBe(true);
}

/**
 * Waits for a smooth scroll transition to settle and verifies the target element
 * is visible, below any sticky header, and not covered by an overlay,
 * WITHOUT calling scrollIntoViewIfNeeded() or .focus() on non-focusable elements.
 */
export async function expectScrollSettledAndNotCovered(
  page: Page,
  locator: Locator,
  headerSelector = '[data-testid="app-header"]'
): Promise<void> {
  await expect
    .poll(
      async () => {
        return locator.evaluate((element, hdrSel) => {
          const rect = element.getBoundingClientRect();
          const header = document.querySelector(hdrSel) || document.querySelector('header');
          const headerBottom = header ? header.getBoundingClientRect().bottom : 0;
          const x = rect.left + rect.width / 2;
          const y = rect.top + Math.min(rect.height / 2, 20);
          const hit = document.elementFromPoint(x, y);
          const hitOk = hit === element || (hit !== null && element.contains(hit));
          return {
            topBelowHeader: rect.top >= headerBottom - 1,
            inViewport: rect.top < window.innerHeight && rect.bottom > 0,
            hitOk,
          };
        }, headerSelector);
      },
      {
        message: 'Expected scrolled element to settle below header and remain uncovered',
        intervals: [100, 200, 300],
        timeout: 10_000,
      }
    )
    .toEqual({
      topBelowHeader: true,
      inViewport: true,
      hitOk: true,
    });
}


function indicatorScript(): FocusIndicator {
  const element = document.activeElement as HTMLElement | null;
  if (!element) {
    return { focusVisible: false, hasVisibleIndicator: false, outline: '', boxShadow: '' };
  }
  const style = getComputedStyle(element);
  const outlineWidth = Number.parseFloat(style.outlineWidth);
  const outlineVisible =
    style.outlineStyle !== 'none' &&
    outlineWidth >= 2 &&
    !/rgba?\([^)]*,\s*0(?:\.0+)?\)/.test(style.outlineColor);
  const shadowVisible =
    style.boxShadow !== 'none' && /(?:^|[,\s])(?:[2-9]|\d{2,})(?:\.\d+)?px/.test(style.boxShadow);
  return {
    focusVisible: element.matches(':focus-visible'),
    hasVisibleIndicator: outlineVisible || shadowVisible,
    outline: `${style.outlineStyle} ${style.outlineWidth} ${style.outlineColor}`,
    boxShadow: style.boxShadow,
  };
}

export async function focusIndicatorOfFocused(page: Page): Promise<FocusIndicator> {
  return page.evaluate(indicatorScript);
}

export async function expectVisibleFocus(page: Page, locator: Locator): Promise<void> {
  await expect(locator).toBeFocused();
  const indicator = await focusIndicatorOfFocused(page);
  expect(indicator.focusVisible, 'Focused control does not match :focus-visible').toBe(true);
  expect(
    indicator.hasVisibleIndicator,
    `Focused control has no visible focus ring (outline="${indicator.outline}", box-shadow="${indicator.boxShadow}")`
  ).toBe(true);
}

/** Drives real Tab presses from the start of the document and records each stop. */
export async function tabThrough(page: Page, steps: number): Promise<TabStop[]> {
  await page.evaluate(() => {
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
  });

  const stops: TabStop[] = [];
  for (let index = 0; index < steps; index += 1) {
    await page.keyboard.press('Tab');
    const stop = await page.evaluate((step) => {
      const element = document.activeElement as HTMLElement | null;
      if (!element) return null;
      const style = getComputedStyle(element);
      const outlineWidth = Number.parseFloat(style.outlineWidth);
      const outlineVisible =
        style.outlineStyle !== 'none' &&
        outlineWidth >= 2 &&
        !/rgba?\([^)]*,\s*0(?:\.0+)?\)/.test(style.outlineColor);
      const shadowVisible =
        style.boxShadow !== 'none' && /(?:^|[,\s])(?:[2-9]|\d{2,})(?:\.\d+)?px/.test(style.boxShadow);
      const hint =
        element.getAttribute('aria-label') ??
        element.getAttribute('data-testid') ??
        (element.textContent ?? '').trim().slice(0, 80);
      return {
        index: step,
        tagName: element.tagName.toLowerCase(),
        testId: element.getAttribute('data-testid'),
        accessibleHint: hint,
        focusVisible: element.matches(':focus-visible'),
        hasVisibleIndicator: outlineVisible || shadowVisible,
        outline: `${style.outlineStyle} ${style.outlineWidth} ${style.outlineColor}`,
        boxShadow: style.boxShadow,
      };
    }, index);
    if (stop) stops.push(stop);
  }
  return stops;
}

/**
 * Presses Tab until the focused element carries the requested test id. Returns
 * false when the control is not reachable within the tab budget, which is a real
 * keyboard-order failure rather than a skipped check.
 */
export async function tabToTestId(page: Page, testId: string, maxSteps = 12): Promise<boolean> {
  for (let step = 0; step < maxSteps; step += 1) {
    await page.keyboard.press('Tab');
    const focusedTestId = await page.evaluate(
      () => document.activeElement?.getAttribute('data-testid') ?? null
    );
    if (focusedTestId === testId) return true;
  }
  return false;
}

function contrastScript(): ContrastSample {
  type Rgba = [number, number, number, number];

  const parse = (value: string): Rgba => {
    const match = value.match(/rgba?\(([^)]+)\)/);
    if (!match) return [0, 0, 0, 0];
    const parts = match[1]
      .split(/[,/\s]+/)
      .filter((part) => part.length > 0)
      .map((part) => Number.parseFloat(part));
    return [parts[0] ?? 0, parts[1] ?? 0, parts[2] ?? 0, parts.length > 3 ? parts[3] : 1];
  };

  const composite = (top: Rgba, bottom: [number, number, number]): [number, number, number] => [
    top[0] * top[3] + bottom[0] * (1 - top[3]),
    top[1] * top[3] + bottom[1] * (1 - top[3]),
    top[2] * top[3] + bottom[2] * (1 - top[3]),
  ];

  const luminance = ([r, g, b]: [number, number, number]): number => {
    const channel = (value: number) => {
      const normalized = value / 255;
      return normalized <= 0.04045 ? normalized / 12.92 : ((normalized + 0.055) / 1.055) ** 2.4;
    };
    return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
  };

  const element = document.querySelector('[data-t04-contrast-target="true"]') as HTMLElement | null;
  if (!element) {
    return { text: '', foreground: '', background: '', fontSize: 0, fontWeight: 0, ratio: 0 };
  }

  const layers: Rgba[] = [];
  let node: Element | null = element;
  while (node) {
    const layer = parse(getComputedStyle(node).backgroundColor);
    if (layer[3] > 0) {
      layers.push(layer);
      if (layer[3] >= 1) break;
    }
    node = node.parentElement;
  }
  let background: [number, number, number] = [255, 255, 255];
  for (const layer of layers.reverse()) {
    background = composite(layer, background);
  }

  const style = getComputedStyle(element);
  const foregroundRgba = parse(style.color);
  const foreground = composite(foregroundRgba, background);
  const lighter = Math.max(luminance(foreground), luminance(background));
  const darker = Math.min(luminance(foreground), luminance(background));

  return {
    text: (element.textContent ?? '').trim().slice(0, 80),
    foreground: style.color,
    background: `rgb(${background.map((value) => Math.round(value)).join(', ')})`,
    fontSize: Number.parseFloat(style.fontSize),
    fontWeight: Number.parseFloat(style.fontWeight),
    ratio: (lighter + 0.05) / (darker + 0.05),
  };
}

/**
 * Measures rendered contrast. Callers mark one element with
 * `data-t04-contrast-target="true"` immediately before measuring.
 */
export async function contrastOf(locator: Locator): Promise<ContrastSample> {
  await locator.evaluate((element) => element.setAttribute('data-t04-contrast-target', 'true'));
  try {
    return await locator.evaluate(contrastScript);
  } finally {
    await locator.evaluate((element) => element.removeAttribute('data-t04-contrast-target'));
  }
}

export async function expectContrast(locator: Locator, minimum: number): Promise<ContrastSample> {
  const sample = await contrastOf(locator);
  expect(
    sample.ratio,
    `Contrast ${sample.ratio.toFixed(2)}:1 below ${minimum}:1 for "${sample.text}" (color=${sample.foreground}, background=${sample.background})`
  ).toBeGreaterThanOrEqual(minimum);
  return sample;
}

/** WCAG large text: >=24px, or >=18.66px bold. */
export function minimumContrastFor(sample: ContrastSample): number {
  const large = sample.fontSize >= 24 || (sample.fontSize >= 18.66 && sample.fontWeight >= 700);
  return large ? 3 : 4.5;
}

export async function expectWcagContrast(locator: Locator): Promise<ContrastSample> {
  const sample = await contrastOf(locator);
  expect(
    sample.ratio,
    `Contrast ${sample.ratio.toFixed(2)}:1 below ${minimumContrastFor(sample)}:1 for "${sample.text}" (color=${sample.foreground}, background=${sample.background})`
  ).toBeGreaterThanOrEqual(minimumContrastFor(sample));
  return sample;
}

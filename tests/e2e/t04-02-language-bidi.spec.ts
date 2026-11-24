import { test, expect } from '../helpers/t04-fixtures';
import { T04_MANIFEST, T04_ROUTES, T04_TEST_IDS } from '../helpers/t04-constants';
import { expectShellReady } from '../helpers/t04-layout';
import { trackNetwork } from '../helpers/t04-storage';

/**
 * T04-02 — Arabic root document, local-only typography and BiDi isolation.
 *
 * The shell contract guarantees RTL/Arabic at the document level, a locally
 * bundled "Noto Sans Arabic", and a Cairo-formatted <time> element on the home shell.
 */

function baseURL(): string {
  const url = test.info().project.use.baseURL;
  if (!url) throw new Error('T04 project must define use.baseURL');
  return url;
}

test('root document declares Arabic RTL, manifest and theme metadata @once', async ({
  t04Page: page,
}) => {
  await page.goto(T04_ROUTES.home);
  await expectShellReady(page);

  await expect(page.locator('html')).toHaveAttribute('lang', 'ar-EG');
  await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');

  const viewport = page.locator('meta[name="viewport"]');
  await expect(viewport).toHaveAttribute('content', /width=device-width/);
  await expect(viewport).toHaveAttribute('content', /initial-scale=1/);
  await expect(viewport).toHaveAttribute('content', /viewport-fit=cover/);

  await expect(page.locator('meta[name="theme-color"]')).toHaveAttribute(
    'content',
    /^#14566B$/i
  );
  await expect(page.locator('link[rel="manifest"]')).toHaveAttribute(
    'href',
    T04_MANIFEST.path
  );

  await expect(page.getByTestId(T04_TEST_IDS.mainContent)).toBeVisible();
});

test('typography loads a local font and makes zero external requests @once', async ({
  t04Page: page,
}) => {
  const network = trackNetwork(page, new URL(baseURL()).origin);
  try {
    await page.goto(T04_ROUTES.home);
    await expectShellReady(page);
    await page.evaluate(async () => {
      await document.fonts.ready;
    });

    const fontFamily = await page.evaluate(() => getComputedStyle(document.body).fontFamily);
    expect(fontFamily, `Body font-family is "${fontFamily}"`).toContain('Noto Sans Arabic');

    const fontAvailable = await page.evaluate(() =>
      document.fonts.check('16px "Noto Sans Arabic"')
    );
    expect(fontAvailable, 'The declared Arabic font is not available to the document').toBe(true);

    expect(network.fontRequests.length, 'No local font file was requested').toBeGreaterThan(0);
    for (const fontUrl of network.fontRequests) {
      const url = new URL(fontUrl);
      expect(url.origin, `Font "${fontUrl}" is not served from the application origin`).toBe(
        new URL(baseURL()).origin
      );
      expect(url.pathname, `Font "${fontUrl}" is not bundled under /fonts/`).toMatch(/^\/fonts\//);
    }
    for (const response of network.fontResponses) {
      expect(response.status, `Font "${response.url}" failed with HTTP ${response.status}`).toBeLessThan(
        400
      );
    }

    expect(
      network.externalRequests,
      `T04 must not call external origins, saw: ${network.externalRequests.join(', ')}`
    ).toEqual([]);

    const externalSubresources = await page.evaluate(() =>
      Array.from(
        document.querySelectorAll<HTMLLinkElement | HTMLScriptElement>(
          'link[rel="stylesheet"][href^="http"], link[rel="preload"][as="font"][href^="http"], script[src^="http"]'
        )
      ).map((element) => (element instanceof HTMLLinkElement ? element.href : element.src))
    );
    expect(externalSubresources, 'External CDN subresources are forbidden').toEqual([]);
  } finally {
    network.dispose();
  }
});

test('numeric and email text is isolated from the RTL paragraph direction @once', async ({
  t04Page: page,
}) => {
  await page.goto(T04_ROUTES.home);
  await expectShellReady(page);

  const offenders = await page.evaluate(() => {
    const findings: Array<{ text: string; kind: string }> = [];
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);

    while (walker.nextNode()) {
      const node = walker.currentNode;
      const text = node.textContent?.trim() ?? '';
      if (!text) continue;

      const parent = node.parentElement;
      if (!parent || parent.closest('script, style, noscript, template')) continue;

      const hasEmail = /[\w.+-]+@[\w-]+\.[\w.-]+/.test(text);
      const hasDigits = /[0-9٠-٩]/.test(text);
      if (!hasEmail && !hasDigits) continue;

      if (!parent.closest('bdi, [dir="ltr"]')) {
        findings.push({ text: text.slice(0, 80), kind: hasEmail ? 'email' : 'digits' });
      }
    }

    return findings;
  });

  expect(
    offenders,
    `RTL text nodes mix technical content without <bdi>/dir="ltr": ${offenders
      .map((finding) => `"${finding.text}" (${finding.kind})`)
      .join('; ')}`
  ).toEqual([]);
});

test('timestamp formatting follows Africa/Cairo on the home shell @once', async ({
  t04Page: page,
}) => {
  await page.goto(T04_ROUTES.home);
  await expectShellReady(page);

  const timestamps = page.locator('time');
  const count = await timestamps.count();

  expect(count, 'Authenticated home shell must render a Cairo <time> element').toBeGreaterThan(0);

  const first = timestamps.first();
  const datetime = await first.getAttribute('datetime');
  expect(datetime, 'A <time> element must expose a machine-readable datetime').not.toBeNull();
  const parsedDate = new Date(datetime!);
  expect(Number.isNaN(parsedDate.getTime()), `Invalid datetime "${datetime}"`).toBe(false);

  const rendered = (await first.innerText()).trim();
  expect(rendered.length, 'A timestamp must not render empty').toBeGreaterThan(0);

  const fmt = new Intl.DateTimeFormat('ar-EG', {
    timeZone: 'Africa/Cairo',
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });
  const allowedCairoDates = [
    fmt.format(parsedDate),
    fmt.format(new Date(parsedDate.getTime() - 5000)),
  ];
  expect(allowedCairoDates).toContain(rendered);
});

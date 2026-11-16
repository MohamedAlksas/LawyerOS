import { test, expect } from '../helpers/t04-fixtures';
import { T04_ROUTES, T04_TEST_IDS } from '../helpers/t04-constants';

/**
 * T04-08 — no demo content, invented security claims or false sync promises.
 *
 * The scans read rendered innerText, so hidden source comments and metadata are
 * not mistaken for user-facing claims. The login-page claim is a separate test:
 * it is a pre-existing T03 string that T04-08 requires the product to remove or
 * explicitly accept, and the suite must report it rather than quietly ignore it.
 */

const UNSUPPORTED_CLAIMS = [
  'أعلى معايير أمان',
  'أعلى معايير الأمان',
  'حماية كاملة',
  'أمان مطلق',
  'تشفير عسكري',
  'مضمون 100%',
  'بياناتك آمنة تماماً',
  'بياناتك محمية بالكامل',
];

const FALSE_SYNC_CLAIMS = [
  'مزامنة تلقائية',
  'متزامن مع',
  'يعمل بدون إنترنت',
  'يعمل دون إنترنت',
  'البيانات محفوظة حتى بدون اتصال',
];

const FAKE_METRIC_PATTERN =
  /[0-9٠-٩]+\s*(?:قضية|قضايا|جلسة|جلسات|عميل|عملاء|جنيه|ريال|%|٪)/;

function assertNoPhrase(text: string, phrases: string[], label: string): void {
  for (const phrase of phrases) {
    expect(text, `The ${label} contains the forbidden claim "${phrase}"`).not.toContain(phrase);
  }
}

test('the authenticated empty state contains no fabricated metrics or claims @once', async ({
  t04Page: page,
}) => {
  await page.goto(T04_ROUTES.home);
  await expect(page.getByTestId(T04_TEST_IDS.mainContent)).toBeVisible();

  const emptyState = page.getByTestId(T04_TEST_IDS.emptyState);
  await expect(emptyState).toBeVisible();
  const emptyText = await emptyState.innerText();

  expect(
    emptyText.match(FAKE_METRIC_PATTERN)?.[0] ?? null,
    `The empty state renders a number with an operational unit: "${emptyText}"`
  ).toBeNull();
  expect(
    emptyText.match(/[0-9٠-٩]+\s*[%٪]/)?.[0] ?? null,
    'The empty state renders a fabricated percentage'
  ).toBeNull();

  assertNoPhrase(emptyText, UNSUPPORTED_CLAIMS, 'empty state');
  assertNoPhrase(emptyText, FALSE_SYNC_CLAIMS, 'empty state');

  const bodyText = await page.locator('body').innerText();
  expect(
    bodyText.match(FAKE_METRIC_PATTERN)?.[0] ?? null,
    'The shell renders a fabricated case/hearing/client/financial metric'
  ).toBeNull();
  assertNoPhrase(bodyText, FALSE_SYNC_CLAIMS, 'authenticated shell');

  // T04 must not ship the static Stitch prototypes as application navigation or
  // surface a prototype version label as if it were an operational release.
  const prototypeLinks = await page.locator('a[href]').evaluateAll((anchors) =>
    anchors
      .map((anchor) => anchor.getAttribute('href') ?? '')
      .filter((href) => /\.html(?:[?#]|$)/i.test(href) || /stitch|docs\/design/i.test(href))
  );
  expect(prototypeLinks, 'The shell links to static mockup or prototype files').toEqual([]);
  expect(bodyText, 'The shell renders a prototype version label').not.toMatch(/\bv\d+\.\d+\b/i);
});

test('the login form starts empty and makes no unsupported security claim @once', async ({
  page,
}) => {
  await page.goto(T04_ROUTES.login);

  const email = page.locator('#email');
  const password = page.locator('#password');
  await expect(email).toBeVisible();
  await expect(password).toBeVisible();
  await expect(email).toHaveValue('');
  await expect(password).toHaveValue('');

  const loginText = await page.locator('body').innerText();
  assertNoPhrase(loginText, UNSUPPORTED_CLAIMS, 'login page');
  assertNoPhrase(loginText, FALSE_SYNC_CLAIMS, 'login page');
});

test('the security screen repeats no unsupported claims or fake metrics @once', async ({
  t04Page: page,
}) => {
  await page.goto(T04_ROUTES.security);
  await expect(page.getByTestId(T04_TEST_IDS.mainContent)).toBeVisible();

  const text = await page.locator('body').innerText();
  assertNoPhrase(text, UNSUPPORTED_CLAIMS, 'security screen');
  assertNoPhrase(text, FALSE_SYNC_CLAIMS, 'security screen');
  expect(
    text.match(FAKE_METRIC_PATTERN)?.[0] ?? null,
    'The security screen renders a fabricated business metric'
  ).toBeNull();
});

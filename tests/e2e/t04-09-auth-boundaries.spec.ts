import { test, expect } from '../helpers/t04-fixtures';
import { T04_ROUTES, T04_TEST_IDS } from '../helpers/t04-constants';
import { expectShellReady } from '../helpers/t04-layout';
import { countSessionsForUser } from '../helpers/t04-auth';

/**
 * T04-09 — browser-observable authentication boundaries.
 *
 * The acceptance criterion also requires the existing T03 unit/integration
 * suite to pass unchanged; that is process evidence from the full test run, not
 * a Playwright assertion. This file covers the browser-visible session boundary:
 * unauthenticated redirects and sign-out revoking the server session and cookie.
 */

test('unauthenticated visitors cannot reach the shell or security settings @once', async ({
  page,
}) => {
  await page.goto(T04_ROUTES.home);
  await expect(page).toHaveURL((url) => url.pathname === T04_ROUTES.login);

  await page.goto(T04_ROUTES.security);
  await expect(page).toHaveURL((url) => url.pathname === T04_ROUTES.login);
});

test('sign out revokes the session, clears the cookie and blocks re-entry @once', async ({
  t04OwnerPage: page,
  t04Owner,
}) => {
  await page.goto(T04_ROUTES.home);
  await expectShellReady(page);

  await expect
    .poll(() => countSessionsForUser(t04Owner.id), {
      message: 'Login must create a server-side session',
    })
    .toBeGreaterThanOrEqual(1);

  page.once('dialog', (dialog) => {
    void dialog.accept();
  });
  await page.getByTestId(T04_TEST_IDS.navLogout).click();

  await expect(page).toHaveURL((url) => url.pathname === T04_ROUTES.login);

  await expect
    .poll(() => countSessionsForUser(t04Owner.id), {
      message: 'Sign out must delete the server-side session',
    })
    .toBe(0);

  const sessionCookies = (await page.context().cookies()).filter((cookie) =>
    /session/i.test(cookie.name)
  );
  expect(
    sessionCookies.map((cookie) => cookie.name),
    'Sign out left a session cookie in the browser'
  ).toEqual([]);

  await page.goto(T04_ROUTES.home);
  await expect(page).toHaveURL((url) => url.pathname === T04_ROUTES.login);
});

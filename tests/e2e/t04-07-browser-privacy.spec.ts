import { test, expect } from '../helpers/t04-fixtures';
import { T04_ROUTES, T04_SW_ALLOWED_PATHS, T04_SW_FORBIDDEN_PATHS } from '../helpers/t04-constants';
import {
  cachePathOf,
  expectCacheAllowlist,
  expectNoSensitiveValues,
  expectSessionCookiesHardened,
  sensitiveNeedles,
  serviceWorkerRegistrations,
  snapshotCookies,
  snapshotStorage,
} from '../helpers/t04-storage';

/**
 * T04-07 — browser storage and cache privacy invariants.
 *
 * Uses the worker owner's real session, visits an authenticated page, and then
 * searches localStorage, sessionStorage, IndexedDB and CacheStorage for the
 * owner's synthetic credentials and session-cookie values. A cached `/` body is
 * included in the search because the contract's allowlist mentions `/` while
 * section 2.1 treats `/` as authenticated; the content check distinguishes a
 * public shell from a cached private response.
 */

const SENSITIVE_KEY_PATTERN =
  /session|token|secret|password|passwd|mfa|totp|backup|client|matter|document|invoice|finance/i;

test('authenticated browsing leaves no credentials or private data in storage @once', async ({
  t04Page: page,
  t04WorkerSession,
}) => {
  await page.goto(T04_ROUTES.home);
  await page.goto(T04_ROUTES.security);

  const rawCookies = await page.context().cookies();
  const sessionCookies = expectSessionCookiesHardened(await snapshotCookies(page));

  const storage = await snapshotStorage(page);
  expect(
    storage.indexedDbErrors,
    `IndexedDB could not be inspected: ${storage.indexedDbErrors.join('; ')}`
  ).toEqual([]);
  expect(
    storage.cacheErrors,
    `CacheStorage could not be inspected: ${storage.cacheErrors.join('; ')}`
  ).toEqual([]);

  const suspiciousKeys = [
    ...Object.keys(storage.localStorage),
    ...Object.keys(storage.sessionStorage),
  ].filter((key) => SENSITIVE_KEY_PATTERN.test(key));
  expect(
    suspiciousKeys,
    `Storage keys suggest persisted auth/private data: ${suspiciousKeys.join(', ')}`
  ).toEqual([]);

  const rawSessionCookies = rawCookies
    .filter((cookie) => /session/i.test(cookie.name))
    .map((cookie) => ({ name: cookie.name, value: cookie.value }));

  expect(sessionCookies.length).toBeGreaterThan(0);

  const needles = [
    ...sensitiveNeedles(t04WorkerSession.owner, rawSessionCookies),
    { label: 'owner display name', value: t04WorkerSession.owner.name },
  ];

  expectNoSensitiveValues(storage, needles);
});

test('CacheStorage contains only allowlisted public assets @once', async ({
  t04Page: page,
  t04WorkerSession,
}) => {
  // The second document navigation gives an installed worker a chance to control
  // the page and populate its cache before the snapshot.
  await page.goto(T04_ROUTES.home);
  await page.goto(T04_ROUTES.home);
  await page.goto(T04_ROUTES.security);

  const registrations = await serviceWorkerRegistrations(page);
  if (registrations.length === 0) {
    test.info().annotations.push({
      type: 'not-observed',
      description:
        'No service-worker registration was observable after authenticated navigation. CacheStorage is asserted to be empty/no-forbidden; a live worker allowlist could not be exercised in this run.',
    });
  } else {
    for (const registration of registrations) {
      expect(registration.scriptURL, 'Unexpected service-worker script').toMatch(/\/sw\.js$/);
    }
  }

  const storage = await snapshotStorage(page);
  expect(
    storage.cacheErrors,
    `CacheStorage could not be inspected: ${storage.cacheErrors.join('; ')}`
  ).toEqual([]);
  expectCacheAllowlist(storage.caches, T04_SW_ALLOWED_PATHS, T04_SW_FORBIDDEN_PATHS);

  const privateEntries = storage.caches.filter((entry) =>
    /^\/(?:api|login|verify|settings)(?:\/|$)/.test(cachePathOf(entry.url))
  );
  expect(
    privateEntries.map((entry) => cachePathOf(entry.url)),
    'Authenticated or API responses were cached'
  ).toEqual([]);

  const rawSessionCookies = (await page.context().cookies())
    .filter((cookie) => /session/i.test(cookie.name))
    .map((cookie) => ({ name: cookie.name, value: cookie.value }));

  expectNoSensitiveValues(storage, [
    ...sensitiveNeedles(t04WorkerSession.owner, rawSessionCookies),
    { label: 'owner display name', value: t04WorkerSession.owner.name },
  ]);
});

import { test, expect } from '../helpers/t04-fixtures';
import {
  T04_ROUTES,
  T04_SW_ALLOWED_PATHS,
  T04_SW_EXACT_ALLOWED_PATHS,
  T04_SW_FORBIDDEN_PATHS,
} from '../helpers/t04-constants';
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

test('service worker upgrade purges legacy caches and preserves allowlist only (T04-R2-03) @once', async ({
  page,
}) => {
  // 1. Visit /offline.html to establish origin context before seeding caches
  await page.goto(T04_ROUTES.offlineHtml);

  // Seed synthetic legacy cache `lawoffice-public-v1` with `/icons/legacy-unlisted.txt`
  // and seed `lawoffice-public-v2` with `/icons/legacy-unlisted.txt`
  await page.evaluate(async () => {
    const v1 = await caches.open('lawoffice-public-v1');
    await v1.put(
      '/icons/legacy-unlisted.txt',
      new Response('synthetic old v1 public cache entry', {
        headers: { 'Content-Type': 'text/plain' },
      })
    );

    const v2 = await caches.open('lawoffice-public-v2');
    await v2.put(
      '/icons/legacy-unlisted.txt',
      new Response('synthetic stale v2 cache entry to purge', {
        headers: { 'Content-Type': 'text/plain' },
      })
    );
  });

  // Verify seeds exist
  const seededKeys = await page.evaluate(async () => await caches.keys());
  expect(seededKeys).toContain('lawoffice-public-v1');
  expect(seededKeys).toContain('lawoffice-public-v2');

  // 2. Navigate to /login to trigger AppShell service worker registration
  await page.goto(T04_ROUTES.login);

  // Await service worker readiness and activation
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
  });

  // Reload page to ensure the active service worker controls the page
  await page.reload();
  await expect
    .poll(() => page.evaluate(() => Boolean(navigator.serviceWorker.controller)), {
      message: 'Active service worker must control client page',
      timeout: 10_000,
    })
    .toBe(true);

  // 3. Assert lawoffice-public-v1 is deleted
  const currentCacheKeys = await page.evaluate(async () => await caches.keys());
  expect(
    currentCacheKeys,
    'Legacy cache lawoffice-public-v1 must be deleted on activation'
  ).not.toContain('lawoffice-public-v1');
  expect(
    currentCacheKeys,
    'Active cache lawoffice-public-v2 must exist'
  ).toContain('lawoffice-public-v2');

  // 4. Assert lawoffice-public-v2 exists with /icons/legacy-unlisted.txt purged
  const legacyInV2 = await page.evaluate(async () => {
    const v2 = await caches.open('lawoffice-public-v2');
    const matched = await v2.match('/icons/legacy-unlisted.txt');
    return Boolean(matched);
  });
  expect(
    legacyInV2,
    '/icons/legacy-unlisted.txt must be purged from lawoffice-public-v2 during activation'
  ).toBe(false);

  // 5. Assert only allowlisted static assets remain in lawoffice-public-v2
  const v2CachedPaths = await page.evaluate(async () => {
    const v2 = await caches.open('lawoffice-public-v2');
    const requests = await v2.keys();
    return requests.map((req) => new URL(req.url).pathname);
  });

  expect(v2CachedPaths.length, 'lawoffice-public-v2 must contain cached static assets').toBeGreaterThan(0);
  for (const cachedPath of v2CachedPaths) {
    expect(
      T04_SW_EXACT_ALLOWED_PATHS,
      `Cached path "${cachedPath}" must be in the exact static allowlist`
    ).toContain(cachedPath);
  }

  // 6. Assert '/' is NOT cached
  expect(v2CachedPaths, 'Root "/" must not be in service worker cache').not.toContain('/');

  // 7. Assert permitted static assets return 200
  for (const assetPath of T04_SW_EXACT_ALLOWED_PATHS) {
    const status = await page.evaluate(async (path) => {
      const response = await fetch(path);
      return response.status;
    }, assetPath);
    expect(status, `Permitted asset "${assetPath}" must return HTTP 200`).toBe(200);
  }
});

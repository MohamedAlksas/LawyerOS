import { expect, type Page } from '@playwright/test';
import type { T04Owner } from './t04-auth';

/**
 * Browser-storage and cache forensics for T04-07.
 *
 * The contract treats browser storage as a privacy boundary: session tokens,
 * passwords, MFA material, client records and API responses must never appear
 * in localStorage, sessionStorage, IndexedDB or CacheStorage. These helpers take
 * a snapshot, then search it for the synthetic fixture's secrets in the common
 * encodings an application might accidentally persist.
 */

export interface CacheEntrySnapshot {
  cacheName: string;
  url: string;
  status: number;
  contentType: string;
  /** Text bodies only; binary responses (icons, fonts) are intentionally skipped. */
  bodyText: string;
}

export interface IndexedDbRecordSnapshot {
  database: string;
  store: string;
  value: string;
}

export interface StorageSnapshot {
  localStorage: Record<string, string>;
  sessionStorage: Record<string, string>;
  indexedDb: IndexedDbRecordSnapshot[];
  indexedDbErrors: string[];
  caches: CacheEntrySnapshot[];
  cacheErrors: string[];
}

export interface CookieSnapshot {
  name: string;
  domain: string;
  path: string;
  httpOnly: boolean;
  secure: boolean;
  sameSite: 'Strict' | 'Lax' | 'None';
}

export interface SensitiveNeedle {
  /** Safe to print in failure messages; never contains the secret itself. */
  label: string;
  value: string;
}

export interface SensitiveFinding {
  needle: string;
  encoding: string;
  location: string;
}

const MAX_TEXT_BODY = 120_000;

export async function snapshotStorage(page: Page): Promise<StorageSnapshot> {
  return page.evaluate(async (maxTextBody) => {
    const errorMessage = (error: unknown): string =>
      error instanceof Error ? error.message : String(error);

    const readStorage = (storage: Storage): Record<string, string> => {
      const entries: Record<string, string> = {};
      for (let index = 0; index < storage.length; index += 1) {
        const key = storage.key(index);
        if (key !== null) entries[key] = storage.getItem(key) ?? '';
      }
      return entries;
    };

    const indexedDb: Array<{ database: string; store: string; value: string }> = [];
    const indexedDbErrors: string[] = [];

    const factory = indexedDB as IDBFactory & {
      databases?: () => Promise<Array<{ name?: string }>>;
    };

    if (typeof factory.databases === 'function') {
      try {
        const databases = await factory.databases();
        for (const database of databases) {
          if (!database.name) continue;
          try {
            const db = await new Promise<IDBDatabase>((resolve, reject) => {
              const request = indexedDB.open(database.name!);
              request.onsuccess = () => resolve(request.result);
              request.onerror = () => reject(request.error ?? new Error('open failed'));
              request.onblocked = () => reject(new Error('open blocked'));
            });

            try {
              for (const storeName of Array.from(db.objectStoreNames)) {
                try {
                  const values = await new Promise<unknown[]>((resolve, reject) => {
                    const transaction = db.transaction(storeName, 'readonly');
                    const request = transaction.objectStore(storeName).getAll();
                    request.onsuccess = () => resolve(request.result as unknown[]);
                    request.onerror = () => reject(request.error ?? new Error('getAll failed'));
                  });

                  for (const value of values) {
                    let serialized: string;
                    try {
                      serialized = JSON.stringify(value) ?? String(value);
                    } catch {
                      serialized = String(value);
                    }
                    indexedDb.push({
                      database: database.name,
                      store: storeName,
                      value: serialized.slice(0, maxTextBody),
                    });
                  }
                } catch (error) {
                  indexedDbErrors.push(`${database.name}/${storeName}: ${errorMessage(error)}`);
                }
              }
            } finally {
              db.close();
            }
          } catch (error) {
            indexedDbErrors.push(`${database.name}: ${errorMessage(error)}`);
          }
        }
      } catch (error) {
        indexedDbErrors.push(`databases(): ${errorMessage(error)}`);
      }
    }

    const cachesSnapshot: Array<{
      cacheName: string;
      url: string;
      status: number;
      contentType: string;
      bodyText: string;
    }> = [];
    const cacheErrors: string[] = [];

    if ('caches' in window) {
      try {
        const cacheNames = await caches.keys();
        for (const cacheName of cacheNames) {
          const cache = await caches.open(cacheName);
          const requests = await cache.keys();
          for (const request of requests) {
            const response = await cache.match(request);
            if (!response) continue;

            const contentType = response.headers.get('content-type') ?? '';
            const isText =
              /^(?:text\/|application\/(?:json|javascript|xml|manifest\+json|xhtml\+xml))/.test(
                contentType
              );
            let bodyText = '';
            if (isText) {
              try {
                bodyText = (await response.text()).slice(0, maxTextBody);
              } catch (error) {
                cacheErrors.push(`body ${request.url}: ${errorMessage(error)}`);
              }
            }

            cachesSnapshot.push({
              cacheName,
              url: request.url,
              status: response.status,
              contentType,
              bodyText,
            });
          }
        }
      } catch (error) {
        cacheErrors.push(`CacheStorage: ${errorMessage(error)}`);
      }
    }

    return {
      localStorage: readStorage(window.localStorage),
      sessionStorage: readStorage(window.sessionStorage),
      indexedDb,
      indexedDbErrors,
      caches: cachesSnapshot,
      cacheErrors,
    };
  }, MAX_TEXT_BODY);
}

export async function snapshotCookies(page: Page): Promise<CookieSnapshot[]> {
  const cookies = await page.context().cookies();
  return cookies.map((cookie) => ({
    name: cookie.name,
    domain: cookie.domain,
    path: cookie.path,
    httpOnly: cookie.httpOnly,
    secure: cookie.secure,
    sameSite: cookie.sameSite,
  }));
}

/**
 * Every synthetic value that must never be persisted client-side, plus the
 * live session-cookie values. Labels are safe to report; values stay in memory.
 */
export function sensitiveNeedles(
  owner: T04Owner,
  sessionCookies: Array<{ name: string; value: string }>
): SensitiveNeedle[] {
  return [
    { label: 'owner id', value: owner.id },
    { label: 'owner email', value: owner.email },
    { label: 'owner password', value: owner.password },
    { label: 'owner TOTP secret', value: owner.totpSecret },
    ...owner.backupCodes.map((code, index) => ({
      label: `owner backup code ${index + 1}`,
      value: code,
    })),
    ...sessionCookies
      .filter((cookie) => cookie.value.length >= 12)
      .map((cookie) => ({
        label: `session cookie value: ${cookie.name}`,
        value: cookie.value,
      })),
  ];
}

function encodedVariants(value: string): Array<{ encoding: string; encoded: string }> {
  const variants = [{ encoding: 'plain', encoded: value }];
  const base64 = Buffer.from(value, 'utf8').toString('base64');
  variants.push({ encoding: 'base64', encoded: base64 });
  variants.push({ encoding: 'base64url', encoded: base64.replace(/\+/g, '-').replace(/\//g, '_') });
  variants.push({ encoding: 'urlencoded', encoded: encodeURIComponent(value) });
  variants.push({
    encoding: 'json-escaped',
    encoded: JSON.stringify(value).slice(1, -1),
  });
  return variants;
}

export function findSensitiveValues(
  snapshot: StorageSnapshot,
  needles: SensitiveNeedle[]
): SensitiveFinding[] {
  const locations: Array<{ location: string; text: string }> = [];

  for (const [key, value] of Object.entries(snapshot.localStorage)) {
    locations.push({ location: `localStorage[${key}]`, text: `${key}\n${value}` });
  }
  for (const [key, value] of Object.entries(snapshot.sessionStorage)) {
    locations.push({ location: `sessionStorage[${key}]`, text: `${key}\n${value}` });
  }
  for (const record of snapshot.indexedDb) {
    locations.push({
      location: `IndexedDB ${record.database}/${record.store}`,
      text: record.value,
    });
  }
  for (const entry of snapshot.caches) {
    locations.push({
      location: `CacheStorage ${entry.cacheName} ${cachePathOf(entry.url)}`,
      text: `${entry.url}\n${entry.bodyText}`,
    });
  }

  const findings: SensitiveFinding[] = [];
  for (const needle of needles) {
    const variants = encodedVariants(needle.value);
    for (const location of locations) {
      const match = variants.find((variant) => location.text.includes(variant.encoded));
      if (match) {
        findings.push({
          needle: needle.label,
          encoding: match.encoding,
          location: location.location,
        });
      }
    }
  }
  return findings;
}

export function expectNoSensitiveValues(
  snapshot: StorageSnapshot,
  needles: SensitiveNeedle[]
): void {
  const findings = findSensitiveValues(snapshot, needles);
  expect(
    findings,
    `Sensitive values found in browser storage: ${findings
      .map((finding) => `${finding.needle} at ${finding.location} (${finding.encoding})`)
      .join('; ')}`
  ).toEqual([]);
}

export function cachePathOf(url: string): string {
  try {
    return new URL(url).pathname;
  } catch {
    return url;
  }
}

/**
 * Asserts every CacheStorage entry matches the contract's static allowlist and
 * none matches a forbidden dynamic/private route. An empty cache list passes.
 */
export function expectCacheAllowlist(
  caches: CacheEntrySnapshot[],
  allowed: readonly RegExp[],
  forbidden: readonly RegExp[]
): void {
  for (const entry of caches) {
    const path = cachePathOf(entry.url);
    expect(
      forbidden.some((pattern) => pattern.test(path)),
      `Forbidden CacheStorage entry "${path}" in cache "${entry.cacheName}"`
    ).toBe(false);
    expect(
      allowed.some((pattern) => pattern.test(path)),
      `CacheStorage entry "${path}" is outside the static allowlist (cache "${entry.cacheName}")`
    ).toBe(true);
  }
}

/**
 * Session cookies must be unreadable from JavaScript. SameSite=None is only
 * acceptable together with Secure, which local HTTP tests cannot provide, so the
 * suite requires Lax or Strict for the local synthetic origin.
 */
export function expectSessionCookiesHardened(cookies: CookieSnapshot[]): CookieSnapshot[] {
  const sessionCookies = cookies.filter((cookie) => /session/i.test(cookie.name));
  expect(sessionCookies.length, 'No authentication cookie was issued').toBeGreaterThan(0);

  for (const cookie of sessionCookies) {
    expect(cookie.httpOnly, `Authentication cookie "${cookie.name}" must be HttpOnly`).toBe(true);
    expect(
      ['Lax', 'Strict'],
      `Authentication cookie "${cookie.name}" has SameSite=${cookie.sameSite}`
    ).toContain(cookie.sameSite);
  }
  return sessionCookies;
}

export interface FontResponse {
  url: string;
  status: number;
}

export interface TrackedNetwork {
  externalRequests: string[];
  fontRequests: string[];
  fontResponses: FontResponse[];
  dispose: () => void;
}

/**
 * Records cross-origin requests and font requests for the local-font and
 * zero-CDN assertions. Call before the first navigation.
 */
export function trackNetwork(page: Page, allowedOrigin: string): TrackedNetwork {
  const externalRequests: string[] = [];
  const fontRequests: string[] = [];
  const fontResponses: FontResponse[] = [];

  const onRequest = (request: import('@playwright/test').Request): void => {
    const url = new URL(request.url());
    if (url.protocol === 'data:' || url.protocol === 'blob:') return;
    if (url.origin !== allowedOrigin) externalRequests.push(request.url());
    if (request.resourceType() === 'font') fontRequests.push(request.url());
  };

  const onResponse = (response: import('@playwright/test').Response): void => {
    if (response.request().resourceType() === 'font') {
      fontResponses.push({ url: response.url(), status: response.status() });
    }
  };

  page.on('request', onRequest);
  page.on('response', onResponse);
  return {
    externalRequests,
    fontRequests,
    fontResponses,
    dispose: () => {
      page.off('request', onRequest);
      page.off('response', onResponse);
    },
  };
}

export interface ServiceWorkerRegistrationSnapshot {
  scope: string;
  scriptURL: string;
  state: string | null;
}

export async function serviceWorkerRegistrations(
  page: Page
): Promise<ServiceWorkerRegistrationSnapshot[]> {
  return page.evaluate(async () => {
    if (!('serviceWorker' in navigator)) return [];
    const registrations = await navigator.serviceWorker.getRegistrations();
    return registrations.map((registration) => ({
      scope: registration.scope,
      scriptURL:
        registration.active?.scriptURL ??
        registration.waiting?.scriptURL ??
        registration.installing?.scriptURL ??
        '',
      state:
        registration.active?.state ??
        registration.waiting?.state ??
        registration.installing?.state ??
        null,
    }));
  });
}

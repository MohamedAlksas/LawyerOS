import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { matterSearchFilters, readParam, unifiedSearchFilters } from '@/lib/search-params';
import {
  bindSearchSession,
  clearSearchSessionStore,
  readSearchHistory,
  writeSearchHistory,
} from '@/lib/search-session-store';

describe('private search history', () => {
  const location = new URL('https://example.test/matters');
  const history = {
    state: { __NA: true } as Record<string, unknown>,
    replaceState: vi.fn((state: Record<string, unknown>, _unused: string, url: string) => {
      history.state = state;
      location.href = new URL(url, location).href;
    }),
  };

  beforeEach(() => {
    history.state = { __NA: true };
    location.search = '';
    clearSearchSessionStore();
    vi.stubGlobal('window', { history, location, crypto: globalThis.crypto });
  });

  afterEach(() => vi.unstubAllGlobals());

  it('restores only within the bound session and serializes an opaque key', () => {
    bindSearchSession('session-a');
    const privateData = { query: 'synthetic private query', client: { id: 'sample-client', name: 'Sample' } };
    writeSearchHistory('session-a', privateData, new URLSearchParams({ page: '2', limit: '10' }));

    expect(readSearchHistory('session-a')).toEqual(privateData);
    expect(readSearchHistory('session-b')).toBeUndefined();
    expect(location.search).toBe('?page=2&limit=10');
    expect(history.state).toEqual({ __NA: true, navKey: expect.any(String) });

    bindSearchSession('session-b');
    expect(readSearchHistory('session-b')).toBeUndefined();
    writeSearchHistory('session-a', privateData, new URLSearchParams());
    expect(location.search).toBe('?page=2&limit=10');
    bindSearchSession('session-a');
    expect(readSearchHistory('session-a')).toBeUndefined();
  });

  it('discards search state across authentication loss', () => {
    bindSearchSession('session-a');
    writeSearchHistory('session-a', { query: 'synthetic' }, new URLSearchParams());
    clearSearchSessionStore();
    expect(readSearchHistory('session-a')).toBeUndefined();
    writeSearchHistory('session-a', { query: 'untrusted completion' }, new URLSearchParams());
    bindSearchSession('session-a');
    expect(readSearchHistory('session-a')).toBeUndefined();
  });

  it('caps in-memory tabStore at 50 entries using LRU eviction', () => {
    bindSearchSession('session-lru');
    for (let i = 0; i < 55; i += 1) {
      history.state = { __NA: true, navKey: `k-${i}` };
      writeSearchHistory('session-lru', { query: `q-${i}` }, new URLSearchParams());
    }
    history.state = { __NA: true, navKey: 'k-0' };
    expect(readSearchHistory('session-lru')).toBeUndefined();
    history.state = { __NA: true, navKey: 'k-4' };
    expect(readSearchHistory('session-lru')).toBeUndefined();
    history.state = { __NA: true, navKey: 'k-5' };
    expect(readSearchHistory('session-lru')).toEqual({ query: 'q-5' });
    history.state = { __NA: true, navKey: 'k-54' };
    expect(readSearchHistory('session-lru')).toEqual({ query: 'q-54' });
  });
});

it('parses public filters identically from server and browser parameters', () => {
  const server = { type: ['PARTY', 'MATTER'], page: '9999', limit: '10', query: 'private' };
  const browser = new URLSearchParams('type=PARTY&type=MATTER&page=9999&limit=10&query=private');
  expect(unifiedSearchFilters((name) => readParam(server, name)))
    .toEqual(unifiedSearchFilters((name) => readParam(browser, name)));
  expect(unifiedSearchFilters((name) => readParam(browser, name)))
    .toEqual({ type: 'ALL', includeArchived: false, page: 1000, limit: 10 });
  const matter = new URLSearchParams('status=SUSPENDED&page=2x&limit=120&clientId=private&courtId=bad-id');
  expect(matterSearchFilters((name) => readParam(matter, name))).toEqual({
    kind: undefined, status: 'ON_HOLD', courtId: undefined, incompleteData: false,
    includeArchived: false, page: 1, limit: 100,
  });
});

/**
 * Search Session Store (In-Memory Tab State)
 * 
 * Securely stores transient private search queries and client filters in
 * memory (JavaScript heap) rather than URL search params, history.state,
 * localStorage, or sessionStorage.
 * 
 * Prevents PII (client names, phone numbers, Egyptian national IDs) from
 * persisting to browser history serialization or disk caches.
 */

export interface SearchSessionEntry {
  query: string;
  clientId?: string;
  timestamp: number;
}

const tabStore = new Map<string, SearchSessionEntry>();

/**
 * Generates an opaque, non-sensitive navigation key for history.state.
 */
export function createNavigationKey(): string {
  return `nav_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * Stores private search text in memory associated with an opaque key.
 */
export function setPrivateSearchState(key: string, query: string, clientId?: string): void {
  if (!key) return;
  tabStore.set(key, {
    query: query || '',
    clientId: clientId || undefined,
    timestamp: Date.now(),
  });
}

/**
 * Retrieves private search text from in-memory tab state.
 */
export function getPrivateSearchState(key?: string | null): SearchSessionEntry | undefined {
  if (!key) return undefined;
  return tabStore.get(key);
}

/**
 * Clears in-memory search store completely upon sign-out or session invalidation.
 */
export function clearSearchSessionStore(): void {
  tabStore.clear();
}

// Attach listener to clear on window beforeunload or custom auth logout event
if (typeof window !== 'undefined') {
  window.addEventListener('lawoffice:signout', () => {
    clearSearchSessionStore();
  });
}

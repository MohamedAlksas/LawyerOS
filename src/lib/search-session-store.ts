/**
 * Search Session Store (In-Memory Tab State)
 *
 * Securely stores transient private search queries and client filters in
 * memory (JavaScript heap) rather than URL search params, history.state,
 * localStorage, or sessionStorage.
 *
 * Prevents PII (client names, phone numbers, Egyptian national IDs) from
 * persisting to browser history serialization or disk caches.
 *
 * Scoped strictly to the authenticated user's active session ID.
 */

export interface SearchSessionEntry {
  query: string;
  clientId?: string;
  sessionId: string;
  timestamp: number;
}

const tabStore = new Map<string, SearchSessionEntry>();
let currentBoundSessionId: string | null = null;

/**
 * Binds the in-memory search store to a specific authenticated session ID.
 * Purges all existing entries if the session ID has changed or is invalidated.
 */
export function bindSearchSession(sessionId?: string | null): void {
  if (!sessionId) {
    clearSearchSessionStore();
    return;
  }
  if (currentBoundSessionId && currentBoundSessionId !== sessionId) {
    tabStore.clear();
  }
  currentBoundSessionId = sessionId;
}

/**
 * Generates an opaque, non-sensitive navigation key for history.state.
 */
export function createNavigationKey(): string {
  return `nav_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * Stores private search text in memory associated with an opaque key and bound session.
 */
export function setPrivateSearchState(key: string, query: string, clientId?: string, sessionId?: string): void {
  if (!key) return;
  if (sessionId) {
    bindSearchSession(sessionId);
  }
  const effectiveSessionId = sessionId || currentBoundSessionId || '';
  tabStore.set(key, {
    query: query || '',
    clientId: clientId || undefined,
    sessionId: effectiveSessionId,
    timestamp: Date.now(),
  });
}

/**
 * Retrieves private search text from in-memory tab state.
 * Rejects entry if expectedSessionId is provided and does not match, or if currentBoundSessionId does not match.
 */
export function getPrivateSearchState(key?: string | null, expectedSessionId?: string): SearchSessionEntry | undefined {
  if (!key) return undefined;
  const entry = tabStore.get(key);
  if (!entry) return undefined;

  const targetSessionId = expectedSessionId || currentBoundSessionId;
  if (targetSessionId && entry.sessionId && entry.sessionId !== targetSessionId) {
    tabStore.delete(key);
    return undefined;
  }
  return entry;
}

/**
 * Clears in-memory search store completely upon sign-out or session invalidation.
 */
export function clearSearchSessionStore(): void {
  tabStore.clear();
  currentBoundSessionId = null;
}

// Attach listener to clear on window beforeunload or custom auth logout event
if (typeof window !== 'undefined') {
  window.addEventListener('lawoffice:signout', () => {
    clearSearchSessionStore();
  });
}

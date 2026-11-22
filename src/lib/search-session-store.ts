interface PrivateSearchState {
  query: string;
  client?: { id: string; name: string };
}

const tabStore = new Map<string, PrivateSearchState>();
let boundSession: string | null = null;

export function bindSearchSession(session: string): void {
  if (boundSession !== session) {
    tabStore.clear();
    boundSession = session;
  }
}

export function clearSearchSessionStore(): void {
  tabStore.clear();
  boundSession = null;
}

export function readSearchHistory(session: string): PrivateSearchState | undefined {
  if (boundSession !== session || typeof window === 'undefined') return undefined;
  const key: unknown = window.history.state?.navKey;
  return typeof key === 'string' ? tabStore.get(`${window.location.pathname}:${key}`) : undefined;
}

export function writeSearchHistory(
  session: string,
  entry: PrivateSearchState,
  params: URLSearchParams,
): void {
  if (boundSession !== session) return;
  const state = window.history.state;
  const key = typeof state?.navKey === 'string'
    ? state.navKey
    : Array.from(window.crypto.getRandomValues(new Uint32Array(4))).join('-');
  tabStore.set(`${window.location.pathname}:${key}`, entry);
  const search = params.toString();
  const url = window.location.pathname + (search ? `?${search}` : '');
  if (state?.navKey !== key || window.location.search !== (search ? `?${search}` : '')) {
    window.history.replaceState({ ...state, navKey: key }, '', url);
  }
}

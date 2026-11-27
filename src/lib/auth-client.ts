'use client';

import { createAuthClient } from 'better-auth/client';
import { twoFactorClient } from 'better-auth/client/plugins';
import { clearSearchSessionStore } from './search-session-store';

export const authClient = createAuthClient({
  baseURL: typeof window !== 'undefined' ? window.location.origin : 'http://127.0.0.1:3000',
  plugins: [twoFactorClient()],
});

export const {
  signIn,
  signOut,
  useSession,
  getSession,
  twoFactor,
} = authClient;

export async function signOutAndReset() {
  const result = await signOut();
  if (!result?.error || result.error.status === 401) {
    clearSearchSessionStore();
    window.dispatchEvent(new Event('lawoffice:session-ended'));
    // Replace the document so no private Next.js route cache survives sign-out.
    window.location.replace('/login');
    return { data: result?.data ?? null, error: null };
  }
  return result;
}

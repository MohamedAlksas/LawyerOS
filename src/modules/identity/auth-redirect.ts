import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import type { AuthenticationError } from './types';

export async function redirectOnAuthError(error: AuthenticationError, returnTo?: string): Promise<never> {
  const qs = returnTo ? `returnTo=${encodeURIComponent(returnTo)}` : '';
  if (error.code === 'MFA_REQUIRED') {
    redirect(qs ? `/verify?${qs}` : '/verify');
  }
  const cookie = (await headers()).get('cookie') || '';
  const hasSessionCookie = /(?:better-auth\.session_token|__Secure-better-auth\.session_token)/i.test(cookie);
  const isExpired = error.code === 'SESSION_EXPIRED' || error.code === 'SESSION_INACTIVE' || hasSessionCookie;
  const params = new URLSearchParams();
  if (isExpired) params.set('error', 'session_expired');
  if (returnTo) params.set('returnTo', returnTo);
  const query = params.toString();
  redirect(query ? `/login?${query}` : '/login');
}

import { expect } from 'vitest';

export async function browserSessionToken(response: Response): Promise<string> {
  const body = await response.json();
  expect(Object.hasOwn(body, 'token')).toBe(false);
  const cookie = response.headers.getSetCookie().find((value) =>
    /^(?:__Secure-)?better-auth\.session_token=[^;]+;/.test(value),
  );
  if (!cookie) throw new Error('The HTTP-only session cookie was not issued');
  expect(cookie).toMatch(/;\s*HttpOnly(?:;|$)/i);
  const value = cookie.slice(cookie.indexOf('=') + 1, cookie.indexOf(';'));
  return decodeURIComponent(value).split('.')[0];
}

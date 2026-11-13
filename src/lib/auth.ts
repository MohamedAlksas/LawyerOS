import { betterAuth } from 'better-auth';
import { prismaAdapter } from '@better-auth/prisma-adapter';
import { twoFactor } from 'better-auth/plugins';
import { createAuthMiddleware } from 'better-auth/api';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { getDbPool } from './db';
import { getEnv } from './env';

declare global {
  var __lawoffice_prisma: PrismaClient | undefined;
  var __lawoffice_auth: ReturnType<typeof createAuthInstance> | undefined;
}

/**
 * Returns a singleton PrismaClient configured with PrismaPg driver adapter
 * over the shared database pool.
 */
export function getPrismaClient(): PrismaClient {
  if (typeof window !== 'undefined') {
    throw new Error('PrismaClient cannot be instantiated in client-side code.');
  }

  const cached = global.__lawoffice_prisma;
  if (cached) {
    return cached;
  }

  const pool = getDbPool();
  const adapter = new PrismaPg(pool);
  const client = new PrismaClient({ adapter });

  global.__lawoffice_prisma = client;
  return client;
}

function createAuthInstance() {
  const env = getEnv();
  const prisma = getPrismaClient();

  return betterAuth({
    database: prismaAdapter(prisma, {
      provider: 'postgresql',
    }),
    secret: env.BETTER_AUTH_SECRET,
    baseURL: env.BETTER_AUTH_URL,
    emailAndPassword: {
      enabled: true,
      disableSignUp: true, // Public self-registration is strictly forbidden
      autoSignIn: false,
    },
    session: {
      expiresIn: 12 * 3600, // Maximum session lifetime: 12 hours
      updateAge: 300,       // Session timestamp updated every 5 minutes when active
      cookieCache: {
        enabled: false,     // Authoritative server-side database session validation
      },
    },
    advanced: {
      defaultCookieAttributes: {
        httpOnly: true,
        sameSite: 'lax',
        secure: env.NODE_ENV === 'production',
      },
    },
    rateLimit: {
      window: 60,
      max: 100,
      customRules: {
        '/sign-in/email': {
          window: 10,
          max: 50,
        },
        '/two-factor/verify-totp': {
          window: 10,
          max: 50,
        },
        '/two-factor/verify-backup-code': {
          window: 10,
          max: 50,
        },
      },
    },
    plugins: [
      {
        id: 'lawoffice-security-policy',
        hooks: {
          before: [
            {
              matcher(context) {
                return Boolean(context.path?.includes('/sign-in'));
              },
              handler: createAuthMiddleware(async (ctx) => {
                const cookieHeader = ctx.headers?.get('cookie');
                if (cookieHeader) {
                  const cleaned = cookieHeader
                    .split(';')
                    .map((c) => c.trim())
                    .filter(
                      (c) =>
                        !c.startsWith('better-auth.trust_device=') &&
                        !c.startsWith('__Secure-better-auth.trust_device=') &&
                        !c.startsWith('better-auth.dont_remember_device=') &&
                        !c.startsWith('__Secure-better-auth.dont_remember_device=')
                    )
                    .join('; ');
                  ctx.headers?.set('cookie', cleaned);
                }
              }),
            },
          ],
        },
      },
      twoFactor({
        issuer: 'LawOffice OS',
        trustDeviceMaxAge: 0,
        otpOptions: {
          period: 30,
          digits: 6,
        },
      }),
    ],
  });
}

/**
 * Lazy singleton Better Auth server instance.
 * Defers database pool acquisition and environment validation until an auth endpoint or query is executed.
 */
export function getAuth(): ReturnType<typeof createAuthInstance> {
  const cached = global.__lawoffice_auth;
  if (cached) {
    return cached;
  }

  const instance = createAuthInstance();
  global.__lawoffice_auth = instance;
  return instance;
}

export const auth = new Proxy({} as ReturnType<typeof createAuthInstance>, {
  get(_target, prop) {
    const instance = getAuth();
    const val = Reflect.get(instance, prop);
    return typeof val === 'function' ? val.bind(instance) : val;
  },
});
import { randomBytes, randomUUID } from 'crypto';
import { expect, type Page } from '@playwright/test';
import { hashPassword, symmetricEncrypt } from 'better-auth/crypto';
import { createOTP } from '@better-auth/utils/otp';
import { base32 } from '@better-auth/utils/base32';
import { cleanupTrackedFixtures, createValidatedTestPool } from './test-db';

/**
 * Synthetic OWNER fixture for T04 browser work.
 *
 * Mirrors the accepted T03 fixture shape (credential account + verified TOTP +
 * single-use backup codes) but creates fresh identities so no T04 test depends
 * on another test's leftovers or on a seeded "official" user.
 */
export interface T04Owner {
  id: string;
  email: string;
  password: string;
  name: string;
  totpSecret: string;
  backupCodes: string[];
}

const T04_LONG_OWNER_NAME =
  'أحمد محمود عبد الرحمن السيد الشربيني عبد الله حسن محمد الطويل الشهير بأبو محمود';

function createTotpSecret(): string {
  // 20 random bytes matches the accepted T03 fixture and RFC 6238's SHA-1 key size.
  return base32.encode(randomBytes(20)).replace(/=+$/, '');
}

export async function seedT04Owner(options: { label: string; name?: string }): Promise<T04Owner> {
  const suffix = randomUUID().slice(0, 12);
  const owner: T04Owner = {
    id: randomUUID(),
    email: `t04.owner.${options.label}.${suffix}@office.test`,
    password: `T04Aa9!${randomUUID().slice(0, 12)}`,
    name: options.name ?? T04_LONG_OWNER_NAME,
    totpSecret: createTotpSecret(),
    backupCodes: Array.from({ length: 5 }, (_, index) => `t04b${index}-${suffix.slice(0, 5)}`),
  };

  const { pool, env } = createValidatedTestPool();
  const client = await pool.connect();
  try {
    const hashedPassword = await hashPassword(owner.password);
    const encryptedSecret = await symmetricEncrypt({
      key: env.BETTER_AUTH_SECRET,
      data: 'base32:' + owner.totpSecret,
    });
    const encryptedBackupCodes = await symmetricEncrypt({
      key: env.BETTER_AUTH_SECRET,
      data: JSON.stringify(owner.backupCodes),
    });

    await client.query('BEGIN');
    try {
      await client.query(
        'INSERT INTO "user" (id, name, email, "emailVerified", role, "twoFactorEnabled", "createdAt", "updatedAt") VALUES ($1, $2, $3, true, $4, true, NOW(), NOW())',
        [owner.id, owner.name, owner.email, 'OWNER']
      );
      await client.query(
        'INSERT INTO "account" (id, "userId", "providerId", "accountId", password, "createdAt", "updatedAt") VALUES ($1, $2, $3, $4, $5, NOW(), NOW())',
        [randomUUID(), owner.id, 'credential', owner.id, hashedPassword]
      );
      await client.query(
        'INSERT INTO "twoFactor" (id, "userId", secret, "backupCodes", verified) VALUES ($1, $2, $3, $4, true)',
        [randomUUID(), owner.id, encryptedSecret, encryptedBackupCodes]
      );
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    }
  } finally {
    client.release();
    await pool.end();
  }

  return owner;
}

export async function deleteT04Owner(userId: string): Promise<void> {
  const { pool } = createValidatedTestPool();
  try {
    await cleanupTrackedFixtures(pool, { userIds: [userId] });
  } finally {
    await pool.end();
  }
}

export async function countSessionsForUser(userId: string): Promise<number> {
  const { pool } = createValidatedTestPool();
  try {
    const result = await pool.query<{ count: number }>(
      'SELECT COUNT(*)::int AS count FROM "session" WHERE "userId" = $1',
      [userId]
    );
    return result.rows[0]?.count ?? 0;
  } finally {
    await pool.end();
  }
}

/**
 * Revokes every server-side session for the synthetic owner. The next real
 * request is therefore rejected by the server, not by a mocked status code.
 */
export async function revokeAllSessionsForUser(userId: string): Promise<number> {
  const { pool } = createValidatedTestPool();
  try {
    const result = await pool.query('DELETE FROM "session" WHERE "userId" = $1', [userId]);
    return result.rowCount ?? 0;
  } finally {
    await pool.end();
  }
}

export async function currentTotp(secret: string): Promise<string> {
  const decoded = base32.decode(secret.toUpperCase());
  return createOTP(decoded, { period: 30, digits: 6 }).totp();
}

/**
 * Real UI login through the accepted T03 screens. The T04 contract keeps those
 * routes and field ids; the fixture intentionally exercises the same journey a
 * lawyer uses, including the TOTP challenge.
 */
export async function signInWithTotp(page: Page, owner: T04Owner): Promise<void> {
  await page.goto('/login');
  await page.locator('#email').fill(owner.email);
  await page.locator('#password').fill(owner.password);
  await page.locator('button[type="submit"]').click();

  await expect(page.getByRole('heading', { level: 1 })).toContainText('التحقق الثنائي');
  await expect(page).toHaveURL(/\/verify/);

  // Generate immediately before submitting so the accepted +/- one step window
  // cannot expire while unrelated assertions run.
  const code = await currentTotp(owner.totpSecret);
  await page.locator('#totpCode').fill(code);
  await page.locator('button[type="submit"]').click();

  await expect(page).not.toHaveURL(/\/(?:login|verify)(?:[/?]|$)/);
}

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import crypto from 'crypto';
import path from 'path';
import { spawnSync } from 'child_process';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { getPrismaClient } from '@/lib/auth';
import { getEnv } from '@/lib/env';
import { saveParty, revealPartyIdentity } from '@/modules/parties/service';
import { CryptoDecryptionError } from '@/lib/crypto/party-identity';
import { createDedicatedTestDatabase } from '../helpers/test-db';
import {
  createSyntheticActor,
  cleanupPartyFixtures,
  setupTestEncryptionKeys,
  SYNTHETIC_ENCRYPTION_KEY,
  SYNTHETIC_KEY_ID,
} from '../helpers/party-test-helper';

function runPrismaMigrateDeploy(dbUrl: string) {
  const prismaJs = path.resolve(process.cwd(), 'node_modules/prisma/build/index.js');
  const res = spawnSync(process.execPath, [prismaJs, 'migrate', 'deploy'], {
    env: {
      ...process.env,
      DATABASE_URL: dbUrl,
      NODE_ENV: 'test',
    },
    encoding: 'utf-8',
  });
  if (res.status !== 0) {
    throw new Error(
      `Prisma migrate deploy failed with status ${res.status}:\nSTDOUT: ${res.stdout}\nSTDERR: ${res.stderr}`
    );
  }
  return res;
}

describe('T05-08: Disaster Recovery & Key Custody Simulation (Integration - SPEC-01)', () => {
  const defaultPrisma = getPrismaClient();
  const actor = createSyntheticActor();
  const partyIds: string[] = [];

  beforeAll(() => {
    setupTestEncryptionKeys();
  });

  afterAll(async () => {
    await cleanupPartyFixtures(defaultPrisma, partyIds);
  });

  it('executes isolated synthetic restore into a distinct database and decrypts with restored key custody', async () => {
    const rawNationalId = '28701011234567';

    // 1. Create Party with encrypted national ID in Primary Database (Database A)
    const partyA = await saveParty(actor, {
      kind: 'PERSON',
      name: 'محمود المليجي في القاعدة الأولى',
      identity: {
        identificationType: 'NATIONAL_ID',
        number: rawNationalId,
      },
      idempotencyKey: `recovery-source-${crypto.randomUUID()}`,
    });
    partyIds.push(partyA.party.id);

    // 2. Read raw ciphertext envelope row from Database A
    const originalRow = await defaultPrisma.partyIdentity.findFirstOrThrow({
      where: { partyId: partyA.party.id },
    });
    expect(originalRow.ciphertext).not.toContain(rawNationalId);
    expect(originalRow.lastFour).toBe('4567');
    expect(originalRow.keyId).toBe(SYNTHETIC_KEY_ID);

    // 3. Create a distinct, completely separate disposable database (Database B)
    const dedicatedDbB = await createDedicatedTestDatabase();

    try {
      // 4. Run migrations on Database B to establish schema
      runPrismaMigrateDeploy(dedicatedDbB.url);

      const clientB = await dedicatedDbB.pool.connect();
      try {
        // Insert synthetic actor/user into Database B to satisfy foreign keys
        await clientB.query(`
          INSERT INTO "user" ("id", "name", "email", "role", "credentialVersion", "updatedAt")
          VALUES ($1, $2, $3, 'OWNER', 1, now())
          ON CONFLICT ("id") DO NOTHING;
        `, [actor.id, actor.name, actor.email]);

        // Insert party into Database B
        await clientB.query(`
          INSERT INTO "party" ("id", "kind", "name", "nameNormalized", "version", "createdById", "updatedById", "updatedAt")
          VALUES ($1, 'PERSON', 'محمود المليجي في القاعدة المستعادة', 'محمود المليجي في القاعده المستعاده', 1, $2, $2, now());
        `, [partyA.party.id, actor.id]);

        // Insert the raw ciphertext envelope row into Database B
        await clientB.query(`
          INSERT INTO "party_identity" ("id", "partyId", "identificationType", "ciphertext", "iv", "authTag", "keyId", "encryptionVersion", "lastFour", "createdById", "createdAt")
          VALUES ($1, $2, $3::"IdentificationType", $4, $5, $6, $7, $8, $9, $10, now());
        `, [
          originalRow.id,
          originalRow.partyId,
          originalRow.identificationType,
          originalRow.ciphertext,
          originalRow.iv,
          originalRow.authTag,
          originalRow.keyId,
          originalRow.encryptionVersion,
          originalRow.lastFour,
          originalRow.createdById,
        ]);
      } finally {
        clientB.release();
      }

      // 5. Connect isolated Prisma client to Database B and verify decryption with restored key custody
      const adapterB = new PrismaPg(dedicatedDbB.pool);
      const prismaB = new PrismaClient({ adapter: adapterB });

      try {
        // Supply matching key
        process.env.PARTY_IDENTITY_ENCRYPTION_KEY = SYNTHETIC_ENCRYPTION_KEY;
        process.env.PARTY_IDENTITY_KEY_ID = SYNTHETIC_KEY_ID;

        const revealedB = await revealPartyIdentity(actor, partyA.party.id, 'استعادة من قاعدة بيانات منفصلة', {
          prismaOverride: prismaB,
        });

        expect(revealedB.number).toBe(rawNationalId);
        expect(revealedB.identificationType).toBe('NATIONAL_ID');

        // 6. Test missing key custody: delete key and verify fail-closed
        delete process.env.PARTY_IDENTITY_ENCRYPTION_KEY;

        await expect(
          revealPartyIdentity(actor, partyA.party.id, 'محاولة بدون مفتاح', {
            prismaOverride: prismaB,
          })
        ).rejects.toThrow();

        // 7. Test wrong key custody: provide incorrect key and verify fail-closed
        process.env.PARTY_IDENTITY_ENCRYPTION_KEY = 'f'.repeat(64);

        await expect(
          revealPartyIdentity(actor, partyA.party.id, 'محاولة بمفتاح خاطئ', {
            prismaOverride: prismaB,
          })
        ).rejects.toThrowError(CryptoDecryptionError);

        // 8. Verify the raw database row in Database B remains completely intact and uncorrupted
        const rowInB = await prismaB.partyIdentity.findFirstOrThrow({
          where: { partyId: partyA.party.id },
        });
        expect(rowInB.ciphertext).toBe(originalRow.ciphertext);
        expect(rowInB.iv).toBe(originalRow.iv);
        expect(rowInB.authTag).toBe(originalRow.authTag);
        expect(rowInB.lastFour).toBe('4567');
        expect(rowInB.keyId).toBe(SYNTHETIC_KEY_ID);

        // 9. Restore key and verify decryption succeeds again
        process.env.PARTY_IDENTITY_ENCRYPTION_KEY = SYNTHETIC_ENCRYPTION_KEY;
        const revealedAfter = await revealPartyIdentity(actor, partyA.party.id, 'إعادة التحقق', {
          prismaOverride: prismaB,
        });
        expect(revealedAfter.number).toBe(rawNationalId);
      } finally {
        await prismaB.$disconnect();
      }
    } finally {
      await dedicatedDbB.drop();
    }
  }, 60000);

  it('demonstrates cold-startup subprocess execution with key custody and missing-key fail-closed', async () => {
    const rawNationalId = '29005051234567';

    // 1. Setup Party in Primary DB
    const party = await saveParty(actor, {
      kind: 'PERSON',
      name: 'سعاد حسني - اختبار العمليات المستقلة',
      identity: {
        identificationType: 'NATIONAL_ID',
        number: rawNationalId,
      },
      idempotencyKey: `recovery-subprocess-${crypto.randomUUID()}`,
    });
    partyIds.push(party.party.id);

    const fs = await import('fs');
    const tsxCli = path.resolve(process.cwd(), 'node_modules/tsx/dist/cli.mjs');
    const tempScriptPath = path.resolve(process.cwd(), `tests/scratch-cold-startup-${crypto.randomUUID()}.ts`);

    try {
      fs.writeFileSync(
        tempScriptPath,
        `
        import { revealPartyIdentity } from '@/modules/parties/service';
        async function run() {
          const actor = {
            id: '${actor.id}',
            name: 'Owner',
            email: '${actor.email}',
            role: 'OWNER',
            sessionId: 's1',
            twoFactorVerified: true
          };
          const res = await revealPartyIdentity(actor, '${party.party.id}', 'cold-start test');
          const isVerified = res.number === '${rawNationalId}' && res.identificationType === 'NATIONAL_ID';
          if (isVerified) {
            console.log('REVEAL_VERIFICATION:SUCCESS');
            process.exit(0);
          } else {
            console.error('REVEAL_VERIFICATION:MISMATCH');
            process.exit(2);
          }
        }
        run().catch(err => {
          console.error(err);
          process.exit(1);
        });
        `,
        'utf8'
      );

      // 2. Subprocess run with matching key custody
      const subEnvSuccess: NodeJS.ProcessEnv = {
        ...process.env,
        DATABASE_URL: getEnv().DATABASE_URL,
        PARTY_IDENTITY_ENCRYPTION_KEY: SYNTHETIC_ENCRYPTION_KEY,
        PARTY_IDENTITY_KEY_ID: SYNTHETIC_KEY_ID,
        NODE_ENV: 'production',
      };
      delete subEnvSuccess.TEST_DATABASE_URL;

      const subSuccess = spawnSync(process.execPath, [tsxCli, tempScriptPath], {
        env: subEnvSuccess,
        encoding: 'utf-8',
        timeout: 45000,
      });

      if (subSuccess.status !== 0) {
        console.error('SUBPROCESS_FAILURE_STDERR:', subSuccess.stderr);
        console.error('SUBPROCESS_FAILURE_STDOUT:', subSuccess.stdout);
      }

      expect(subSuccess.status).toBe(0);
      expect(subSuccess.stdout).toContain('REVEAL_VERIFICATION:SUCCESS');
      expect(subSuccess.stdout).not.toContain(rawNationalId);

      // 3. Subprocess run WITHOUT key custody (missing key fails closed)
      const envWithoutKey: NodeJS.ProcessEnv = {
        ...process.env,
        DATABASE_URL: getEnv().DATABASE_URL,
        NODE_ENV: 'production',
      };
      delete envWithoutKey.TEST_DATABASE_URL;
      delete envWithoutKey.PARTY_IDENTITY_ENCRYPTION_KEY;
      delete envWithoutKey.PARTY_IDENTITY_KEY_ID;

      const subFail = spawnSync(process.execPath, [tsxCli, tempScriptPath], {
        env: envWithoutKey,
        encoding: 'utf-8',
        timeout: 45000,
      });

      // Subprocess must exit with non-zero error code
      expect(subFail.status).not.toBe(0);

      // 4. Verify database record remains completely intact after subprocess failure
      const dbRecord = await defaultPrisma.partyIdentity.findFirstOrThrow({
        where: { partyId: party.party.id },
      });
      expect(dbRecord.lastFour).toBe('4567');
      expect(dbRecord.keyId).toBe(SYNTHETIC_KEY_ID);
    } finally {
      if (fs.existsSync(tempScriptPath)) {
        fs.unlinkSync(tempScriptPath);
      }
    }
  }, 90000);
});


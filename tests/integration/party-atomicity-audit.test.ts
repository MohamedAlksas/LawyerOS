import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import crypto from 'crypto';
import { getPrismaClient } from '@/lib/auth';
import { saveParty } from '@/modules/parties/service';
import {
  createSyntheticActor,
  cleanupPartyFixtures,
  setupTestEncryptionKeys,
} from '../helpers/party-test-helper';

describe('T05-05: Transaction Atomicity & Redacted Audit Logging (Integration)', () => {
  const prisma = getPrismaClient();
  const actor = createSyntheticActor();
  const partyIds: string[] = [];

  beforeAll(() => {
    setupTestEncryptionKeys();
  });

  afterAll(async () => {
    await cleanupPartyFixtures(prisma, partyIds);
  });

  it('rolls back completely when audit insertion fails, leaving zero partial state', async () => {
    const key = `atomicity-fail-audit-${crypto.randomUUID()}`;
    const partyName = `يوسف الصديق المنكوب-${crypto.randomUUID().slice(0, 6)}`;

    // Trigger transaction with simulated audit failure at the Seam
    await expect(
      saveParty(
        actor,
        {
          kind: 'PERSON',
          name: partyName,
          identity: {
            identificationType: 'NATIONAL_ID',
            number: '29101011234567',
          },
          idempotencyKey: key,
        },
        { simulateAuditFailure: true }
      )
    ).rejects.toThrowError('SIMULATED_AUDIT_TRANSACTION_FAILURE');

    // 1. Verify party record was NOT created in database
    const partyRow = await prisma.party.findFirst({
      where: { name: partyName },
    });
    expect(partyRow).toBeNull();

    // 2. Verify party identity was NOT created
    const identityRow = await prisma.partyIdentity.findFirst({
      where: { lastFour: '4567', party: { name: partyName } },
    });
    expect(identityRow).toBeNull();

    // 3. Verify no poisoned idempotency record was left behind
    const idempRow = await prisma.idempotencyRecord.findUnique({
      where: {
        actorId_commandType_key: {
          actorId: actor.id,
          commandType: 'saveParty',
          key,
        },
      },
    });
    expect(idempRow).toBeNull();

    // 4. Retry with the SAME key and payload now succeeds without error
    const retryResult = await saveParty(actor, {
      kind: 'PERSON',
      name: partyName,
      identity: {
        identificationType: 'NATIONAL_ID',
        number: '29101011234567',
      },
      idempotencyKey: key,
    });

    expect(retryResult.success).toBe(true);
    partyIds.push(retryResult.party.id);

    // Verify record now exists properly
    const savedParty = await prisma.party.findUnique({
      where: { id: retryResult.party.id },
    });
    expect(savedParty).toBeDefined();
    expect(savedParty?.name).toBe(partyName);
  });

  it('records immutable audit event with redacted changes (never plaintext identity number)', async () => {
    const partyName = `عادل إمام-${crypto.randomUUID().slice(0, 6)}`;
    const rawNationalId = '26201011234567';

    const result = await saveParty(actor, {
      kind: 'PERSON',
      name: partyName,
      identity: {
        identificationType: 'NATIONAL_ID',
        number: rawNationalId,
      },
      idempotencyKey: `audit-redaction-${crypto.randomUUID()}`,
    });
    partyIds.push(result.party.id);

    const auditEvent = await prisma.auditEvent.findFirstOrThrow({
      where: {
        entityType: 'Party',
        entityId: result.party.id,
        action: 'CREATE_PARTY',
      },
    });

    expect(auditEvent.userId).toBe(actor.id);
    expect(auditEvent.action).toBe('CREATE_PARTY');

    const changes = auditEvent.changedFields as Record<string, unknown>;
    expect(changes).toBeDefined();
    expect(changes.name).toBe(partyName);

    // Verify plaintext raw national ID is completely absent from audit log
    const auditString = JSON.stringify(auditEvent);
    expect(auditString).not.toContain(rawNationalId);

    // Masked identity summary is present
    const identityChange = changes.identity as { identificationType: string; lastFour: string };
    expect(identityChange).toBeDefined();
    expect(identityChange.identificationType).toBe('NATIONAL_ID');
    expect(identityChange).not.toHaveProperty('lastFour');
  });
});


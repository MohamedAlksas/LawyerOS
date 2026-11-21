import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import crypto from 'crypto';
import { getPrismaClient } from '@/lib/auth';
import { computePayloadHash, IdempotencyPayloadMismatchError } from '@/lib/idempotency';
import { savePowerOfAttorneySchema } from '@/modules/parties/validation';
import {
  saveParty,
  getClientProfile,
  addCommunicationNote,
  savePowerOfAttorney,
  ConcurrencyConflictError,
} from '@/modules/parties/service';
import {
  createSyntheticActor,
  cleanupPartyFixtures,
  setupTestEncryptionKeys,
} from '../helpers/party-test-helper';

describe('T05-09: Communication Notes & Powers of Attorney (Integration)', () => {
  const prisma = getPrismaClient();
  const actor = createSyntheticActor();
  const partyIds: string[] = [];
  let partyId: string;

  beforeAll(async () => {
    setupTestEncryptionKeys();

    const created = await saveParty(actor, {
      kind: 'PERSON',
      name: 'صلاح الدين الأيوبي',
      idempotencyKey: `comm-poa-party-setup-${crypto.randomUUID()}`,
    });
    partyId = created.party.id;
    partyIds.push(partyId);
  });

  afterAll(async () => {
    await cleanupPartyFixtures(prisma, partyIds);
  });

  describe('Communication Notes Timeline', () => {
    it('persists communication note with Cairo instant and optional follow-up date', async () => {
      const instant = '2026-11-17T14:30:00.000Z';
      const note = await addCommunicationNote(actor, {
        partyId,
        communicationAt: instant,
        channel: 'PHONE',
        summary: 'مكالمة هاتفية مع العميل لتحديد جلسة الاستئناف وطلب أصل التوكيل.',
        followUpRequired: true,
        followUpDate: '2026-11-25',
        idempotencyKey: `comm-note-test-${crypto.randomUUID()}`,
      });

      expect(note.id).toBeDefined();
      expect(note.partyId).toBe(partyId);
      expect(note.channel).toBe('PHONE');
      expect(note.summary).toContain('مكالمة هاتفية مع العميل');
      expect(note.followUpRequired).toBe(true);
      expect(note.followUpDate).toBe('2026-11-25');

      // Verify note appears in client profile in descending order
      const profile = await getClientProfile(actor, partyId);
      expect(profile.communicationNotes.length).toBeGreaterThan(0);
      const found = profile.communicationNotes.find((n) => n.id === note.id);
      expect(found).toBeDefined();
      expect(found?.communicationAt).toBe(instant);
    });
  });

  describe('Powers of Attorney Metadata & Human Review', () => {
    it('persists POA preserving leading zeros in number text and unreviewed by default', async () => {
      const poa = await savePowerOfAttorney(actor, {
        partyId,
        poaNumberText: '0045/ب',
        poaYearLabel: '2026',
        notarizationOffice: 'مكتب توثيق قصر النيل النموذجي',
        poaType: 'GENERAL',
        issueDate: '2026-05-10',
        idempotencyKey: `poa-metadata-${crypto.randomUUID()}`,
      });

      expect(poa.id).toBeDefined();
      expect(poa.poaNumberText).toBe('0045/ب'); // Leading zero strictly preserved!
      expect(poa.poaYearLabel).toBe('2026');
      expect(poa.notarizationOffice).toBe('مكتب توثيق قصر النيل النموذجي');
      expect(poa.poaType).toBe('GENERAL');
      expect(poa.issueDate).toBe('2026-05-10');
      expect(poa.humanReviewStatus).toBe('UNREVIEWED');
      expect(poa.version).toBe(1);

      // Verify in client profile
      const profile = await getClientProfile(actor, partyId);
      const foundPoa = profile.powersOfAttorney.find((p) => p.id === poa.id);
      expect(foundPoa).toBeDefined();
      expect(foundPoa?.poaNumberText).toBe('0045/ب');
    });

    it('updates POA human review status with optimistic version protection', async () => {
      const created = await savePowerOfAttorney(actor, {
        partyId,
        poaNumberText: '0123/ج',
        poaYearLabel: '2025',
        notarizationOffice: 'مكتب توثيق الدقي',
        poaType: 'LITIGATION',
        idempotencyKey: `poa-review-init-${crypto.randomUUID()}`,
      });

      // Update status to VALID with expectedVersion 1
      const updated = await savePowerOfAttorney(actor, {
        id: created.id,
        partyId,
        poaNumberText: created.poaNumberText,
        poaYearLabel: created.poaYearLabel,
        notarizationOffice: created.notarizationOffice,
        poaType: created.poaType,
        humanReviewStatus: 'VALID',
        notes: 'تمت مراجعة أصل التوكيل والتأكد من سريانه وصلاحيته للحضور أمام المحكمة',
        expectedVersion: 1,
        idempotencyKey: `poa-review-update-${crypto.randomUUID()}`,
      });

      expect(updated.version).toBe(2);
      expect(updated.humanReviewStatus).toBe('VALID');
      expect(updated.humanReviewedAt).toBeDefined();
      expect(updated.humanReviewedById).toBe(actor.id);

      const editable = {
        id: created.id,
        partyId,
        poaNumberText: created.poaNumberText,
        poaYearLabel: created.poaYearLabel,
        notarizationOffice: 'مكتب توثيق اختباري',
        poaType: created.poaType,
      };
      const metadataOnly = await savePowerOfAttorney(actor, {
        ...editable,
        expectedVersion: updated.version,
        idempotencyKey: `poa-metadata-${crypto.randomUUID()}`,
      });
      expect(metadataOnly.humanReviewStatus).toBe('VALID');
      expect(metadataOnly.humanReviewedAt).toBe(updated.humanReviewedAt);
      expect(metadataOnly.humanReviewedById).toBe(actor.id);
      const requestWithoutStatus = {
        ...editable,
        expectedVersion: metadataOnly.version,
        idempotencyKey: `poa-review-reset-${crypto.randomUUID()}`,
      };
      const resetRequest = { ...requestWithoutStatus, humanReviewStatus: 'UNREVIEWED' as const };
      const resetReview = await savePowerOfAttorney(actor, resetRequest);
      const replayMetadata = {
        isReplay: true,
        currentVersion: resetReview.version,
        operationVersion: resetReview.version,
      };
      await expect(savePowerOfAttorney(actor, resetRequest)).resolves.toEqual({
        ...resetReview, ...replayMetadata,
      });
      await expect(savePowerOfAttorney(actor, requestWithoutStatus)).rejects.toThrow(
        IdempotencyPayloadMismatchError,
      );
      // Before this change the old schema defaulted omitted update status to UNREVIEWED.
      const legacyDigest = computePayloadHash(savePowerOfAttorneySchema.parse(resetRequest));
      await prisma.idempotencyRecord.updateMany({
        where: { actorId: actor.id, key: resetRequest.idempotencyKey },
        data: { payloadHash: legacyDigest },
      });
      await expect(savePowerOfAttorney(actor, requestWithoutStatus)).resolves.toEqual({
        ...resetReview, ...replayMetadata,
      });
      expect(resetReview.humanReviewStatus).toBe('UNREVIEWED');
      expect(resetReview.humanReviewedAt).toBeNull();
      expect(resetReview.humanReviewedById).toBeNull();

      // Attempting to update with stale version 1 must fail
      await expect(
        savePowerOfAttorney(actor, {
          id: created.id,
          partyId,
          poaNumberText: created.poaNumberText,
          poaYearLabel: created.poaYearLabel,
          notarizationOffice: created.notarizationOffice,
          poaType: created.poaType,
          humanReviewStatus: 'REVOKED',
          expectedVersion: 1, // Stale!
          idempotencyKey: `poa-review-stale-${crypto.randomUUID()}`,
        })
      ).rejects.toThrowError(ConcurrencyConflictError);
    });
  });
});



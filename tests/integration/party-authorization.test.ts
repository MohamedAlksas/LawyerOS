import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import crypto from 'crypto';
import { getPrismaClient } from '@/lib/auth';
import { getEnv } from '@/lib/env';
import {
  saveParty,
  searchParties,
  getClientProfile,
  addCommunicationNote,
  savePowerOfAttorney,
  revealPartyIdentity,
} from '@/modules/parties/service';
import {
  savePartyAction,
  searchPartiesAction,
  getClientProfileAction,
  addCommunicationNoteAction,
  savePowerOfAttorneyAction,
  revealPartyIdentityAction,
  checkPartyDuplicatesAction,
} from '@/modules/parties/actions';
import { AuthorizationError } from '@/modules/identity/types';
import type { SavePartyInput } from '@/modules/parties/types';
import {
  createSyntheticActor,
  createSyntheticMaintainer,
  cleanupPartyFixtures,
  setupTestEncryptionKeys,
} from '../helpers/party-test-helper';

let mockRequestHeaders: Headers = new Headers();

vi.mock('next/headers', () => {
  return {
    headers: async () => mockRequestHeaders,
  };
});

function signSessionTokenCookie(token: string, secret: string): string {
  const signature = crypto.createHmac('sha256', secret).update(token).digest('base64');
  return encodeURIComponent(`${token}.${signature}`);
}

function setTestRequest(token?: string, origin?: string): void {
  const env = getEnv();
  const h = new Headers();
  if (token) {
    const signed = signSessionTokenCookie(token, env.BETTER_AUTH_SECRET);
    h.set('cookie', `better-auth.session_token=${signed}`);
  }
  if (origin !== undefined) {
    h.set('origin', origin);
  } else {
    h.set('origin', env.BETTER_AUTH_URL);
  }
  mockRequestHeaders = h;
}

function expectFailure(res: {
  success: boolean;
  error?: string;
  code?: string;
  fieldErrors?: Record<string, string>;
  data?: unknown;
}) {
  expect(res.success).toBe(false);
  expect(res.data).toBeUndefined();
  return res as { success: false; error: string; code?: string; fieldErrors?: Record<string, string> };
}

describe('T05-06: Server-Side Authorization & Role Access Controls (Integration)', () => {
  const prisma = getPrismaClient();
  const ownerActor = createSyntheticActor();
  const maintainerActor = createSyntheticMaintainer();
  const partyIds: string[] = [];
  const userIds: string[] = [];
  const sessionIds: string[] = [];
  let existingPartyId: string;

  // Real DB Users and Sessions
  let verifiedOwnerSessionToken: string;
  let unverifiedMfaOwnerSessionToken: string;
  let maintainerSessionToken: string;
  let expiredSessionToken: string;

  beforeAll(async () => {
    setupTestEncryptionKeys();

    // 1. Setup existing test party
    const party = await saveParty(ownerActor, {
      kind: 'PERSON',
      name: 'عميل اختبار الصلاحيات',
      primaryPhone: '01099887766',
      identity: {
        identificationType: 'NATIONAL_ID',
        number: '28001011234567',
      },
      idempotencyKey: `auth-test-setup-1-${crypto.randomUUID()}`,
    });
    existingPartyId = party.party.id;
    partyIds.push(existingPartyId);

    // 2. Setup Real DB Owner with Completed 2FA
    const verifiedOwnerUser = await prisma.user.create({
      data: {
        id: `user-owner-verified-${crypto.randomUUID()}`,
        name: 'مالك مصرح مكتمل المصادقة',
        email: `owner-verified-${crypto.randomUUID()}@lawoffice.test`,
        role: 'OWNER',
        twoFactorEnabled: true,
        emailVerified: true,
        credentialVersion: 1,
      },
    });
    userIds.push(verifiedOwnerUser.id);

    const verifiedOwnerSession = await prisma.session.create({
      data: {
        id: `session-owner-verified-${crypto.randomUUID()}`,
        userId: verifiedOwnerUser.id,
        token: crypto.randomBytes(32).toString('hex'),
        expiresAt: new Date(Date.now() + 12 * 60 * 60 * 1000),
        credentialVersion: 1,
      },
    });
    sessionIds.push(verifiedOwnerSession.id);
    verifiedOwnerSessionToken = verifiedOwnerSession.token;

    await prisma.twoFactor.create({
      data: {
        id: `tf-owner-verified-${crypto.randomUUID()}`,
        userId: verifiedOwnerUser.id,
        secret: 'TESTSECRET2FAVERIFIED',
        backupCodes: '[]',
        verified: true,
      },
    });

    // 3. Setup Real DB Owner with Incomplete / Pending 2FA (R2-01, R2-03)
    const incompleteMfaUser = await prisma.user.create({
      data: {
        id: `user-owner-nomfa-${crypto.randomUUID()}`,
        name: 'مالك غير مكتمل المصادقة الثنائية',
        email: `owner-nomfa-${crypto.randomUUID()}@lawoffice.test`,
        role: 'OWNER',
        twoFactorEnabled: true,
        emailVerified: true,
        credentialVersion: 1,
      },
    });
    userIds.push(incompleteMfaUser.id);

    const incompleteMfaSession = await prisma.session.create({
      data: {
        id: `session-owner-nomfa-${crypto.randomUUID()}`,
        userId: incompleteMfaUser.id,
        token: crypto.randomBytes(32).toString('hex'),
        expiresAt: new Date(Date.now() + 12 * 60 * 60 * 1000),
        credentialVersion: 1,
      },
    });
    sessionIds.push(incompleteMfaSession.id);
    unverifiedMfaOwnerSessionToken = incompleteMfaSession.token;

    await prisma.twoFactor.create({
      data: {
        id: `tf-owner-nomfa-${crypto.randomUUID()}`,
        userId: incompleteMfaUser.id,
        secret: 'TESTSECRET2FAUNVERIFIED',
        backupCodes: '[]',
        verified: false, // Explicitly unverified MFA record (R2-01, R2-03)
      },
    });

    // 4. Setup Real DB Maintainer User and Session
    const maintainerUser = await prisma.user.create({
      data: {
        id: `user-maintainer-${crypto.randomUUID()}`,
        name: 'مهندس صيانة تقني',
        email: `maintainer-${crypto.randomUUID()}@lawoffice.test`,
        role: 'MAINTAINER',
        emailVerified: true,
        credentialVersion: 1,
      },
    });
    userIds.push(maintainerUser.id);

    const maintainerSession = await prisma.session.create({
      data: {
        id: `session-maint-${crypto.randomUUID()}`,
        userId: maintainerUser.id,
        token: crypto.randomBytes(32).toString('hex'),
        expiresAt: new Date(Date.now() + 12 * 60 * 60 * 1000),
        credentialVersion: 1,
      },
    });
    sessionIds.push(maintainerSession.id);
    maintainerSessionToken = maintainerSession.token;

    // 5. Setup Expired Session
    const expiredUser = await prisma.user.create({
      data: {
        id: `user-expired-${crypto.randomUUID()}`,
        name: 'مستخدم منتهي الجلسة',
        email: `expired-${crypto.randomUUID()}@lawoffice.test`,
        role: 'OWNER',
        emailVerified: true,
        credentialVersion: 1,
      },
    });
    userIds.push(expiredUser.id);

    const expiredSession = await prisma.session.create({
      data: {
        id: `session-expired-${crypto.randomUUID()}`,
        userId: expiredUser.id,
        token: crypto.randomBytes(32).toString('hex'),
        expiresAt: new Date(Date.now() - 60 * 1000), // Expired 1 minute ago
        credentialVersion: 1,
      },
    });
    sessionIds.push(expiredSession.id);
    expiredSessionToken = expiredSession.token;
  });

  afterAll(async () => {
    await cleanupPartyFixtures(prisma, partyIds);
    await prisma.session.deleteMany({ where: { id: { in: sessionIds } } }).catch(() => {});
    await prisma.twoFactor.deleteMany({ where: { userId: { in: userIds } } }).catch(() => {});
    await prisma.user.deleteMany({ where: { id: { in: userIds } } }).catch(() => {});
  });

  describe('Service-Level Role Policy Checks', () => {
    it('strictly forbids MAINTAINER from creating new party records', async () => {
      await expect(
        saveParty(maintainerActor, {
          kind: 'PERSON',
          name: 'محاولة اختراق الصيانة',
          idempotencyKey: 'maint-create-attempt',
        })
      ).rejects.toThrowError(AuthorizationError);
    });

    it('strictly forbids MAINTAINER from searching parties', async () => {
      await expect(
        searchParties(maintainerActor, { query: 'عميل' })
      ).rejects.toThrowError(AuthorizationError);
    });

    it('strictly forbids MAINTAINER from viewing client profile', async () => {
      await expect(
        getClientProfile(maintainerActor, existingPartyId)
      ).rejects.toThrowError(AuthorizationError);
    });

    it('strictly forbids MAINTAINER from adding communication notes', async () => {
      await expect(
        addCommunicationNote(maintainerActor, {
          partyId: existingPartyId,
          communicationAt: new Date().toISOString(),
          channel: 'PHONE',
          summary: 'ملاحظة صيانة غير مصرح بها',
          idempotencyKey: 'maint-comm-attempt',
        })
      ).rejects.toThrowError(AuthorizationError);
    });

    it('strictly forbids MAINTAINER from saving powers of attorney', async () => {
      await expect(
        savePowerOfAttorney(maintainerActor, {
          partyId: existingPartyId,
          poaNumberText: '001/أ',
          poaYearLabel: '2026',
          notarizationOffice: 'مكتب التوثيق',
          poaType: 'GENERAL',
          idempotencyKey: 'maint-poa-attempt',
        })
      ).rejects.toThrowError(AuthorizationError);
    });

    it('strictly forbids MAINTAINER from revealing identity numbers', async () => {
      await expect(
        revealPartyIdentity(maintainerActor, existingPartyId, 'محاولة غير مصرحة')
      ).rejects.toThrowError(AuthorizationError);
    });
  });

  describe('Server Action Entry Points: Negative Authorization Checks (SPEC-02, R2-01, R2-03)', () => {
    it('rejects unauthenticated requests across all 7 entry points returning zero protected data', async () => {
      setTestRequest(undefined);

      const r1 = await savePartyAction({
        kind: 'PERSON',
        name: 'محاولة بدون مصادقة',
        idempotencyKey: `unauth-${crypto.randomUUID()}`,
      });
      expect(expectFailure(r1).code).toBe('UNAUTHENTICATED');

      const r2 = await searchPartiesAction({ query: 'عميل' });
      expect(expectFailure(r2).code).toBe('UNAUTHENTICATED');

      const r3 = await getClientProfileAction(existingPartyId);
      expect(expectFailure(r3).code).toBe('UNAUTHENTICATED');

      const r4 = await addCommunicationNoteAction({
        partyId: existingPartyId,
        communicationAt: '2026-11-18T10:00:00.000Z',
        channel: 'PHONE',
        summary: 'محاولة غير مصرح بها',
        idempotencyKey: `unauth-comm-${crypto.randomUUID()}`,
      });
      expect(expectFailure(r4).code).toBe('UNAUTHENTICATED');

      const r5 = await savePowerOfAttorneyAction({
        partyId: existingPartyId,
        poaNumberText: '11/أ',
        poaYearLabel: '2026',
        notarizationOffice: 'مكتب التوثيق',
        poaType: 'GENERAL',
        idempotencyKey: `unauth-poa-${crypto.randomUUID()}`,
      });
      expect(expectFailure(r5).code).toBe('UNAUTHENTICATED');

      const r6 = await revealPartyIdentityAction(existingPartyId, 'اختبار');
      expect(expectFailure(r6).code).toBe('UNAUTHENTICATED');

      const r7 = await checkPartyDuplicatesAction('عميل');
      expect(expectFailure(r7).code).toBe('UNAUTHENTICATED');
    });

    it('rejects expired sessions across all server action entry points', async () => {
      setTestRequest(expiredSessionToken);

      const r1 = await savePartyAction({
        kind: 'PERSON',
        name: 'محاولة بجلسة منتهية',
        idempotencyKey: `expired-${crypto.randomUUID()}`,
      });
      expect(['SESSION_EXPIRED', 'UNAUTHENTICATED']).toContain(expectFailure(r1).code);

      const r2 = await searchPartiesAction({ query: 'عميل' });
      expect(['SESSION_EXPIRED', 'UNAUTHENTICATED']).toContain(expectFailure(r2).code);

      const r3 = await getClientProfileAction(existingPartyId);
      expect(['SESSION_EXPIRED', 'UNAUTHENTICATED']).toContain(expectFailure(r3).code);

      const r4 = await addCommunicationNoteAction({
        partyId: existingPartyId,
        communicationAt: '2026-11-18T10:00:00.000Z',
        channel: 'PHONE',
        summary: 'محاولة بجلسة منتهية',
        idempotencyKey: `expired-comm-${crypto.randomUUID()}`,
      });
      expect(['SESSION_EXPIRED', 'UNAUTHENTICATED']).toContain(expectFailure(r4).code);

      const r5 = await savePowerOfAttorneyAction({
        partyId: existingPartyId,
        poaNumberText: '12/أ',
        poaYearLabel: '2026',
        notarizationOffice: 'مكتب التوثيق',
        poaType: 'GENERAL',
        idempotencyKey: `expired-poa-${crypto.randomUUID()}`,
      });
      expect(['SESSION_EXPIRED', 'UNAUTHENTICATED']).toContain(expectFailure(r5).code);

      const r6 = await revealPartyIdentityAction(existingPartyId, 'اختبار');
      expect(['SESSION_EXPIRED', 'UNAUTHENTICATED']).toContain(expectFailure(r6).code);

      const r7 = await checkPartyDuplicatesAction('عميل');
      expect(['SESSION_EXPIRED', 'UNAUTHENTICATED']).toContain(expectFailure(r7).code);
    });

    it('rejects revoked sessions across all server action entry points (R3-04)', async () => {
      const nonExistentToken = crypto.randomBytes(32).toString('hex');
      setTestRequest(nonExistentToken);

      const r1 = await searchPartiesAction({ query: 'عميل' });
      expect(expectFailure(r1).code).toBe('UNAUTHENTICATED');

      const r2 = await getClientProfileAction(existingPartyId);
      expect(expectFailure(r2).code).toBe('UNAUTHENTICATED');

      const r3 = await checkPartyDuplicatesAction('عميل');
      expect(expectFailure(r3).code).toBe('UNAUTHENTICATED');

      const r4 = await savePartyAction({
        kind: 'PERSON',
        name: 'عميل بجلسة ملغاة',
        idempotencyKey: `revoked-save-${crypto.randomUUID()}`,
      });
      expect(expectFailure(r4).code).toBe('UNAUTHENTICATED');

      const r5 = await addCommunicationNoteAction({
        partyId: existingPartyId,
        communicationAt: '2026-11-18T10:00:00.000Z',
        channel: 'PHONE',
        summary: 'محاولة تدوين بجلسة ملغاة',
        idempotencyKey: `revoked-note-${crypto.randomUUID()}`,
      });
      expect(expectFailure(r5).code).toBe('UNAUTHENTICATED');

      const r6 = await savePowerOfAttorneyAction({
        partyId: existingPartyId,
        poaNumberText: '99/أ',
        poaYearLabel: '2026',
        notarizationOffice: 'مكتب التوثيق',
        poaType: 'GENERAL',
        idempotencyKey: `revoked-poa-${crypto.randomUUID()}`,
      });
      expect(expectFailure(r6).code).toBe('UNAUTHENTICATED');

      const r7 = await revealPartyIdentityAction(existingPartyId, 'محاولة فك تشفير بجلسة ملغاة');
      expect(expectFailure(r7).code).toBe('UNAUTHENTICATED');
    });

    it('rejects unverified MFA session for OWNER role across all operation families (R2-01, R2-03)', async () => {
      setTestRequest(unverifiedMfaOwnerSessionToken);

      const r1 = await savePartyAction({
        kind: 'PERSON',
        name: 'عميل بمصادقة ناقصة',
        idempotencyKey: `nomfa-${crypto.randomUUID()}`,
      });
      expect(expectFailure(r1).code).toBe('MFA_REQUIRED');

      const r2 = await searchPartiesAction({ query: 'عميل' });
      expect(expectFailure(r2).code).toBe('MFA_REQUIRED');

      const r3 = await getClientProfileAction(existingPartyId);
      expect(expectFailure(r3).code).toBe('MFA_REQUIRED');

      const r4 = await addCommunicationNoteAction({
        partyId: existingPartyId,
        communicationAt: '2026-11-18T10:00:00.000Z',
        channel: 'PHONE',
        summary: 'محاولة بدون إكمال MFA',
        idempotencyKey: `nomfa-comm-${crypto.randomUUID()}`,
      });
      expect(expectFailure(r4).code).toBe('MFA_REQUIRED');

      const r5 = await savePowerOfAttorneyAction({
        partyId: existingPartyId,
        poaNumberText: '13/أ',
        poaYearLabel: '2026',
        notarizationOffice: 'مكتب التوثيق',
        poaType: 'GENERAL',
        idempotencyKey: `nomfa-poa-${crypto.randomUUID()}`,
      });
      expect(expectFailure(r5).code).toBe('MFA_REQUIRED');

      const r6 = await revealPartyIdentityAction(existingPartyId, 'اختبار');
      expect(expectFailure(r6).code).toBe('MFA_REQUIRED');

      const r7 = await checkPartyDuplicatesAction('عميل');
      expect(expectFailure(r7).code).toBe('MFA_REQUIRED');
    });

    it('rejects forged runtime options attempting to bypass MFA (R2-01)', async () => {
      setTestRequest(unverifiedMfaOwnerSessionToken);

      // Attempting to inject allowIncompleteMfa: true as an extra parameter
      const savePartyWithExtraArg = savePartyAction as unknown as (
        input: unknown,
        options?: unknown
      ) => ReturnType<typeof savePartyAction>;
      const r1 = await savePartyWithExtraArg(
        {
          kind: 'PERSON',
          name: 'عميل محاولة تجاوز',
          idempotencyKey: `nomfa-forged-${crypto.randomUUID()}`,
        },
        { allowIncompleteMfa: true }
      );
      expect(expectFailure(r1).code).toBe('MFA_REQUIRED');

      const revealPartyWithExtraArg = revealPartyIdentityAction as unknown as (
        partyId: string,
        reason?: string,
        options?: unknown
      ) => ReturnType<typeof revealPartyIdentityAction>;
      const r2 = await revealPartyWithExtraArg(
        existingPartyId,
        'سبب التجاوز',
        { allowIncompleteMfa: true }
      );
      expect(expectFailure(r2).code).toBe('MFA_REQUIRED');
    });

    it('rejects cross-origin requests from untrusted origins with FORBIDDEN (R2-01, R2-03)', async () => {
      setTestRequest(verifiedOwnerSessionToken, 'http://untrusted-attacker.invalid');

      const r1 = await savePartyAction({
        kind: 'PERSON',
        name: 'عميل هجوم عبر المصدر',
        idempotencyKey: `cors-attack-${crypto.randomUUID()}`,
      });
      expect(expectFailure(r1).code).toBe('FORBIDDEN');

      const r2 = await addCommunicationNoteAction({
        partyId: existingPartyId,
        communicationAt: '2026-11-18T10:00:00.000Z',
        channel: 'PHONE',
        summary: 'ملاحظة عبر مصدر غير موثوق',
        idempotencyKey: `cors-comm-${crypto.randomUUID()}`,
      });
      expect(expectFailure(r2).code).toBe('FORBIDDEN');
    });

    it('rejects MAINTAINER role from executing client data actions across all entry points', async () => {
      setTestRequest(maintainerSessionToken);

      const r1 = await savePartyAction({
        kind: 'PERSON',
        name: 'محاولة صيانة عبر Server Action',
        idempotencyKey: `maint-action-${crypto.randomUUID()}`,
      });
      expect(expectFailure(r1).code).toBe('FORBIDDEN');

      const r2 = await searchPartiesAction({ query: 'عميل' });
      expect(expectFailure(r2).code).toBe('FORBIDDEN');

      const r3 = await getClientProfileAction(existingPartyId);
      expect(expectFailure(r3).code).toBe('FORBIDDEN');

      const r4 = await addCommunicationNoteAction({
        partyId: existingPartyId,
        communicationAt: '2026-11-18T10:00:00.000Z',
        channel: 'PHONE',
        summary: 'محاولة صيانة لتسجيل ملاحظة',
        idempotencyKey: `maint-comm-${crypto.randomUUID()}`,
      });
      expect(expectFailure(r4).code).toBe('FORBIDDEN');

      const r5 = await savePowerOfAttorneyAction({
        partyId: existingPartyId,
        poaNumberText: '14/أ',
        poaYearLabel: '2026',
        notarizationOffice: 'مكتب التوثيق',
        poaType: 'GENERAL',
        idempotencyKey: `maint-poa-${crypto.randomUUID()}`,
      });
      expect(expectFailure(r5).code).toBe('FORBIDDEN');

      const r6 = await revealPartyIdentityAction(existingPartyId, 'محاولة صيانة كشف هوية');
      expect(expectFailure(r6).code).toBe('FORBIDDEN');

      const r7 = await checkPartyDuplicatesAction('عميل');
      expect(expectFailure(r7).code).toBe('FORBIDDEN');
    });

    it('rejects forged client inputs injecting actorId, role, or userId into actions', async () => {
      setTestRequest(verifiedOwnerSessionToken);

      const forgedInput = {
        kind: 'PERSON' as const,
        name: 'عميل بحقول مزورة',
        idempotencyKey: `forged-${crypto.randomUUID()}`,
        actorId: 'forged-attacker-id',
        role: 'OWNER',
        userId: 'forged-user-id',
      };

      const res = await savePartyAction(forgedInput as unknown as SavePartyInput);
      expect(expectFailure(res).code).toBe('VALIDATION_ERROR');
    });

    it('rejects replay after session revocation', async () => {
      // 1. Create temporary session for verified owner
      const tempSession = await prisma.session.create({
        data: {
          id: `session-temp-revoke-${crypto.randomUUID()}`,
          userId: userIds[0],
          token: crypto.randomBytes(32).toString('hex'),
          expiresAt: new Date(Date.now() + 12 * 60 * 60 * 1000),
          credentialVersion: 1,
        },
      });
      sessionIds.push(tempSession.id);
      setTestRequest(tempSession.token);

      // 2. Action succeeds with active session
      const validKey = `temp-replay-test-${crypto.randomUUID()}`;
      const firstRes = await savePartyAction({
        kind: 'PERSON',
        name: 'عميل جلسة مؤقتة',
        idempotencyKey: validKey,
      });
      expect(firstRes.success).toBe(true);
      if (firstRes.success) {
        partyIds.push(firstRes.data.party.id);
      }

      // 3. Revoke the session by deleting it from database
      await prisma.session.delete({ where: { id: tempSession.id } });

      // 4. Replay attempt using the revoked session must fail
      const replayRes = await savePartyAction({
        kind: 'PERSON',
        name: 'عميل جلسة مؤقتة',
        idempotencyKey: validKey,
      });
      expect(expectFailure(replayRes).code).toBe('UNAUTHENTICATED');
    });

    it('sanitizes unexpected internal errors and leaks zero query, table, or schema details (PARENT-01)', async () => {
      setTestRequest(verifiedOwnerSessionToken);

      const res = await getClientProfileAction('not-a-uuid');
      const f = expectFailure(res);
      expect(f.error).not.toMatch(/SELECT|INSERT|UPDATE|DELETE/i);
      expect(f.error).not.toMatch(/public\./i);
      expect(f.error).not.toMatch(/password|secret|key/i);
      expect(f.error).not.toMatch(/[a-zA-Z]:\\|\/var\/|\/home\//);
      expect(f.error.length).toBeGreaterThan(0);
    });
  });

  describe('OWNER Role Execution', () => {
    it('allows verified OWNER to search, view profile, and add communication note', async () => {
      const searchRes = await searchParties(ownerActor, { query: 'عميل اختبار' });
      expect(searchRes.parties.length).toBeGreaterThan(0);

      const profile = await getClientProfile(ownerActor, existingPartyId);
      expect(profile.name).toBe('عميل اختبار الصلاحيات');

      const note = await addCommunicationNote(ownerActor, {
        partyId: existingPartyId,
        communicationAt: '2026-11-18T10:00:00.000Z',
        channel: 'PHONE',
        summary: 'ملاحظة تواصل مصرح بها من المالك',
        idempotencyKey: `owner-comm-allowed-${crypto.randomUUID()}`,
      });
      expect(note.id).toBeDefined();
    });

    it('allows verified OWNER to execute real Server Actions successfully', async () => {
      setTestRequest(verifiedOwnerSessionToken);

      const saveRes = await savePartyAction({
        kind: 'PERSON',
        name: 'عميل مالك ناجح عبر Server Action',
        primaryPhone: '01055443322',
        idempotencyKey: `owner-action-success-${crypto.randomUUID()}`,
      });
      expect(saveRes.success).toBe(true);
      if (saveRes.success) {
        partyIds.push(saveRes.data.party.id);
        expect(saveRes.data.party.name).toBe('عميل مالك ناجح عبر Server Action');
      }

      const dupRes = await checkPartyDuplicatesAction('عميل مالك ناجح عبر Server Action');
      expect(dupRes.success).toBe(true);
    });
  });
});


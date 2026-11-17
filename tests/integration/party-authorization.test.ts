import { describe, it, expect, beforeAll, afterAll } from 'vitest';
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
} from '@/modules/parties/actions';
import { AuthorizationError } from '@/modules/identity/types';
import type { SavePartyInput } from '@/modules/parties/types';
import {
  createSyntheticActor,
  createSyntheticMaintainer,
  cleanupPartyFixtures,
  setupTestEncryptionKeys,
} from '../helpers/party-test-helper';

function signSessionTokenCookie(token: string, secret: string): string {
  const signature = crypto.createHmac('sha256', secret).update(token).digest('base64');
  return encodeURIComponent(`${token}.${signature}`);
}

function makeSessionHeaders(token: string): Headers {
  const env = getEnv();
  const signed = signSessionTokenCookie(token, env.BETTER_AUTH_SECRET);
  return new Headers({
    cookie: `better-auth.session_token=${signed}`,
  });
}

function expectFailure(res: { success: boolean; error?: string; code?: string; fieldErrors?: Record<string, string>; data?: unknown }) {
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

    // 3. Setup Real DB Owner with Incomplete / Pending 2FA
    const incompleteMfaUser = await prisma.user.create({
      data: {
        id: `user-owner-nomfa-${crypto.randomUUID()}`,
        name: 'مالك غير مكتمل المصادقة الثنائية',
        email: `owner-nomfa-${crypto.randomUUID()}@lawoffice.test`,
        role: 'OWNER',
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

  describe('Server Action Entry Points: Negative Authorization Checks (SPEC-02)', () => {
    it('rejects unauthenticated requests across all entry points returning zero protected data', async () => {
      const emptyHeaders = new Headers();

      const r1 = await savePartyAction(
        {
          kind: 'PERSON',
          name: 'محاولة بدون مصادقة',
          idempotencyKey: `unauth-${crypto.randomUUID()}`,
        },
        { headers: emptyHeaders }
      );
      expect(expectFailure(r1).code).toBe('UNAUTHENTICATED');

      const r2 = await searchPartiesAction({ query: 'عميل' }, { headers: emptyHeaders });
      expect(expectFailure(r2).code).toBe('UNAUTHENTICATED');

      const r3 = await getClientProfileAction(existingPartyId, { headers: emptyHeaders });
      expect(expectFailure(r3).code).toBe('UNAUTHENTICATED');

      const r4 = await addCommunicationNoteAction(
        {
          partyId: existingPartyId,
          communicationAt: new Date().toISOString(),
          channel: 'PHONE',
          summary: 'محاولة غير مصرح بها',
          idempotencyKey: `unauth-comm-${crypto.randomUUID()}`,
        },
        { headers: emptyHeaders }
      );
      expect(expectFailure(r4).code).toBe('UNAUTHENTICATED');

      const r5 = await savePowerOfAttorneyAction(
        {
          partyId: existingPartyId,
          poaNumberText: '11/أ',
          poaYearLabel: '2026',
          notarizationOffice: 'مكتب التوثيق',
          poaType: 'GENERAL',
          idempotencyKey: `unauth-poa-${crypto.randomUUID()}`,
        },
        { headers: emptyHeaders }
      );
      expect(expectFailure(r5).code).toBe('UNAUTHENTICATED');

      const r6 = await revealPartyIdentityAction(existingPartyId, 'اختبار', {
        headers: emptyHeaders,
      });
      expect(expectFailure(r6).code).toBe('UNAUTHENTICATED');
    });

    it('rejects expired sessions across server action entry points', async () => {
      const expiredHeaders = makeSessionHeaders(expiredSessionToken);

      const res = await getClientProfileAction(existingPartyId, { headers: expiredHeaders });
      const f = expectFailure(res);
      expect(['SESSION_EXPIRED', 'UNAUTHENTICATED']).toContain(f.code);
    });

    it('rejects revoked sessions across server action entry points', async () => {
      const nonExistentToken = crypto.randomBytes(32).toString('hex');
      const revokedHeaders = makeSessionHeaders(nonExistentToken);

      const res = await searchPartiesAction({ query: 'عميل' }, { headers: revokedHeaders });
      expect(expectFailure(res).code).toBe('UNAUTHENTICATED');
    });

    it('rejects pending 2FA / unfinished MFA session for OWNER role', async () => {
      const incompleteHeaders = makeSessionHeaders(unverifiedMfaOwnerSessionToken);

      const res = await savePartyAction(
        {
          kind: 'PERSON',
          name: 'عميل بمصادقة ناقصة',
          idempotencyKey: `nomfa-${crypto.randomUUID()}`,
        },
        { headers: incompleteHeaders }
      );
      expect(expectFailure(res).code).toBe('MFA_REQUIRED');
    });

    it('rejects MAINTAINER role from executing client data actions', async () => {
      const maintainerHeaders = makeSessionHeaders(maintainerSessionToken);

      const r1 = await savePartyAction(
        {
          kind: 'PERSON',
          name: 'محاولة صيانة عبر Server Action',
          idempotencyKey: `maint-action-${crypto.randomUUID()}`,
        },
        { headers: maintainerHeaders }
      );
      expect(expectFailure(r1).code).toBe('FORBIDDEN');

      const r2 = await getClientProfileAction(existingPartyId, { headers: maintainerHeaders });
      expect(expectFailure(r2).code).toBe('FORBIDDEN');
    });

    it('rejects forged client inputs injecting actorId, role, or userId into actions', async () => {
      const verifiedHeaders = makeSessionHeaders(verifiedOwnerSessionToken);

      // Attempting to inject actorId or role into input
      const forgedInput = {
        kind: 'PERSON' as const,
        name: 'عميل بحقول مزورة',
        idempotencyKey: `forged-${crypto.randomUUID()}`,
        actorId: 'forged-attacker-id',
        role: 'OWNER',
        userId: 'forged-user-id',
      };

      const res = await savePartyAction(forgedInput as unknown as SavePartyInput, { headers: verifiedHeaders });
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
      const tempHeaders = makeSessionHeaders(tempSession.token);

      // 2. Action succeeds with active session
      const validKey = `temp-replay-test-${crypto.randomUUID()}`;
      const firstRes = await savePartyAction(
        {
          kind: 'PERSON',
          name: 'عميل جلسة مؤقتة',
          idempotencyKey: validKey,
        },
        { headers: tempHeaders }
      );
      expect(firstRes.success).toBe(true);
      if (firstRes.success) {
        partyIds.push(firstRes.data.party.id);
      }

      // 3. Revoke the session by deleting it from database
      await prisma.session.delete({ where: { id: tempSession.id } });

      // 4. Replay attempt using the revoked session must fail
      const replayRes = await savePartyAction(
        {
          kind: 'PERSON',
          name: 'عميل جلسة مؤقتة',
          idempotencyKey: validKey,
        },
        { headers: tempHeaders }
      );
      expect(expectFailure(replayRes).code).toBe('UNAUTHENTICATED');
    });

    it('sanitizes unexpected internal errors and leaks zero query, table, or schema details (PARENT-01)', async () => {
      const verifiedHeaders = makeSessionHeaders(verifiedOwnerSessionToken);

      // Pass an invalid/non-existent UUID to a query that triggers an internal or DB error,
      // or invoke with a mock that throws an unexpected internal Error
      const res = await getClientProfileAction('not-a-uuid', { headers: verifiedHeaders });
      const f = expectFailure(res);
      // Must not leak SQL queries, schema, tables, or file paths
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
        communicationAt: new Date().toISOString(),
        channel: 'PHONE',
        summary: 'ملاحظة تواصل مصرح بها من المالك',
        idempotencyKey: `owner-comm-allowed-${crypto.randomUUID()}`,
      });
      expect(note.id).toBeDefined();
    });

    it('allows verified OWNER to execute real Server Actions successfully', async () => {
      const verifiedHeaders = makeSessionHeaders(verifiedOwnerSessionToken);

      const saveRes = await savePartyAction(
        {
          kind: 'PERSON',
          name: 'عميل مالك ناجح عبر Server Action',
          primaryPhone: '01055443322',
          idempotencyKey: `owner-action-success-${crypto.randomUUID()}`,
        },
        { headers: verifiedHeaders }
      );
      expect(saveRes.success).toBe(true);
      if (saveRes.success) {
        partyIds.push(saveRes.data.party.id);
        expect(saveRes.data.party.name).toBe('عميل مالك ناجح عبر Server Action');
      }
    });
  });
});


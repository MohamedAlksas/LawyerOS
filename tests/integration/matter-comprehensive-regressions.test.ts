import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import crypto from 'crypto';
import path from 'path';
import { spawnSync } from 'child_process';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { createDedicatedTestDatabase } from '../helpers/test-db';
import * as requireActorModule from '@/modules/identity/require-actor';
import { getPrismaClient } from '@/lib/auth';
import { normalizeArabicText } from '@/lib/normalization';
import {
  openMatter,
  updateMatter,
  linkMatterParty,
  updateMatterParty,
  unlinkMatterParty,
  addProceeding,
  updateProceeding,
  linkProceedingParty,
  unlinkProceedingParty,
  searchMatters,
  getPartyMatterAssociations,
  findSimilarProceedings,
} from '@/modules/matters/matter-service';
import {
  createReferenceItem,
  updateReferenceItem,
  getOfficeSettings,
  updateOfficeSettings,
} from '@/modules/settings/reference-service';
import {
  createReferenceItemAction,
  updateReferenceItemAction,
} from '@/modules/settings/reference-actions';
import {
  createReferenceItemSchema,
  updateReferenceItemSchema,
  updateOfficeSettingsSchema,
  ConcurrencyConflictError as SettingsConcurrencyConflictError,
} from '@/modules/settings/reference-types';
import {
  linkProceedingPartySchema,
  unlinkProceedingPartySchema,
  parseCalendarDateToUtc,
  validateStrictCalendarDate,
  ConcurrencyConflictError,
  MatterValidationError,
} from '@/modules/matters/matter-types';
import {
  createSyntheticActor,
  setupTestEncryptionKeys,
  cleanupPartyFixtures,
} from '../helpers/party-test-helper';
import {
  cleanupMatterFixtures,
  cleanupReferenceFixtures,
} from '../helpers/matter-test-helper';

describe('T06 Comprehensive Review Regressions (C01–C08, C16, C18)', () => {
  const prisma = getPrismaClient();
  const actor = createSyntheticActor();

  const createdMatterIds: string[] = [];
  const createdPartyIds: string[] = [];
  const createdCourtIds: string[] = [];

  beforeAll(() => {
    setupTestEncryptionKeys();
  });

  afterAll(async () => {
    await cleanupMatterFixtures(prisma, createdMatterIds);
    await cleanupReferenceFixtures(prisma, { courtIds: createdCourtIds });
    await cleanupPartyFixtures(prisma, createdPartyIds);
  });

  // Helper to create synthetic party
  async function makeParty(name: string) {
    const p = await prisma.party.create({
      data: {
        kind: 'PERSON',
        name,
        nameNormalized: normalizeArabicText(name),
        createdById: actor.id,
        updatedById: actor.id,
      },
    });
    createdPartyIds.push(p.id);
    return p;
  }

  // Helper to create synthetic court
  async function makeCourt(name: string) {
    const c = await createReferenceItem(actor, {
      type: 'COURT',
      name,
      idempotencyKey: `court-${crypto.randomUUID()}`,
    });
    createdCourtIds.push(c.id);
    return c;
  }

  // =========================================================================
  // C01: Strict proceeding expectedVersion on linkProceedingParty & unlinkProceedingParty
  // =========================================================================
  it('C01: enforces mandatory expectedVersion on proceeding party link/unlink and prevents stale writes', async () => {
    const court = await makeCourt(`C01 Court ${crypto.randomUUID().slice(0, 6)}`);
    const client = await makeParty('طرف فحص النسخة');

    const m = await openMatter(actor, {
      title: 'ملف فحص نسخة القيد القضائي',
      kind: 'LITIGATION',
      initialClientId: client.id,
      idempotencyKey: `m-c01-${crypto.randomUUID()}`,
    });
    createdMatterIds.push(m.matter.id);

    const clientMp = m.matter.parties![0];

    const proc = await addProceeding(actor, {
      matterId: m.matter.id,
      courtId: court.id,
      instance: 'FIRST_INSTANCE',
      idempotencyKey: `proc-c01-${crypto.randomUUID()}`,
    });
    expect(proc.version).toBe(1);

    // 1. Zod schema validation rejects omitted expectedVersion
    expect(() =>
      linkProceedingPartySchema.parse({
        proceedingId: proc.id,
        matterPartyId: clientMp.id,
        capacityText: 'مدعي',
        idempotencyKey: 'test-key',
      })
    ).toThrow();

    expect(() =>
      unlinkProceedingPartySchema.parse({
        id: crypto.randomUUID(),
        proceedingId: proc.id,
        idempotencyKey: 'test-key',
      })
    ).toThrow();

    // 2. Reject stale expectedVersion in service
    await expect(
      linkProceedingParty(actor, {
        proceedingId: proc.id,
        matterPartyId: clientMp.id,
        capacityText: 'مدعي',
        expectedVersion: 999, // Stale!
        idempotencyKey: `link-stale-${crypto.randomUUID()}`,
      })
    ).rejects.toThrow(ConcurrencyConflictError);

    // 3. Valid link with matching expectedVersion succeeds and bumps proceeding version
    const linked = await linkProceedingParty(actor, {
      proceedingId: proc.id,
      matterPartyId: clientMp.id,
      capacityText: 'مدعي',
      expectedVersion: proc.version, // 1
      idempotencyKey: `link-valid-${crypto.randomUUID()}`,
    });
    expect(linked.operationVersion).toBe(2);

    const procAfterLink = await prisma.proceeding.findUniqueOrThrow({ where: { id: proc.id } });
    expect(procAfterLink.version).toBe(2);

    // 4. Stale unlink throws ConcurrencyConflictError
    await expect(
      unlinkProceedingParty(actor, {
        id: linked.id,
        proceedingId: proc.id,
        expectedVersion: 1, // Stale! (current is 2)
        idempotencyKey: `unlink-stale-${crypto.randomUUID()}`,
      })
    ).rejects.toThrow(ConcurrencyConflictError);

    // 5. Valid unlink succeeds and bumps proceeding version
    await unlinkProceedingParty(actor, {
      id: linked.id,
      proceedingId: proc.id,
      expectedVersion: 2,
      idempotencyKey: `unlink-valid-${crypto.randomUUID()}`,
    });

    const procAfterUnlink = await prisma.proceeding.findUniqueOrThrow({ where: { id: proc.id } });
    expect(procAfterUnlink.version).toBe(3);
  });

  // =========================================================================
  // C02: Cascaded ProceedingParty deletion on MatterParty unlink advances version & writes audit
  // =========================================================================
  it('C02: unlinking matter party cascades to proceeding parties, increments proceeding version, and writes audit event', async () => {
    const court = await makeCourt(`C02 Court ${crypto.randomUUID().slice(0, 6)}`);
    const client1 = await makeParty('موكل رئيسي أول');
    const client2 = await makeParty('موكل ثانوي يتم حذفه');

    const m = await openMatter(actor, {
      title: 'ملف فحص تسلسل حذف صفة التقاضي',
      kind: 'LITIGATION',
      initialClientId: client1.id,
      idempotencyKey: `m-c02-${crypto.randomUUID()}`,
    });
    createdMatterIds.push(m.matter.id);

    const mp2 = await linkMatterParty(actor, {
      matterId: m.matter.id,
      partyId: client2.id,
      role: 'CLIENT',
      idempotencyKey: `link-client2-${crypto.randomUUID()}`,
    });

    const proc = await addProceeding(actor, {
      matterId: m.matter.id,
      courtId: court.id,
      instance: 'FIRST_INSTANCE',
      parties: [
        { matterPartyId: mp2.id, capacityText: 'مدعي منضم' },
      ],
      idempotencyKey: `proc-c02-${crypto.randomUUID()}`,
    });
    expect(proc.version).toBe(1);

    const ppCountBefore = await prisma.proceedingParty.count({ where: { proceedingId: proc.id } });
    expect(ppCountBefore).toBe(1);

    // Unlink mp2 from the matter
    await unlinkMatterParty(actor, {
      id: mp2.id,
      matterId: m.matter.id,
      expectedVersion: mp2.version,
      idempotencyKey: `unlink-mp2-${crypto.randomUUID()}`,
    });

    // ProceedingParty row must be deleted
    const ppCountAfter = await prisma.proceedingParty.count({ where: { proceedingId: proc.id } });
    expect(ppCountAfter).toBe(0);

    // Proceeding.version must be bumped
    const procAfterCascade = await prisma.proceeding.findUniqueOrThrow({ where: { id: proc.id } });
    expect(procAfterCascade.version).toBe(2);

    // Audit event must be recorded
    const cascadeAudit = await prisma.auditEvent.findFirst({
      where: {
        action: 'PROCEEDING_PARTY_CASCADE_REMOVED',
        entityType: 'ProceedingParty',
      },
      orderBy: { createdAt: 'desc' },
    });
    expect(cascadeAudit).not.toBeNull();
    const changedFields = cascadeAudit!.changedFields as Record<string, unknown>;
    expect(changedFields.proceedingId).toBe(proc.id);
    expect(changedFields.matterPartyId).toBe(mp2.id);
    expect(changedFields.reason).toBe('MATTER_PARTY_UNLINKED');
  });

  // =========================================================================
  // C03: Idempotent replays return original operationVersion with live resourceVersion
  // =========================================================================
  it('C03: idempotent replay across matters, proceedings, and settings returns original operationVersion with live state', async () => {
    const court = await makeCourt(`C03 Court ${crypto.randomUUID().slice(0, 6)}`);

    // 1. Reference item creation and update replay
    const refKey = `ref-c03-${crypto.randomUUID()}`;
    const refItem1 = await createReferenceItem(actor, {
      type: 'PRACTICE_AREA',
      name: 'قضايا عمالية أولية',
      idempotencyKey: refKey,
    });
    expect(refItem1.version).toBe(1);
    expect(refItem1.operationVersion).toBe(1);

    // Replay createReferenceItem returns operationVersion: 1
    const refReplay = await createReferenceItem(actor, {
      type: 'PRACTICE_AREA',
      name: 'قضايا عمالية أولية',
      idempotencyKey: refKey,
    });
    expect(refReplay.id).toBe(refItem1.id);
    expect(refReplay.operationVersion).toBe(1);

    // Update ref item
    const updateKey = `ref-up-c03-${crypto.randomUUID()}`;
    const refUpdated = await updateReferenceItem(actor, {
      id: refItem1.id,
      type: 'PRACTICE_AREA',
      expectedVersion: refItem1.version,
      name: 'قضايا عمالية معدلة',
      isActive: true,
      idempotencyKey: updateKey,
    });
    expect(refUpdated.version).toBe(2);
    expect(refUpdated.operationVersion).toBe(2);

    // Replay update
    const refUpdateReplay = await updateReferenceItem(actor, {
      id: refItem1.id,
      type: 'PRACTICE_AREA',
      expectedVersion: refItem1.version,
      name: 'قضايا عمالية معدلة',
      isActive: true,
      idempotencyKey: updateKey,
    });
    expect(refUpdateReplay.operationVersion).toBe(2);
    expect(refUpdateReplay.version).toBe(2);

    // 2. Office Settings update replay
    const settings = await getOfficeSettings(actor);
    const settingsKey = `settings-up-c03-${crypto.randomUUID()}`;
    const settingsUpdated = await updateOfficeSettings(actor, {
      expectedVersion: settings.version,
      officeName: 'مكتب الاختبار المتكامل القانوني',
      idempotencyKey: settingsKey,
    });
    expect(settingsUpdated.operationVersion).toBe(settings.version + 1);

    const settingsReplay = await updateOfficeSettings(actor, {
      expectedVersion: settings.version,
      officeName: 'مكتب الاختبار المتكامل القانوني',
      idempotencyKey: settingsKey,
    });
    expect(settingsReplay.operationVersion).toBe(settings.version + 1);

    // 3. Proceeding creation replay
    const m = await openMatter(actor, {
      title: 'ملف فحص استعادة رقم العملية',
      kind: 'LITIGATION',
      idempotencyKey: `m-c03-${crypto.randomUUID()}`,
    });
    createdMatterIds.push(m.matter.id);

    const procKey = `proc-replay-${crypto.randomUUID()}`;
    const proc = await addProceeding(actor, {
      matterId: m.matter.id,
      courtId: court.id,
      instance: 'FIRST_INSTANCE',
      idempotencyKey: procKey,
    });
    expect(proc.operationVersion).toBe(1);

    const procReplay = await addProceeding(actor, {
      matterId: m.matter.id,
      courtId: court.id,
      instance: 'FIRST_INSTANCE',
      idempotencyKey: procKey,
    });
    expect(procReplay.id).toBe(proc.id);
    expect(procReplay.operationVersion).toBe(1);

    // 4. Matter-party link replay after intervening edit (S3)
    const clientP = await makeParty('طرف فحص إعادة تشغيل العلاقة');
    const linkKey = `link-p-replay-${crypto.randomUUID()}`;
    const initialLink = await linkMatterParty(actor, {
      matterId: m.matter.id,
      partyId: clientP.id,
      role: 'CLIENT',
      idempotencyKey: linkKey,
    });
    expect(initialLink.version).toBe(1);
    expect(initialLink.operationVersion).toBe(1);

    // Intervening edit bumps version to 2
    const updatedLink = await updateMatterParty(actor, {
      id: initialLink.id,
      matterId: m.matter.id,
      expectedVersion: initialLink.version,
      role: 'OPPONENT',
      notes: 'تعديل وسيط لتغيير الصفة',
      idempotencyKey: `upd-p-${crypto.randomUUID()}`,
    });
    expect(updatedLink.version).toBe(2);

    // Replaying original linkKey returns current live version (2) AND original operationVersion (1)
    const linkReplay = await linkMatterParty(actor, {
      matterId: m.matter.id,
      partyId: clientP.id,
      role: 'CLIENT',
      idempotencyKey: linkKey,
    });
    expect(linkReplay.id).toBe(initialLink.id);
    expect(linkReplay.version).toBe(2);
    expect(linkReplay.operationVersion).toBe(1);
  });

  // =========================================================================
  // C04: Canonical Arabic text normalization in SQL migration matches TypeScript
  // =========================================================================
  it('C04: SQL normalized title matches normalizeArabicText across diacritics, tatweel, Alef, Maqsura, and Eastern digits', async () => {
    // String with Alef variants (أ إ آ), diacritics (َ ً ُ ٍ ّ), tatweel (ـ), Yaa/Maqsura (ي ى), Taa/Haa (ة ه), and Eastern digits (١٢٣)
    const testTitle = 'دَعْوَى شَــرِكَةِ الأَمَلِ وَالْإِنْشَاءَاتِ ١٢٣';
    const expectedNormalized = normalizeArabicText(testTitle);

    const m = await openMatter(actor, {
      title: testTitle,
      kind: 'LITIGATION',
      idempotencyKey: `m-norm-${crypto.randomUUID()}`,
    });
    createdMatterIds.push(m.matter.id);

    const row = await prisma.matter.findUniqueOrThrow({
      where: { id: m.matter.id },
      select: { title: true, titleNormalized: true },
    });

    expect(row.titleNormalized).toBe(expectedNormalized);

    // Verify SQL query using the normalized form finds the matter
    const searchResult = await searchMatters({ query: 'شركة الامل والانشاءات 123' }, actor);
    expect(searchResult.matters.some((item) => item.id === m.matter.id)).toBe(true);

    // Direct SQL migration backfill test over pre-existing raw rows (S1)
    const rawTitles = [
      ' دَعْوَى شَرِكَةِ  الأَهْرَامِ لِلتَّجَارَةِ (١٢٣)ـ  ',
      'استئناف حُكْمِ جُنَحِ العَجُوزَةِ رَقْمُ ٤٥٦/۲۰۲۶',
      '  إِلْزَامُ شَرِكَةِ التَّعْمِيرِ بِسَدَادِ  ١٠٠٠٠٠٠ ج.م.  ',
      'أَإِآٱةىئؤـ١٢٣٤٥٦٧٨٩۰۱۲۳۴۵۶۷۸۹',
    ];

    for (const rawTitle of rawTitles) {
      const testMatterId = crypto.randomUUID();
      createdMatterIds.push(testMatterId);
      const fileCode = `MIG-${crypto.randomUUID().slice(0, 8)}`;

      // Insert row directly simulating pre-migration state where titleNormalized was null/stale
      await prisma.$executeRaw`
        INSERT INTO "matter" ("id", "fileCode", "title", "titleNormalized", "kind", "status", "version", "createdById", "updatedById", "createdAt", "updatedAt")
        VALUES (${testMatterId}, ${fileCode}, ${rawTitle}, 'PRE_MIGRATION_UNNORMALIZED', 'LITIGATION', 'ACTIVE', 1, ${actor.id}, ${actor.id}, now(), now());
      `;

      // Run the exact SQL migration backfill statement from Migration 9
      await prisma.$executeRaw`
        UPDATE "matter"
        SET "titleNormalized" = trim(
          regexp_replace(
            regexp_replace(
              translate(
                lower("title"),
                '٠١٢٣٤٥٦٧٨٩۰۱۲۳۴۵۶۷۸۹أإآٱةىئؤ',
                '01234567890123456789ااااهييو'
              ),
              '[ً-ٰٟـ]',
              '',
              'g'
            ),
            '\\s+',
            ' ',
            'g'
          )
        )
        WHERE "id" = ${testMatterId};
      `;

      const backfilled = await prisma.matter.findUniqueOrThrow({
        where: { id: testMatterId },
        select: { title: true, titleNormalized: true },
      });

      // Assert original title is preserved exactly
      expect(backfilled.title).toBe(rawTitle);
      // Assert SQL backfill matches canonical TypeScript normalization
      expect(backfilled.titleNormalized).toBe(normalizeArabicText(rawTitle));
    }
  });

  // =========================================================================
  // C05: Confidential notes redacted in audit changedFields & bundled link audits
  // =========================================================================
  it('C05: redacts private notes in proceeding party audit logs and records child audit logs for bundled parties', async () => {
    const court = await makeCourt(`C05 Court ${crypto.randomUUID().slice(0, 6)}`);
    const client = await makeParty('طرف فحص سرية الملاحظات');

    const m = await openMatter(actor, {
      title: 'ملف فحص سرية سجل التدقيق',
      kind: 'LITIGATION',
      initialClientId: client.id,
      idempotencyKey: `m-c05-${crypto.randomUUID()}`,
    });
    createdMatterIds.push(m.matter.id);
    const clientMp = m.matter.parties![0];

    // Bundled party link in addProceeding
    const proc = await addProceeding(actor, {
      matterId: m.matter.id,
      courtId: court.id,
      instance: 'FIRST_INSTANCE',
      parties: [
        {
          matterPartyId: clientMp.id,
          capacityText: 'مدعي أصيل',
          notes: 'ملاحظة سرية للغاية للموكل في القيد',
        },
      ],
      idempotencyKey: `proc-c05-${crypto.randomUUID()}`,
    });

    // Check audit event for bundled link
    const bundledPartyAudit = await prisma.auditEvent.findFirst({
      where: {
        action: 'LINK_PROCEEDING_PARTY',
        entityType: 'ProceedingParty',
      },
      orderBy: { createdAt: 'desc' },
    });
    expect(bundledPartyAudit).not.toBeNull();
    const bundledFields = bundledPartyAudit!.changedFields as Record<string, unknown>;
    expect(bundledFields.hasNotes).toBe(true);
    expect(bundledFields.notes).toBeUndefined(); // Raw notes MUST NOT be stored!

    // Standalone linkProceedingParty with confidential notes
    const party2 = await makeParty('طرف ثان لفحص التدقيق');
    const mp2 = await linkMatterParty(actor, {
      matterId: m.matter.id,
      partyId: party2.id,
      role: 'OPPONENT',
      idempotencyKey: `mp2-c05-${crypto.randomUUID()}`,
    });

    await linkProceedingParty(actor, {
      proceedingId: proc.id,
      matterPartyId: mp2.id,
      capacityText: 'مدعى عليه',
      notes: 'تفاصيل سرية خاصة بخصومة الطرف',
      expectedVersion: proc.version,
      idempotencyKey: `link-pp2-${crypto.randomUUID()}`,
    });

    const standaloneAudit = await prisma.auditEvent.findFirst({
      where: {
        action: 'LINK_PROCEEDING_PARTY',
        entityType: 'ProceedingParty',
      },
      orderBy: { createdAt: 'desc' },
    });
    expect(standaloneAudit).not.toBeNull();
    const standaloneFields = standaloneAudit!.changedFields as Record<string, unknown>;
    expect(standaloneFields.hasNotes).toBe(true);
    expect(standaloneFields.notes).toBeUndefined();
  });

  // =========================================================================
  // C06: Strict calendar date range & whitespace rejection on reference schemas
  // =========================================================================
  it('C06: rejects whitespace-only reference names and validates strict calendar date range (1000-9999)', () => {
    // 1. Whitespace rejection on schemas
    expect(() =>
      createReferenceItemSchema.parse({
        type: 'COURT',
        name: '   ',
        idempotencyKey: 'test',
      })
    ).toThrow();

    expect(() =>
      updateReferenceItemSchema.parse({
        id: crypto.randomUUID(),
        type: 'COURT',
        expectedVersion: 1,
        name: '  \t \n ',
        idempotencyKey: 'test',
      })
    ).toThrow();

    expect(() =>
      updateOfficeSettingsSchema.parse({
        expectedVersion: 1,
        officeName: '   ',
        idempotencyKey: 'test',
      })
    ).toThrow();

    // 2. Strict calendar dates
    expect(validateStrictCalendarDate('2026-02-28')).toBe(true);
    expect(validateStrictCalendarDate('2026-02-29')).toBe(false); // Non-leap year
    expect(validateStrictCalendarDate('2024-02-29')).toBe(true); // Leap year
    expect(validateStrictCalendarDate('2026-04-31')).toBe(false); // April has 30 days
    expect(validateStrictCalendarDate('0026-05-15')).toBe(false); // Year < 1000
    expect(validateStrictCalendarDate('0000-01-01')).toBe(false); // Year 0

    // 3. parseCalendarDateToUtc uses setUTCFullYear without 0..99 remapping
    const validDate = parseCalendarDateToUtc('2026-11-19');
    expect(validDate).not.toBeNull();
    expect(validDate!.getUTCFullYear()).toBe(2026);
    expect(validDate!.getUTCMonth()).toBe(10); // 0-indexed month (November)
    expect(validDate!.getUTCDate()).toBe(19);

    const oldCenturyDate = parseCalendarDateToUtc('1050-06-15');
    expect(oldCenturyDate!.getUTCFullYear()).toBe(1050);

    expect(() => parseCalendarDateToUtc('0099-01-01')).toThrow(MatterValidationError);
  });

  // =========================================================================
  // C07: Reference action error handling maps ConcurrencyConflict & NotFound correctly
  // =========================================================================
  it('C07: reference-actions handleActionError maps CONCURRENCY_CONFLICT and NOT_FOUND without falling back to INTERNAL_ERROR', async () => {
    // Mock requireActor to simulate authenticated session in Action
    vi.spyOn(requireActorModule, 'requireActor').mockResolvedValue(actor);

    // Attempt updating non-existent reference item
    const notFoundRes = await updateReferenceItemAction({
      id: crypto.randomUUID(),
      type: 'COURT',
      expectedVersion: 1,
      name: 'محكمة وهمية',
      isActive: true,
      idempotencyKey: `act-nf-${crypto.randomUUID()}`,
    });
    expect(notFoundRes.success).toBe(false);
    if (!notFoundRes.success) {
      expect(notFoundRes.code).toBe('NOT_FOUND');
    }

    // Create item and trigger concurrency conflict
    const created = await createReferenceItemAction({
      type: 'STORAGE_LOCATION',
      name: `Ref Action Test ${crypto.randomUUID().slice(0, 6)}`,
      idempotencyKey: `act-cr-${crypto.randomUUID()}`,
    });
    expect(created.success).toBe(true);
    if (created.success) {
      const conflictRes = await updateReferenceItemAction({
        id: created.data.id,
        type: 'STORAGE_LOCATION',
        expectedVersion: 999, // Mismatched!
        name: 'تعديل بنسخة خاطئة',
        isActive: true,
        idempotencyKey: `act-cf-${crypto.randomUUID()}`,
      });
      expect(conflictRes.success).toBe(false);
      if (!conflictRes.success) {
        expect(conflictRes.code).toBe('CONCURRENCY_CONFLICT');
      }
    }
  });

  // =========================================================================
  // C08: Race-safe getOfficeSettings via upsert eliminates P2002 on concurrent first load
  // and preserves singleton integrity under first-update races on dedicated database
  // =========================================================================
  it('C08: concurrent initial getOfficeSettings calls all resolve cleanly without P2002 errors on dedicated empty table', async () => {
    const dedicated = await createDedicatedTestDatabase();
    try {
      const prismaJs = path.resolve(process.cwd(), 'node_modules/prisma/build/index.js');
      const migRes = spawnSync(process.execPath, [prismaJs, 'migrate', 'deploy'], {
        env: {
          ...process.env,
          DATABASE_URL: dedicated.url,
          NODE_ENV: 'test',
        },
        encoding: 'utf-8',
      });
      if (migRes.status !== 0) {
        throw new Error(`Prisma migrate deploy failed: ${migRes.stderr}`);
      }

      const adapter = new PrismaPg(dedicated.pool);
      const dedicatedPrisma = new PrismaClient({ adapter });

      try {
        // 1. Verify office_settings is empty initially (no singleton pre-created)
        const initialCount = await dedicatedPrisma.officeSettings.count();
        expect(initialCount).toBe(0);

        // 2. Run 5 simultaneous requests to getOfficeSettings on empty table
        const promises = Array.from({ length: 5 }, () =>
          getOfficeSettings(actor, { prisma: dedicatedPrisma })
        );
        const results = await Promise.all(promises);

        expect(results).toHaveLength(5);
        for (const res of results) {
          expect(res.id).toBeDefined();
          expect(res.officeName).toBeDefined();
        }
        // All 5 must have resolved the exact same singleton record
        const uniqueIds = new Set(results.map((r) => r.id));
        expect(uniqueIds.size).toBe(1);

        // 3. First-update race on that singleton: run 2 concurrent updateOfficeSettings calls
        const singletonId = results[0].id;
        const p1 = updateOfficeSettings(
          actor,
          {
            officeName: 'مكتب المحاماة الأول المتسابق',
            expectedVersion: 1,
            idempotencyKey: `c08-upd1-${crypto.randomUUID()}`,
          },
          { prisma: dedicatedPrisma }
        );

        const p2 = updateOfficeSettings(
          actor,
          {
            officeName: 'مكتب المحاماة الثاني المتسابق',
            expectedVersion: 1,
            idempotencyKey: `c08-upd2-${crypto.randomUUID()}`,
          },
          { prisma: dedicatedPrisma }
        );

        const settled = await Promise.allSettled([p1, p2]);
        const fulfilled = settled.filter((s) => s.status === 'fulfilled');
        const rejected = settled.filter((s) => s.status === 'rejected');
        expect(fulfilled).toHaveLength(1);
        expect(rejected).toHaveLength(1);
        expect((rejected[0] as PromiseRejectedResult).reason).toBeInstanceOf(SettingsConcurrencyConflictError);

        // Singleton remains intact with incremented version 2
        const finalSettings = await dedicatedPrisma.officeSettings.findUnique({
          where: { id: singletonId },
        });
        expect(finalSettings).not.toBeNull();
        expect(finalSettings?.version).toBe(2);
      } finally {
        await dedicatedPrisma.$disconnect();
      }
    } finally {
      await dedicated.drop();
    }
  }, 60000);

  // =========================================================================
  // C16: Party-matter associations query across all roles (CLIENT, OPPONENT, OTHER)
  // =========================================================================
  it('C16: queries party-matter associations across all roles with pagination', async () => {
    const testParty = await makeParty('طرف متعدد الصفات');

    // Link testParty to 3 matters with different roles
    const m1 = await openMatter(actor, {
      title: 'ملف الموكل الأول',
      kind: 'LITIGATION',
      initialClientId: testParty.id,
      idempotencyKey: `m1-c16-${crypto.randomUUID()}`,
    });
    createdMatterIds.push(m1.matter.id);

    const m2 = await openMatter(actor, {
      title: 'ملف الخصم الثاني',
      kind: 'LITIGATION',
      idempotencyKey: `m2-c16-${crypto.randomUUID()}`,
    });
    createdMatterIds.push(m2.matter.id);
    await linkMatterParty(actor, {
      matterId: m2.matter.id,
      partyId: testParty.id,
      role: 'OPPONENT',
      idempotencyKey: `link-opp-c16-${crypto.randomUUID()}`,
    });

    const m3 = await openMatter(actor, {
      title: 'ملف الطرف الثالث',
      kind: 'CONSULTATION',
      idempotencyKey: `m3-c16-${crypto.randomUUID()}`,
    });
    createdMatterIds.push(m3.matter.id);
    await linkMatterParty(actor, {
      matterId: m3.matter.id,
      partyId: testParty.id,
      role: 'OTHER',
      idempotencyKey: `link-oth-c16-${crypto.randomUUID()}`,
    });

    // 1. Query all roles for testParty
    const allAssoc = await getPartyMatterAssociations(actor, { partyId: testParty.id });
    expect(allAssoc.total).toBe(3);
    expect(allAssoc.associations).toHaveLength(3);

    const roles = allAssoc.associations.map((a) => a.role);
    expect(roles).toContain('CLIENT');
    expect(roles).toContain('OPPONENT');
    expect(roles).toContain('OTHER');

    // 2. Query filtered by role
    const oppAssoc = await getPartyMatterAssociations(actor, {
      partyId: testParty.id,
      role: 'OPPONENT',
    });
    expect(oppAssoc.total).toBe(1);
    expect(oppAssoc.associations[0].matterId).toBe(m2.matter.id);

    // 3. Search matters by partyId across all roles
    const searchRes = await searchMatters({ partyId: testParty.id }, actor);
    expect(searchRes.total).toBe(3);
    const searchMatterIds = searchRes.matters.map((m) => m.id);
    expect(searchMatterIds).toContain(m1.matter.id);
    expect(searchMatterIds).toContain(m2.matter.id);
    expect(searchMatterIds).toContain(m3.matter.id);
  });

  // =========================================================================
  // C18: Advisory similar proceedings preflight helper
  // =========================================================================
  it('C18: findSimilarProceedings identifies existing proceeding candidates and direct matches before creation', async () => {
    const court1 = await makeCourt(`C18 Court North ${crypto.randomUUID().slice(0, 6)}`);
    const court2 = await makeCourt(`C18 Court South ${crypto.randomUUID().slice(0, 6)}`);

    const m = await openMatter(actor, {
      title: 'ملف فحص تشابه القيود القضائية',
      kind: 'LITIGATION',
      idempotencyKey: `m-c18-${crypto.randomUUID()}`,
    });
    createdMatterIds.push(m.matter.id);

    // Create an existing proceeding in court1 with numberText: '456/أ', yearLabel: '2026'
    await addProceeding(actor, {
      matterId: m.matter.id,
      courtId: court1.id,
      instance: 'FIRST_INSTANCE',
      registerType: 'مدني كلي',
      numberText: '456/أ',
      yearLabel: '2026',
      status: 'ACTIVE',
      idempotencyKey: `proc-existing-c18-${crypto.randomUUID()}`,
    });

    // 1. Direct match with Eastern Arabic digits '٤٥٦/أ' and year '2026'
    const matchRes = await findSimilarProceedings(actor, {
      courtId: court1.id,
      numberText: '٤٥٦/أ',
      yearLabel: '2026',
    });
    expect(matchRes.hasDirectMatch).toBe(true);
    expect(matchRes.candidates).toHaveLength(1);
    expect(matchRes.candidates[0].similarityReason).toContain('تطابق تام');

    // 2. Partial match in same court but different year
    const diffYearRes = await findSimilarProceedings(actor, {
      courtId: court1.id,
      numberText: '456/أ',
      yearLabel: '2025',
    });
    expect(diffYearRes.hasDirectMatch).toBe(false);
    expect(diffYearRes.candidates).toHaveLength(1);
    expect(diffYearRes.candidates[0].similarityReason).toContain('سنة مختلفة');

    // 3. Different court returns no candidates
    const diffCourtRes = await findSimilarProceedings(actor, {
      courtId: court2.id,
      numberText: '456/أ',
      yearLabel: '2026',
    });
    expect(diffCourtRes.hasDirectMatch).toBe(false);
    expect(diffCourtRes.candidates).toHaveLength(0);
  });

  // =========================================================================
  // S2: Concurrent office settings update serialization
  // =========================================================================
  it('S2: concurrent updates to office settings with same expectedVersion serialize; exactly one succeeds and one throws ConcurrencyConflictError', async () => {
    const current = await getOfficeSettings(actor);
    const key1 = `office-race-1-${crypto.randomUUID()}`;
    const key2 = `office-race-2-${crypto.randomUUID()}`;

    const [res1, res2] = await Promise.allSettled([
      updateOfficeSettings(actor, {
        officeName: 'مكتب المحاماة المتحد - فرع أ',
        expectedVersion: current.version,
        idempotencyKey: key1,
      }),
      updateOfficeSettings(actor, {
        officeName: 'مكتب المحاماة المتحد - فرع ب',
        expectedVersion: current.version,
        idempotencyKey: key2,
      }),
    ]);

    const fulfilled = [res1, res2].filter((r) => r.status === 'fulfilled');
    const rejected = [res1, res2].filter((r) => r.status === 'rejected');

    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect((rejected[0] as PromiseRejectedResult).reason.name).toBe('ConcurrencyConflictError');
  });

  // =========================================================================
  // S4: updateProceeding atomic party exclusion / membership reconciliation
  // =========================================================================
  it('S4: updateProceeding reconciles desired parties atomically (removes unmentioned with audit, clears all with [], preserves on undefined)', async () => {
    const court = await makeCourt(`S4 Court ${crypto.randomUUID().slice(0, 6)}`);
    const client1 = await makeParty('طرف قيد أول');
    const client2 = await makeParty('طرف قيد ثان');

    const m = await openMatter(actor, {
      title: 'ملف فحص استبعاد أطراف القيد القضائي',
      kind: 'LITIGATION',
      initialClientId: client1.id,
      idempotencyKey: `m-s4-${crypto.randomUUID()}`,
    });
    createdMatterIds.push(m.matter.id);
    const client1Mp = m.matter.parties![0];

    const link2 = await linkMatterParty(actor, {
      matterId: m.matter.id,
      partyId: client2.id,
      role: 'OPPONENT',
      idempotencyKey: `m-s4-p2-${crypto.randomUUID()}`,
    });

    // Create proceeding with both parties bundled
    const proc = await addProceeding(actor, {
      matterId: m.matter.id,
      courtId: court.id,
      instance: 'FIRST_INSTANCE',
      status: 'DRAFT',
      parties: [
        { matterPartyId: client1Mp.id, capacityText: 'مدعي' },
        { matterPartyId: link2.id, capacityText: 'مدعى عليه' },
      ],
      idempotencyKey: `proc-s4-${crypto.randomUUID()}`,
    });
    expect(proc.version).toBe(1);
    expect(proc.parties).toHaveLength(2);

    // 1. Omit client2 from parties array -> client2 link is deleted, audit emitted, version bumped
    const upd1 = await updateProceeding(actor, {
      id: proc.id,
      matterId: m.matter.id,
      courtId: court.id,
      instance: 'FIRST_INSTANCE',
      status: 'DRAFT',
      expectedVersion: proc.version,
      parties: [
        { matterPartyId: client1Mp.id, capacityText: 'مدعي وحيد معدل' },
      ],
      idempotencyKey: `upd-proc-s4-1-${crypto.randomUUID()}`,
    });
    expect(upd1.version).toBe(2);

    const remainingAfterOmission = await prisma.proceedingParty.findMany({
      where: { proceedingId: proc.id },
    });
    expect(remainingAfterOmission).toHaveLength(1);
    expect(remainingAfterOmission[0].matterPartyId).toBe(client1Mp.id);

    const unlinkAudits = await prisma.auditEvent.findMany({
      where: {
        action: 'UNLINK_PROCEEDING_PARTY',
        changedFields: {
          path: ['proceedingId'],
          equals: proc.id,
        },
      },
    });
    expect(unlinkAudits.length).toBeGreaterThan(0);

    // 2. parties: undefined -> leaves membership untouched
    const upd2 = await updateProceeding(actor, {
      id: proc.id,
      matterId: m.matter.id,
      courtId: court.id,
      instance: 'FIRST_INSTANCE',
      status: 'DRAFT',
      expectedVersion: upd1.version,
      circuit: 'الدائرة الأولى مدني',
      // parties is undefined!
      idempotencyKey: `upd-proc-s4-2-${crypto.randomUUID()}`,
    });
    expect(upd2.version).toBe(3);

    const remainingAfterUndefined = await prisma.proceedingParty.findMany({
      where: { proceedingId: proc.id },
    });
    expect(remainingAfterUndefined).toHaveLength(1);
    expect(remainingAfterUndefined[0].matterPartyId).toBe(client1Mp.id);

    // 3. parties: [] -> clears all proceeding party links
    const upd3 = await updateProceeding(actor, {
      id: proc.id,
      matterId: m.matter.id,
      courtId: court.id,
      instance: 'FIRST_INSTANCE',
      status: 'DRAFT',
      expectedVersion: upd2.version,
      parties: [],
      idempotencyKey: `upd-proc-s4-3-${crypto.randomUUID()}`,
    });
    expect(upd3.version).toBe(4);

    const remainingAfterEmpty = await prisma.proceedingParty.findMany({
      where: { proceedingId: proc.id },
    });
    expect(remainingAfterEmpty).toHaveLength(0);
  });

  // =========================================================================
  // S5: updateMatterParty preserves omitted billing preference and notes
  // =========================================================================
  it('S5: updateMatterParty preserves omitted billingEnabled, isPrimaryContact, and notes on partial update', async () => {
    const client = await makeParty('طرف فحص تفضيلات الفوترة');

    const m = await openMatter(actor, {
      title: 'ملف فحص الحفاظ على تفضيلات الفوترة',
      kind: 'LITIGATION',
      initialClientId: client.id,
      idempotencyKey: `m-s5-${crypto.randomUUID()}`,
    });
    createdMatterIds.push(m.matter.id);
    const clientMp = m.matter.parties![0];

    // Initial update configuring billing, primary contact, and notes
    const initialConfig = await updateMatterParty(actor, {
      id: clientMp.id,
      matterId: m.matter.id,
      expectedVersion: clientMp.version,
      role: 'CLIENT',
      billingEnabled: true,
      isPrimaryContact: true,
      notes: 'ملاحظات أولية سرية للفوترة والاتصال',
      idempotencyKey: `upd-s5-1-${crypto.randomUUID()}`,
    });
    expect(initialConfig.billingEnabled).toBe(true);
    expect(initialConfig.isPrimaryContact).toBe(true);
    expect(initialConfig.notes).toBe('ملاحظات أولية سرية للفوترة والاتصال');
    expect(initialConfig.version).toBe(clientMp.version + 1);

    // Partial update omitting billingEnabled, isPrimaryContact, and notes
    const partialUpdate = await updateMatterParty(actor, {
      id: clientMp.id,
      matterId: m.matter.id,
      expectedVersion: initialConfig.version,
      role: 'CLIENT',
      idempotencyKey: `upd-s5-2-${crypto.randomUUID()}`,
    });

    // Assert that billingEnabled, isPrimaryContact, and notes were preserved, NOT reset to default false/null
    expect(partialUpdate.billingEnabled).toBe(true);
    expect(partialUpdate.isPrimaryContact).toBe(true);
    expect(partialUpdate.notes).toBe('ملاحظات أولية سرية للفوترة والاتصال');

    // Update only notes (omitting billingEnabled and isPrimaryContact)
    const notesUpdate = await updateMatterParty(actor, {
      id: clientMp.id,
      matterId: m.matter.id,
      expectedVersion: partialUpdate.version,
      role: 'CLIENT',
      notes: 'ملاحظات محدثة',
      idempotencyKey: `upd-s5-3-${crypto.randomUUID()}`,
    });

    expect(notesUpdate.billingEnabled).toBe(true);
    expect(notesUpdate.isPrimaryContact).toBe(true);
    expect(notesUpdate.notes).toBe('ملاحظات محدثة');
  });

  // =========================================================================
  // S6: findSimilarProceedings SQL filter preserves older matches past LIMIT 100
  // =========================================================================
  it('S6: findSimilarProceedings finds matching proceeding even when 105 newer proceedings exist in same court with same numberText but different years', async () => {
    const court = await makeCourt(`S6 Court ${crypto.randomUUID().slice(0, 6)}`);

    const mTarget = await openMatter(actor, {
      title: 'ملف القضية المستهدفة',
      kind: 'LITIGATION',
      idempotencyKey: `m-s6-target-${crypto.randomUUID()}`,
    });
    createdMatterIds.push(mTarget.matter.id);

    // 1. Create the older matching proceeding (number: 888/ب, year: 2024)
    const olderMatching = await addProceeding(actor, {
      matterId: mTarget.matter.id,
      courtId: court.id,
      instance: 'FIRST_INSTANCE',
      registerType: 'مدني كلي',
      numberText: '888/ب',
      yearLabel: '2024',
      status: 'ACTIVE',
      idempotencyKey: `proc-s6-target-${crypto.randomUUID()}`,
    });

    // 2. Insert 105 newer proceedings in the SAME court with the SAME numberText (888/ب) but DIFFERENT years
    const mFiller = await openMatter(actor, {
      title: 'ملف القضايا المتعددة الحشو',
      kind: 'LITIGATION',
      idempotencyKey: `m-s6-filler-${crypto.randomUUID()}`,
    });
    createdMatterIds.push(mFiller.matter.id);

    const fillerData = Array.from({ length: 105 }, (_, i) => ({
      id: crypto.randomUUID(),
      matterId: mFiller.matter.id,
      courtId: court.id,
      instance: 'FIRST_INSTANCE' as const,
      registerType: 'مدني كلي',
      numberText: '888/ب',
      yearLabel: `${2025 + (i % 20)}`, // Different years (2025-2044), none equal to 2024
      status: 'ACTIVE' as const,
      version: 1,
      createdById: actor.id,
      updatedById: actor.id,
    }));

    await prisma.proceeding.createMany({
      data: fillerData,
    });

    // 3. Query findSimilarProceedings with normalized Eastern Arabic digits '٨٨٨/ب' and year '2024'
    const searchRes = await findSimilarProceedings(actor, {
      courtId: court.id,
      numberText: '٨٨٨/ب',
      yearLabel: '2024',
    });

    // Assert that the older matching proceeding is returned as direct match despite 105 newer entries!
    expect(searchRes.hasDirectMatch).toBe(true);
    expect(searchRes.candidates.length).toBeGreaterThanOrEqual(1);
    expect(searchRes.candidates[0].id).toBe(olderMatching.id);
    expect(searchRes.candidates[0].similarityReason).toContain('تطابق تام');
  });

  // =========================================================================
  // U6: Association pagination deterministic tie-breaker
  // =========================================================================
  it('U6: getPartyMatterAssociations has deterministic unique page slicing with tied timestamps', async () => {
    const party = await makeParty('طرف فحص الصفحات المتزامنة');
    const tiedDate = new Date('2026-11-19T10:00:00.000Z');

    // Create 10 matters and matter parties with identical createdAt timestamps
    const matterPartyIds: string[] = [];
    for (let i = 0; i < 10; i++) {
      const m = await openMatter(actor, {
        title: `قضية تكرار التوقيت ${i}`,
        kind: 'LITIGATION',
        idempotencyKey: `m-tied-${i}-${crypto.randomUUID()}`,
      });
      createdMatterIds.push(m.matter.id);

      const mpId = crypto.randomUUID();
      await prisma.$executeRaw`
        INSERT INTO "matter_party" ("id", "matterId", "partyId", "role", "isPrimaryContact", "billingEnabled", "version", "createdById", "updatedById", "createdAt", "updatedAt")
        VALUES (${mpId}, ${m.matter.id}, ${party.id}, 'CLIENT', false, false, 1, ${actor.id}, ${actor.id}, ${tiedDate}, ${tiedDate})
      `;
      matterPartyIds.push(mpId);
    }

    // Query page 1 (limit 5, offset 0) and page 2 (limit 5, offset 5)
    const page1 = await getPartyMatterAssociations(actor, {
      partyId: party.id,
      limit: 5,
      offset: 0,
    });
    const page2 = await getPartyMatterAssociations(actor, {
      partyId: party.id,
      limit: 5,
      offset: 5,
    });

    expect(page1.associations).toHaveLength(5);
    expect(page2.associations).toHaveLength(5);

    const page1Ids = page1.associations.map((a) => a.matterPartyId);
    const page2Ids = page2.associations.map((a) => a.matterPartyId);

    // No overlap between adjacent pages
    const overlap = page1Ids.filter((id) => page2Ids.includes(id));
    expect(overlap).toHaveLength(0);

    // Union covers all 10 associations uniquely
    const combinedIds = new Set([...page1Ids, ...page2Ids]);
    expect(combinedIds.size).toBe(10);
  });

  // =========================================================================
  // S2/C10: Office replay adopts full snapshot after intervening write
  // =========================================================================
  it('S2/C10: office replay adopts full snapshot after intervening write', async () => {
    const initial = await getOfficeSettings(actor);

    // User A prepares update with keyA
    const keyA = `office-replay-A-${crypto.randomUUID()}`;
    const resA1 = await updateOfficeSettings(actor, {
      officeName: 'مكتب المحامي أ الأصلي',
      phone: '01011111111',
      expectedVersion: initial.version,
      idempotencyKey: keyA,
    });
    expect(resA1.officeName).toBe('مكتب المحامي أ الأصلي');

    // User B performs intervening update with keyB
    const keyB = `office-intervene-B-${crypto.randomUUID()}`;
    const resB = await updateOfficeSettings(actor, {
      officeName: 'مكتب المحامي ب المتدخل',
      phone: '01022222222',
      email: 'office-b@lawyer.test',
      address: 'شارع التحرير، الدقي، الجيزة',
      expectedVersion: resA1.version,
      idempotencyKey: keyB,
    });
    expect(resB.officeName).toBe('مكتب المحامي ب المتدخل');
    expect(resB.version).toBe(resA1.version + 1);

    // User A replays original save with keyA
    const replayA = await updateOfficeSettings(actor, {
      officeName: 'مكتب المحامي أ الأصلي',
      phone: '01011111111',
      expectedVersion: initial.version,
      idempotencyKey: keyA,
    });

    // Replay returns the complete current database snapshot!
    expect(replayA.officeName).toBe('مكتب المحامي ب المتدخل');
    expect(replayA.phone).toBe('01022222222');
    expect(replayA.email).toBe('office-b@lawyer.test');
    expect(replayA.address).toBe('شارع التحرير، الدقي، الجيزة');
    expect(replayA.version).toBe(resB.version);
    expect(replayA.operationVersion).toBe(resA1.version);
  });

  // =========================================================================
  // P1/U1: Committed create with lost response, retry of original, subsequent update
  // =========================================================================
  it('P1/U1: committed create with lost response, retry of original, and intentional subsequent update creates exactly 1 row', async () => {
    const keyCreate = `matter-lost-res-${crypto.randomUUID()}`;
    const client = await makeParty('موكل اختبار الحفظ غير المؤكد');

    // 1. Initial create commits
    const createRes = await openMatter(actor, {
      title: 'ملف قبل فقدان الاستجابة',
      kind: 'LITIGATION',
      initialClientId: client.id,
      idempotencyKey: keyCreate,
    });
    createdMatterIds.push(createRes.matter.id);
    expect(createRes.matter.id).toBeDefined();

    // 2. Transport failure simulated: caller retries the original create operation with keyCreate
    const retryRes = await openMatter(actor, {
      title: 'ملف قبل فقدان الاستجابة',
      kind: 'LITIGATION',
      initialClientId: client.id,
      idempotencyKey: keyCreate,
    });

    // Replay returns the exact same matter ID
    expect(retryRes.matter.id).toBe(createRes.matter.id);

    // Assert DB contains exactly ONE matter for this ID
    const countMatters = await prisma.matter.count({
      where: { id: createRes.matter.id },
    });
    expect(countMatters).toBe(1);

    // 3. User edit intent applied as an intentional UPDATE to the resolved matter
    const keyUpdate = `matter-subsequent-upd-${crypto.randomUUID()}`;
    const updateRes = await updateMatter(actor, {
      id: createRes.matter.id,
      title: 'ملف بعد التعديل المقصود اللاحق',
      kind: 'LITIGATION',
      status: 'ACTIVE',
      expectedVersion: retryRes.matter.version,
      idempotencyKey: keyUpdate,
    });

    expect(updateRes.matter.title).toBe('ملف بعد التعديل المقصود اللاحق');
    expect(updateRes.matter.id).toBe(createRes.matter.id);

    // Exactly 1 row exists in the database
    const totalMattersForClient = await prisma.matterParty.count({
      where: { partyId: client.id, role: 'CLIENT' },
    });
    expect(totalMattersForClient).toBe(1);
  });
});

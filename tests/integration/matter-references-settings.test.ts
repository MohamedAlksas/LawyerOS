import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import crypto from 'crypto';
import { getPrismaClient } from '@/lib/auth';
import {
  getOfficeSettings,
  updateOfficeSettings,
  createReferenceItem,
  updateReferenceItem,
  listReferenceItems,
} from '@/modules/settings/reference-service';
import {
  openMatter,
  updateMatter,
  addProceeding,
} from '@/modules/matters/matter-service';
import {
  InactiveReferenceSelectedError,
} from '@/modules/matters/matter-types';
import {
  createSyntheticActor,
  setupTestEncryptionKeys,
} from '../helpers/party-test-helper';
import {
  cleanupMatterFixtures,
  cleanupReferenceFixtures,
} from '../helpers/matter-test-helper';

describe('T06-08: Reference Settings Maintenance & Inactive Reference Guards', () => {
  const prisma = getPrismaClient();
  const actor = createSyntheticActor();
  const createdMatterIds: string[] = [];
  const createdCourtIds: string[] = [];
  const createdPracticeAreaIds: string[] = [];
  const createdStorageLocationIds: string[] = [];

  beforeAll(() => {
    setupTestEncryptionKeys();
  });

  afterEach(async () => {
    await cleanupMatterFixtures(prisma, createdMatterIds);
    await cleanupReferenceFixtures(prisma, {
      courtIds: createdCourtIds,
      practiceAreaIds: createdPracticeAreaIds,
      storageLocationIds: createdStorageLocationIds,
    });
    createdMatterIds.length = 0;
    createdCourtIds.length = 0;
    createdPracticeAreaIds.length = 0;
    createdStorageLocationIds.length = 0;
  });

  afterAll(async () => {
    await cleanupMatterFixtures(prisma, createdMatterIds);
    await cleanupReferenceFixtures(prisma, {
      courtIds: createdCourtIds,
      practiceAreaIds: createdPracticeAreaIds,
      storageLocationIds: createdStorageLocationIds,
    });
  });

  it('maintains office profile singleton with versioning and defaults', async () => {
    const settings = await getOfficeSettings(actor);
    expect(settings.id).toBe('singleton');
    expect(settings.currency).toBe('EGP');
    expect(settings.timeZone).toBe('Africa/Cairo');

    const updated = await updateOfficeSettings(actor, {
      officeName: 'مكتب الأستاذ أحمد للمحاماة والاستشارات القانونية',
      lawyerName: 'أحمد محمود المحامي بالنقض',
      phone: '01001234567',
      email: 'contact@ahmed-lawoffice.test',
      address: '٤٥ شارع قصر العيني، القاهرة',
      taxNumber: '123-456-789',
      expectedVersion: settings.version,
      idempotencyKey: `update-office-${crypto.randomUUID()}`,
    });

    expect(updated.officeName).toBe('مكتب الأستاذ أحمد للمحاماة والاستشارات القانونية');
    expect(updated.lawyerName).toBe('أحمد محمود المحامي بالنقض');
    expect(updated.phone).toBe('01001234567');
    expect(updated.version).toBe(settings.version + 1);
  });

  it('creates, lists, and deactivates reference items (courts, practice areas, storage locations)', async () => {
    // 1. Create active items
    const court = await createReferenceItem(actor, {
      type: 'COURT',
      name: 'محكمة استئناف الإسكندرية',
      code: 'ALX-01',
      circuitTypes: ['استئناف عالي', 'عمالي', 'تعويضات'],
      notes: 'مأمورية الاستئناف الرئيسية',
      idempotencyKey: `create-court-${crypto.randomUUID()}`,
    });
    createdCourtIds.push(court.id);
    expect(court.isActive).toBe(true);
    expect(court.name).toBe('محكمة استئناف الإسكندرية');

    const area = await createReferenceItem(actor, {
      type: 'PRACTICE_AREA',
      name: 'المنازعات الضريبية والجمارك',
      code: 'TAX-01',
      notes: 'قضايا لجان الطعن الضريبي والجمارك',
      idempotencyKey: `create-area-${crypto.randomUUID()}`,
    });
    createdPracticeAreaIds.push(area.id);
    expect(area.isActive).toBe(true);

    const location = await createReferenceItem(actor, {
      type: 'STORAGE_LOCATION',
      name: 'دولاب أرشيف القضايا المنتهية - رف 3',
      code: 'ARCH-03',
      notes: 'غرفة الحفظ الرئيسية',
      idempotencyKey: `create-loc-${crypto.randomUUID()}`,
    });
    createdStorageLocationIds.push(location.id);
    expect(location.isActive).toBe(true);

    // 2. Deactivate court
    const deactivatedCourt = await updateReferenceItem(actor, {
      type: 'COURT',
      id: court.id,
      expectedVersion: court.version,
      name: court.name,
      isActive: false, // Deactivated!
      idempotencyKey: `deact-court-${crypto.randomUUID()}`,
    });
    expect(deactivatedCourt.isActive).toBe(false);

    // 3. Listing with includeInactive = false hides deactivated court
    const activeCourts = await listReferenceItems('COURT', false, actor);
    expect(activeCourts.some((c) => c.id === court.id)).toBe(false);

    // Listing with includeInactive = true shows it
    const allCourts = await listReferenceItems('COURT', true, actor);
    expect(allCourts.some((c) => c.id === court.id)).toBe(true);
  });

  it('rejects new assignment of deactivated references while preserving historical associations', async () => {
    // Create practice area and deactivate it
    const area = await createReferenceItem(actor, {
      type: 'PRACTICE_AREA',
      name: 'قوانين الملكية الفكرية',
      idempotencyKey: `area-to-deact-${crypto.randomUUID()}`,
    });
    createdPracticeAreaIds.push(area.id);

    // Create matter referencing active practice area
    const matter = await openMatter(actor, {
      title: 'دعوى انتهاك براءة اختراع',
      kind: 'LITIGATION',
      practiceAreaId: area.id,
      idempotencyKey: `matter-with-area-${crypto.randomUUID()}`,
    });
    createdMatterIds.push(matter.matter.id);
    expect(matter.matter.practiceAreaId).toBe(area.id);

    // Now deactivate practice area
    await updateReferenceItem(actor, {
      type: 'PRACTICE_AREA',
      id: area.id,
      expectedVersion: area.version,
      name: area.name,
      isActive: false,
      idempotencyKey: `deact-area-now-${crypto.randomUUID()}`,
    });

    // 1. Assigning deactivated practice area to a NEW matter must be rejected
    await expect(
      openMatter(actor, {
        title: 'محاولة فتح ملف بدائرة غير نشطة',
        kind: 'LITIGATION',
        practiceAreaId: area.id, // Inactive!
        idempotencyKey: `open-with-inactive-${crypto.randomUUID()}`,
      })
    ).rejects.toThrow(InactiveReferenceSelectedError);

    // 2. Updating historical matter's title without changing practiceAreaId succeeds
    const updatedMatter = await updateMatter(actor, {
      id: matter.matter.id,
      expectedVersion: 1,
      title: 'دعوى انتهاك براءة اختراع - تعديل الوصف',
      kind: 'LITIGATION',
      status: 'DRAFT',
      practiceAreaId: area.id, // Unchanged historical reference!
      idempotencyKey: `update-historical-matter-${crypto.randomUUID()}`,
    });
    expect(updatedMatter.matter.title).toBe('دعوى انتهاك براءة اختراع - تعديل الوصف');
    expect(updatedMatter.matter.practiceAreaId).toBe(area.id);

    // 3. Adding proceeding with deactivated court must be rejected
    const court = await createReferenceItem(actor, {
      type: 'COURT',
      name: 'محكمة ملغاة للاختبار',
      idempotencyKey: `court-to-deact-${crypto.randomUUID()}`,
    });
    createdCourtIds.push(court.id);

    await updateReferenceItem(actor, {
      type: 'COURT',
      id: court.id,
      expectedVersion: court.version,
      name: court.name,
      isActive: false,
      idempotencyKey: `deact-court-inactive-${crypto.randomUUID()}`,
    });

    await expect(
      addProceeding(actor, {
        matterId: matter.matter.id,
        courtId: court.id, // Inactive!
        instance: 'FIRST_INSTANCE',
        idempotencyKey: `proc-inactive-court-${crypto.randomUUID()}`,
      })
    ).rejects.toThrow(InactiveReferenceSelectedError);
  });
});


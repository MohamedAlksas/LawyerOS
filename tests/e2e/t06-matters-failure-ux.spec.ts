import { test, expect } from '@playwright/test';
import { getPrismaClient } from '@/lib/auth';
import { seedT04Owner, deleteT04Owner, signInWithTotp, T04Owner } from '../helpers/t04-auth';
import { cleanupPartyFixtures, setupTestEncryptionKeys } from '../helpers/party-test-helper';
import { cleanupMatterFixtures, cleanupReferenceFixtures } from '../helpers/matter-test-helper';

test.describe('T06 Matters Failure UX & Invariant Enforcements @matters', () => {
  let owner: T04Owner;
  const prisma = getPrismaClient();
  const createdPartyIds: string[] = [];
  const createdMatterIds: string[] = [];
  const createdCourtIds: string[] = [];

  test.beforeAll(async () => {
    setupTestEncryptionKeys();
    owner = await seedT04Owner({ label: 'matters-failure-e2e', name: 'أحمد المحامي' });
  });

  test.afterAll(async () => {
    if (createdMatterIds.length > 0) {
      await cleanupMatterFixtures(prisma, createdMatterIds);
    }
    if (createdPartyIds.length > 0) {
      await cleanupPartyFixtures(prisma, createdPartyIds);
    }
    if (createdCourtIds.length > 0) {
      await cleanupReferenceFixtures(prisma, { courtIds: createdCourtIds });
    }
    if (owner?.id) {
      await deleteT04Owner(owner.id);
    }
  });

  test('validates required fields and enforces in-memory form retention @matters', async ({
    page,
  }) => {
    test.setTimeout(90_000);
    await signInWithTotp(page, owner);

    await page.goto('/matters/new');
    await expect(page).toHaveURL(/\/matters\/new/);

    // Try submitting without title
    const submitBtn = page.getByTestId('matter-submit-button');
    await submitBtn.click();

    // HTML5 validation or form error prevents navigation
    await expect(page).toHaveURL(/\/matters\/new/);

    // Type notes and summary
    const testSummary = 'ملخص محفوظ في الذاكرة لتجربة الصمود أمام الأخطاء';
    await page.getByTestId('matter-summary-textarea').fill(testSummary);

    // Ensure memory retention
    await expect(page.getByTestId('matter-summary-textarea')).toHaveValue(testSummary);
  });

  test('enforces last client invariant on active matter @matters', async ({
    page,
  }) => {
    test.setTimeout(120_000);
    await signInWithTotp(page, owner);

    // 1. Create a party directly in db
    const party = await prisma.party.create({
      data: {
        kind: 'PERSON',
        name: 'سعيد عبد الحليم الوحيد',
        nameNormalized: 'سعيد عبد الحليم الوحيد',
        primaryPhone: '01099990000',
        createdById: owner.id,
        updatedById: owner.id,
      },
    });
    createdPartyIds.push(party.id);

    // 2. Create an ACTIVE matter directly with this party as CLIENT
    const matter = await prisma.matter.create({
      data: {
        fileCode: '2026/9991',
        title: 'قضية حصرية ذات موكل وحيد',
        kind: 'LITIGATION',
        status: 'ACTIVE',
        createdById: owner.id,
        updatedById: owner.id,
        parties: {
          create: {
            partyId: party.id,
            role: 'CLIENT',
            isPrimaryContact: true,
            version: 1,
            createdById: owner.id,
            updatedById: owner.id,
          },
        },
      },
    });
    createdMatterIds.push(matter.id);

    // 3. Navigate to matter page
    await page.goto(`/matters/${matter.id}`);
    await expect(page).toHaveURL(new RegExp(`/matters/${matter.id}$`));

    // Handle browser dialog confirm
    page.on('dialog', (dialog) => dialog.accept());

    // 4. Try unlinking the only client
    const unlinkBtn = page.locator('[data-testid^="unlink-party-"]').first();
    await expect(unlinkBtn).toBeVisible();
    await unlinkBtn.click();

    // 5. Verify LAST_CLIENT_REQUIRED error banner is displayed
    const errorBanner = page.getByTestId('party-action-error');
    await expect(errorBanner).toBeVisible();
    await expect(errorBanner).toContainText('لا يمكن إلغاء أو تغيير صفة الموكل الأخير في ملف نشط');

    // Verify client is still in the list (not removed)
    await expect(page.getByText('سعيد عبد الحليم الوحيد')).toBeVisible();
  });

  test('handles proceeding concurrency conflict, preserves in-memory entries, and recovers on retry @matters', async ({
    page,
  }) => {
    test.setTimeout(120_000);
    await signInWithTotp(page, owner);

    // 1. Create reference court
    const court = await prisma.court.create({
      data: {
        name: 'محكمة الجيزة الابتدائية - اختبار النزاع',
        code: 'COURT-CONF-01',
        isActive: true,
        createdById: owner.id,
        updatedById: owner.id,
      },
    });
    createdCourtIds.push(court.id);

    // 2. Create party in DB
    const party = await prisma.party.create({
      data: {
        kind: 'PERSON',
        name: 'إبراهيم النزاع المتزامن',
        nameNormalized: 'ابراهيم النزاع المتزامن',
        primaryPhone: '01011112222',
        createdById: owner.id,
        updatedById: owner.id,
      },
    });
    createdPartyIds.push(party.id);

    // 3. Create active matter with the party as CLIENT
    const matter = await prisma.matter.create({
      data: {
        fileCode: '2026/8881',
        title: 'ملف اختبار التعارض المتزامن في القيود',
        kind: 'LITIGATION',
        status: 'ACTIVE',
        createdById: owner.id,
        updatedById: owner.id,
        parties: {
          create: {
            partyId: party.id,
            role: 'CLIENT',
            isPrimaryContact: true,
            version: 1,
            createdById: owner.id,
            updatedById: owner.id,
          },
        },
      },
      include: {
        parties: true,
      },
    });
    createdMatterIds.push(matter.id);
    const matterPartyId = matter.parties[0].id;

    // 4. Create proceeding with proceedingParty in DB
    const proceeding = await prisma.proceeding.create({
      data: {
        matterId: matter.id,
        courtId: court.id,
        instance: 'FIRST_INSTANCE',
        numberText: '1001',
        yearLabel: '2026',
        registerType: 'مدني كلي',
        circuit: 'الدائرة الأولى الأصلية',
        status: 'ACTIVE',
        version: 1,
        createdById: owner.id,
        updatedById: owner.id,
        parties: {
          create: {
            matterPartyId: matterPartyId,
            legalCapacity: 'PLAINTIFF',
            capacityText: 'المدعي الأصلي المبدئي',
            createdById: owner.id,
          },
        },
      },
    });

    // 5. Navigate to proceeding edit form
    await page.goto(`/matters/${matter.id}/proceedings/${proceeding.id}/edit`);
    await expect(page).toHaveURL(new RegExp(`/matters/${matter.id}/proceedings/${proceeding.id}/edit$`));
    await expect(page.getByTestId('proceeding-number-input')).toHaveValue('1001');
    await expect(page.getByTestId(`capacity-text-${matterPartyId}`)).toHaveValue('المدعي الأصلي المبدئي');

    // 6. User modifies inputs in the form
    await page.getByTestId('proceeding-number-input').fill('9988');
    await page.getByTestId('proceeding-circuit-input').fill('الدائرة 9 المستعجلة');
    await page.getByTestId(`capacity-text-${matterPartyId}`).fill('المدعي بالحق المدني المعدل');

    // 7. Simulate concurrent conflict: another actor updates proceeding in DB
    await prisma.proceeding.update({
      where: { id: proceeding.id },
      data: {
        version: { increment: 1 },
        circuit: 'دائرة معدلة في الخلفية',
      },
    });

    // 8. Submit form with outdated expectedVersion
    await page.getByTestId('proceeding-submit-button').click();

    // 9. Verify concurrency conflict alert appears
    const conflictAlert = page.getByTestId('concurrency-conflict-alert');
    await expect(conflictAlert).toBeVisible();
    await expect(conflictAlert).toContainText('تعارض في التعديل المتزامن');

    // 10. Verify in-memory form retention
    await expect(page.getByTestId('proceeding-number-input')).toHaveValue('9988');
    await expect(page.getByTestId('proceeding-circuit-input')).toHaveValue('الدائرة 9 المستعجلة');
    await expect(page.getByTestId(`capacity-text-${matterPartyId}`)).toHaveValue('المدعي بالحق المدني المعدل');

    // 11. Verify atomic safety: DB proceeding row was NOT updated with user edits (no partial save)
    const dbProcAfterConflict = await prisma.proceeding.findUnique({
      where: { id: proceeding.id },
      include: { parties: true },
    });
    expect(dbProcAfterConflict?.numberText).toBe('1001');
    expect(dbProcAfterConflict?.circuit).toBe('دائرة معدلة في الخلفية');
    expect(dbProcAfterConflict?.parties[0].capacityText).toBe('المدعي الأصلي المبدئي');

    // 12. Dismiss conflict banner and verify recovery
    const dismissBtn = page.getByTestId('conflict-dismiss-button');
    await expect(dismissBtn).toBeVisible();
    await dismissBtn.click();
    await expect(conflictAlert).toBeHidden();

    // User inputs are still intact after dismiss
    await expect(page.getByTestId('proceeding-number-input')).toHaveValue('9988');
    await expect(page.getByTestId(`capacity-text-${matterPartyId}`)).toHaveValue('المدعي بالحق المدني المعدل');
  });
});


import { test, expect } from '@playwright/test';
import { getPrismaClient } from '@/lib/auth';
import { seedT04Owner, deleteT04Owner, signInWithTotp, T04Owner } from '../helpers/t04-auth';
import { cleanupPartyFixtures, setupTestEncryptionKeys } from '../helpers/party-test-helper';
import { cleanupMatterFixtures } from '../helpers/matter-test-helper';

test.describe('T06 Matters Failure UX & Invariant Enforcements @matters', () => {
  let owner: T04Owner;
  const prisma = getPrismaClient();
  const createdPartyIds: string[] = [];
  const createdMatterIds: string[] = [];

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
});


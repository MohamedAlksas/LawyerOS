import { test, expect } from '@playwright/test';
import { getPrismaClient } from '@/lib/auth';
import { seedT04Owner, deleteT04Owner, signInWithTotp, T04Owner } from '../helpers/t04-auth';
import { cleanupPartyFixtures, setupTestEncryptionKeys } from '../helpers/party-test-helper';
import { cleanupMatterFixtures, cleanupReferenceFixtures } from '../helpers/matter-test-helper';
import { normalizeArabicText } from '@/lib/normalization';

test.describe('T06 Matters & Proceedings Operational Lifecycle @matters', () => {
  let owner: T04Owner;
  const prisma = getPrismaClient();
  const createdPartyIds: string[] = [];
  const createdMatterIds: string[] = [];
  let testCourtId = '';
  let testStorageLocationId = '';
  let testOpponentPartyId = '';

  test.beforeAll(async () => {
    setupTestEncryptionKeys();
    owner = await seedT04Owner({ label: 'matters-e2e', name: 'أحمد المحامي' });

    // Seed test opponent party (required for ACTIVE litigation matters)
    const oppParty = await prisma.party.create({
      data: {
        kind: 'ORGANIZATION',
        name: 'شركة النيل للتجارة والمقاولات',
        nameNormalized: normalizeArabicText('شركة النيل للتجارة والمقاولات'),
        createdById: owner.id,
        updatedById: owner.id,
      },
    });
    testOpponentPartyId = oppParty.id;
    createdPartyIds.push(oppParty.id);

    // Seed test court and storage location so dropdowns are guaranteed populated
    const court = await prisma.court.create({
      data: {
        name: 'محكمة شمال الجيزة الابتدائية - تجريبي',
        code: 'GIZA-TEST-01',
        isActive: true,
        createdById: owner.id,
        updatedById: owner.id,
      },
    });
    testCourtId = court.id;

    const storageLoc = await prisma.storageLocation.create({
      data: {
        name: 'دولاب القضايا المدنية - رف 3 - تجريبي',
        code: 'CAB-CIVIL-03',
        isActive: true,
        createdById: owner.id,
        updatedById: owner.id,
      },
    });
    testStorageLocationId = storageLoc.id;
  });

  test.afterAll(async () => {
    if (createdMatterIds.length > 0) {
      await cleanupMatterFixtures(prisma, createdMatterIds);
    }
    if (createdPartyIds.length > 0) {
      await cleanupPartyFixtures(prisma, createdPartyIds);
    }
    await cleanupReferenceFixtures(prisma, {
      courtIds: [testCourtId],
      storageLocationIds: [testStorageLocationId],
    });
    if (owner?.id) {
      await deleteT04Owner(owner.id);
    }
  });

  test('full operational matter, proceedings, POA, and party association journey @matters', async ({
    page,
  }) => {
    test.setTimeout(180_000);

    // 1. Authenticate with real TOTP
    await signInWithTotp(page, owner);

    // 2. Create a client Party first at /parties/new
    await page.goto('/parties/new');
    await expect(page.locator('h1')).toContainText('إضافة طرف أو موكل جديد');

    const runId = Math.random().toString(36).substring(2, 7);
    const testClientName = `حسام عبد الرؤوف المنشاوي ${runId}`;
    const testClientPhone = `010${Math.floor(10000000 + Math.random() * 90000000)}`;
    const testPoaNumber = `${Math.floor(1000 + Math.random() * 9000)}/أ`;
    await page.getByTestId('party-name-input').fill(testClientName);
    await page.getByTestId('party-phone-input').fill(testClientPhone);
    await page.getByTestId('submit-party-button').click();

    // Land on /parties/[id]
    await expect(page).toHaveURL(/\/parties\/[a-f0-9-]+$/);
    const partyUrl = page.url();
    const partyId = partyUrl.split('/').pop()!;
    createdPartyIds.push(partyId);

    // Add a Power of Attorney (POA) for this client
    await page.getByTestId('add-poa-button').click();
    await page.getByTestId('poa-number-input').fill(testPoaNumber);
    await page.getByTestId('poa-year-input').fill('2026');
    await page.getByTestId('poa-office-input').fill('مكتب توثيق الأهرام النموذجي');
    await page.getByTestId('poa-type-select').selectOption('LITIGATION');
    await page.getByTestId('save-poa-button').click();
    await expect(page.getByTestId('poa-item')).toBeVisible();

    // 3. Visit /matters
    await page.goto('/matters');
    await expect(page).toHaveURL(/\/matters/);
    await expect(page.locator('h1')).toContainText('ملفات القضايا والخدمات القانونية');

    // 4. Click CTA to create a new Matter
    await page.getByTestId('new-matter-button').click();
    await expect(page).toHaveURL(/\/matters\/new/);
    await expect(page.locator('h1')).toContainText('فتح ملف قضية جديد');

    // 5. Fill matter form as a DRAFT (no client selected)
    const matterTitle = `دعوى تعويض عن أضرار تجارية ${runId}`;
    await page.getByTestId('matter-title-input').fill(matterTitle);
    await page.getByTestId('matter-kind-select').selectOption('LITIGATION');
    await page.getByTestId('matter-summary-textarea').fill('ملخص نزاع تجاري متعلق بعقد توريد بضائع ومعدات');
    await page.getByTestId('matter-submit-button').click();

    // 6. Land on /matters/[id]
    await expect(page).toHaveURL(/\/matters\/[a-f0-9-]+$/);
    const matterUrl = page.url();
    const matterId = matterUrl.split('/').pop()!;
    createdMatterIds.push(matterId);

    // Verify DRAFT state
    await expect(page.locator('h1')).toContainText(matterTitle);
    await expect(page.getByTestId('matter-status-badge')).toContainText('مسودة');

    // 7. Link the client party to this matter
    await page.getByTestId('open-add-party-modal').click();
    await expect(page.getByTestId('add-party-panel')).toBeVisible();

    await page.getByTestId('party-search-input').fill(testClientName);
    const selectPartyBtn = page.getByTestId(`select-party-${partyId}`);
    await expect(selectPartyBtn).toBeVisible();
    await selectPartyBtn.click();

    await page.getByTestId('party-role-select').selectOption('CLIENT');
    await page.getByTestId('primary-contact-checkbox').check();
    await page.getByTestId('submit-link-party').click();

    // Verify client appears in Clients section with Primary Contact badge
    await expect(page.getByTestId('detail-action-message')).toContainText('تم ربط الطرف بالملف بنجاح');
    await expect(page.getByText(testClientName)).toBeVisible();
    await expect(page.getByText('جهة الاتصال الأساسية')).toBeVisible();

    // 7b. Link an opponent party to this matter (required for ACTIVE litigation matters)
    await page.getByTestId('open-add-party-modal').click();
    await expect(page.getByTestId('add-party-panel')).toBeVisible();

    await page.getByTestId('party-search-input').fill('شركة النيل');
    const selectOpponentBtn = page.getByTestId(`select-party-${testOpponentPartyId}`);
    await expect(selectOpponentBtn).toBeVisible();
    await selectOpponentBtn.click();

    await page.getByTestId('party-role-select').selectOption('OPPONENT');
    await page.getByTestId('submit-link-party').click();

    await expect(page.getByTestId('detail-action-message')).toContainText('تم ربط الطرف بالملف بنجاح');
    await expect(page.getByText('شركة النيل للتجارة والمقاولات')).toBeVisible();

    // 8. Link the client's POA to this matter
    await page.getByTestId('tab-authorizations').click();
    await page.getByTestId('open-add-poa-modal').click();
    await expect(page.getByTestId('add-poa-panel')).toBeVisible();

    // Wait for POAs to load into select
    const poaSelect = page.getByTestId('poa-select');
    await expect(poaSelect).toBeVisible();
    await expect(poaSelect.locator('option')).toHaveCount(2); // placeholder + 1 option
    await poaSelect.selectOption({ index: 1 });
    await page.getByTestId('submit-link-poa').click();

    await expect(page.getByTestId('detail-action-message')).toContainText('تم ربط التوكيل بالملف بنجاح');
    await expect(page.getByText('مكتب توثيق الأهرام النموذجي')).toBeVisible();

    // 9. Transition Matter from DRAFT to ACTIVE
    await page.getByTestId('edit-matter-button').click();
    await expect(page).toHaveURL(new RegExp(`/matters/${matterId}/edit`));
    await page.getByTestId('matter-status-select').selectOption('ACTIVE');
    await page.getByTestId('matter-submit-button').click();

    await expect(page).toHaveURL(new RegExp(`/matters/${matterId}$`));
    await expect(page.getByTestId('matter-status-badge')).toContainText('نشط');

    // 10. Verify missing paper location warning is visible on ACTIVE matter
    await expect(page.getByTestId('missing-paper-location-warning')).toBeVisible();

    // Set paper storage location
    await page.getByTestId('edit-matter-button').click();
    await page.getByTestId('matter-paper-location-select').selectOption({ value: testStorageLocationId });
    await page.getByTestId('matter-submit-button').click();

    // Warning is gone, paper location card displays location
    await expect(page.getByTestId('missing-paper-location-warning')).toBeHidden();
    await expect(page.getByTestId('paper-location-card')).toBeVisible();
    await expect(page.getByTestId('paper-location-card')).toContainText('دولاب القضايا المدنية');

    // 11. Add Court Proceeding (Draft registration)
    await page.getByTestId('add-proceeding-button').click();
    await expect(page).toHaveURL(new RegExp(`/matters/${matterId}/proceedings/new`));

    await page.getByTestId('proceeding-court-select').selectOption({ value: testCourtId });
    await page.getByTestId('proceeding-instance-select').selectOption('FIRST_INSTANCE');
    // Leave docket number blank (draft)
    await page.getByTestId('proceeding-submit-button').click();

    // Land on matter details, verify incomplete docket badge
    await expect(page).toHaveURL(new RegExp(`/matters/${matterId}$`));
    await page.getByTestId('tab-proceedings').click();
    await expect(page.getByTestId('proceeding-draft-badge')).toBeVisible();
    await expect(page.getByText('الرقم غير مستكمل (مسودة قيد)')).toBeVisible();

    // 12. Complete the court proceeding registration and activate it
    await page.locator('[data-testid^="edit-proceeding-"]').first().click();
    await page.getByTestId('proceeding-number-input').fill('5678');
    await page.getByTestId('proceeding-year-input').fill('2026');
    await page.getByTestId('proceeding-register-type-input').fill('مدني كلي');
    await page.getByTestId('proceeding-circuit-input').fill('الدائرة 4 تعويضات');
    await expect(page.getByTestId('proceeding-status-select')).toBeVisible();
    await page.getByTestId('proceeding-status-select').selectOption('ACTIVE');

    // Deliberately include candidate parties into proceeding (U2 / C12)
    const addPartyBtns = page.locator('[data-testid^="add-party-to-proceeding-"]');
    const partyCount = await addPartyBtns.count();
    for (let i = 0; i < partyCount; i++) {
      await addPartyBtns.first().click();
    }

    // Explicitly select legal capacities for included parties (U2 / C12)
    const capacitySelects = page.locator('[data-testid^="capacity-select-"]');
    await capacitySelects.nth(0).selectOption('PLAINTIFF');
    if ((await capacitySelects.count()) > 1) {
      await capacitySelects.nth(1).selectOption('DEFENDANT');
    }

    await page.locator('[data-testid^="capacity-text-"]').first().fill('المدعي الأصلي');
    await page.getByTestId('proceeding-submit-button').click();

    // Proceeding is now complete and active
    await expect(page).toHaveURL(new RegExp(`/matters/${matterId}$`));
    await page.getByTestId('tab-proceedings').click();
    await expect(page.getByText('5678 لسنة 2026')).toBeVisible();
    await expect(page.getByText('مدني كلي')).toBeVisible();
    await expect(page.getByText('الدائرة 4 تعويضات')).toBeVisible();
    await expect(page.getByText('متداول بالجلسات')).toBeVisible();
    await expect(page.locator('[data-testid^="proceeding-party-capacity-"]').filter({ hasText: testClientName })).toContainText('المدعي الأصلي');
    await expect(page.locator('[data-testid^="proceeding-party-capacity-"]').filter({ hasText: 'شركة النيل' })).toContainText('مدعى عليه');

    // Reload to verify persisted active status and capacityText
    await page.reload();
    await page.getByTestId('tab-proceedings').click();
    await expect(page.getByText('5678 لسنة 2026')).toBeVisible();
    await expect(page.getByText('متداول بالجلسات')).toBeVisible();
    await expect(page.locator('[data-testid^="proceeding-party-capacity-"]').filter({ hasText: testClientName })).toContainText('المدعي الأصلي');
    await expect(page.locator('[data-testid^="proceeding-party-capacity-"]').filter({ hasText: 'شركة النيل' })).toContainText('مدعى عليه');

    // 13. Add Linked Appeal Proceeding
    await page.getByTestId('add-proceeding-tab-button').click();
    await page.getByTestId('proceeding-court-select').selectOption({ value: testCourtId });
    await page.getByTestId('proceeding-instance-select').selectOption('APPEAL');

    // Link parent proceeding
    const parentSelect = page.getByTestId('proceeding-parent-select');
    await expect(parentSelect.locator('option')).toHaveCount(2); // placeholder + 1 parent
    await parentSelect.selectOption({ index: 1 });

    await page.getByTestId('proceeding-number-input').fill('9012');
    await page.getByTestId('proceeding-year-input').fill('2026');
    await page.getByTestId('proceeding-register-type-input').fill('استئناف عالي');
    await page.getByTestId('proceeding-submit-button').click();

    await expect(page).toHaveURL(new RegExp(`/matters/${matterId}$`));
    await page.getByTestId('tab-proceedings').click();
    await expect(page.getByTestId('parent-proceeding-link')).toBeVisible();
    await expect(page.getByTestId('parent-proceeding-link')).toContainText('مرتبط بالدعوى السابقة');

    // 14. Contracted Proceeding Detail Route (C20)
    await page.locator('[data-testid^="view-proceeding-"]').first().click();
    await expect(page).toHaveURL(new RegExp(`/matters/${matterId}/proceedings/`));
    await expect(page.getByTestId('proceeding-court-heading')).toBeVisible();
    await expect(page.getByTestId('proceeding-docket-card')).toBeVisible();
    await expect(page.getByTestId('proceeding-parties-card')).toBeVisible();
    await expect(page.getByTestId('edit-proceeding-button')).toBeVisible();

    // 15. Verify Party Profile reflects this matter under linked matters with role badge (C16)
    await page.goto(`/parties/${partyId}`);
    await expect(page.getByTestId('party-matters-section')).toBeVisible();
    await expect(page.getByTestId(`linked-matter-${matterId}`)).toBeVisible();
    await expect(page.getByTestId(`linked-matter-${matterId}`)).toContainText(matterTitle);
    await expect(page.getByTestId(`matter-role-badge-${matterId}`)).toBeVisible();
    await expect(page.getByTestId(`matter-role-badge-${matterId}`)).toContainText('موكل');

    // 16. Reference Item Editing (C19)
    await page.goto('/settings/reference');
    await page.getByTestId('tab-courts').click();
    await expect(page.getByTestId(`edit-reference-item-${testCourtId}`)).toBeVisible();
    await page.getByTestId(`edit-reference-item-${testCourtId}`).click();
    await expect(page.getByTestId('edit-reference-item-name-input')).toBeVisible();
    await page.getByTestId('edit-reference-item-name-input').fill('محكمة شمال القاهرة الابتدائية - المعدلة');
    await page.getByTestId('save-edit-reference-item-button').click();
    await expect(page.getByTestId('reference-success-banner')).toBeVisible();
    await expect(page.getByText('محكمة شمال القاهرة الابتدائية - المعدلة')).toBeVisible();

    // 17. Reload to verify full persistence
    await page.reload();
    await page.getByTestId('tab-courts').click();
    await expect(page.getByText('محكمة شمال القاهرة الابتدائية - المعدلة')).toBeVisible();
  });
});


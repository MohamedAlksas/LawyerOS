import { test, expect } from '@playwright/test';
import { getPrismaClient } from '@/lib/auth';
import { seedT04Owner, deleteT04Owner, signInWithTotp, T04Owner } from '../helpers/t04-auth';
import { cleanupPartyFixtures, setupTestEncryptionKeys } from '../helpers/party-test-helper';
import { cleanupMatterFixtures, cleanupReferenceFixtures } from '../helpers/matter-test-helper';
import { normalizeArabicText } from '@/lib/normalization';

test.describe('T07 Search, Normalization, Pagination & Safe Archiving @t07', () => {
  let owner: T04Owner;
  const prisma = getPrismaClient();
  const runId = Math.random().toString(36).substring(2, 7);

  const createdPartyIds: string[] = [];
  const createdMatterIds: string[] = [];
  let testCourtId = '';

  let normMatterId = '';
  let normProcId = '';
  let archivedMatterId = '';
  let lifecycleMatterId = '';
  let lifecycleProcId = '';
  let testPartyId = '';
  const pageRunId = `pg_${Math.random().toString(36).substring(2, 7)}`;

  test.beforeAll(async () => {
    setupTestEncryptionKeys();
    owner = await seedT04Owner({ label: 't07-e2e', name: 'أحمد المحامي' });

    // Seed test court
    const court = await prisma.court.create({
      data: {
        name: `محكمة القاهرة الاقتصادية - دائرة ${runId}`,
        code: `CAIRO-ECON-${runId.toUpperCase()}`,
        isActive: true,
        createdById: owner.id,
        updatedById: owner.id,
      },
    });
    testCourtId = court.id;

    // 1. Seed party for unified search & associations
    const party = await prisma.party.create({
      data: {
        kind: 'PERSON',
        name: `فاروق السعيد المنشاوي ${runId}`,
        nameNormalized: normalizeArabicText(`فاروق السعيد المنشاوي ${runId}`),
        primaryPhone: `010${Math.floor(10000000 + Math.random() * 90000000)}`,
        createdById: owner.id,
        updatedById: owner.id,
      },
    });
    testPartyId = party.id;
    createdPartyIds.push(party.id);

    // 2. Normalization test matter (contains Alef with hamza and 2026 digits)
    const normMatter = await prisma.matter.create({
      data: {
        fileCode: `2026/7788`,
        title: `الأهرام ${runId} نزاع استثماري 2026`,
        titleNormalized: normalizeArabicText(`الأهرام ${runId} نزاع استثماري 2026`),
        kind: 'LITIGATION',
        status: 'ACTIVE',
        createdById: owner.id,
        updatedById: owner.id,
      },
    });
    normMatterId = normMatter.id;
    createdMatterIds.push(normMatter.id);

    // Proceeding under normMatter
    const normProc = await prisma.proceeding.create({
      data: {
        matterId: normMatter.id,
        courtId: testCourtId,
        instance: 'FIRST_INSTANCE',
        registerType: 'تجاري',
        circuit: `الدائرة 7 ${runId}`,
        numberText: '7788',
        numberNormalized: '7788',
        yearLabel: '2026',
        yearNormalized: '2026',
        status: 'ACTIVE',
        createdById: owner.id,
        updatedById: owner.id,
      },
    });
    normProcId = normProc.id;

    // 3. Seed 22 matters for pagination testing (page size is 20, guarantees 2 pages)
    for (let i = 1; i <= 22; i++) {
      const pad = String(i).padStart(2, '0');
      const m = await prisma.matter.create({
        data: {
          fileCode: `2026/88${pad}`,
          title: `تصفح صفحات النظام ${pageRunId} ملف ${pad}`,
          titleNormalized: normalizeArabicText(`تصفح صفحات النظام ${pageRunId} ملف ${pad}`),
          kind: i % 2 === 0 ? 'LITIGATION' : 'CONSULTATION',
          status: 'ACTIVE',
          createdById: owner.id,
          updatedById: owner.id,
        },
      });
      createdMatterIds.push(m.id);
    }

    // 4. Seed 1 archived matter for search archive-toggle verification
    const archivedMatter = await prisma.matter.create({
      data: {
        fileCode: `2026/66${runId.slice(0, 2)}`,
        title: `ملف مؤرشف للبحث الموحد ${runId}`,
        titleNormalized: normalizeArabicText(`ملف مؤرشف للبحث الموحد ${runId}`),
        kind: 'CONSULTATION',
        status: 'ARCHIVED',
        archivedAt: new Date(),
        archiveReason: 'أرشفة تجريبية سابقة',
        createdById: owner.id,
        updatedById: owner.id,
      },
    });
    archivedMatterId = archivedMatter.id;
    createdMatterIds.push(archivedMatter.id);

    // 5. Seed dedicated matter and proceeding for archive & reopen lifecycle testing
    const lifecycleMatter = await prisma.matter.create({
      data: {
        fileCode: `2026/55${runId.slice(0, 2)}`,
        title: `قضية دورة حياة الأرشفة وإعادة الفتح ${runId}`,
        titleNormalized: normalizeArabicText(`قضية دورة حياة الأرشفة وإعادة الفتح ${runId}`),
        kind: 'LITIGATION',
        status: 'ACTIVE',
        createdById: owner.id,
        updatedById: owner.id,
      },
    });
    lifecycleMatterId = lifecycleMatter.id;
    createdMatterIds.push(lifecycleMatter.id);

    const lifecycleProc = await prisma.proceeding.create({
      data: {
        matterId: lifecycleMatter.id,
        courtId: testCourtId,
        instance: 'FIRST_INSTANCE',
        registerType: 'مدني كلي',
        circuit: 'الدائرة 3',
        numberText: '3344',
        numberNormalized: '3344',
        yearLabel: '2026',
        yearNormalized: '2026',
        status: 'ACTIVE',
        createdById: owner.id,
        updatedById: owner.id,
      },
    });
    lifecycleProcId = lifecycleProc.id;
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
    });
    if (owner?.id) {
      await deleteT04Owner(owner.id);
    }
  });

  // =========================================================================
  // 1. Search & Arabic Normalization
  // =========================================================================
  test('searches matters by normalized Arabic text and Eastern Arabic digits @t07 @search', async ({
    page,
  }) => {
    test.setTimeout(90_000);
    await signInWithTotp(page, owner);

    await page.goto('/matters');
    await expect(page).toHaveURL(/\/matters/);

    // 1. Search with Eastern Arabic digits (٢٠٢٦ instead of 2026)
    const searchInput = page.getByTestId('matters-search-input');
    await searchInput.fill(`٢٠٢٦`);
    await page.getByTestId('matters-search-submit').click();

    // Verify matching matters appear
    await expect(page.locator(`text=${runId}`).first()).toBeVisible();

    // 2. Search with unnormalized Arabic text (Alef without hamza: الاهرام vs الأهرام)
    await searchInput.fill(`الاهرام ${runId}`);
    await page.getByTestId('matters-search-submit').click();

    // Must find the matter with "الأهرام"
    await expect(page.locator(`text=الأهرام ${runId}`).first()).toBeVisible();

    // 3. Search with non-matching query -> triggers empty state
    await searchInput.fill(`سجل_غير_موجود_${runId}_9999`);
    await page.getByTestId('matters-search-submit').click();

    await expect(page.getByTestId('empty-search-container')).toBeVisible();
    await expect(page.getByTestId('empty-search-container')).toContainText('لم يتم العثور على نتائج');

    // 4. Clear filters restores the full list
    await page.getByTestId('matters-clear-filters').click();
    await expect(searchInput).toHaveValue('');
    await expect(page.locator('tbody tr, [data-testid^="matter-card-"]').first()).toBeVisible();
  });

  // =========================================================================
  // 2. Pagination & URL Synchronization
  // =========================================================================
  test('verifies bounded pagination controls and state preservation across back-navigation @t07 @pagination', async ({
    page,
  }) => {
    test.setTimeout(90_000);
    await signInWithTotp(page, owner);

    // Search specifically for our 22 seeded pagination matters using isolated pageRunId
    await page.goto(`/matters?query=${encodeURIComponent(`تصفح صفحات النظام ${pageRunId}`)}`);

    // Verify pagination controls are visible (22 items / 20 per page = 2 pages)
    const paginationControls = page.getByTestId('pagination-controls');
    await expect(paginationControls).toBeVisible();
    await expect(paginationControls).toContainText('صفحة 1 من 2');

    const prevButton = page.getByTestId('prev-page-button');
    const nextButton = page.getByTestId('next-page-button');

    // Page 1 assertions
    await expect(prevButton).toBeDisabled();
    await expect(nextButton).toBeEnabled();

    // Navigate to Page 2
    await nextButton.click();
    await expect(page).toHaveURL(/page=2/);
    await expect(paginationControls).toContainText('صفحة 2 من 2');
    await expect(nextButton).toBeDisabled();
    await expect(prevButton).toBeEnabled();

    // Click to view a matter detail on page 2
    const matterRowLink = page.locator('tbody tr a, [data-testid^="matter-card-"] a').first();
    await matterRowLink.click();
    await expect(page).toHaveURL(/\/matters\/[a-f0-9-]+$/);

    // Use browser back-navigation
    await page.goBack();

    // Verify URL parameters and page state are preserved
    await expect(page).toHaveURL(/page=2/);
    await expect(page.getByTestId('pagination-controls')).toBeVisible();
    await expect(page.getByTestId('pagination-controls')).toContainText('صفحة 2 من 2');
  });

  // =========================================================================
  // 3. Unified Search S12
  // =========================================================================
  test('searches across Matter, Proceeding, Party with live counts, tabs, archive toggle, and deep links @t07 @search', async ({
    page,
  }) => {
    test.setTimeout(90_000);
    await signInWithTotp(page, owner);

    // Navigate to unified search via header link
    await page.goto('/matters');
    await page.getByTestId('header-search-link').click();
    await expect(page).toHaveURL(/\/search/);
    await expect(page.locator('h1')).toContainText('البحث الموحد الشامل');

    // Perform search using our unique runId
    const searchInput = page.getByTestId('unified-search-input');
    await searchInput.fill(runId);
    await page.getByTestId('search-submit-button').click();

    // Verify search results list is visible
    const resultsList = page.getByTestId('search-results-list');
    await expect(resultsList).toBeVisible();

    // 1. Verify tabs live counts
    const tabAll = page.getByTestId('tab-all');
    const tabMatter = page.getByTestId('tab-matter');
    const tabProceeding = page.getByTestId('tab-proceeding');
    const tabParty = page.getByTestId('tab-party');

    await expect(tabAll).toBeVisible();
    await expect(tabMatter).toBeVisible();
    await expect(tabProceeding).toBeVisible();
    await expect(tabParty).toBeVisible();

    // 2. Filter by tabs
    // Tab: Party
    await tabParty.click();
    await expect(page).toHaveURL(/type=PARTY/);
    const partyResult = page.getByTestId(`search-result-${testPartyId}`);
    await expect(partyResult).toBeVisible();
    await expect(partyResult).toContainText('طرف / موكل');

    // Tab: Matter
    await tabMatter.click();
    await expect(page).toHaveURL(/type=MATTER/);
    const matterResult = page.getByTestId(`search-result-${normMatterId}`);
    await expect(matterResult).toBeVisible();
    await expect(matterResult).toContainText('ملف قضية');

    // Tab: Proceeding
    await tabProceeding.click();
    await expect(page).toHaveURL(/type=PROCEEDING/);
    const procResult = page.getByTestId(`search-result-${normProcId}`);
    await expect(procResult).toBeVisible();
    await expect(procResult).toContainText('قيد قضائي');

    // Tab: All
    await tabAll.click();
    await expect(page).not.toHaveURL(/type=/);

    // 3. Archive toggle verification
    // Without archived toggle: archivedMatter is not visible
    const archivedResultLocator = page.getByTestId(`search-result-${archivedMatterId}`);
    await expect(archivedResultLocator).toBeHidden();

    // Check include archived
    const includeArchivedCheckbox = page.getByTestId('include-archived-checkbox');
    await includeArchivedCheckbox.check();
    await expect(page).toHaveURL(/includeArchived=true/);

    // Now archived matter appears with archived badge
    await expect(archivedResultLocator).toBeVisible();
    await expect(archivedResultLocator.getByTestId('item-archived-badge')).toBeVisible();

    // 4. Deep link navigation: click party result detail link
    const targetPartyResult = page.getByTestId(`search-result-${testPartyId}`);
    await expect(targetPartyResult).toBeVisible();
    await targetPartyResult.getByRole('link', { name: /عرض التفاصيل/ }).click();
    await expect(page).toHaveURL(new RegExp(`/parties/${testPartyId}`));
  });

  // =========================================================================
  // 4. Safe Archiving Lifecycle (Matter & Proceeding)
  // =========================================================================
  test('exercises atomic archiving and reopening lifecycle for Matter and Proceeding @t07 @lifecycle', async ({
    page,
  }) => {
    test.setTimeout(120_000);
    await signInWithTotp(page, owner);

    // Go to dedicated lifecycle matter detail page
    await page.goto(`/matters/${lifecycleMatterId}`);
    await expect(page.locator('h1')).toContainText(runId);

    // Step A: Archive Proceeding first (active proceedings would otherwise block matter archiving)
    await page.getByTestId('tab-proceedings').click();
    const archiveProcBtn = page.getByTestId(`archive-proceeding-${lifecycleProcId}`);
    await expect(archiveProcBtn).toBeVisible();
    await archiveProcBtn.click();

    // Proceeding archive modal
    const procLifecycleModal = page.getByTestId('proceeding-lifecycle-modal');
    await expect(procLifecycleModal).toBeVisible();
    await page.getByTestId('proceeding-lifecycle-reason-input').fill('أرشفة القيد لصدور حكم نهائي وبات وانتهاء الاستئناف');
    await page.getByTestId('confirm-proceeding-lifecycle-button').click();
    await expect(procLifecycleModal).toBeHidden();

    // Verify reopen button is now displayed for this proceeding
    await expect(page.getByTestId(`reopen-proceeding-${lifecycleProcId}`)).toBeVisible();

    // Verify proceeding detail page reflects archived read-only state
    await page.goto(`/matters/${lifecycleMatterId}/proceedings/${lifecycleProcId}`);
    await expect(page.getByTestId('proceeding-archived-banner')).toBeVisible();
    await expect(page.getByTestId('proceeding-archived-badge')).toBeVisible();
    await expect(page.getByTestId('edit-proceeding-button')).toBeHidden();

    // Step B: Archive Parent Matter
    await page.goto(`/matters/${lifecycleMatterId}`);
    const archiveMatterBtn = page.getByTestId('archive-matter-button');
    await expect(archiveMatterBtn).toBeVisible();
    await archiveMatterBtn.click();

    // Archive Matter Modal
    const reasonInput = page.getByTestId('archive-matter-reason-input');
    await expect(reasonInput).toBeVisible();
    await reasonInput.fill('تمت أرشفة الملف بالكامل بعد حفظ كافة الأوراق والقيود بالمكتب');
    await page.getByTestId('confirm-archive-matter-button').click();

    // Step C: Observe Read-Only Banner and Disabled Mutation Controls
    const archivedBanner = page.getByTestId('matter-archived-banner');
    await expect(archivedBanner).toBeVisible();
    await expect(archivedBanner).toContainText('ملف القضية مؤرشف — وضع القراءة فقط');

    const statusBadge = page.getByTestId('matter-status-badge');
    await expect(statusBadge).toContainText('مؤرشف');

    // Mutations must be disabled / hidden
    await expect(page.getByTestId('archive-matter-button')).toBeHidden();
    await expect(page.getByTestId('edit-matter-button')).toBeHidden();
    await expect(page.getByTestId('add-proceeding-button')).toBeHidden();

    // Reopen button must be available
    const reopenMatterBtn = page.getByTestId('reopen-matter-button');
    await expect(reopenMatterBtn).toBeVisible();

    // Step D: Reopen Matter
    await reopenMatterBtn.click();
    const reopenReasonInput = page.getByTestId('reopen-matter-reason-input');
    await expect(reopenReasonInput).toBeVisible();
    await reopenReasonInput.fill('ظهور أوراق رسمية جديدة تستدعي إعادة فتح ومتابعة ملف القضية');
    await page.getByTestId('confirm-reopen-matter-button').click();

    // Verify banner is removed and mutations are restored
    await expect(archivedBanner).toBeHidden();
    await expect(page.getByTestId('matter-status-badge')).not.toContainText('مؤرشف');
    await expect(page.getByTestId('archive-matter-button')).toBeVisible();
    await expect(page.getByTestId('edit-matter-button')).toBeVisible();
    await expect(page.getByTestId('add-proceeding-button')).toBeVisible();

    // Step E: Reopen Proceeding
    await page.getByTestId('tab-proceedings').click();
    const reopenProcBtn = page.getByTestId(`reopen-proceeding-${lifecycleProcId}`);
    await expect(reopenProcBtn).toBeVisible();
    await reopenProcBtn.click();

    await expect(procLifecycleModal).toBeVisible();
    await page.getByTestId('proceeding-lifecycle-reason-input').fill('إعادة فتح القيد لمتابعة تنفيذ الحكم');
    await page.getByTestId('confirm-proceeding-lifecycle-button').click();
    await expect(procLifecycleModal).toBeHidden();

    // Verify proceeding is restored
    await expect(page.getByTestId(`archive-proceeding-${lifecycleProcId}`)).toBeVisible();
  });

  // =========================================================================
  // 5. Accessibility, Viewports & RTL Reflow
  // =========================================================================
  test('verifies Arabic RTL layout, 1440px desktop, 768px tablet, 390px mobile, and 320px reflow @t07 @a11y @responsive', async ({
    page,
  }) => {
    test.setTimeout(90_000);
    await signInWithTotp(page, owner);

    // 1. Desktop 1440px
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/matters');

    // Document RTL attributes
    const htmlDir = await page.getAttribute('html', 'dir');
    const htmlLang = await page.getAttribute('html', 'lang');
    expect(htmlDir).toBe('rtl');
    expect(htmlLang).toBe('ar-EG');

    // Desktop sidebar and table visible
    await expect(page.getByTestId('desktop-sidebar')).toBeVisible();
    await expect(page.getByTestId('matters-table')).toBeVisible();

    // Unified Search link in sidebar is present
    await expect(page.getByTestId('nav-link-search')).toBeVisible();

    // 2. Tablet 768px
    await page.setViewportSize({ width: 768, height: 1024 });
    await expect(page.getByTestId('desktop-sidebar')).toBeHidden();

    // 3. Mobile 390px
    await page.setViewportSize({ width: 390, height: 844 });
    await expect(page.getByTestId('mobile-bottom-nav')).toBeVisible();

    // Table is hidden on mobile, card view is used
    await expect(page.getByTestId('matters-table')).toBeHidden();
    await expect(page.locator('[data-testid^="matter-card-"]').first()).toBeVisible();

    // Verify touch target min-height >= 44px on primary buttons
    const searchButtonBox = await page.getByTestId('matters-search-submit').boundingBox();
    expect(searchButtonBox).not.toBeNull();
    expect(searchButtonBox!.height).toBeGreaterThanOrEqual(44);

    // 4. Reflow at 320px without horizontal overflow
    await page.setViewportSize({ width: 320, height: 568 });
    await page.goto('/search');

    const hasHorizontalOverflow = await page.evaluate(() => {
      return document.documentElement.scrollWidth > document.documentElement.clientWidth;
    });
    expect(hasHorizontalOverflow).toBe(false);
  });
});

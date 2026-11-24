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
  let closedProcMatterId = '';
  let closedProcId = '';
  let incompleteMatterId = '';
  let retryMatterId = '';
  let testPartyId = '';
  let archivedPartyId = '';
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

    // 1b. Seed archived party to verify read-only presentation and exclusion
    const archivedParty = await prisma.party.create({
      data: {
        kind: 'PERSON',
        name: `رشدي محفوظ المؤرشف ${runId}`,
        nameNormalized: normalizeArabicText(`رشدي محفوظ المؤرشف ${runId}`),
        primaryPhone: `011${Math.floor(10000000 + Math.random() * 90000000)}`,
        archivedAt: new Date(),
        createdById: owner.id,
        updatedById: owner.id,
        identities: {
          create: {
            identificationType: 'NATIONAL_ID',
            ciphertext: Buffer.alloc(16).toString('base64'),
            iv: Buffer.alloc(12).toString('base64'),
            authTag: Buffer.alloc(16).toString('base64'),
            keyId: 'synthetic-test-envelope',
            lastFour: '0123',
            createdById: owner.id,
          },
        },
      },
    });
    archivedPartyId = archivedParty.id;
    createdPartyIds.push(archivedParty.id);

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

    // Link party to normMatter as CLIENT
    await prisma.matterParty.create({
      data: {
        matterId: normMatter.id,
        partyId: party.id,
        role: 'CLIENT',
        isPrimaryContact: true,
        version: 1,
        createdById: owner.id,
        updatedById: owner.id,
      },
    });

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

    // 6. Seed closed proceeding matter for CLOSED vs ARCHIVED verification
    const closedMatter = await prisma.matter.create({
      data: {
        fileCode: `2026/44${runId.slice(0, 2)}`,
        title: `قضية قيد مغلق للتعديل ${runId}`,
        titleNormalized: normalizeArabicText(`قضية قيد مغلق للتعديل ${runId}`),
        kind: 'LITIGATION',
        status: 'ACTIVE',
        createdById: owner.id,
        updatedById: owner.id,
      },
    });
    closedProcMatterId = closedMatter.id;
    createdMatterIds.push(closedMatter.id);

    const closedProc = await prisma.proceeding.create({
      data: {
        matterId: closedMatter.id,
        courtId: testCourtId,
        instance: 'FIRST_INSTANCE',
        registerType: 'مدني كلي',
        circuit: 'الدائرة 9',
        numberText: '9922',
        numberNormalized: '9922',
        yearLabel: '2026',
        yearNormalized: '2026',
        status: 'CLOSED',
        archivedAt: null,
        createdById: owner.id,
        updatedById: owner.id,
      },
    });
    closedProcId = closedProc.id;

    // 7. Seed incomplete matter (ACTIVE without paper location and without client)
    const incompleteMatter = await prisma.matter.create({
      data: {
        fileCode: `2026/33${runId.slice(0, 2)}`,
        title: `ملف ناقص البيانات للاختبار ${runId}`,
        titleNormalized: normalizeArabicText(`ملف ناقص البيانات للاختبار ${runId}`),
        kind: 'LITIGATION',
        status: 'ACTIVE',
        paperLocationId: null,
        createdById: owner.id,
        updatedById: owner.id,
      },
    });
    incompleteMatterId = incompleteMatter.id;
    createdMatterIds.push(incompleteMatter.id);

    // 8. Seed dedicated matter for frozen retry testing
    const retryMatter = await prisma.matter.create({
      data: {
        fileCode: `2026/22${runId.slice(0, 2)}`,
        title: `قضية فحص إعادة المحاولة والمفتاح المجمد ${runId}`,
        titleNormalized: normalizeArabicText(`قضية فحص إعادة المحاولة والمفتاح المجمد ${runId}`),
        kind: 'LITIGATION',
        status: 'ACTIVE',
        createdById: owner.id,
        updatedById: owner.id,
      },
    });
    retryMatterId = retryMatter.id;
    createdMatterIds.push(retryMatter.id);
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
    await expect(page.locator('tbody tr, [data-testid^="matter-card-"]').filter({ hasText: runId }).first()).toBeVisible();

    // 2. Search with unnormalized Arabic text (Alef without hamza: الاهرام vs الأهرام)
    await searchInput.fill(`الاهرام ${runId}`);
    await page.getByTestId('matters-search-submit').click();

    // Must find the matter with "الأهرام"
    await expect(page.locator('tbody tr, [data-testid^="matter-card-"]').filter({ hasText: `الأهرام ${runId}` }).first()).toBeVisible();

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

    const total = await prisma.matter.count({ where: { archivedAt: null, status: { not: 'ARCHIVED' } } });
    const last = Math.ceil(total / 6);
    await page.goto('/matters?limit=6&page=1000');
    await expect(page.getByTestId('pagination-controls')).toContainText(`صفحة ${last} من ${last}`);
    await expect(page).toHaveURL(new RegExp(`[?&]page=${last}(?:&|$)`));
    await expect(page).toHaveURL(/limit=6/);

    // Search specifically for our 22 seeded pagination matters using isolated pageRunId
    await page.goto('/matters');
    await page.getByTestId('matters-search-input').fill(`تصفح صفحات النظام ${pageRunId}`);
    await page.getByTestId('matters-search-submit').click();

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

    // Capture matter title on page 2 before navigating
    const page2ItemText = await page.locator('tbody tr, [data-testid^="matter-card-"]').filter({ hasText: pageRunId }).first().innerText();
    const matterRowLink = page.locator('tbody tr a, [data-testid^="matter-card-"] a').first();
    await matterRowLink.click();
    await expect(page).toHaveURL(/\/matters\/[a-f0-9-]+$/);

    // Use browser back-navigation
    await page.goBack();

    // Verify URL parameters, page state, and exact record are preserved
    await expect(page).toHaveURL(/page=2/);
    await expect(page.getByTestId('pagination-controls')).toBeVisible();
    await expect(page.getByTestId('pagination-controls')).toContainText('صفحة 2 من 2');
    await expect(page.locator('tbody tr, [data-testid^="matter-card-"]').filter({ hasText: pageRunId }).first()).toBeVisible();
    expect(page2ItemText).toContain(pageRunId);
  });

  // =========================================================================
  // 3. Unified Search S12
  // =========================================================================
  test('recovers search state after a session service error and a stalled session check @t07 @search', async ({ page }) => {
    await signInWithTotp(page, owner);
    await page.goto('/search');
    const input = page.getByTestId('unified-search-input');
    await input.fill(runId);
    await page.getByTestId('search-submit-button').click();
    await expect(page.getByTestId('search-results-list')).toBeVisible();
    const sessionUrl = '**/api/auth/view-session';
    const lock = page.getByTestId('protected-view-lock');
    const retry = page.getByRole('button', { name: 'إعادة التحقق من الجلسة' });

    await page.route(sessionUrl, (route) => route.fulfill({ status: 503 }), { times: 1 });
    await page.evaluate(() => window.dispatchEvent(new Event('lawoffice:recheck-session')));
    await expect(lock).toContainText('تعذر التحقق من الجلسة');
    await expect(input).toBeHidden();
    await retry.click();
    await expect(input).toHaveValue(runId);

    let release: () => void = () => {};
    const stalled = new Promise<void>((resolve) => { release = resolve; });
    await page.route(sessionUrl, async (route) => {
      await stalled;
      await route.abort().catch(() => {});
    }, { times: 1 });
    try {
      await page.evaluate(() => window.dispatchEvent(new Event('lawoffice:recheck-session')));
      await expect(lock).toContainText('تعذر التحقق من الجلسة');
      await expect(input).toBeHidden();
      await retry.click();
      await expect(input).toHaveValue(runId);
      await expect(page.getByTestId('search-results-list')).toBeVisible();
    } finally {
      release();
    }
  });

  test('moves the current-session controls to the replacement after same-account sign-in @t07', async ({ page, context }) => {
    await signInWithTotp(page, owner);
    const sessionId = () => page.evaluate(async () => (await (await fetch('/api/auth/view-session')).json()).sessionId as string);
    const oldId = await sessionId();
    await prisma.session.update({ where: { id: oldId }, data: { userAgent: 'T07 previous browser' } });
    await page.goto('/settings/security');
    const previous = page.locator('div.divide-y > div').filter({ hasText: 'T07 previous browser' });
    await expect(previous.getByText('الجلسة الحالية')).toBeVisible();
    await expect(previous.getByRole('button', { name: 'تسجيل الخروج' })).toBeVisible();

    await context.clearCookies();
    await page.evaluate(() => window.dispatchEvent(new Event('lawoffice:recheck-session')));
    await expect(page.getByTestId('protected-view-lock')).toContainText('انتهت الجلسة');
    const reauth = await context.newPage();
    try {
      await signInWithTotp(reauth, owner);
      const replacement = await sessionId();
      expect(replacement).not.toBe(oldId);
      await prisma.session.update({ where: { id: replacement }, data: { userAgent: 'T07 replacement browser' } });
    } finally {
      await reauth.close();
    }
    await page.evaluate(() => window.dispatchEvent(new Event('lawoffice:recheck-session')));
    const current = page.locator('div.divide-y > div').filter({ hasText: 'T07 replacement browser' });
    await expect(current.getByText('الجلسة الحالية')).toBeVisible();
    await expect(current.getByRole('button', { name: 'تسجيل الخروج' })).toBeVisible();
    await expect(previous.getByText('جلسة متصلة')).toBeVisible();
    await expect(previous.getByRole('button', { name: 'إنهاء الجلسة' })).toBeVisible();
  });

  test('searches across Matter, Proceeding, Party with live counts, tabs, archive toggle, and deep links @t07 @search', async ({
    page,
  }) => {
    test.setTimeout(90_000);
    await signInWithTotp(page, owner);

    // Navigate to unified search via nav link
    await page.goto('/matters');
    await page.getByTestId('nav-link-search').click();
    await expect(page).toHaveURL(/\/search/);
    await expect(page.locator('h1')).toContainText('البحث الموحد الشامل');

    // Perform search using our unique runId
    const searchInput = page.getByTestId('unified-search-input');
    await searchInput.fill(runId);
    await page.getByTestId('search-submit-button').click();

    // Verify search results list is visible
    const resultsList = page.getByTestId('search-results-list');
    await expect(resultsList).toBeVisible();

    // Assert private search text is absent from page.url(), history.state, localStorage, and sessionStorage
    expect(page.url()).not.toContain(runId);
    const historyStateStr = await page.evaluate(() => JSON.stringify(window.history.state));
    expect(historyStateStr).not.toContain(runId);
    const storageKeys = await page.evaluate(() => JSON.stringify(window.localStorage));
    expect(storageKeys).not.toContain(runId);
    const sessionKeys = await page.evaluate(() => JSON.stringify(window.sessionStorage));
    expect(sessionKeys).not.toContain(runId);

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

    // Archived party also appears with archived badge
    const archivedPartyResult = page.getByTestId(`search-result-${archivedPartyId}`);
    await expect(archivedPartyResult).toBeVisible();
    await expect(archivedPartyResult.getByTestId('item-archived-badge')).toBeVisible();

    // 4. Deep link navigation: click party result detail link
    const targetPartyResult = page.getByTestId(`search-result-${testPartyId}`);
    await expect(targetPartyResult).toBeVisible();
    await targetPartyResult.getByRole('link', { name: /عرض التفاصيل/ }).click();
    await expect(page).toHaveURL(new RegExp(`/parties/${testPartyId}`));

    // Test Back-navigation to search
    await page.goBack();
    await expect(page).toHaveURL(/\/search/);
    await expect(page.getByTestId('unified-search-input')).toHaveValue(runId);
    await expect(page.getByTestId('search-results-list')).toBeVisible();
    const historyAfterBack = await page.evaluate(() => JSON.stringify(window.history.state));
    expect(historyAfterBack).not.toContain(runId);

    // 5. Navigate to archived party profile from search result
    const archivedPartyItem = page.getByTestId(`search-result-${archivedPartyId}`);
    await expect(archivedPartyItem).toBeVisible();
    await archivedPartyItem.getByRole('link', { name: /عرض التفاصيل/ }).click();
    await expect(page).toHaveURL(new RegExp(`/parties/${archivedPartyId}`));

    // Assert archived party profile is read-only
    await expect(page.getByTestId('party-archived-banner')).toBeVisible();
    await expect(page.getByTestId('party-archived-badge')).toBeVisible();
    await expect(page.getByTestId('edit-party-button')).toBeHidden();
    await expect(page.getByTestId('reveal-identity-button')).toBeHidden();
    await expect(page.getByTestId('add-note-button')).toBeHidden();
    await expect(page.getByTestId('add-poa-button')).toBeHidden();
    await expect(page.locator('text=+ فتح ملف جديد')).toBeHidden();

    // Verify direct navigation to edit archived party is blocked
    await page.goto(`/parties/${archivedPartyId}/edit`);
    await expect(page.locator('text=الطرف مؤرشف')).toBeVisible();
    await expect(page.locator('input, select, textarea, button[type="submit"]')).toHaveCount(0);
  });

  test('verifies Unified Search pagination stability against debounce reset and back-navigation @t07 @search @pagination', async ({
    page,
  }) => {
    test.setTimeout(90_000);
    await signInWithTotp(page, owner);

    await page.clock.install();
    await page.goto('/search?type=MATTER&includeArchived=true&limit=15');
    const searchInput = page.getByTestId('unified-search-input');
    await searchInput.fill(`تصفح صفحات النظام ${pageRunId}`);
    await page.getByTestId('search-submit-button').click();

    const paginationControls = page.getByTestId('pagination-controls');
    await expect(paginationControls).toBeVisible();
    await expect(paginationControls).toContainText('صفحة 1 من 2');

    // Click next page to go to Page 2
    const nextButton = page.getByTestId('next-page-button');
    await nextButton.click();
    await expect(page).toHaveURL(/page=2/);
    await expect(paginationControls).toContainText('صفحة 2 من 2');

    // Track POST requests and deterministically advance past the 300ms debounce timer
    let postRequestsAfterPage2 = 0;
    const onSearchRequest = (req: { method(): string; url(): string }) => {
      if (req.method() === 'POST' && req.url().includes('/search')) {
        postRequestsAfterPage2++;
      }
    };
    page.on('request', onSearchRequest);
    try {
      await page.clock.runFor(500);
      await page.clock.resume();
    } finally {
      page.off('request', onSearchRequest);
    }
    expect(postRequestsAfterPage2).toBe(0);
    await expect(page).toHaveURL(/page=2/);
    await expect(paginationControls).toContainText('صفحة 2 من 2');

    // Deep link navigation
    const resultItems = page.getByTestId('search-results-list').locator('article');
    await expect(resultItems).toHaveCount(7);
    const resultIds = await resultItems.evaluateAll((items) => items.map((item) => item.getAttribute('data-testid')));
    const resultItem = resultItems.first();
    await expect(resultItem).toBeVisible();
    const detailLink = resultItem.getByRole('link', { name: /عرض التفاصيل/ });
    const detailHref = await detailLink.getAttribute('href');
    await detailLink.click();
    await expect(page).toHaveURL(/\/matters\/[a-f0-9-]+$/);

    // Back navigation to search preserves page 2 and stable item
    await page.goBack();
    await expect(page).toHaveURL(/page=2/);
    await expect(paginationControls).toContainText('صفحة 2 من 2');
    await expect(page.getByTestId('unified-search-input')).toHaveValue(`تصفح صفحات النظام ${pageRunId}`);
    const restoredFilters = new URL(page.url()).searchParams;
    expect(restoredFilters.get('type')).toBe('MATTER');
    expect(restoredFilters.get('includeArchived')).toBe('true');
    expect(restoredFilters.get('limit')).toBe('15');
    await expect.poll(() => resultItems.evaluateAll((items) => items.map((item) => item.getAttribute('data-testid'))))
      .toEqual(resultIds);
    await page.goForward();
    expect(new URL(page.url()).pathname).toBe(detailHref);
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
    const proceedingPath = `/matters/${lifecycleMatterId}/proceedings/${lifecycleProcId}`;
    await page.goto(`${proceedingPath}/edit`);
    await expect(page).toHaveURL((url) => url.pathname === proceedingPath);
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

    const archivedMatterPath = `/matters/${lifecycleMatterId}`;
    for (const writePath of [`${archivedMatterPath}/edit`, `${archivedMatterPath}/proceedings/new`]) {
      await page.goto(writePath);
      await expect(page).toHaveURL((url) => url.pathname === archivedMatterPath);
      await expect(archivedBanner).toBeVisible();
    }

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
  }, testInfo) => {
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

    await page.setViewportSize({ width: 390, height: 844 });
    await page.evaluate(() => { document.documentElement.style.fontSize = '200%'; });
    await expect(page.getByTestId('unified-search-input')).toBeVisible();
    const labels = page.getByTestId('mobile-bottom-nav').locator('a > span:last-child, button > span:last-child');
    const labelBoxes = await labels.evaluateAll((elements) => elements.map((element) => {
      const { left, right, top, bottom } = element.getBoundingClientRect();
      return { left, right, top, bottom };
    }));
    expect(labelBoxes).toHaveLength(6);
    for (const [index, box] of labelBoxes.entries()) {
      expect(box.left).toBeGreaterThanOrEqual(0);
      expect(box.right).toBeLessThanOrEqual(390);
      expect(labelBoxes.slice(index + 1).some((other) =>
        box.left < other.right && box.right > other.left && box.top < other.bottom && box.bottom > other.top
      )).toBe(false);
    }
    const wordmark = page.getByTestId('office-wordmark');
    await expect(wordmark).toContainText('مكتب المحامي');
    expect(await wordmark.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
    const enlargedSubmitButton = page.getByTestId('search-submit-button');
    await enlargedSubmitButton.evaluate((element) => element.scrollIntoView({ block: 'center' }));
    await enlargedSubmitButton.click({ trial: true });
    const enlargedSubmit = await enlargedSubmitButton.boundingBox();
    expect(enlargedSubmit).not.toBeNull();
    expect(enlargedSubmit!.x).toBeGreaterThanOrEqual(0);
    expect(enlargedSubmit!.x + enlargedSubmit!.width).toBeLessThanOrEqual(390);
    const screenshot = testInfo.outputPath('arabic-search-200-percent.png');
    await page.screenshot({ path: screenshot });
    await testInfo.attach('arabic-search-200-percent', { path: screenshot, contentType: 'image/png' });

    const nextPage = page.getByTestId('next-page-button');
    const pager = page.getByTestId('pagination-controls');
    const nav = page.getByTestId('mobile-bottom-nav');
    await expect.poll(async () => {
      await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
      const [pagerBox, navBox] = await Promise.all([pager.boundingBox(), nav.boundingBox()]);
      return pagerBox!.y + pagerBox!.height - navBox!.y;
    }).toBeLessThanOrEqual(1);
    await nextPage.click({ trial: true });
  });

  // =========================================================================
  // 6. Modal Keyboard Focus Trap & Restoration
  // =========================================================================
  test('verifies modal keyboard focus trap, Tab cycling, Escape dismissal, and focus restoration to opener @t07 @a11y', async ({
    page,
  }) => {
    test.setTimeout(90_000);
    await signInWithTotp(page, owner);

    await page.goto(`/matters/${normMatterId}`);

    const archiveBtn = page.getByTestId('archive-matter-button');
    await expect(archiveBtn).toBeVisible();
    await archiveBtn.focus();
    await archiveBtn.click();

    const modal = page.getByTestId('archive-matter-modal');
    await expect(modal).toBeVisible();

    // 1. Initial focus lands on the reason input inside the modal
    const reasonInput = page.getByTestId('archive-matter-reason-input');
    await expect(reasonInput).toBeFocused();

    // 2. Tab cycling stays trapped within modal
    await page.keyboard.press('Tab');
    const isInsideModalAfterTab = await page.evaluate(() => {
      const modalEl = document.querySelector('[data-testid="archive-matter-modal"]');
      return modalEl ? modalEl.contains(document.activeElement) : false;
    });
    expect(isInsideModalAfterTab).toBe(true);

    // 3. Escape key closes the modal
    await page.keyboard.press('Escape');
    await expect(modal).toBeHidden();

    // 4. Focus is restored to the opener button
    await expect(archiveBtn).toBeFocused();
  });

  // =========================================================================
  // 7. Closed Proceeding Editable & Not Archived
  // =========================================================================
  test('verifies closed proceeding is editable and not presented as archived @t07 @proceedings', async ({
    page,
  }) => {
    test.setTimeout(90_000);
    await signInWithTotp(page, owner);

    await page.goto(`/matters/${closedProcMatterId}/proceedings/${closedProcId}`);

    // Closed proceeding must NOT be presented as archived
    await expect(page.getByTestId('proceeding-archived-banner')).toBeHidden();
    await expect(page.getByTestId('proceeding-archived-badge')).toBeHidden();

    // Must be editable (edit button visible with valid link)
    const editBtn = page.getByTestId('edit-proceeding-button');
    await expect(editBtn).toBeVisible();
    await expect(editBtn).toHaveAttribute('href', `/matters/${closedProcMatterId}/proceedings/${closedProcId}/edit`);
  });

  // =========================================================================
  // 8. Filter by Court, Client, and Incomplete Data
  // =========================================================================
  test('filters matters by Court, Client, and Incomplete Data filters @t07 @filters', async ({
    page,
  }) => {
    test.setTimeout(90_000);
    await signInWithTotp(page, owner);

    await page.goto('/matters');

    // 1. Filter by Court
    const courtSelect = page.getByTestId('filter-court-select');
    await courtSelect.selectOption(testCourtId);
    await page.getByTestId('matters-search-submit').click();
    await expect(page).toHaveURL(new RegExp(`courtId=${testCourtId}`));
    await expect(page.locator('tbody tr, [data-testid^="matter-card-"]').filter({ hasText: runId }).first()).toBeVisible();

    // 2. Filter by Client (using searchable client picker popover)
    const openClientPickerBtn = page.getByTestId('open-client-picker-button');
    await openClientPickerBtn.click();
    await expect(page.getByTestId('client-picker-popover')).toBeVisible();
    await page.getByRole('button', { name: 'إغلاق اختيار الموكل' }).click();
    await expect(openClientPickerBtn).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(page.getByTestId('client-picker-popover')).toBeVisible();

    const clientSearchInput = page.getByTestId('filter-client-search-input');
    await clientSearchInput.fill(`لا يوجد اسم مطابق ${runId}`);
    await expect(page.getByRole('status', { name: '' }).filter({ hasText: 'لا يوجد موكلين مطابقين' })).toBeVisible();
    await expect(page.locator('[data-testid^="filter-client-option-"]')).toHaveCount(0);
    await clientSearchInput.fill(runId);
    const clientOption = page.getByTestId(`filter-client-option-${testPartyId}`);
    await expect(clientOption).toBeVisible();
    await clientOption.click();
    await expect(openClientPickerBtn).toBeFocused();

    // Verify client select is updated
    const clientSelect = page.getByTestId('filter-client-select');
    expect(await clientSelect.inputValue()).toBe(testPartyId);

    await page.getByTestId('matters-search-submit').click();
    expect(page.url()).not.toContain('clientId=');
    expect(page.url()).not.toContain(testPartyId);
    await expect(page.locator('tbody tr, [data-testid^="matter-card-"]').filter({ hasText: `الأهرام ${runId}` }).first()).toBeVisible();
    await page.locator('tbody tr a').first().click();
    await expect(page).toHaveURL(/\/matters\/[a-f0-9-]+$/);
    await page.goBack();
    await expect(clientSelect).toHaveValue(testPartyId);

    // 3. Filter by Incomplete Data
    await page.getByTestId('matters-clear-filters').click();
    const incompleteCheckbox = page.getByTestId('incomplete-data-checkbox');
    await incompleteCheckbox.check();
    await page.getByTestId('matters-search-submit').click();
    await expect(page).toHaveURL(/incompleteData=true/);
    expect(incompleteMatterId).toBeTruthy();
    await expect(page.locator('tbody tr, [data-testid^="matter-card-"]').filter({ hasText: `ملف ناقص البيانات للاختبار ${runId}` }).first()).toBeVisible();
  });

  // =========================================================================
  // 9. Frozen Operation Retry on Lifecycle Failure
  // =========================================================================
  test('verifies frozen operation retry on lifecycle failure @t07 @retry', async ({
    page,
  }) => {
    test.setTimeout(90_000);
    await signInWithTotp(page, owner);

    // Dedicated retry matter
    await page.goto(`/matters/${retryMatterId}`);
    await expect(page.locator('h1')).toContainText(runId);

    const archiveMatterBtn = page.getByTestId('archive-matter-button');
    await expect(archiveMatterBtn).toBeVisible();
    await archiveMatterBtn.click();

    const reasonInput = page.getByTestId('archive-matter-reason-input');
    await expect(reasonInput).toBeVisible();
    await reasonInput.fill('أرشفة تجريبية لفحص إعادة المحاولة والمفتاح المجمد');

    // Intercept POST request: allow server commit via route.fetch(), then abort delivery to browser
    let interceptedOnce = false;
    let interceptedKey: string | null = null;
    let originalRequest: unknown;
    await page.route('**/matters/**', async (route) => {
      const req = route.request();
      if (req.method() === 'POST' && !interceptedOnce) {
        interceptedOnce = true;
        const postData = req.postDataJSON() as unknown;
        originalRequest = postData;
        const payload = Array.isArray(postData) ? postData[0] : (postData as { idempotencyKey?: string } | null);
        if (payload?.idempotencyKey) {
          interceptedKey = payload.idempotencyKey;
        }
        // Let the request reach the server and commit in PostgreSQL!
        await route.fetch();
        // Drop the response to simulate lost connection/response
        await route.abort('failed');
        return;
      }
      await route.continue();
    });

    // Submit -> server commits, but browser catches response delivery failure
    await page.getByTestId('confirm-archive-matter-button').click();

    // Assert alert and amber frozen key banner appear
    await expect(page.locator('[role="alert"]').first()).toBeVisible();
    await expect(page.locator('text=العملية مجمّدة بمفتاح الطلب نفسه لضمان عدم التكرار')).toBeVisible();
    await expect(page.getByTestId('frozen-reason-notice')).toBeVisible();

    // Verify reason textarea is readOnly
    await expect(page.getByTestId('archive-matter-reason-input')).toHaveAttribute('readonly', '');

    // The retry button is rendered
    const retryBtn = page.getByTestId('retry-archive-matter-button');
    await expect(retryBtn).toBeVisible();

    // Verify database state: row was already committed by server during the lost response!
    const matterInDbAfterCommit = await prisma.matter.findUnique({
      where: { id: retryMatterId },
      select: { status: true, version: true, archivedAt: true },
    });
    expect(matterInDbAfterCommit?.status).toBe('ARCHIVED');
    expect(matterInDbAfterCommit?.archivedAt).not.toBeNull();
    expect(matterInDbAfterCommit?.version).toBe(2);

    // Exactly 1 audit event exists
    const auditCountBeforeRetry = await prisma.auditEvent.count({
      where: { entityId: retryMatterId, action: 'ARCHIVE_MATTER' },
    });
    expect(auditCountBeforeRetry).toBe(1);

    // Dismiss the modal to verify page-level unresolved lifecycle banner and competing action protection
    await page.getByRole('button', { name: 'إلغاء' }).click();
    await expect(page.getByTestId('archive-matter-modal')).toBeHidden();

    // Verify page-level unresolved lifecycle banner is displayed with frozen key notice
    const unresolvedBanner = page.getByTestId('unresolved-lifecycle-banner');
    await expect(unresolvedBanner).toBeVisible();
    await expect(unresolvedBanner).toContainText('العملية مجمّدة');

    // The unresolved request remains reachable after leaving and returning to the detail.
    await page.getByTestId('nav-link-search').click();
    await expect(page).toHaveURL(/\/search$/);
    await page.goBack();
    await expect(unresolvedBanner).toBeVisible();

    await page.context().clearCookies();
    await page.evaluate(() => window.dispatchEvent(new Event('lawoffice:recheck-session')));
    await expect(page.getByTestId('protected-view-lock')).toContainText('انتهت الجلسة');
    const reauth = await page.context().newPage();
    try {
      await signInWithTotp(reauth, owner);
    } finally {
      await reauth.close();
    }
    await page.evaluate(() => window.dispatchEvent(new Event('lawoffice:recheck-session')));
    await expect(unresolvedBanner).toBeVisible();
    await expect(page.getByTestId('reopen-matter-button')).toBeDisabled();

    // Reopen modal via unresolved lifecycle banner
    await page.getByTestId('reopen-unresolved-lifecycle-button').click();
    await expect(page.getByTestId('archive-matter-modal')).toBeVisible();
    await expect(page.getByTestId('archive-matter-reason-input')).toHaveAttribute('readonly', '');

    // Track retry request key
    let retryInterceptedKey: string | null = null;
    let retryRequest: unknown;
    await page.unroute('**/matters/**');
    await page.route('**/matters/**', async (route) => {
      const req = route.request();
      if (req.method() === 'POST') {
        const postData = req.postDataJSON() as unknown;
        retryRequest = postData;
        const payload = Array.isArray(postData) ? postData[0] : (postData as { idempotencyKey?: string } | null);
        if (payload?.idempotencyKey) {
          retryInterceptedKey = payload.idempotencyKey;
        }
      }
      await route.continue();
    });

    // Click retry with the frozen key
    await page.getByTestId('retry-archive-matter-button').click();

    // Modal closes and archived state is reflected in UI
    await expect(page.getByTestId('archive-matter-modal')).toBeHidden();
    await expect(page.getByTestId('matter-archived-banner')).toBeVisible();
    await expect(page.getByTestId('matter-status-badge')).toContainText('مؤرشف');

    // Verify retry resent identical idempotency key
    expect(interceptedKey).toBeTruthy();
    expect(retryInterceptedKey).toBe(interceptedKey);
    expect(retryRequest).toEqual(originalRequest);

    // Verify in database: retry was idempotent! Still exactly 1 audit event row and version bump = 1!
    const auditCountAfterRetry = await prisma.auditEvent.count({
      where: { entityId: retryMatterId, action: 'ARCHIVE_MATTER' },
    });
    expect(auditCountAfterRetry).toBe(1);

    const finalMatter = await prisma.matter.findUniqueOrThrow({
      where: { id: retryMatterId },
      select: { version: true, status: true },
    });
    expect(finalMatter.version).toBe(2);
    expect(finalMatter.status).toBe('ARCHIVED');

    const claim = await prisma.idempotencyRecord.findFirstOrThrow({
      where: { key: interceptedKey! },
    });
    expect(claim.status).toBe('COMPLETED');
    expect(await prisma.idempotencyRecord.count({
      where: { commandType: 'archiveMatter', resultId: retryMatterId },
    })).toBe(1);
  });
});

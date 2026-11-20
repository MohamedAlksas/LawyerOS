import { test, expect } from '@playwright/test';
import { getPrismaClient } from '@/lib/auth';
import {
  seedT04Owner,
  deleteT04Owner,
  signInWithTotp,
  currentTotp,
  revokeAllSessionsForUser,
  T04Owner,
} from '../helpers/t04-auth';
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

    // 13. Recover from conflict by reloading latest snapshot and reapplying edits
    await page.goto(`/matters/${matter.id}/proceedings/${proceeding.id}/edit`);
    await page.waitForLoadState('networkidle');

    // Adopted latest background circuit
    await expect(page.getByTestId('proceeding-circuit-input')).toHaveValue('دائرة معدلة في الخلفية');

    // Reapply user edits with fresh expectedVersion (now 2)
    await page.getByTestId('proceeding-number-input').fill('9988');
    await page.getByTestId(`capacity-text-${matterPartyId}`).fill('المدعي بالحق المدني المعدل');

    // Submit form with updated expectedVersion
    await page.getByTestId('proceeding-submit-button').click();

    // Verify submission succeeds and redirects to matter/proceeding detail
    await page.waitForURL((url) => url.pathname === `/matters/${matter.id}`);
    expect(page.url()).toContain(`/matters/${matter.id}`);

    // Verify persisted outcomes in DB: proceeding row has updated number and version 3
    const dbProcFinal = await prisma.proceeding.findUnique({
      where: { id: proceeding.id },
      include: { parties: true },
    });
    expect(dbProcFinal?.numberText).toBe('9988');
    expect(dbProcFinal?.version).toBe(3);
    expect(dbProcFinal?.parties[0].capacityText).toBe('المدعي بالحق المدني المعدل');
  });

  test('signed-out deep link preserves returnTo and settles on destination matter after login and MFA (C21) @matters', async ({
    browser,
  }) => {
    test.setTimeout(120_000);

    // 1. Create a test matter in DB
    const matter = await prisma.matter.create({
      data: {
        fileCode: '2026/7771',
        title: 'ملف تجربة التوجيه الآمن بعد الدخول',
        kind: 'LITIGATION',
        status: 'ACTIVE',
        createdById: owner.id,
        updatedById: owner.id,
      },
    });
    createdMatterIds.push(matter.id);

    // 2. Open an unauthenticated browser context
    const unauthContext = await browser.newContext();
    const page = await unauthContext.newPage();

    try {
      // 3. Navigate directly to matter deep link
      await page.goto(`/matters/${matter.id}`);

      // 4. Verify redirected to login with returnTo
      await expect(page).toHaveURL((url) => {
        return (
          url.pathname === '/login' &&
          url.searchParams.get('error') === 'session_expired' &&
          url.searchParams.get('returnTo') === `/matters/${matter.id}`
        );
      });

      // 5. Fill credentials and submit
      await page.locator('#email').fill(owner.email);
      await page.locator('#password').fill(owner.password);
      await page.locator('button[type="submit"]').click();

      // 6. Verify forward to verify with returnTo preserved
      await expect(page).toHaveURL((url) => {
        return (
          url.pathname === '/verify' &&
          url.searchParams.get('returnTo') === `/matters/${matter.id}`
        );
      });

      // 7. Fill TOTP code and submit
      const code = await currentTotp(owner.totpSecret);
      await page.locator('#totpCode').fill(code);
      await page.locator('button[type="submit"]').click();

      // 8. Assert browser settles on target deep link and NOT home '/'
      await page.waitForURL((url) => url.pathname === `/matters/${matter.id}`);
      expect(page.url()).toContain(`/matters/${matter.id}`);
      await expect(page.getByRole('heading', { level: 1 })).toContainText(matter.title);
    } finally {
      await unauthContext.close();
    }
  });

  test('unfinished MFA preserves returnTo when returning to login (C21) @matters', async ({
    browser,
  }) => {
    test.setTimeout(90_000);

    const unauthContext = await browser.newContext();
    const page = await unauthContext.newPage();

    try {
      // 1. Visit /matters/new signed out
      await page.goto('/matters/new');
      await expect(page).toHaveURL((url) => {
        return (
          url.pathname === '/login' &&
          url.searchParams.get('returnTo') === '/matters/new'
        );
      });

      // 2. Submit credentials to reach verify step
      await page.locator('#email').fill(owner.email);
      await page.locator('#password').fill(owner.password);
      await page.locator('button[type="submit"]').click();
      await expect(page).toHaveURL(/\/verify\?returnTo=%2Fmatters%2Fnew/);

      // 3. User cancels MFA and returns to login
      const backToLoginBtn = page.getByRole('button', { name: 'العودة إلى شاشة تسجيل الدخول' });
      await expect(backToLoginBtn).toBeVisible();
      await backToLoginBtn.click();

      // 4. Verify returnTo is safely preserved on login
      await expect(page).toHaveURL((url) => {
        return (
          url.pathname === '/login' &&
          url.searchParams.get('returnTo') === '/matters/new'
        );
      });
    } finally {
      await unauthContext.close();
    }
  });

  test('preserves in-memory form inputs and renders explicit recovery banner on mid-form session revocation (C21) @matters', async ({
    page,
  }) => {
    test.setTimeout(120_000);
    await signInWithTotp(page, owner);

    // 1. Navigate to matter create form
    await page.goto('/matters/new');
    await expect(page).toHaveURL(/\/matters\/new/);

    // 2. Populate form fields in memory
    const testTitle = 'دعوى تعويض عن إخلال عقدي تجريبي';
    const testSummary = 'ملخص محفوظ في الذاكرة لتجربة استرجاع الجلسة عند الإلغاء';
    const testNotes = 'ملاحظات تدقيق أمان الهوية';

    await page.getByTestId('matter-title-input').fill(testTitle);
    await page.getByTestId('matter-summary-textarea').fill(testSummary);
    await page.getByTestId('matter-notes-textarea').fill(testNotes);

    // 3. Simulate mid-journey server session revocation
    const revokedCount = await revokeAllSessionsForUser(owner.id);
    expect(revokedCount).toBeGreaterThan(0);

    // 4. User attempts form submission with revoked session
    await page.getByTestId('matter-submit-button').click();

    // 5. Verify explicit session expired recovery alert is displayed
    const recoveryAlert = page.getByTestId('session-expired-recovery-alert');
    await expect(recoveryAlert).toBeVisible();
    await expect(recoveryAlert).toContainText('انتهت صلاحية الجلسة أو تم إلغاؤها');
    await expect(recoveryAlert).toContainText('تم الحفاظ على كافة البيانات والتعديلات المدخلة في ذاكرة الصفحة دون فقدان');

    // 6. Verify in-memory inputs were NOT wiped or lost
    await expect(page.getByTestId('matter-title-input')).toHaveValue(testTitle);
    await expect(page.getByTestId('matter-summary-textarea')).toHaveValue(testSummary);
    await expect(page.getByTestId('matter-notes-textarea')).toHaveValue(testNotes);

    // 7. Verify recovery action link points to login with target="_blank"
    const loginLink = page.getByTestId('session-recovery-login-link');
    await expect(loginLink).toBeVisible();
    await expect(loginLink).toHaveAttribute('href', '/login');
    await expect(loginLink).toHaveAttribute('target', '_blank');

    // 8. Open login in new tab/page within same context to renew session via login & MFA
    const loginPage = await page.context().newPage();
    await signInWithTotp(loginPage, owner);
    await loginPage.close();

    // 9. Return to original page with frozen form and click session recovery retry button
    const retryBtn = page.getByTestId('session-recovery-retry-button');
    await expect(retryBtn).toBeVisible();
    await retryBtn.click();

    // 10. Verify submission completes successfully and navigates to the newly created matter
    await page.waitForURL((url) => url.pathname.startsWith('/matters/') && url.pathname !== '/matters/new');
    const newMatterId = new URL(page.url()).pathname.split('/').pop()!;
    createdMatterIds.push(newMatterId);

    // 11. Assert persisted matter in DB matches the in-memory preserved values
    const createdMatter = await prisma.matter.findUnique({
      where: { id: newMatterId },
    });
    expect(createdMatter).not.toBeNull();
    expect(createdMatter?.title).toBe(testTitle);
    expect(createdMatter?.createdById).toBe(owner.id);
  });

  test('recovers from transport-uncertain save via retry without creating duplicate records @matters', async ({
    page,
  }) => {
    test.setTimeout(120_000);
    await signInWithTotp(page, owner);

    // 1. Navigate to matter create form
    await page.goto('/matters/new');
    await expect(page).toHaveURL(/\/matters\/new/);

    const uniqueTitle = `دعوى التحقق من عدم التكرار ${Date.now()}`;
    await page.getByTestId('matter-title-input').fill(uniqueTitle);

    // 2. Intercept the first POST action request to simulate committed save with lost response
    let interceptedOnce = false;
    await page.route('**/matters**', async (route) => {
      if (route.request().method() === 'POST' && !interceptedOnce) {
        interceptedOnce = true;
        // Fetch to execute and commit on server, then abort client response
        await page.request.fetch(route.request());
        await route.abort('failed');
      } else {
        await route.continue();
      }
    });

    // 3. Click submit
    await page.getByTestId('matter-submit-button').click();

    // 4. Verify operation pending / uncertain banner appears with retry button
    const pendingBanner = page.getByTestId('operation-pending-banner');
    await expect(pendingBanner).toBeVisible();

    // 5. Unroute so retry goes through cleanly
    await page.unroute('**/matters**');

    // 6. Click retry original operation
    const retryBtn = page.getByTestId('operation-retry-button');
    await expect(retryBtn).toBeVisible();
    await retryBtn.click();

    // 7. Verify navigation settles on created matter
    await page.waitForURL((url) => url.pathname.startsWith('/matters/') && url.pathname !== '/matters/new');
    const createdId = new URL(page.url()).pathname.split('/').pop()!;
    createdMatterIds.push(createdId);

    // 8. Verify exactly ONE matter row was created in DB for this title (no duplicate records)
    const matchingMatters = await prisma.matter.findMany({
      where: { title: uniqueTitle },
    });
    expect(matchingMatters).toHaveLength(1);
    expect(matchingMatters[0].id).toBe(createdId);

    // 9. Verify exact audit event recorded for CREATE_MATTER
    const auditEvents = await prisma.auditEvent.findMany({
      where: {
        entityType: 'Matter',
        entityId: createdId,
        action: 'CREATE_MATTER',
      },
    });
    expect(auditEvents).toHaveLength(1);
  });

  test('enforces focus trap and keyboard navigation inside reference edit modal without focus stealing (U9/C23) @matters', async ({
    page,
  }) => {
    test.setTimeout(90_000);
    await signInWithTotp(page, owner);

    // Create a court to edit
    const court = await prisma.court.create({
      data: {
        name: 'محكمة استئناف القاهرة الجديدة التجريبية',
        code: 'CRT-CAIRO-E2E',
        isActive: true,
        createdById: owner.id,
        updatedById: owner.id,
      },
    });
    createdCourtIds.push(court.id);

    // 1. Navigate to reference settings
    await page.goto('/settings/reference');
    await expect(page).toHaveURL(/\/settings\/reference/);

    // 2. Click courts tab
    await page.getByTestId('tab-courts').click();

    // 3. Open Edit modal for the court
    const editBtn = page.getByTestId(`edit-reference-item-${court.id}`);
    await expect(editBtn).toBeVisible();
    await editBtn.click();

    const modal = page.getByRole('dialog');
    await expect(modal).toBeVisible();

    // Verify initial focus is trapped inside modal on name input
    const nameInput = page.getByTestId('edit-reference-item-name-input');
    await expect(nameInput).toBeFocused();

    // Press Escape when unmodified closes modal cleanly
    await page.keyboard.press('Escape');
    await expect(modal).toBeHidden();

    // Re-open modal and type in secondary fields
    await editBtn.click();
    await expect(modal).toBeVisible();
    await expect(nameInput).toBeFocused();

    // Tab to Code input and type sequentially — focus must NOT jump back to name input (U9)
    await page.keyboard.press('Tab');
    const codeInput = page.getByTestId('edit-reference-item-code-input');
    await expect(codeInput).toBeFocused();
    await codeInput.pressSequentially('EDIT');
    await expect(codeInput).toBeFocused();
    await expect(nameInput).not.toBeFocused();

    // Tab to Notes input and type sequentially — focus must NOT jump back to name input (U9)
    await page.keyboard.press('Tab');
    const notesInput = page.getByTestId('edit-reference-item-notes-input');
    await expect(notesInput).toBeFocused();
    await notesInput.pressSequentially('ملاحظات التجربة');
    await expect(notesInput).toBeFocused();
    await expect(nameInput).not.toBeFocused();

    // Tab cycling trap: Tab through remaining elements wraps back to first element
    await page.keyboard.press('Tab'); // active checkbox
    await page.keyboard.press('Tab'); // cancel button
    const cancelBtn = modal.getByRole('button', { name: 'إلغاء' });
    await expect(cancelBtn).toBeFocused();
    await page.keyboard.press('Tab'); // save button
    const saveBtn = modal.getByRole('button', { name: 'حفظ التعديلات' });
    await expect(saveBtn).toBeFocused();
    await page.keyboard.press('Tab'); // wraps around to header close button
    await page.keyboard.press('Tab'); // moves to first form input (name input)
    await expect(nameInput).toBeFocused();

    // Close via cancel button (confirm discard of unsaved changes)
    page.once('dialog', (d) => d.accept());
    await cancelBtn.click();
    await expect(modal).toBeHidden();

    // Focus restoration: closing the modal restores focus to the triggering edit button
    await expect(editBtn).toBeFocused();
  });

  test('blocks competing association operations while an operation is in flight and settles on retry (U1/U3) @matters', async ({
    page,
  }) => {
    test.setTimeout(120_000);
    await signInWithTotp(page, owner);

    // Create 2 parties
    const partyA = await prisma.party.create({
      data: {
        kind: 'PERSON',
        name: `طرف أ للتزامن ${Date.now()}`,
        nameNormalized: `طرف أ للتزامن ${Date.now()}`,
        createdById: owner.id,
        updatedById: owner.id,
      },
    });
    createdPartyIds.push(partyA.id);

    const partyB = await prisma.party.create({
      data: {
        kind: 'PERSON',
        name: `طرف ب للتزامن ${Date.now()}`,
        nameNormalized: `طرف ب للتزامن ${Date.now()}`,
        createdById: owner.id,
        updatedById: owner.id,
      },
    });
    createdPartyIds.push(partyB.id);

    // Create matter with partyA as CLIENT and partyB as OPPONENT
    const matter = await prisma.matter.create({
      data: {
        fileCode: `2026/M${Date.now().toString().slice(-4)}`,
        title: `قضية فحص تنازع العمليات المتزامنة ${Date.now()}`,
        kind: 'LITIGATION',
        status: 'ACTIVE',
        createdById: owner.id,
        updatedById: owner.id,
        parties: {
          create: [
            {
              partyId: partyA.id,
              role: 'CLIENT',
              isPrimaryContact: true,
              version: 1,
              createdById: owner.id,
              updatedById: owner.id,
            },
            {
              partyId: partyB.id,
              role: 'OPPONENT',
              isPrimaryContact: false,
              version: 1,
              createdById: owner.id,
              updatedById: owner.id,
            },
          ],
        },
      },
      include: { parties: true },
    });
    createdMatterIds.push(matter.id);
    const mpA = matter.parties.find((p) => p.partyId === partyA.id)!;
    const mpB = matter.parties.find((p) => p.partyId === partyB.id)!;

    // Navigate to matter detail
    await page.goto(`/matters/${matter.id}`);
    await expect(page).toHaveURL(new RegExp(`/matters/${matter.id}$`));

    // Handle any window dialogs (e.g. confirm on unlink)
    page.on('dialog', (d) => d.accept());

    // Intercept POST request for unlinking party B to simulate lost response
    let abortedOnce = false;
    await page.route('**/matters/**', async (route) => {
      if (route.request().method() === 'POST' && !abortedOnce) {
        abortedOnce = true;
        await page.request.fetch(route.request());
        await route.abort('failed');
      } else {
        await route.continue();
      }
    });

    // Click unlink on opponent party B
    const unlinkBtnB = page.getByTestId(`unlink-opponent-${mpB.id}`);
    await expect(unlinkBtnB).toBeVisible();
    await unlinkBtnB.click();

    // Verify operation pending banner appears for the association operation
    const assocPendingBanner = page.getByTestId('assoc-operation-pending-banner');
    await expect(assocPendingBanner).toBeVisible();

    // Verify Party A controls are DISABLED while Party B operation is pending/unsettled
    const toggleBtnA = page.getByTestId(`toggle-primary-${mpA.id}`);
    const unlinkBtnA = page.getByTestId(`unlink-party-${mpA.id}`);
    const addPartyBtn = page.getByTestId('open-add-party-modal');

    await expect(toggleBtnA).toBeDisabled();
    await expect(unlinkBtnA).toBeDisabled();
    await expect(unlinkBtnB).toBeDisabled();
    await expect(addPartyBtn).toBeDisabled();

    // Unroute network abort
    await page.unroute('**/matters/**');

    // Click retry on the association pending banner
    const assocRetryBtn = page.getByTestId('assoc-operation-retry-button');
    await expect(assocRetryBtn).toBeVisible();
    await assocRetryBtn.click();

    // Verify pending banner is dismissed
    await expect(assocPendingBanner).toBeHidden();

    // Verify Party B opponent card is removed
    await expect(page.getByTestId(`opponent-card-${mpB.id}`)).toBeHidden();

    // Verify Party A controls are now re-enabled
    await expect(toggleBtnA).toBeEnabled();
    await expect(unlinkBtnA).toBeEnabled();
    await expect(addPartyBtn).toBeEnabled();

    // Verify exact persisted effects in DB (E1 / Codex requirement)
    const checkPartyB = await prisma.matterParty.findUnique({ where: { id: mpB.id } });
    expect(checkPartyB).toBeNull();

    const checkPartyA = await prisma.matterParty.findUnique({ where: { id: mpA.id } });
    expect(checkPartyA).not.toBeNull();
    expect(checkPartyA?.isPrimaryContact).toBe(true);

    const auditUnlinkB = await prisma.auditEvent.count({
      where: {
        entityId: mpB.id,
        action: 'UNLINK_MATTER_PARTY',
      },
    });
    expect(auditUnlinkB).toBe(1);
  });

  test('invalidates proceeding similarity confirmation immediately on docket change (U7) @matters', async ({
    page,
  }) => {
    test.setTimeout(120_000);
    await signInWithTotp(page, owner);

    // Create court
    const court = await prisma.court.create({
      data: {
        name: `محكمة الاستئناف للتشابه ${Date.now()}`,
        code: `CRT-SIM-${Date.now().toString().slice(-4)}`,
        isActive: true,
        createdById: owner.id,
        updatedById: owner.id,
      },
    });
    createdCourtIds.push(court.id);

    // Create matter 1
    const matter1 = await prisma.matter.create({
      data: {
        fileCode: `2026/S1-${Date.now().toString().slice(-4)}`,
        title: 'قضية أصلية لوجود تشابه',
        kind: 'LITIGATION',
        status: 'ACTIVE',
        createdById: owner.id,
        updatedById: owner.id,
      },
    });
    createdMatterIds.push(matter1.id);

    // Create existing proceeding A on matter 1
    const existingProcA = await prisma.proceeding.create({
      data: {
        matterId: matter1.id,
        courtId: court.id,
        instance: 'FIRST_INSTANCE',
        numberText: '7788',
        yearLabel: '2026',
        status: 'ACTIVE',
        createdById: owner.id,
        updatedById: owner.id,
      },
    });

    // Create existing proceeding B on matter 1
    const existingProcB = await prisma.proceeding.create({
      data: {
        matterId: matter1.id,
        courtId: court.id,
        instance: 'FIRST_INSTANCE',
        numberText: '7789',
        yearLabel: '2026',
        status: 'ACTIVE',
        createdById: owner.id,
        updatedById: owner.id,
      },
    });

    // Create matter 2 where we will add a proceeding
    const matter2 = await prisma.matter.create({
      data: {
        fileCode: `2026/S2-${Date.now().toString().slice(-4)}`,
        title: 'قضية ثانية لاختبار إلغاء تأكيد التشابه',
        kind: 'LITIGATION',
        status: 'ACTIVE',
        createdById: owner.id,
        updatedById: owner.id,
      },
    });
    createdMatterIds.push(matter2.id);

    // Navigate to new proceeding form for matter 2
    await page.goto(`/matters/${matter2.id}/proceedings/new`);
    await expect(page).toHaveURL(new RegExp(`/matters/${matter2.id}/proceedings/new$`));

    // Fill court, year, number matching existing proceeding A
    await page.getByTestId('proceeding-court-select').selectOption(court.id);
    await page.getByTestId('proceeding-year-input').fill('2026');
    await page.getByTestId('proceeding-number-input').fill('7788');

    // Wait for similarity warning banner showing candidate A
    const similarityBanner = page.getByTestId('similarity-warning-banner');
    await expect(similarityBanner).toBeVisible();
    await expect(page.getByTestId(`similarity-candidate-${existingProcA.id}`)).toBeVisible();

    // Click confirm distinct save for candidate A
    const confirmBtn = page.getByTestId('confirm-distinct-save-button');
    await expect(confirmBtn).toBeVisible();
    await confirmBtn.click();

    // Verify confirmation message appears for candidate A
    const confirmedMsg = page.getByTestId('distinct-save-confirmed-message');
    await expect(confirmedMsg).toBeVisible();

    // Now edit the number input to change docket identity from 7788 to 7789 (U7)
    await page.getByTestId('proceeding-number-input').fill('7789');

    // On docket change:
    // 1. A's confirmation message must be immediately invalidated
    // 2. A's candidate must NOT remain visible for 7789
    // 3. Confirm button must NOT carry over A's confirmation
    await expect(confirmedMsg).toBeHidden();
    await expect(page.getByTestId(`similarity-candidate-${existingProcA.id}`)).toBeHidden();

    // Wait for B's candidate to load
    await expect(page.getByTestId(`similarity-candidate-${existingProcB.id}`)).toBeVisible();

    // Without clicking confirm for B, attempt to submit -> must be blocked
    await page.getByTestId('proceeding-submit-button').click();
    await expect(page.getByTestId('proceeding-error-banner')).toBeVisible();
    await expect(page.getByTestId('proceeding-error-banner')).toContainText('عُثر على قيود قضائية مطابقة في نفس المحكمة');

    // Now confirm candidate B
    await expect(confirmBtn).toBeVisible();
    await confirmBtn.click();
    await expect(confirmedMsg).toBeVisible();

    // Submit now succeeds and navigates to matter detail page
    await page.getByTestId('proceeding-submit-button').click();
    await page.waitForURL(new RegExp(`/matters/${matter2.id}$`));
    await page.getByTestId('tab-proceedings').click();
    await expect(page.getByText('7789')).toBeVisible();
  });

  test('requires explicit draft acknowledgment when editing an initially draft proceeding with incomplete docket (U5) @matters', async ({
    page,
  }) => {
    test.setTimeout(120_000);
    await signInWithTotp(page, owner);

    // Create matter
    const matter = await prisma.matter.create({
      data: {
        fileCode: `2026/D${Date.now().toString().slice(-4)}`,
        title: 'قضية لقيد مسودة أولي',
        kind: 'LITIGATION',
        status: 'ACTIVE',
        createdById: owner.id,
        updatedById: owner.id,
      },
    });
    createdMatterIds.push(matter.id);

    // Create court
    const draftCourt = await prisma.court.create({
      data: {
        name: `محكمة لقيد مسودة ${Date.now()}`,
        code: `CRT-DFT-${Date.now().toString().slice(-4)}`,
        isActive: true,
        createdById: owner.id,
        updatedById: owner.id,
      },
    });
    createdCourtIds.push(draftCourt.id);

    // Create DRAFT proceeding with no docket number or year
    const draftProc = await prisma.proceeding.create({
      data: {
        matterId: matter.id,
        courtId: draftCourt.id,
        instance: 'FIRST_INSTANCE',
        status: 'DRAFT',
        createdById: owner.id,
        updatedById: owner.id,
      },
    });

    // Navigate to edit form of the draft proceeding
    await page.goto(`/matters/${matter.id}/proceedings/${draftProc.id}/edit`);
    await expect(page).toHaveURL(new RegExp(`/matters/${matter.id}/proceedings/${draftProc.id}/edit$`));

    // Try to switch status to ACTIVE without court/number
    await page.getByTestId('proceeding-status-select').selectOption('ACTIVE');

    // Submit -> must be rejected because docket is incomplete for ACTIVE status
    await page.getByTestId('proceeding-submit-button').click();
    await expect(page.getByTestId('proceeding-error-banner')).toBeVisible();

    // Verify incomplete draft acknowledgment checkbox is NOT pre-checked
    const ackCheckbox = page.getByTestId('incomplete-draft-acknowledgement');
    await expect(ackCheckbox).toBeVisible();
    await expect(ackCheckbox).not.toBeChecked();

    // Acknowledge explicitly that incomplete docket is saved as DRAFT despite ACTIVE selection
    await ackCheckbox.check();
    await expect(ackCheckbox).toBeChecked();

    // Submit -> now succeeds and settles on matter detail page with DRAFT proceeding
    await page.getByTestId('proceeding-submit-button').click();
    await page.waitForURL(new RegExp(`/matters/${matter.id}$`));
    await page.getByTestId('tab-proceedings').click();
    await expect(page.getByTestId('proceeding-draft-badge')).toBeVisible();
  });

  test('reference refresh preserves dirty office form version and triggers concurrency conflict on concurrent edit (U8/C10) @matters', async ({
    page,
  }) => {
    test.setTimeout(120_000);
    await signInWithTotp(page, owner);

    // 1. Navigate to reference settings
    await page.goto('/settings/reference');
    await expect(page).toHaveURL(/\/settings\/reference/);

    const officeNameInput = page.getByTestId('office-name-input');
    await expect(officeNameInput).toBeVisible();

    // 2. Tab 1 edits office name (form becomes dirty)
    await officeNameInput.fill('مكتب المحاماة المحلي المعدل');

    // 3. Simulating Tab 2 / concurrent user: update office phone & address directly in DB, bumping version 1 -> 2
    const currentOffice = await prisma.officeSettings.findFirstOrThrow();
    await prisma.officeSettings.update({
      where: { id: currentOffice.id },
      data: {
        phone: '01012345678',
        address: 'الدقي - الجيزة',
        version: currentOffice.version + 1,
        updatedById: owner.id,
      },
    });

    // 4. Tab 1 creates a reference item (triggers page refresh of initialOfficeSettings props)
    await page.getByTestId('tab-courts').click();
    const courtName = `محكمة تنشيط الخادم ${Date.now()}`;
    await page.getByTestId('reference-item-name-input').fill(courtName);
    await page.getByTestId('add-reference-item-button').click();

    // Wait for court creation to succeed
    await expect(page.getByTestId('reference-item-name-input')).toHaveValue('');

    // Switch back to office tab
    await page.getByTestId('tab-office-profile').click();

    // Verify Tab 1 form is STILL dirty with local edits and was NOT overwritten by silent refresh
    await expect(officeNameInput).toHaveValue('مكتب المحاماة المحلي المعدل');

    // 5. Tab 1 attempts to save office settings -> must encounter CONCURRENCY_CONFLICT
    await page.getByTestId('save-office-button').click();

    const conflictError = page.getByTestId('office-error-banner');
    await expect(conflictError).toBeVisible();
    await expect(conflictError).toContainText('تعارض في التعديل المتزامن');

    // Verify Tab 2's values survived in DB! (Not silently overwritten!)
    const reloadedDb = await prisma.officeSettings.findUniqueOrThrow({ where: { id: currentOffice.id } });
    expect(reloadedDb.phone).toBe('01012345678');
    expect(reloadedDb.address).toBe('الدقي - الجيزة');

    // 6. User clicks deliberate reconciliation button
    const reconcileBtn = page.getByTestId('office-reconcile-server-button');
    await expect(reconcileBtn).toBeVisible();
    await reconcileBtn.click();

    // Verify form adopts Tab 2's latest values from the server
    await expect(page.getByTestId('office-phone-input')).toHaveValue('01012345678');
    await expect(page.getByTestId('office-address-input')).toHaveValue('الدقي - الجيزة');
  });

  test('recovers from committed proceeding creation with lost response using original idempotency key without duplicate creation (E1) @matters', async ({
    page,
  }) => {
    test.setTimeout(120_000);
    await signInWithTotp(page, owner);

    const court = await prisma.court.create({
      data: {
        name: `محكمة الفقدان للقيد ${Date.now()}`,
        code: `CRT-LOS-${Date.now().toString().slice(-4)}`,
        isActive: true,
        createdById: owner.id,
        updatedById: owner.id,
      },
    });
    createdCourtIds.push(court.id);

    const matter = await prisma.matter.create({
      data: {
        fileCode: `2026/LP-${Date.now().toString().slice(-4)}`,
        title: 'قضية لفحص فقدان استجابة القيد',
        kind: 'LITIGATION',
        status: 'ACTIVE',
        createdById: owner.id,
        updatedById: owner.id,
      },
    });
    createdMatterIds.push(matter.id);

    await page.goto(`/matters/${matter.id}/proceedings/new`);
    await expect(page).toHaveURL(new RegExp(`/matters/${matter.id}/proceedings/new$`));

    const uniqueNumber = `${Date.now().toString().slice(-4)}/ف`;
    await page.getByTestId('proceeding-court-select').selectOption(court.id);
    await page.getByTestId('proceeding-year-input').fill('2026');
    await page.getByTestId('proceeding-number-input').fill(uniqueNumber);

    // Wait for debounced similarity check to finish so route interception only catches form submission
    await page.waitForTimeout(500);

    let interceptedOnce = false;
    await page.route(`**/matters/${matter.id}/proceedings**`, async (route) => {
      const postData = route.request().postData() || '';
      if (route.request().method() === 'POST' && postData.includes('FIRST_INSTANCE') && !interceptedOnce) {
        interceptedOnce = true;
        await page.request.fetch(route.request());
        await route.abort('failed');
      } else {
        await route.continue();
      }
    });

    await page.getByTestId('proceeding-submit-button').click();

    const pendingBanner = page.getByTestId('operation-pending-banner');
    await expect(pendingBanner).toBeVisible();

    await page.unroute(`**/matters/${matter.id}/proceedings**`);

    const retryBtn = page.getByTestId('operation-retry-button');
    await expect(retryBtn).toBeVisible();
    await retryBtn.click();

    await page.waitForURL(new RegExp(`/matters/${matter.id}$`));

    const matchingProcs = await prisma.proceeding.findMany({
      where: { matterId: matter.id, numberText: uniqueNumber },
    });
    expect(matchingProcs).toHaveLength(1);

    const auditEvents = await prisma.auditEvent.findMany({
      where: {
        entityType: 'Proceeding',
        entityId: matchingProcs[0].id,
        action: 'ADD_PROCEEDING',
      },
    });
    expect(auditEvents).toHaveLength(1);
  });

  test('recovers from committed reference item toggle with lost response using frozen idempotency key (E1) @matters', async ({
    page,
  }) => {
    test.setTimeout(120_000);
    await signInWithTotp(page, owner);

    const court = await prisma.court.create({
      data: {
        name: `محكمة لتعطيل الفقدان ${Date.now()}`,
        code: `CRT-TGL-${Date.now().toString().slice(-4)}`,
        isActive: true,
        createdById: owner.id,
        updatedById: owner.id,
      },
    });
    createdCourtIds.push(court.id);

    await page.goto('/settings/reference');
    await page.getByTestId('tab-courts').click();

    const toggleBtn = page.getByTestId(`toggle-active-${court.id}`);
    await expect(toggleBtn).toBeVisible();

    let interceptedOnce = false;
    await page.route('**/settings/reference**', async (route) => {
      if (route.request().method() === 'POST' && !interceptedOnce) {
        interceptedOnce = true;
        await page.request.fetch(route.request());
        await route.abort('failed');
      } else {
        await route.continue();
      }
    });

    await toggleBtn.click();

    const togglePendingBanner = page.getByTestId('toggle-operation-pending-banner');
    await expect(togglePendingBanner).toBeVisible();

    await page.unroute('**/settings/reference**');

    const retryToggleBtn = page.getByTestId('toggle-operation-retry-button');
    await expect(retryToggleBtn).toBeVisible();
    await retryToggleBtn.click();

    await expect(togglePendingBanner).toBeHidden();

    const reloadedCourt = await prisma.court.findUniqueOrThrow({ where: { id: court.id } });
    expect(reloadedCourt.isActive).toBe(false);

    const auditCount = await prisma.auditEvent.count({
      where: {
        entityType: 'COURT',
        entityId: court.id,
        action: 'UPDATE_COURT',
      },
    });
    expect(auditCount).toBe(1);
  });
});


'use client';

import React, { useState, useEffect, useLayoutEffect, useRef, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { GuardedLink as Link, useFormDraft, useLeaveGuard } from '@/components/navigation-guard';
import {
  OfficeSettingsDTO,
  ReferenceItemDTO,
  ReferenceItemType,
  UpdateOfficeSettingsInput,
  CreateReferenceItemInput,
  UpdateReferenceItemInput,
} from '@/modules/settings/reference-types';
import {
  updateOfficeSettingsAction,
  createReferenceItemAction,
  updateReferenceItemAction,
  getOfficeSettingsAction,
} from '@/modules/settings/reference-actions';
import { generateClientRequestId, isAuthRecoveryCode } from '@/components/matters/matter-ui-types';
import { renderModalPortal, useAccessibleModal } from '@/components/productivity/productivity-ui-types';

interface ReferenceSettingsClientProps {
  ownerId: string;
  initialOfficeSettings: OfficeSettingsDTO;
  initialCourts: ReferenceItemDTO[];
  initialPracticeAreas: ReferenceItemDTO[];
  initialStorageLocations: ReferenceItemDTO[];
  initialLookupError?: boolean;
  canWriteSettings?: boolean;
}

type ReferenceTab = 'office' | 'courts' | 'practice_areas' | 'storage_locations';
type PendingSave<T> = { key: string; payload: T };
type ReferenceDraft = {
  tab: ReferenceTab;
  office: PendingSave<UpdateOfficeSettingsInput> | null;
  create: PendingSave<CreateReferenceItemInput> | null;
  edit: PendingSave<UpdateReferenceItemInput> | null;
  editItem: ReferenceItemDTO | null;
  toggle: { item: ReferenceItemDTO; key: string } | null;
};

export function ReferenceSettingsClient({
  ownerId,
  initialOfficeSettings,
  initialCourts,
  initialPracticeAreas,
  initialStorageLocations,
  initialLookupError,
  canWriteSettings = false,
}: ReferenceSettingsClientProps) {
  const router = useRouter();
  const draft = useFormDraft<ReferenceDraft>(ownerId, '/settings/reference');
  const restored = draft.restored;

  const [activeTab, setActiveTab] = useState<ReferenceTab>(restored?.tab ?? 'office');
  const tabRefs = useRef<Partial<Record<ReferenceTab, HTMLButtonElement | null>>>({});

  const handleTabKeyDown = (e: React.KeyboardEvent<HTMLButtonElement>, currentTab: ReferenceTab) => {
    const tabs: ReferenceTab[] = ['office', 'courts', 'practice_areas', 'storage_locations'];
    const idx = tabs.indexOf(currentTab);
    let nextIdx = -1;
    if (e.key === 'ArrowLeft') nextIdx = (idx + 1) % tabs.length;
    else if (e.key === 'ArrowRight') nextIdx = (idx - 1 + tabs.length) % tabs.length;
    else if (e.key === 'Home') nextIdx = 0;
    else if (e.key === 'End') nextIdx = tabs.length - 1;
    if (nextIdx === -1) return;
    e.preventDefault();
    const nextTab = tabs[nextIdx];
    setActiveTab(nextTab);
    tabRefs.current[nextTab]?.focus();
  };

  // Office Settings State
  const [officeSettings, setOfficeSettings] = useState<OfficeSettingsDTO>(initialOfficeSettings);
  const restoredOffice = restored?.office?.payload ?? initialOfficeSettings;
  const [officeName, setOfficeName] = useState(restoredOffice.officeName);
  const [lawyerName, setLawyerName] = useState(restoredOffice.lawyerName || '');
  const [phone, setPhone] = useState(restoredOffice.phone || '');
  const [email, setEmail] = useState(restoredOffice.email || '');
  const [address, setAddress] = useState(restoredOffice.address || '');
  const [taxNumber, setTaxNumber] = useState(restoredOffice.taxNumber || '');
  const [isSavingOffice, setIsSavingOffice] = useState(false);
  const [officeMessage, setOfficeMessage] = useState<string | null>(null);
  const [officeError, setOfficeError] = useState<string | null>(null);
  const [officePending, setOfficePending] = useState(Boolean(restored?.office));
  const [officeConflictPending, setOfficeConflictPending] = useState(false);
  const [reconcilePreview, setReconcilePreview] = useState<OfficeSettingsDTO | null>(null);
  const [isReconcilingOffice, setIsReconcilingOffice] = useState(false);
  const officeSaveRequestIdRef = useRef(0);
  const [officeSessionExpired, setOfficeSessionExpired] = useState(false);
  const [officeDirty, setOfficeDirty] = useState(false);
  const [officeFieldErrors, setOfficeFieldErrors] = useState<Record<string, string>>({});
  const officePendingRef = useRef<ReferenceDraft['office']>(restored?.office ?? null);

  // Reference Items Lists
  const [courts, setCourts] = useState<ReferenceItemDTO[]>(initialCourts);
  const [practiceAreas, setPracticeAreas] = useState<ReferenceItemDTO[]>(initialPracticeAreas);
  const [storageLocations, setStorageLocations] = useState<ReferenceItemDTO[]>(initialStorageLocations);

  // Reconcile props on external updates / retry reload (U8)
  const [prevProps, setPrevProps] = useState({
    courts: initialCourts,
    practiceAreas: initialPracticeAreas,
    storageLocations: initialStorageLocations,
    officeSettings: initialOfficeSettings,
  });

  if (
    prevProps.courts !== initialCourts ||
    prevProps.practiceAreas !== initialPracticeAreas ||
    prevProps.storageLocations !== initialStorageLocations ||
    prevProps.officeSettings !== initialOfficeSettings
  ) {
    setPrevProps({
      courts: initialCourts,
      practiceAreas: initialPracticeAreas,
      storageLocations: initialStorageLocations,
      officeSettings: initialOfficeSettings,
    });
    setCourts(initialCourts);
    setPracticeAreas(initialPracticeAreas);
    setStorageLocations(initialStorageLocations);

    // U8/C10: Reconcile editable office fields and version as ONE single baseline.
    // If the form is clean, refresh everything from incoming props.
    // If the form is dirty or pending, KEEP the original baseline and version so concurrent edits conflict cleanly.
    const isFormClean =
      !officeDirty &&
      !officePending &&
      !officeConflictPending &&
      !isSavingOffice &&
      !isReconcilingOffice &&
      officeName === prevProps.officeSettings.officeName &&
      lawyerName === (prevProps.officeSettings.lawyerName || '') &&
      phone === (prevProps.officeSettings.phone || '') &&
      email === (prevProps.officeSettings.email || '') &&
      address === (prevProps.officeSettings.address || '') &&
      taxNumber === (prevProps.officeSettings.taxNumber || '');

    if (isFormClean) {
      setOfficeSettings(initialOfficeSettings);
      setOfficeName(initialOfficeSettings.officeName);
      setLawyerName(initialOfficeSettings.lawyerName || '');
      setPhone(initialOfficeSettings.phone || '');
      setEmail(initialOfficeSettings.email || '');
      setAddress(initialOfficeSettings.address || '');
      setTaxNumber(initialOfficeSettings.taxNumber || '');
    }
  }

  // New Reference Item Input State
  const [newItemName, setNewItemName] = useState(restored?.create?.payload.name ?? '');
  const [newItemCode, setNewItemCode] = useState(restored?.create?.payload.code ?? '');
  const [newItemNotes, setNewItemNotes] = useState(restored?.create?.payload.notes ?? '');
  const [isCreatingItem, setIsCreatingItem] = useState(false);
  const [itemError, setItemError] = useState<string | null>(null);
  const [itemSuccessMessage, setItemSuccessMessage] = useState<string | null>(null);
  const [itemFieldErrors, setItemFieldErrors] = useState<Record<string, string>>({});
  const [itemPending, setItemPending] = useState(Boolean(restored?.create));
  const [itemSessionExpired, setItemSessionExpired] = useState(false);
  const [itemDraftDirty, setItemDraftDirty] = useState(false);
  const itemPendingRef = useRef<ReferenceDraft['create']>(restored?.create ?? null);

  // Toggle Item State & Recovery Ref (P1 / U1 / U3)
  const togglePendingRef = useRef<ReferenceDraft['toggle']>(restored?.toggle ?? null);
  const [togglePending, setTogglePending] = useState(Boolean(restored?.toggle));
  const [togglePendingItem, setTogglePendingItem] = useState<ReferenceItemDTO | null>(restored?.toggle?.item ?? null);
  const [toggleSessionExpired, setToggleSessionExpired] = useState(false);
  const [isTogglingActive, setIsTogglingActive] = useState(false);

  // Edit Item Modal State (C19/U9)
  const [editingItem, setEditingItem] = useState<ReferenceItemDTO | null>(restored?.editItem ?? null);
  const [editItemName, setEditItemName] = useState(restored?.edit?.payload.name ?? '');
  const [editItemCode, setEditItemCode] = useState(restored?.edit?.payload.code ?? '');
  const [editItemNotes, setEditItemNotes] = useState(restored?.edit?.payload.notes ?? '');
  const [editItemIsActive, setEditItemIsActive] = useState(restored?.edit?.payload.isActive ?? true);
  const [isSavingEditItem, setIsSavingEditItem] = useState(false);
  const [editItemError, setEditItemError] = useState<string | null>(null);
  const [editItemFieldErrors, setEditItemFieldErrors] = useState<Record<string, string>>({});
  const [editItemPending, setEditItemPending] = useState(Boolean(restored?.edit));
  const [editItemSessionExpired, setEditItemSessionExpired] = useState(false);
  const editPendingRef = useRef<ReferenceDraft['edit']>(restored?.edit ?? null);
  const editDialogRef = useRef<HTMLDivElement>(null);
  const editNameInputRef = useRef<HTMLInputElement>(null);

  // Modal State Ref for stable callbacks without effect re-runs (U9)
  const editModalStateRef = useRef({
    editingItem,
    editItemName,
    editItemCode,
    editItemNotes,
    editItemIsActive,
    editItemPending,
    isSavingEditItem,
  });
  useEffect(() => {
    editModalStateRef.current = {
      editingItem,
      editItemName,
      editItemCode,
      editItemNotes,
      editItemIsActive,
      editItemPending,
      isSavingEditItem,
    };
  });

  // Filter for Reference Items
  const [filterActiveOnly, setFilterActiveOnly] = useState(false);

  const isModalDirty =
    editingItem !== null &&
    (editItemName !== editingItem.name ||
      editItemCode !== (editingItem.code || '') ||
      editItemNotes !== (editingItem.notes || '') ||
      editItemIsActive !== editingItem.isActive);

  useLeaveGuard(
    officeDirty || itemDraftDirty || isModalDirty || officePending || itemPending || editItemPending || togglePending,
    isSavingOffice || isCreatingItem || isSavingEditItem || isTogglingActive
  );

  const keepPendingOperations = () => {
    if (!draft.isCurrent()) return;
    const office = officePendingRef.current;
    const create = itemPendingRef.current;
    const edit = editPendingRef.current;
    const toggle = togglePendingRef.current;
    if (office || create || edit || toggle) {
      draft.keep({ tab: activeTab, office, create, edit, editItem: edit ? editingItem : null, toggle });
    } else {
      draft.clear();
    }
  };
  useLayoutEffect(keepPendingOperations);

  const handleCloseEditModal = useCallback(() => {
    const {
      editingItem: item,
      editItemName: name,
      editItemCode: code,
      editItemNotes: notes,
      editItemIsActive: active,
      editItemPending: pending,
      isSavingEditItem: saving,
    } = editModalStateRef.current;

    const modalDirty =
      item &&
      (name !== item.name ||
        code !== (item.code || '') ||
        notes !== (item.notes || '') ||
        active !== item.isActive);

    if (pending || saving) return;
    if (modalDirty && !window.confirm('لديك تعديلات غير محفوظة على هذا العنصر. هل تريد الإغلاق وفقدانها؟')) {
      return;
    }
    setEditingItem(null);
    editPendingRef.current = null;
    setEditItemPending(false);
    setEditItemSessionExpired(false);
  }, []);

  useAccessibleModal({
    isOpen: Boolean(editingItem),
    isSubmitting: isSavingEditItem,
    hasPending: editItemPending,
    onClose: handleCloseEditModal,
    dialogRef: editDialogRef,
    initialFocusRef: editNameInputRef,
  });

  // Handle Office Settings Save (C09/U1: frozen key & payload across retries)
  const [officeIdempotencyKey, setOfficeIdempotencyKey] = useState(() => generateClientRequestId('off'));

  const handleSaveOffice = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canWriteSettings || isSavingOffice || isReconcilingOffice) return;

    const requestId = ++officeSaveRequestIdRef.current;
    setIsSavingOffice(true);
    setOfficeMessage(null);
    setOfficeError(null);
    setOfficeFieldErrors({});
    setOfficeSessionExpired(false);
    setOfficeConflictPending(false);
    setReconcilePreview(null);

    let op = officePendingRef.current;
    if (!op) {
      op = {
        key: officeIdempotencyKey,
        payload: {
          officeName: officeName.trim(),
          lawyerName: lawyerName.trim() || null,
          phone: phone.trim() || null,
          email: email.trim() || null,
          address: address.trim() || null,
          taxNumber: taxNumber.trim() || null,
          expectedVersion: officeSettings.version,
          idempotencyKey: officeIdempotencyKey,
        },
      };
      officePendingRef.current = op;
    }
    keepPendingOperations();

    try {
      const res = await updateOfficeSettingsAction(op.payload);

      if (requestId !== officeSaveRequestIdRef.current || !draft.isCurrent()) return;

      if (!res.success) {
        if (isAuthRecoveryCode(res.code)) {
          setOfficeSessionExpired(true);
          setOfficePending(true);
          setOfficeError(
            'انتهت صلاحية الجلسة أو يلزم استكمال التحقق. أُبقيت العملية مجمّدة؛ سجّل الدخول في نافذة جديدة ثم أعد المحاولة.'
          );
        } else if (res.code === 'CONCURRENCY_CONFLICT') {
          officePendingRef.current = null;
          setOfficePending(false);
          setOfficeConflictPending(true);
          setOfficeError(
            'تعارض في التعديل المتزامن: تم تحديث بيانات المكتب من مستخدم أو نافذة أخرى. مسودتك محفوظة؛ يمكنك استعراض وتحديث بأحدث بيانات من الخادم واعتمادها قبل إعادة التعديل.'
          );
        } else if (
          !res.code ||
          res.code === 'INTERNAL_ERROR' ||
          res.code === 'DATABASE_UNAVAILABLE' ||
          res.code === 'IDEMPOTENCY_CONCURRENT_CONFLICT'
        ) {
          setOfficePending(true);
          setOfficeConflictPending(false);
          setOfficeError(
            res.code === 'IDEMPOTENCY_CONCURRENT_CONFLICT'
              ? 'العملية قيد المعالجة حالياً على الخادم. أُبقيت العملية مجمّدة؛ أعد المحاولة بنفس المفتاح.'
              : res.error || 'لم يتأكد وصول العملية إلى الخادم. أُبقيت العملية مجمّدة؛ أعد المحاولة بنفس المفتاح أو ابدأ تعديلاً جديداً.'
          );
        } else {
          officePendingRef.current = null;
          setOfficePending(false);
          setOfficeConflictPending(false);
          setOfficeIdempotencyKey(generateClientRequestId('off'));
          setOfficeError(res.error || 'تعذر حفظ بيانات المكتب.');
          if (res.fieldErrors) setOfficeFieldErrors(res.fieldErrors);
        }
        setIsSavingOffice(false);
        return;
      }

      officePendingRef.current = null;
      setOfficePending(false);
      setOfficeConflictPending(false);
      setOfficeDirty(false);
      setOfficeSessionExpired(false);
      setReconcilePreview(null);
      setOfficeSettings(res.data);
      // Reconcile all editable form fields from the confirmed snapshot
      setOfficeName(res.data.officeName);
      setLawyerName(res.data.lawyerName || '');
      setPhone(res.data.phone || '');
      setEmail(res.data.email || '');
      setAddress(res.data.address || '');
      setTaxNumber(res.data.taxNumber || '');
      setOfficeMessage('تم حفظ بيانات المكتب بنجاح.');
      setIsSavingOffice(false);
      setOfficeIdempotencyKey(generateClientRequestId('off'));
      router.refresh();
    } catch (err: unknown) {
      if (requestId !== officeSaveRequestIdRef.current) return;
      setOfficePending(true);
      setOfficeConflictPending(false);
      setOfficeError(
        err instanceof Error
          ? err.message
          : 'حدث خطأ في الاتصال أثناء حفظ بيانات المكتب. العملية الأصلية محفوظة ويمكنك إعادة المحاولة بأمان.'
      );
      setIsSavingOffice(false);
    }
  };

  const handleStartNewOfficeEdit = () => {
    if (isSavingOffice || isReconcilingOffice) return;
    ++officeSaveRequestIdRef.current;
    officePendingRef.current = null;
    setOfficePending(false);
    setOfficeConflictPending(false);
    setOfficeSessionExpired(false);
    setOfficeError(null);
    setReconcilePreview(null);
    setOfficeIdempotencyKey(generateClientRequestId('off'));
    setOfficeDirty(true);
  };

  const handleFetchOfficeForReconcile = async () => {
    if (isSavingOffice || isReconcilingOffice) return;
    setIsReconcilingOffice(true);
    setOfficeError(null);
    try {
      const res = await getOfficeSettingsAction();
      if (!res.success) {
        setOfficeError(res.error || 'تعذر جلب أحدث بيانات المكتب من الخادم. تم الاحتفاظ بمسودتك.');
        return;
      }
      setReconcilePreview(res.data);
    } catch (err: unknown) {
      setOfficeError(
        err instanceof Error
          ? err.message
          : 'تعذر الاتصال بالخادم لجلب أحدث البيانات. تم الاحتفاظ بمسودتك.'
      );
    } finally {
      setIsReconcilingOffice(false);
    }
  };

  const handleConfirmReconcile = () => {
    if (!reconcilePreview) return;
    const latest = reconcilePreview;
    setOfficeSettings(latest);
    setOfficeName(latest.officeName);
    setLawyerName(latest.lawyerName || '');
    setPhone(latest.phone || '');
    setEmail(latest.email || '');
    setAddress(latest.address || '');
    setTaxNumber(latest.taxNumber || '');

    setReconcilePreview(null);
    setOfficeConflictPending(false);
    setOfficePending(false);
    officePendingRef.current = null;
    setOfficeDirty(false);
    setOfficeSessionExpired(false);
    setOfficeError(null);
    setOfficeIdempotencyKey(generateClientRequestId('off'));
    setOfficeMessage('تم تحديث البيانات بأحدث نسخة من الخادم بنجاح.');
    router.refresh();
  };

  // Handle Create Reference Item (C09/U1: frozen key on transport retry)
  const [createItemKey, setCreateItemKey] = useState(() => generateClientRequestId('ritem'));

  const handleCreateItem = async (type: ReferenceItemType) => {
    if (isCreatingItem || !newItemName.trim()) return;
    setIsCreatingItem(true);
    setItemError(null);
    setItemSuccessMessage(null);
    setItemFieldErrors({});
    setItemSessionExpired(false);

    let op = itemPendingRef.current;
    if (!op) {
      op = {
        key: createItemKey,
        payload: {
          type,
          name: newItemName.trim(),
          code: newItemCode.trim() || null,
          notes: newItemNotes.trim() || null,
          idempotencyKey: createItemKey,
        },
      };
      itemPendingRef.current = op;
    }
    keepPendingOperations();

    try {
      const res = await createReferenceItemAction(op.payload);
      if (!draft.isCurrent()) return;

      if (!res.success) {
        if (isAuthRecoveryCode(res.code)) {
          setItemSessionExpired(true);
          setItemPending(true);
          setItemError('انتهت صلاحية الجلسة أو يلزم استكمال التحقق. أُبقيت العملية مجمّدة؛ سجّل الدخول في نافذة جديدة ثم أعد المحاولة.');
        } else if (
          !res.code ||
          res.code === 'INTERNAL_ERROR' ||
          res.code === 'DATABASE_UNAVAILABLE' ||
          res.code === 'IDEMPOTENCY_CONCURRENT_CONFLICT'
        ) {
          setItemPending(true);
          setItemError(
            res.code === 'IDEMPOTENCY_CONCURRENT_CONFLICT'
              ? 'العملية قيد المعالجة حالياً على الخادم. أُبقيت العملية مجمّدة؛ أعد المحاولة بنفس المفتاح.'
              : res.error || 'لم يتأكد وصول العملية إلى الخادم. أُبقيت العملية مجمّدة.'
          );
        } else {
          itemPendingRef.current = null;
          setItemPending(false);
          setCreateItemKey(generateClientRequestId('ritem'));
          setItemError(res.error || 'تعذر إضافة العنصر المرجعي.');
          if (res.fieldErrors) setItemFieldErrors(res.fieldErrors);
        }
        setIsCreatingItem(false);
        return;
      }

      itemPendingRef.current = null;
      setItemPending(false);
      setItemDraftDirty(false);
      setItemSessionExpired(false);

      // Reconcile into the actual category of the acknowledged entity, eliminating cross-tab placement mismatch
      const targetType = res.data.type || op.payload.type;
      if (targetType === 'COURT') {
        setCourts((prev) => [...prev.filter((i) => i.id !== res.data.id), res.data]);
      } else if (targetType === 'PRACTICE_AREA') {
        setPracticeAreas((prev) => [...prev.filter((i) => i.id !== res.data.id), res.data]);
      } else if (targetType === 'STORAGE_LOCATION') {
        setStorageLocations((prev) => [...prev.filter((i) => i.id !== res.data.id), res.data]);
      }

      setNewItemName('');
      setNewItemCode('');
      setNewItemNotes('');
      setItemSuccessMessage('تمت إضافة العنصر المرجعي بنجاح.');
      setIsCreatingItem(false);
      setCreateItemKey(generateClientRequestId('ritem'));
      router.refresh();
    } catch (err: unknown) {
      setItemPending(true);
      setItemError(err instanceof Error ? err.message : 'حدث خطأ في الاتصال أثناء إضافة العنصر المرجعي.');
      setIsCreatingItem(false);
    }
  };

  const handleStartNewItemCreate = () => {
    if (itemPending) {
      setItemError('يلزم التحقق من نتيجة إضافة العنصر الأصلي أو إعادة المحاولة لتفادي تكرار الإضافة.');
      return;
    }
    itemPendingRef.current = null;
    setItemPending(false);
    setItemSessionExpired(false);
    setItemError(null);
    setCreateItemKey(generateClientRequestId('ritem'));
    setItemDraftDirty(true);
  };

  // Open Edit Modal (C19/U9)
  const handleOpenEditModal = (item: ReferenceItemDTO) => {
    if (!canWriteSettings) return;
    setEditingItem(item);
    setEditItemName(item.name);
    setEditItemCode(item.code || '');
    setEditItemNotes(item.notes || '');
    setEditItemIsActive(item.isActive);
    setEditItemError(null);
    setEditItemFieldErrors({});
    setEditItemPending(false);
    setEditItemSessionExpired(false);
    editPendingRef.current = null;
  };

  // Handle Save Edited Reference Item (C19/U1/U9)
  const handleSaveEditItem = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canWriteSettings || isSavingEditItem || !editingItem || !editItemName.trim()) return;
    setIsSavingEditItem(true);
    setEditItemError(null);
    setEditItemFieldErrors({});
    setEditItemSessionExpired(false);

    let op = editPendingRef.current;
    if (!op) {
      const key = generateClientRequestId('edititem');
      op = {
        key,
        payload: {
          id: editingItem.id,
          type: editingItem.type,
          expectedVersion: editingItem.version,
          name: editItemName.trim(),
          code: editItemCode.trim() || null,
          notes: editItemNotes.trim() || null,
          isActive: editItemIsActive,
          idempotencyKey: key,
        },
      };
      editPendingRef.current = op;
    }
    keepPendingOperations();

    try {
      const res = await updateReferenceItemAction(op.payload);
      if (!draft.isCurrent()) return;

      if (!res.success) {
        if (isAuthRecoveryCode(res.code)) {
          setEditItemSessionExpired(true);
          setEditItemPending(true);
          setEditItemError('انتهت صلاحية الجلسة أو يلزم استكمال التحقق. أُبقيت العملية مجمّدة؛ سجّل الدخول في نافذة جديدة ثم أعد المحاولة.');
        } else if (res.code === 'CONCURRENCY_CONFLICT') {
          editPendingRef.current = null;
          setEditItemPending(false);
          setEditItemError('تعارض في التعديل المتزامن: تم تعديل هذا العنصر من مستخدم آخر.');
        } else if (
          !res.code ||
          res.code === 'INTERNAL_ERROR' ||
          res.code === 'DATABASE_UNAVAILABLE' ||
          res.code === 'IDEMPOTENCY_CONCURRENT_CONFLICT'
        ) {
          setEditItemPending(true);
          setEditItemError(
            res.code === 'IDEMPOTENCY_CONCURRENT_CONFLICT'
              ? 'العملية قيد المعالجة حالياً على الخادم. أُبقيت العملية مجمّدة؛ أعد المحاولة بنفس المفتاح.'
              : res.error || 'لم يتأكد وصول العملية إلى الخادم. أُبقيت العملية مجمّدة.'
          );
        } else {
          editPendingRef.current = null;
          setEditItemPending(false);
          setEditItemError(res.error || 'تعذر حفظ تعديلات العنصر المرجعي.');
          if (res.fieldErrors) setEditItemFieldErrors(res.fieldErrors);
        }
        setIsSavingEditItem(false);
        return;
      }

      editPendingRef.current = null;
      setEditItemPending(false);
      setEditItemSessionExpired(false);

      const updater = (prev: ReferenceItemDTO[]) =>
        prev.map((i) => (i.id === editingItem.id ? res.data : i));

      if (editingItem.type === 'COURT') setCourts(updater);
      else if (editingItem.type === 'PRACTICE_AREA') setPracticeAreas(updater);
      else if (editingItem.type === 'STORAGE_LOCATION') setStorageLocations(updater);

      setItemSuccessMessage('تم حفظ تعديلات العنصر المرجعي بنجاح.');
      setEditingItem(null);
      setIsSavingEditItem(false);
      router.refresh();
    } catch (err: unknown) {
      setEditItemPending(true);
      setEditItemError(err instanceof Error ? err.message : 'حدث خطأ في الاتصال أثناء حفظ تعديلات العنصر.');
      setIsSavingEditItem(false);
    }
  };

  const handleStartNewEditItem = () => {
    editPendingRef.current = null;
    setEditItemPending(false);
    setEditItemSessionExpired(false);
    setEditItemError(null);
  };

  // Handle Toggle Active/Inactive (U1/U3: frozen key and recovery)
  const handleToggleActive = async (item: ReferenceItemDTO) => {
    if (!canWriteSettings || isTogglingActive) return;

    if (togglePendingRef.current && togglePendingRef.current.item.id !== item.id) {
      setItemError('توجد عملية تعديل حالة معلّقة لعنصر آخر. يرجى حسم العملية العالقة أولاً.');
      return;
    }

    setItemError(null);
    setItemSuccessMessage(null);

    let op = togglePendingRef.current;
    if (!op || op.item.id !== item.id) {
      op = { item, key: generateClientRequestId('tog') };
      togglePendingRef.current = op;
    }
    keepPendingOperations();
    setTogglePendingItem(op.item);

    setIsTogglingActive(true);
    try {
      const res = await updateReferenceItemAction({
        id: op.item.id,
        type: op.item.type,
        expectedVersion: op.item.version,
        name: op.item.name,
        code: op.item.code,
        notes: op.item.notes,
        isActive: !op.item.isActive,
        idempotencyKey: op.key,
      });
      if (!draft.isCurrent()) return;

      if (!res.success) {
        if (isAuthRecoveryCode(res.code)) {
          setToggleSessionExpired(true);
          setTogglePending(true);
          setTogglePendingItem(op.item);
          setItemError('انتهت صلاحية الجلسة أو يلزم استكمال التحقق. أُبقيت عملية تعديل الحالة مجمّدة؛ سجّل الدخول في نافذة جديدة ثم أعد المحاولة.');
        } else if (
          !res.code ||
          res.code === 'INTERNAL_ERROR' ||
          res.code === 'DATABASE_UNAVAILABLE' ||
          res.code === 'IDEMPOTENCY_CONCURRENT_CONFLICT'
        ) {
          setTogglePending(true);
          setTogglePendingItem(op.item);
          setItemError(
            res.code === 'IDEMPOTENCY_CONCURRENT_CONFLICT'
              ? 'عملية تعديل الحالة قيد المعالجة حالياً على الخادم. أُبقيت العملية مجمّدة؛ أعد المحاولة بنفس المفتاح.'
              : res.error || 'لم يتأكد وصول عملية تعديل الحالة إلى الخادم. أُبقيت العملية مجمّدة.'
          );
        } else {
          if (togglePendingRef.current?.key === op.key) {
            togglePendingRef.current = null;
            setTogglePending(false);
            setTogglePendingItem(null);
          }
          setItemError(res.error || 'تعذر تعديل حالة العنصر.');
        }
        return;
      }

      if (togglePendingRef.current?.key === op.key) {
        togglePendingRef.current = null;
        setTogglePending(false);
        setTogglePendingItem(null);
        setToggleSessionExpired(false);
      }

      const updater = (prev: ReferenceItemDTO[]) =>
        prev.map((i) => (i.id === item.id ? res.data : i));

      if (res.data.type === 'COURT') setCourts(updater);
      else if (res.data.type === 'PRACTICE_AREA') setPracticeAreas(updater);
      else if (res.data.type === 'STORAGE_LOCATION') setStorageLocations(updater);

      setItemSuccessMessage(
        res.data.isActive ? 'تم تفعيل العنصر المرجعي بنجاح.' : 'تم تعطيل العنصر المرجعي (لن يتاح للاختيار الجديد).'
      );
      router.refresh();
    } catch (err: unknown) {
      setTogglePending(true);
      setItemError(err instanceof Error ? err.message : 'حدث خطأ في الاتصال أثناء تعديل حالة العنصر.');
    } finally {
      setIsTogglingActive(false);
    }
  };

  return (
    <div className="max-w-5xl mx-auto space-y-6">
      {/* Page Header */}
      <div className="pb-4 border-b border-[#D5DFE3] flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <nav aria-label="مسار التنقل" className="text-xs text-[#4D606A] mb-1">
            <Link href="/" className="hover:text-[#14566B] hover:underline">
              الرئيسية
            </Link>
            <span aria-hidden="true" className="mx-1.5">/</span>
            <span>إعدادات المكتب والمراجع</span>
          </nav>
          <h1 className="text-2xl font-bold text-[#172A35]">
            إعدادات الجداول المرجعية وبيانات المكتب
          </h1>
          <p className="text-xs text-[#4D606A] mt-1">
            إدارة بيانات المكتب، المحاكم والجهات القضائية، دوائر التخصص، وأماكن الحفظ الورقي.
          </p>
        </div>

        <Link
          href="/settings/security"
          className="text-xs font-semibold text-[#14566B] hover:underline flex items-center gap-1 min-h-[44px]"
        >
          <span>الانتقال لإعدادات الأمان والجلسات</span>
        </Link>
      </div>

      {/* Lookup read failure alert (U8) */}
      {initialLookupError && (
        <div
          role="alert"
          data-testid="lookup-read-error-banner"
          className="p-4 bg-amber-50 border border-amber-300 rounded-[6px] text-amber-950 space-y-2 text-xs"
        >
          <div className="flex items-center gap-2 font-bold text-sm">
            <span>تعذر تحميل بعض الجداول المرجعية بالكامل</span>
          </div>
          <p className="leading-relaxed">
            حدث خطأ أثناء استرجاع البيانات المرجعية من الخادم. يمكنك إعادة تحميل الصفحة.
          </p>
          <button
            type="button"
            onClick={() => router.refresh()}
            className="inline-flex items-center justify-center px-3 py-1.5 bg-[#14566B] text-white rounded font-semibold text-xs min-h-[44px]"
          >
            إعادة تحميل الصفحة
          </button>
        </div>
      )}

      {/* Tabs */}
      <div className="border-b border-[#D5DFE3]">
        <div className="flex flex-wrap gap-x-2 sm:gap-x-4 gap-y-1" aria-label="أقسام الإعدادات" role="tablist">
          <button
            ref={(el) => {
              tabRefs.current.office = el;
            }}
            id="ref-tab-office"
            type="button"
            role="tab"
            aria-selected={activeTab === 'office'}
            aria-controls={activeTab === 'office' ? 'ref-tabpanel-office' : undefined}
            tabIndex={activeTab === 'office' ? 0 : -1}
            data-testid="tab-office-profile"
            onClick={() => setActiveTab('office')}
            onKeyDown={(e) => handleTabKeyDown(e, 'office')}
            className={`py-3 px-3 text-xs sm:text-sm font-bold border-b-2 transition-colors min-h-[44px] ${
              activeTab === 'office'
                ? 'border-[#14566B] text-[#14566B]'
                : 'border-transparent text-[#4D606A] hover:text-[#172A35]'
            }`}
          >
            بيانات المكتب
          </button>

          <button
            ref={(el) => {
              tabRefs.current.courts = el;
            }}
            id="ref-tab-courts"
            type="button"
            role="tab"
            aria-selected={activeTab === 'courts'}
            aria-controls={activeTab === 'courts' ? 'ref-tabpanel-courts' : undefined}
            tabIndex={activeTab === 'courts' ? 0 : -1}
            data-testid="tab-courts"
            onClick={() => setActiveTab('courts')}
            onKeyDown={(e) => handleTabKeyDown(e, 'courts')}
            className={`py-3 px-3 text-xs sm:text-sm font-bold border-b-2 transition-colors min-h-[44px] ${
              activeTab === 'courts'
                ? 'border-[#14566B] text-[#14566B]'
                : 'border-transparent text-[#4D606A] hover:text-[#172A35]'
            }`}
          >
            المحاكم والجهات ({courts.length})
          </button>

          <button
            ref={(el) => {
              tabRefs.current.practice_areas = el;
            }}
            id="ref-tab-practice_areas"
            type="button"
            role="tab"
            aria-selected={activeTab === 'practice_areas'}
            aria-controls={activeTab === 'practice_areas' ? 'ref-tabpanel-practice_areas' : undefined}
            tabIndex={activeTab === 'practice_areas' ? 0 : -1}
            data-testid="tab-practice-areas"
            onClick={() => setActiveTab('practice_areas')}
            onKeyDown={(e) => handleTabKeyDown(e, 'practice_areas')}
            className={`py-3 px-3 text-xs sm:text-sm font-bold border-b-2 transition-colors min-h-[44px] ${
              activeTab === 'practice_areas'
                ? 'border-[#14566B] text-[#14566B]'
                : 'border-transparent text-[#4D606A] hover:text-[#172A35]'
            }`}
          >
            دوائر التخصص ({practiceAreas.length})
          </button>

          <button
            ref={(el) => {
              tabRefs.current.storage_locations = el;
            }}
            id="ref-tab-storage_locations"
            type="button"
            role="tab"
            aria-selected={activeTab === 'storage_locations'}
            aria-controls={activeTab === 'storage_locations' ? 'ref-tabpanel-storage_locations' : undefined}
            tabIndex={activeTab === 'storage_locations' ? 0 : -1}
            data-testid="tab-storage-locations"
            onClick={() => setActiveTab('storage_locations')}
            onKeyDown={(e) => handleTabKeyDown(e, 'storage_locations')}
            className={`py-3 px-3 text-xs sm:text-sm font-bold border-b-2 transition-colors min-h-[44px] ${
              activeTab === 'storage_locations'
                ? 'border-[#14566B] text-[#14566B]'
                : 'border-transparent text-[#4D606A] hover:text-[#172A35]'
            }`}
          >
            أماكن الحفظ الورقي ({storageLocations.length})
          </button>
        </div>
      </div>

      {/* Tab 1: Office Profile */}
      {activeTab === 'office' && (
        <div id="ref-tabpanel-office" role="tabpanel" aria-labelledby="ref-tab-office" className="space-y-6">
          {officeMessage && (
            <div
              role="status"
              data-testid="office-success-banner"
              className="p-3 bg-emerald-50 border border-emerald-200 text-emerald-900 rounded-[6px] text-xs font-semibold"
            >
              ✓ {officeMessage}
            </div>
          )}

          {/* Session Recovery Banner (U3) */}
          {officeSessionExpired && (
            <div
              role="alert"
              data-testid="office-session-recovery-alert"
              className="p-4 bg-amber-50 border border-amber-300 rounded-[6px] text-amber-900 space-y-3 text-xs"
            >
              <div className="flex items-center gap-2 font-bold text-sm">
                <span>انتهت صلاحية الجلسة أو يلزم استكمال التحقق</span>
              </div>
              <p className="leading-relaxed">
                تم الحفاظ على بيانات المكتب في الذاكرة. يرجى تسجيل الدخول أو إكمال التحقق (MFA) في نافذة جديدة
                ثم العودة والضغط على &quot;إعادة محاولة الحفظ&quot;.
              </p>
              <div className="flex items-center gap-3 pt-1">
                <a
                  href="/login"
                  target="_blank"
                  rel="noopener noreferrer"
                  data-testid="office-session-login-link"
                  className="px-3 py-1.5 bg-[#14566B] text-white text-xs font-semibold rounded-[6px] hover:bg-[#114252] transition-colors inline-flex items-center min-h-[44px]"
                >
                  فتح شاشة تسجيل الدخول في نافذة جديدة ↗
                </a>
                <button
                  type="submit"
                  form="office-settings-form"
                  data-testid="office-session-retry-button"
                  className="px-3 py-1.5 border border-[#14566B] text-[#14566B] bg-white text-xs font-semibold rounded-[6px] hover:bg-[#F4F6F7] transition-colors min-h-[44px]"
                >
                  إعادة محاولة الحفظ
                </button>
              </div>
            </div>
          )}

          {/* Confirmed Concurrency Conflict Banner (P2 Spec: explicit server reconciliation) */}
          {officeConflictPending && (
            <div
              role="alert"
              data-testid="office-conflict-banner"
              className="p-4 bg-amber-50 border border-amber-300 rounded-[6px] text-amber-950 space-y-3 text-xs"
            >
              <div className="flex items-center gap-2 font-bold text-sm">
                <span>تعارض في التعديل المتزامن: بيانات أحدث موجودة على الخادم</span>
              </div>
              <p className="leading-relaxed">
                تم تحديث بيانات المكتب من مستخدم أو نافذة أخرى. مسودتك المحلية محفوظة. استعرض بيانات الخادم ثم اعتمدها لبدء تعديل من النسخة الحالية.
              </p>
              {reconcilePreview ? (
                <div data-testid="office-reconcile-preview" className="p-3 bg-white border border-amber-200 rounded-[6px] space-y-2">
                  <div className="font-semibold text-amber-900">البيانات الحالية على الخادم (النسخة {reconcilePreview.version}):</div>
                  <div className="grid grid-cols-2 gap-2 text-[11px] text-gray-700">
                    <div><span className="font-medium">الاسم:</span> {reconcilePreview.officeName}</div>
                    <div><span className="font-medium">الهاتف:</span> {reconcilePreview.phone ? <bdi dir="ltr">{reconcilePreview.phone}</bdi> : '—'}</div>
                    <div><span className="font-medium">العنوان:</span> {reconcilePreview.address || '—'}</div>
                    <div><span className="font-medium">المحامي:</span> {reconcilePreview.lawyerName || '—'}</div>
                    <div><span className="font-medium">البريد الإلكتروني:</span> {reconcilePreview.email ? <bdi dir="ltr">{reconcilePreview.email}</bdi> : '—'}</div>
                    <div><span className="font-medium">الرقم الضريبي:</span> {reconcilePreview.taxNumber ? <bdi dir="ltr">{reconcilePreview.taxNumber}</bdi> : '—'}</div>
                  </div>
                  <div className="flex items-center gap-2 pt-2">
                    <button
                      type="button"
                      data-testid="office-reconcile-confirm-button"
                      onClick={handleConfirmReconcile}
                      disabled={isSavingOffice || isReconcilingOffice}
                      className="px-3 py-1.5 bg-[#14566B] hover:bg-[#114252] text-white font-semibold rounded-[6px] min-h-[44px]"
                    >
                      تأكيد اعتماد بيانات الخادم
                    </button>
                    <button
                      type="button"
                      data-testid="office-reconcile-cancel-button"
                      onClick={() => setReconcilePreview(null)}
                      disabled={isSavingOffice || isReconcilingOffice}
                      className="px-3 py-1.5 bg-gray-100 hover:bg-gray-200 text-gray-800 font-semibold rounded-[6px] min-h-[44px]"
                    >
                      إلغاء والاحتفاظ بالمسودة
                    </button>
                  </div>
                </div>
              ) : (
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={handleFetchOfficeForReconcile}
                    disabled={isSavingOffice || isReconcilingOffice}
                    data-testid="office-reconcile-server-button"
                    className="px-3 py-1.5 bg-amber-100 hover:bg-amber-200 text-amber-900 border border-amber-300 text-xs font-semibold rounded-[6px] min-h-[44px] disabled:opacity-50"
                  >
                    {isReconcilingOffice ? 'جارٍ جلب بيانات الخادم...' : 'استعراض وتحديث بأحدث بيانات من الخادم'}
                  </button>
                </div>
              )}
            </div>
          )}

          {/* Frozen Operation Banner for Uncertain Transport Outcomes (U1/Standards P2) */}
          {officePending && !officeConflictPending && (
            <div
              role="alert"
              data-testid="office-operation-pending-banner"
              className="p-4 bg-sky-50 border border-sky-300 rounded-[6px] text-sky-950 space-y-3 text-xs"
            >
              <div className="flex items-center gap-2 font-bold text-sm">
                <span>العملية الأصلية معلّقة بانتظار نتيجة مؤكدة</span>
              </div>
              <p className="leading-relaxed">
                أُبقيت العملية بنفس المفتاح والبيانات المجمّدة. أعد المحاولة بنفس المفتاح أو ابدأ تعديلاً جديداً.
              </p>
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="submit"
                  form="office-settings-form"
                  disabled={isSavingOffice || isReconcilingOffice}
                  data-testid="office-operation-retry-button"
                  className="px-3 py-1.5 bg-[#14566B] hover:bg-[#114252] disabled:opacity-50 text-white text-xs font-semibold rounded-[6px] min-h-[44px]"
                >
                  {isSavingOffice ? 'جارٍ إعادة المحاولة...' : 'إعادة محاولة العملية الأصلية'}
                </button>
                <button
                  type="button"
                  onClick={handleStartNewOfficeEdit}
                  disabled={isSavingOffice || isReconcilingOffice}
                  data-testid="office-operation-start-new-button"
                  className="px-3 py-1.5 bg-white border border-[#14566B] text-[#14566B] text-xs font-semibold rounded-[6px] min-h-[44px] disabled:opacity-50"
                >
                  بدء تعديل جديد
                </button>
              </div>
            </div>
          )}

          {officeError && !officeSessionExpired && (
            <div
              role="alert"
              data-testid="office-error-banner"
              className="p-3 bg-red-50 border border-red-200 text-[#A4262C] rounded-[6px] text-xs font-semibold"
            >
              {officeError}
            </div>
          )}

          <form
            id="office-settings-form"
            onSubmit={handleSaveOffice}
            onChange={() => setOfficeDirty(true)}
            className="bg-white rounded-[6px] border border-[#D5DFE3] p-5 sm:p-6 shadow-xs space-y-4"
          >
            <fieldset disabled={officePending || isSavingOffice || isReconcilingOffice || !!reconcilePreview || !canWriteSettings} className="space-y-4 border-0 p-0 m-0 min-w-0">
              <h2 className="text-base font-bold text-[#172A35] pb-2 border-b border-[#E8EEF1]">
                الملف التعريفي للمكتب
              </h2>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="space-y-1">
                  <label htmlFor="office-name-input" className="block text-xs font-bold text-[#172A35]">
                    اسم المكتب / المنشأة القانونية <span className="text-red-600">*</span>
                  </label>
                  <input
                    id="office-name-input"
                    type="text"
                    required
                    value={officeName}
                    onChange={(e) => setOfficeName(e.target.value)}
                    placeholder="مثال: مكتب الأستاذ / محمد عادل المحامي"
                    data-testid="office-name-input"
                    aria-invalid={Boolean(officeFieldErrors['officeName'])}
                    aria-describedby={officeFieldErrors['officeName'] ? 'office-name-error' : undefined}
                    className="w-full px-3 py-2 text-sm border border-[#D5DFE3] rounded-[6px] min-h-[44px]"
                  />
                  {officeFieldErrors['officeName'] && (
                    <p id="office-name-error" role="alert" className="text-xs text-red-600 font-semibold">
                      {officeFieldErrors['officeName']}
                    </p>
                  )}
                </div>

                <div className="space-y-1">
                  <label htmlFor="lawyer-name-input" className="block text-xs font-bold text-[#172A35]">
                    اسم المحامي المسؤول
                  </label>
                  <input
                    id="lawyer-name-input"
                    type="text"
                    value={lawyerName}
                    onChange={(e) => setLawyerName(e.target.value)}
                    placeholder="اسم المحامي بالنقض أو الاستئناف"
                    data-testid="lawyer-name-input"
                    className="w-full px-3 py-2 text-sm border border-[#D5DFE3] rounded-[6px] min-h-[44px]"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="space-y-1">
                  <label htmlFor="office-phone-input" className="block text-xs font-bold text-[#172A35]">
                    هاتف المكتب
                  </label>
                  <input
                    id="office-phone-input"
                    type="text"
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                    placeholder="010XXXXXXXX"
                    data-testid="office-phone-input"
                    className="w-full px-3 py-2 text-sm border border-[#D5DFE3] rounded-[6px] min-h-[44px] font-mono text-left"
                    dir="ltr"
                  />
                </div>

                <div className="space-y-1">
                  <label htmlFor="office-email-input" className="block text-xs font-bold text-[#172A35]">
                    البريد الإلكتروني
                  </label>
                  <input
                    id="office-email-input"
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="lawyer@example.com"
                    data-testid="office-email-input"
                    className="w-full px-3 py-2 text-sm border border-[#D5DFE3] rounded-[6px] min-h-[44px] font-mono text-left"
                    dir="ltr"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="space-y-1">
                  <label htmlFor="office-address-input" className="block text-xs font-bold text-[#172A35]">
                    عنوان المقر
                  </label>
                  <input
                    id="office-address-input"
                    type="text"
                    value={address}
                    onChange={(e) => setAddress(e.target.value)}
                    placeholder="العنوان ومقر المكتب"
                    data-testid="office-address-input"
                    className="w-full px-3 py-2 text-sm border border-[#D5DFE3] rounded-[6px] min-h-[44px]"
                  />
                </div>

                <div className="space-y-1">
                  <label htmlFor="office-tax-input" className="block text-xs font-bold text-[#172A35]">
                    الرقم الضريبي / القيد بالنقابة
                  </label>
                  <input
                    id="office-tax-input"
                    type="text"
                    dir="ltr"
                    value={taxNumber}
                    onChange={(e) => setTaxNumber(e.target.value)}
                    placeholder="الرقم الضريبي"
                    data-testid="office-tax-input"
                    className="w-full px-3 py-2 text-sm border border-[#D5DFE3] rounded-[6px] min-h-[44px] font-mono text-left"
                  />
                </div>
              </div>

              {/* Display-only System Defaults */}
              <div className="p-3 bg-slate-50 border border-slate-200 rounded-[6px] text-xs text-[#4D606A] flex flex-wrap gap-4">
                <div>
                  <span className="font-semibold text-[#172A35]">العملة المعتمدة: </span>
                  <span>الجنيه المصري (ج.م)</span>
                </div>
                <div>
                  <span className="font-semibold text-[#172A35]">النطاق الزمني: </span>
                  <span>توقيت القاهرة (<bdi dir="ltr">Africa/Cairo</bdi>)</span>
                </div>
              </div>

              <div className="flex justify-end pt-2">
                <button
                  type="submit"
                  disabled={isSavingOffice || isReconcilingOffice || officePending || officeConflictPending || !canWriteSettings}
                  data-testid="save-office-button"
                  className="px-6 py-2.5 bg-[#14566B] hover:bg-[#0F4354] disabled:opacity-50 text-white font-bold text-sm rounded-[6px] min-h-[44px] shadow-xs"
                >
                  {isSavingOffice ? 'جارٍ الحفظ...' : 'حفظ بيانات المكتب'}
                </button>
              </div>
            </fieldset>
          </form>
        </div>
      )}

      {/* Tabs 2, 3, 4: Generic Reference Items Section */}
      {activeTab !== 'office' && (
        <div id={`ref-tabpanel-${activeTab}`} role="tabpanel" aria-labelledby={`ref-tab-${activeTab}`} className="space-y-6">
          {itemSuccessMessage && (
            <div
              role="status"
              data-testid="reference-success-banner"
              className="p-3 bg-emerald-50 border border-emerald-200 text-emerald-900 rounded-[6px] text-xs font-semibold"
            >
              ✓ {itemSuccessMessage}
            </div>
          )}

          {/* Session Recovery Banner for Items (U3) */}
          {itemSessionExpired && (
            <div
              role="alert"
              data-testid="item-session-recovery-alert"
              className="p-4 bg-amber-50 border border-amber-300 rounded-[6px] text-amber-900 space-y-3 text-xs"
            >
              <div className="flex items-center gap-2 font-bold text-sm">
                <span>انتهت صلاحية الجلسة أو يلزم استكمال التحقق</span>
              </div>
              <p className="leading-relaxed">
                تم الحفاظ على بيانات العنصر في الذاكرة. يرجى تسجيل الدخول أو إكمال التحقق (MFA) في نافذة جديدة
                ثم العودة والضغط على &quot;إعادة محاولة الإضافة&quot;.
              </p>
              <div className="flex items-center gap-3 pt-1">
                <a
                  href="/login"
                  target="_blank"
                  rel="noopener noreferrer"
                  data-testid="item-session-login-link"
                  className="px-3 py-1.5 bg-[#14566B] text-white text-xs font-semibold rounded-[6px] hover:bg-[#114252] transition-colors inline-flex items-center min-h-[44px]"
                >
                  فتح شاشة تسجيل الدخول في نافذة جديدة ↗
                </a>
                <button
                  type="button"
                  onClick={() => {
                    const type: ReferenceItemType = itemPendingRef.current
                      ? itemPendingRef.current.payload.type
                      : activeTab === 'courts'
                      ? 'COURT'
                      : activeTab === 'practice_areas'
                      ? 'PRACTICE_AREA'
                      : 'STORAGE_LOCATION';
                    handleCreateItem(type);
                  }}
                  data-testid="item-session-retry-button"
                  className="px-3 py-1.5 border border-[#14566B] text-[#14566B] bg-white text-xs font-semibold rounded-[6px] hover:bg-[#F4F6F7] transition-colors min-h-[44px]"
                >
                  إعادة محاولة الإضافة
                </button>
              </div>
            </div>
          )}

          {/* Frozen Operation Banner for Items (U1) */}
          {itemPending && (
            <div
              role="alert"
              data-testid="item-operation-pending-banner"
              className="p-4 bg-sky-50 border border-sky-300 rounded-[6px] text-sky-950 space-y-3 text-xs"
            >
              <div className="flex items-center gap-2 font-bold text-sm">
                <span>عملية الإضافة معلّقة بانتظار نتيجة مؤكدة</span>
              </div>
              <p className="leading-relaxed">
                أُبقيت العملية بنفس المفتاح والبيانات المجمّدة.
              </p>
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={() => {
                    const type: ReferenceItemType = itemPendingRef.current
                      ? itemPendingRef.current.payload.type
                      : activeTab === 'courts'
                      ? 'COURT'
                      : activeTab === 'practice_areas'
                      ? 'PRACTICE_AREA'
                      : 'STORAGE_LOCATION';
                    handleCreateItem(type);
                  }}
                  data-testid="item-operation-retry-button"
                  className="px-3 py-1.5 bg-[#14566B] text-white text-xs font-semibold rounded-[6px] min-h-[44px]"
                >
                  إعادة محاولة العملية الأصلية
                </button>
                <button
                  type="button"
                  onClick={handleStartNewItemCreate}
                  data-testid="item-operation-start-new-button"
                  className="px-3 py-1.5 bg-white border border-[#14566B] text-[#14566B] text-xs font-semibold rounded-[6px] min-h-[44px]"
                >
                  بدء إضافة جديدة
                </button>
              </div>
            </div>
          )}

          {/* Session Recovery Banner for Toggle (U1/U3) */}
          {toggleSessionExpired && (
            <div
              role="alert"
              data-testid="toggle-session-recovery-alert"
              className="p-4 bg-amber-50 border border-amber-300 rounded-[6px] text-amber-900 space-y-3 text-xs"
            >
              <div className="flex items-center gap-2 font-bold text-sm">
                <span>انتهت صلاحية الجلسة أثناء تعديل حالة العنصر</span>
              </div>
              <p className="leading-relaxed">
                أُبقيت عملية تعديل الحالة مجمّدة بنفس المفتاح. سجّل الدخول في نافذة جديدة ثم أعد المحاولة.
              </p>
              <div className="flex items-center gap-3 pt-1">
                <a
                  href="/login"
                  target="_blank"
                  rel="noopener noreferrer"
                  data-testid="toggle-session-login-link"
                  className="px-3 py-1.5 bg-[#14566B] text-white text-xs font-semibold rounded-[6px] hover:bg-[#114252] transition-colors inline-flex items-center min-h-[44px]"
                >
                  فتح شاشة تسجيل الدخول في نافذة جديدة ↗
                </a>
                {togglePendingItem && (
                  <button
                    type="button"
                    onClick={() => {
                      if (togglePendingItem) handleToggleActive(togglePendingItem);
                    }}
                    data-testid="toggle-session-retry-button"
                    className="px-3 py-1.5 border border-[#14566B] text-[#14566B] bg-white text-xs font-semibold rounded-[6px] hover:bg-[#F4F6F7] transition-colors min-h-[44px]"
                  >
                    إعادة محاولة تعديل الحالة
                  </button>
                )}
              </div>
            </div>
          )}

          {/* Frozen Operation Banner for Toggle (U1) */}
          {togglePending && !toggleSessionExpired && togglePendingItem && (
            <div
              role="alert"
              data-testid="toggle-operation-pending-banner"
              className="p-4 bg-sky-50 border border-sky-300 rounded-[6px] text-sky-950 space-y-3 text-xs"
            >
              <div className="flex items-center gap-2 font-bold text-sm">
                <span>عملية تعديل الحالة معلّقة بانتظار نتيجة مؤكدة</span>
              </div>
              <p className="leading-relaxed">
                أُبقيت عملية تعديل حالة العنصر مجمّدة بنفس المفتاح الأصلي.
              </p>
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={() => {
                    if (togglePendingItem) handleToggleActive(togglePendingItem);
                  }}
                  data-testid="toggle-operation-retry-button"
                  className="px-3 py-1.5 bg-[#14566B] text-white text-xs font-semibold rounded-[6px] min-h-[44px]"
                >
                  إعادة محاولة تعديل الحالة
                </button>
              </div>
            </div>
          )}

          {itemError && !itemSessionExpired && !itemPending && (
            <div
              role="alert"
              data-testid="reference-error-banner"
              className="p-3 bg-red-50 border border-red-200 text-[#A4262C] rounded-[6px] text-xs font-semibold"
            >
              {itemError}
            </div>
          )}

          {/* Add Item Form */}
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (isCreatingItem || itemPending || !newItemName.trim() || !canWriteSettings) return;
              const type: ReferenceItemType =
                activeTab === 'courts'
                  ? 'COURT'
                  : activeTab === 'practice_areas'
                  ? 'PRACTICE_AREA'
                  : 'STORAGE_LOCATION';
              handleCreateItem(type);
            }}
            className="bg-white rounded-[6px] border border-[#D5DFE3] p-5 shadow-xs space-y-4"
          >
            <h2 className="text-sm font-bold text-[#172A35] pb-2 border-b border-[#E8EEF1]">
              {activeTab === 'courts'
                ? '+ إضافة محكمة أو جهة قضائية جديدة'
                : activeTab === 'practice_areas'
                ? '+ إضافة دائرة تخصص قانوني جديدة'
                : '+ إضافة مكان حفظ ورقي جديد'}
            </h2>

            <fieldset disabled={isCreatingItem || itemPending || !canWriteSettings} className="space-y-3 border-0 p-0 m-0 min-w-0">
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div className="space-y-1 sm:col-span-2">
                  <label htmlFor="reference-item-name-input" className="block text-xs font-bold text-[#172A35]">
                    الاسم <span className="text-red-600">*</span>
                  </label>
                  <input
                    id="reference-item-name-input"
                    type="text"
                    required
                    value={newItemName}
                    onChange={(e) => {
                      setNewItemName(e.target.value);
                      setItemDraftDirty(true);
                    }}
                    placeholder={
                      activeTab === 'courts'
                        ? 'مثال: محكمة جنوب الجيزة الابتدائية'
                        : activeTab === 'practice_areas'
                        ? 'مثال: تعويضات ومدني كلي'
                        : 'مثال: دولاب أ - رف 3'
                    }
                    data-testid="reference-item-name-input"
                    aria-invalid={Boolean(itemFieldErrors['name'])}
                    aria-describedby={itemFieldErrors['name'] ? 'reference-item-name-error' : undefined}
                    className="w-full px-3 py-2 text-sm border border-[#D5DFE3] rounded-[6px] min-h-[44px]"
                  />
                  {itemFieldErrors['name'] && (
                    <p id="reference-item-name-error" role="alert" className="text-xs text-red-600 font-semibold">
                      {itemFieldErrors['name']}
                    </p>
                  )}
                </div>

                <div className="space-y-1">
                  <label htmlFor="reference-item-code-input" className="block text-xs font-bold text-[#172A35]">
                    كود مرجعي (اختياري)
                  </label>
                  <input
                    id="reference-item-code-input"
                    type="text"
                    dir="ltr"
                    value={newItemCode}
                    onChange={(e) => {
                      setNewItemCode(e.target.value);
                      setItemDraftDirty(true);
                    }}
                    placeholder="مثال: CRT-GIZA-01"
                    data-testid="reference-item-code-input"
                    className="w-full px-3 py-2 text-sm border border-[#D5DFE3] rounded-[6px] min-h-[44px] font-mono text-left"
                  />
                </div>
              </div>

              <div className="flex justify-end pt-1">
                <button
                  type="submit"
                  disabled={isCreatingItem || itemPending || !newItemName.trim() || !canWriteSettings}
                  data-testid="add-reference-item-button"
                  className="px-5 py-2 bg-[#14566B] hover:bg-[#0F4354] disabled:opacity-50 text-white font-bold text-xs rounded-[6px] min-h-[44px]"
                >
                  {isCreatingItem ? 'جارٍ الإضافة...' : 'إضافة للقائمة المرجعية'}
                </button>
              </div>
            </fieldset>
          </form>

          {/* List of Items */}
          <div className="bg-white rounded-[6px] border border-[#D5DFE3] overflow-hidden shadow-xs space-y-3 p-4">
            <div className="flex items-center justify-between pb-2 border-b border-[#E8EEF1]">
              <span className="text-xs font-bold text-[#172A35]">
                العناصر المسجلة (
                {activeTab === 'courts'
                  ? courts.length
                  : activeTab === 'practice_areas'
                  ? practiceAreas.length
                  : storageLocations.length}
                )
              </span>

              <label className="flex items-center gap-1.5 text-xs text-[#4D606A] cursor-pointer min-h-[44px]">
                <input
                  type="checkbox"
                  checked={filterActiveOnly}
                  onChange={(e) => setFilterActiveOnly(e.target.checked)}
                  data-testid="filter-active-only-checkbox"
                  className="w-3.5 h-3.5 text-[#14566B] rounded border-[#D5DFE3]"
                />
                <span>عرض النشطة فقط</span>
              </label>
            </div>

            {(() => {
              const currentList =
                activeTab === 'courts'
                  ? courts
                  : activeTab === 'practice_areas'
                  ? practiceAreas
                  : storageLocations;

              const filtered = filterActiveOnly
                ? currentList.filter((item) => item.isActive)
                : currentList;

              if (filtered.length === 0) {
                return (
                  <p className="text-xs text-[#4D606A] italic py-4 text-center">
                    {filterActiveOnly ? 'لا توجد عناصر نشطة مطابقة للفلتر.' : 'لا توجد عناصر مسجلة بعد في هذا القسم.'}
                  </p>
                );
              }

              return (
                <div className="divide-y divide-[#E8EEF1]">
                  {filtered.map((item) => (
                    <div
                      key={item.id}
                      data-testid={`reference-item-row-${item.id}`}
                      className="py-3 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 text-xs"
                    >
                      <div className="space-y-0.5">
                        <div className="flex items-center gap-2">
                          <span className="font-bold text-sm text-[#172A35]">
                            {item.name}
                          </span>
                          {item.code && (
                            <span className="font-mono text-[11px] bg-slate-100 text-slate-700 px-1.5 py-0.5 rounded">
                              <bdi dir="ltr">{item.code}</bdi>
                            </span>
                          )}
                          <span
                            className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                              item.isActive
                                ? 'bg-emerald-50 text-emerald-800 border border-emerald-200'
                                : 'bg-gray-100 text-gray-600 border border-gray-300'
                            }`}
                          >
                            {item.isActive ? 'نشط' : 'معطل'}
                          </span>
                        </div>
                      </div>

                      {canWriteSettings && (
                        <div className="flex items-center gap-2">
                          <button
                            type="button"
                            data-testid={`edit-reference-item-${item.id}`}
                            onClick={() => handleOpenEditModal(item)}
                            disabled={isTogglingActive || togglePending}
                            className={`px-3 py-1.5 text-xs font-semibold rounded-[6px] border border-[#D5DFE3] bg-[#F4F6F7] hover:bg-[#E8EEF1] text-[#14566B] min-h-[44px] transition-colors ${
                              isTogglingActive || togglePending ? 'opacity-50 cursor-not-allowed' : ''
                            }`}
                          >
                            تعديل
                          </button>
                          <button
                            type="button"
                            data-testid={`toggle-active-${item.id}`}
                            onClick={() => handleToggleActive(item)}
                            disabled={isTogglingActive || togglePending}
                            className={`px-3 py-1.5 text-xs font-semibold rounded-[6px] border min-h-[44px] transition-colors ${
                              isTogglingActive || togglePending ? 'opacity-50 cursor-not-allowed ' : ''
                            }${
                              item.isActive
                                ? 'text-red-700 bg-red-50 hover:bg-red-100 border-red-200'
                                : 'text-emerald-700 bg-emerald-50 hover:bg-emerald-100 border-emerald-200'
                            }`}
                          >
                            {item.isActive ? 'تعطيل العنصر' : 'إعادة التفعيل'}
                          </button>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              );
            })()}
          </div>
        </div>
      )}

      {/* Edit Reference Item Modal (C19/U1/U9) */}
      {editingItem &&
        renderModalPortal(
          <div
            role="presentation"
            className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 overflow-y-auto"
          >
            <div
              ref={editDialogRef}
              role="dialog"
              aria-modal="true"
              aria-labelledby="edit-reference-title"
              data-testid="reference-item-modal"
              className="bg-white rounded-[6px] border border-[#D5DFE3] max-w-lg w-full p-6 space-y-4 shadow-lg text-xs max-h-[90vh] overflow-y-auto my-auto"
              dir="rtl"
              lang="ar-EG"
            >
            <div className="flex items-center justify-between pb-3 border-b border-[#E8EEF1]">
              <h2 id="edit-reference-title" className="text-base font-bold text-[#172A35]">
                تعديل بيانات العنصر المرجعي
              </h2>
              <button
                type="button"
                onClick={handleCloseEditModal}
                aria-label="إغلاق نافذة تعديل العنصر المرجعي"
                className="text-[#4D606A] hover:text-[#172A35] p-1 font-bold text-sm min-h-[44px] min-w-[44px] flex items-center justify-center"
              >
                ✕
              </button>
            </div>

            {/* Session Recovery Banner for Edit Modal (U3) */}
            {editItemSessionExpired && (
              <div
                role="alert"
                data-testid="edit-session-recovery-alert"
                className="p-3 bg-amber-50 border border-amber-300 rounded-[6px] text-amber-900 space-y-2 text-xs"
              >
                <p className="font-bold">انتهت صلاحية الجلسة أو يلزم استكمال التحقق.</p>
                <div className="flex items-center gap-2">
                  <a
                    href="/login"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="px-2.5 py-1 bg-[#14566B] text-white text-xs font-semibold rounded hover:bg-[#114252] inline-flex items-center min-h-[44px]"
                  >
                    تسجيل الدخول في نافذة جديدة ↗
                  </a>
                  <button
                    type="submit"
                    form="edit-reference-item-form"
                    disabled={isSavingEditItem}
                    className="px-2.5 py-1 border border-[#14566B] text-[#14566B] bg-white text-xs font-semibold rounded min-h-[44px] disabled:opacity-50"
                  >
                    إعادة محاولة الحفظ
                  </button>
                </div>
              </div>
            )}

            {/* Frozen Operation Banner for Edit Modal (U1) */}
            {editItemPending && (
              <div
                role="alert"
                data-testid="edit-operation-pending-banner"
                className="p-3 bg-sky-50 border border-sky-300 rounded-[6px] text-sky-950 space-y-2 text-xs"
              >
                <p className="font-bold">العملية الأصلية معلّقة بانتظار نتيجة مؤكدة.</p>
                <div className="flex items-center gap-2">
                  <button
                    type="submit"
                    form="edit-reference-item-form"
                    disabled={isSavingEditItem}
                    className="px-2.5 py-1 bg-[#14566B] text-white text-xs font-semibold rounded min-h-[44px] disabled:opacity-50"
                  >
                    إعادة المحاولة
                  </button>
                  <button
                    type="button"
                    onClick={handleStartNewEditItem}
                    className="px-2.5 py-1 bg-white border border-[#14566B] text-[#14566B] text-xs font-semibold rounded min-h-[44px]"
                  >
                    بدء تعديل جديد
                  </button>
                </div>
              </div>
            )}

            {editItemError && !editItemSessionExpired && !editItemPending && (
              <div role="alert" className="p-2.5 bg-red-50 border border-red-200 text-[#A4262C] rounded-[6px] font-semibold">
                {editItemError}
              </div>
            )}

            <form id="edit-reference-item-form" onSubmit={handleSaveEditItem} className="space-y-4">
              <fieldset disabled={!canWriteSettings || isSavingEditItem || editItemPending} className="space-y-4 border-0 p-0 m-0 min-w-0">
                <div className="space-y-1">
                  <label htmlFor="edit-reference-name-input" className="block font-bold text-[#172A35]">
                    الاسم <span className="text-red-600">*</span>
                  </label>
                  <input
                    ref={editNameInputRef}
                    id="edit-reference-name-input"
                    type="text"
                    required
                    value={editItemName}
                    onChange={(e) => setEditItemName(e.target.value)}
                    data-testid="edit-reference-item-name-input"
                    aria-invalid={Boolean(editItemFieldErrors['name'])}
                    aria-describedby={editItemFieldErrors['name'] ? 'edit-reference-name-error' : undefined}
                    className="w-full px-3 py-2 text-sm border border-[#D5DFE3] rounded-[6px] min-h-[44px]"
                  />
                  {editItemFieldErrors['name'] && (
                    <p id="edit-reference-name-error" role="alert" className="text-xs text-red-600 font-semibold">
                      {editItemFieldErrors['name']}
                    </p>
                  )}
                </div>

                <div className="space-y-1">
                  <label htmlFor="edit-reference-code-input" className="block font-bold text-[#172A35]">
                    الكود المرجعي (اختياري)
                  </label>
                  <input
                    id="edit-reference-code-input"
                    type="text"
                    dir="ltr"
                    value={editItemCode}
                    onChange={(e) => setEditItemCode(e.target.value)}
                    data-testid="edit-reference-item-code-input"
                    className="w-full px-3 py-2 text-sm border border-[#D5DFE3] rounded-[6px] min-h-[44px] font-mono text-left"
                  />
                </div>

                <div className="space-y-1">
                  <label htmlFor="edit-reference-notes-input" className="block font-bold text-[#172A35]">
                    ملاحظات (اختياري)
                  </label>
                  <textarea
                    id="edit-reference-notes-input"
                    rows={2}
                    value={editItemNotes}
                    onChange={(e) => setEditItemNotes(e.target.value)}
                    data-testid="edit-reference-item-notes-input"
                    className="w-full px-3 py-2 text-sm border border-[#D5DFE3] rounded-[6px]"
                  />
                </div>

                <div className="flex items-center gap-2 pt-1">
                  <input
                    id="edit-reference-active-checkbox"
                    type="checkbox"
                    checked={editItemIsActive}
                    onChange={(e) => setEditItemIsActive(e.target.checked)}
                    data-testid="edit-reference-item-active-checkbox"
                    className="w-4 h-4 text-[#14566B] rounded border-[#D5DFE3]"
                  />
                  <label htmlFor="edit-reference-active-checkbox" className="font-semibold text-[#172A35] cursor-pointer min-h-[44px] inline-flex items-center">
                    عنصر نشط ومتاح للاختيار بالملفات والقضايا
                  </label>
                </div>

                <div className="flex justify-end gap-2 pt-3 border-t border-[#E8EEF1]">
                  <button
                    type="button"
                    onClick={handleCloseEditModal}
                    data-testid="modal-cancel-button"
                    className="px-4 py-2 bg-[#F4F6F7] text-[#172A35] font-semibold rounded-[6px] border border-[#D5DFE3] min-h-[44px]"
                  >
                    إلغاء
                  </button>
                  <button
                    type="submit"
                    disabled={!canWriteSettings || isSavingEditItem || editItemPending || !editItemName.trim()}
                    data-testid="save-edit-reference-item-button"
                    className="px-5 py-2 bg-[#14566B] hover:bg-[#0F4354] disabled:opacity-50 text-white font-bold rounded-[6px] min-h-[44px]"
                  >
                    {isSavingEditItem ? 'جارٍ الحفظ...' : 'حفظ التعديلات'}
                  </button>
                </div>
              </fieldset>
            </form>
          </div>
        </div>
        )}
    </div>
  );
}

'use client';

import React, { useState, useRef, useCallback, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import {
  createTaskAction,
  updateTaskAction,
  completeTaskAction,
  cancelTaskAction,
} from '@/modules/productivity/productivity-actions';
import type {
  ActionResult,
  CreateTaskInput,
  SelectableMatterOptionDTO,
  TaskItemDTO,
  TaskPriority,
  UpdateTaskInput,
} from '@/modules/productivity/productivity-types';
import { formatCairoDateArabic } from '@/lib/cairo-date';
import { GuardedLink as Link, useFormDraft, useLeaveGuard } from '@/components/navigation-guard';
import { LoadingIndicator, ErrorContainer, EmptyStateContainer } from '@/components/presentation-state';
import { generateClientRequestId, isAuthRecoveryCode } from '@/components/matters/matter-ui-types';
import {
  TASK_PRIORITY_CLASSES,
  TASK_PRIORITY_LABELS,
  TASK_STATUS_CLASSES,
  TASK_STATUS_LABELS,
  isUncertainMutationOutcome,
  renderModalPortal,
  useAccessibleModal,
} from './productivity-ui-types';

interface TasksViewProps {
  actorId: string;
  initialTasks: TaskItemDTO[];
  selectableMatters: SelectableMatterOptionDTO[];
  initialError?: string;
  lockedMatterId?: string;
  lockedMatterProceedings?: Array<{ id: string; label: string; courtId: string; courtName: string }>;
  isReadOnly?: boolean;
  onDataChanged?: () => void;
}

type TaskFilterMode = 'ACTIVE' | 'OVERDUE' | 'UNDATED' | 'DONE' | 'ALL';

export function TasksView({
  actorId,
  initialTasks,
  selectableMatters,
  initialError,
  lockedMatterId,
  lockedMatterProceedings,
  isReadOnly = false,
  onDataChanged,
}: TasksViewProps) {
  const router = useRouter();
  const scopePath = lockedMatterId ? `/matters/${lockedMatterId}` : '/tasks';
  const createDraft = useFormDraft<CreateTaskInput>(`${actorId}:create-task:${lockedMatterId ?? 'all'}`, scopePath);

  const [tasks, setTasks] = useState<TaskItemDTO[]>(initialTasks);
  const [filterMode, setFilterMode] = useState<TaskFilterMode>('ALL');
  const [isLoading, setIsLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(initialError ?? null);
  const [statusNotice, setStatusNotice] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [conflictNotice, setConflictNotice] = useState<string | null>(null);

  // Create / Edit Modal State
  const [isCreateOpen, setIsCreateOpen] = useState(Boolean(createDraft.restored));
  const [editingTask, setEditingTask] = useState<TaskItemDTO | null>(null);
  const [title, setTitle] = useState(createDraft.restored?.title ?? '');
  const [details, setDetails] = useState(createDraft.restored?.details ?? '');
  const [dueDate, setDueDate] = useState(createDraft.restored?.dueDate ?? '');
  const [dueTime, setDueTime] = useState(createDraft.restored?.dueTime ?? '');
  const [priority, setPriority] = useState<TaskPriority>(createDraft.restored?.priority ?? 'NORMAL');
  const [editStatus, setEditStatus] = useState<'OPEN' | 'IN_PROGRESS'>('OPEN');
  const [matterId, setMatterId] = useState(lockedMatterId ?? createDraft.restored?.matterId ?? '');
  const [proceedingId, setProceedingId] = useState(createDraft.restored?.proceedingId ?? '');
  const [isSubmittingCreate, setIsSubmittingCreate] = useState(false);
  const [isFrozenCreateRetry, setIsFrozenCreateRetry] = useState(Boolean(createDraft.restored));
  const [createSessionExpired, setCreateSessionExpired] = useState(false);
  const [createError, setCreateError] = useState<string | null>(
    createDraft.restored ? 'تعذر تأكيد حفظ المهمة على الخادم. يمكنك إعادة المحاولة بنفس المفتاح.' : null
  );
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const pendingCreateRef = useRef<CreateTaskInput | undefined>(createDraft.restored);
  const pendingUpdateRef = useRef<UpdateTaskInput | undefined>(undefined);

  // Per-task mutation pending/retry state (in-memory only)
  const [mutatingTaskId, setMutatingTaskId] = useState<string | null>(null);
  const pendingTaskKeysRef = useRef<Map<string, string>>(new Map());
  const [cancelTarget, setCancelTarget] = useState<TaskItemDTO | null>(null);
  const [cancelReason, setCancelReason] = useState('');
  const [cancelError, setCancelError] = useState<string | null>(null);
  const [isSubmittingCancel, setIsSubmittingCancel] = useState(false);

  const createDialogRef = useRef<HTMLDivElement>(null);
  const titleInputRef = useRef<HTMLInputElement>(null);
  const dueDateInputRef = useRef<HTMLInputElement>(null);
  const cancelDialogRef = useRef<HTMLDivElement>(null);
  const cancelReasonInputRef = useRef<HTMLTextAreaElement>(null);

  const createDirty =
    isFrozenCreateRetry ||
    (isCreateOpen && Boolean(title || details || dueDate || dueTime));
  useLeaveGuard(createDirty, isSubmittingCreate || isSubmittingCancel || Boolean(mutatingTaskId));

  const closeCreateModal = () => {
    if (isSubmittingCreate) return;
    setIsCreateOpen(false);
    setEditingTask(null);
    pendingUpdateRef.current = undefined;
    if (!pendingCreateRef.current) {
      setIsFrozenCreateRetry(false);
      setCreateSessionExpired(false);
    }
    setCreateError(null);
    setFieldErrors({});
  };

  const closeCancelModal = () => {
    if (isSubmittingCancel) return;
    setCancelTarget(null);
    setCancelReason('');
    setCancelError(null);
  };

  useAccessibleModal({
    isOpen: isCreateOpen,
    isSubmitting: isSubmittingCreate,
    hasPending: isFrozenCreateRetry,
    onClose: closeCreateModal,
    dialogRef: createDialogRef,
    initialFocusRef: titleInputRef,
  });

  useAccessibleModal({
    isOpen: Boolean(cancelTarget),
    isSubmitting: isSubmittingCancel,
    hasPending: false,
    onClose: closeCancelModal,
    dialogRef: cancelDialogRef,
    initialFocusRef: cancelReasonInputRef,
  });

  const refreshAbortRef = useRef<AbortController | null>(null);
  const refreshSeqRef = useRef(0);

  useEffect(() => {
    return () => {
      refreshAbortRef.current?.abort();
    };
  }, []);

  const refreshTasks = useCallback(async () => {
    refreshAbortRef.current?.abort();
    const controller = new AbortController();
    refreshAbortRef.current = controller;
    const seq = ++refreshSeqRef.current;

    setIsLoading(true);
    setLoadError(null);
    try {
      const sp = new URLSearchParams({ includeCompleted: 'true' });
      if (lockedMatterId) sp.set('matterId', lockedMatterId);
      const res = await fetch(`/api/tasks?${sp.toString()}`, { cache: 'no-store', signal: controller.signal });
      if (res.status === 401 && typeof window !== 'undefined') {
        window.dispatchEvent(new Event('lawoffice:recheck-session'));
      }
      const body = (await res.json().catch(() => null)) as ActionResult<TaskItemDTO[]> | null;
      if (seq !== refreshSeqRef.current) return;
      if (!res.ok || !body || !body.success) {
        throw new Error(body && !body.success ? body.error : 'تعذر تحميل قائمة المهام من الخادم.');
      }
      setTasks(body.data);
      setConflictNotice(null);
    } catch (err) {
      if (controller.signal.aborted || seq !== refreshSeqRef.current) return;
      setLoadError(err instanceof Error ? err.message : 'تعذر تحميل قائمة المهام من الخادم.');
    } finally {
      if (refreshAbortRef.current === controller) {
        refreshAbortRef.current = null;
      }
      if (seq === refreshSeqRef.current) {
        setIsLoading(false);
      }
    }
  }, [lockedMatterId]);

  const openNewTaskModal = () => {
    setActionError(null);
    setStatusNotice(null);
    setEditingTask(null);
    pendingUpdateRef.current = undefined;
    if (!pendingCreateRef.current) {
      setTitle('');
      setDetails('');
      setDueDate('');
      setDueTime('');
      setPriority('NORMAL');
      setEditStatus('OPEN');
      setMatterId(lockedMatterId ?? '');
      setProceedingId('');
      setCreateError(null);
      setFieldErrors({});
      setCreateSessionExpired(false);
      setIsFrozenCreateRetry(false);
    } else {
      setTitle(pendingCreateRef.current.title);
      setDetails(pendingCreateRef.current.details ?? '');
      setDueDate(pendingCreateRef.current.dueDate ?? '');
      setDueTime(pendingCreateRef.current.dueTime ?? '');
      setPriority(pendingCreateRef.current.priority ?? 'NORMAL');
      setMatterId(lockedMatterId ?? pendingCreateRef.current.matterId ?? '');
      setProceedingId(pendingCreateRef.current.proceedingId ?? '');
      setIsFrozenCreateRetry(true);
    }
    setIsCreateOpen(true);
  };

  const openEditTaskModal = (task: TaskItemDTO) => {
    setActionError(null);
    setStatusNotice(null);
    setConflictNotice(null);
    setEditingTask(task);
    pendingUpdateRef.current = undefined;
    setTitle(task.title);
    setDetails(task.details ?? '');
    setDueDate(task.dueDate ?? '');
    setDueTime(task.dueTime ?? '');
    setPriority(task.priority);
    setEditStatus(task.status === 'IN_PROGRESS' ? 'IN_PROGRESS' : 'OPEN');
    setCreateError(null);
    setFieldErrors({});
    setCreateSessionExpired(false);
    setIsFrozenCreateRetry(false);
    setIsCreateOpen(true);
  };

  const selectedMatterProceedings = lockedMatterId
    ? (lockedMatterProceedings ?? [])
    : (selectableMatters.find((m) => m.id === matterId)?.proceedings ?? []);

  const handleCreateSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isSubmittingCreate) return;

    setCreateError(null);
    setCreateSessionExpired(false);
    setFieldErrors({});

    if (editingTask) {
      if (!pendingUpdateRef.current) {
        const trimmedTitle = title.trim();
        const trimmedDate = dueDate.trim();
        const trimmedTime = dueTime.trim();
        const nextErrors: Record<string, string> = {};

        if (!trimmedTitle) {
          nextErrors.title = 'عنوان المهمة مطلوب.';
        }
        if (trimmedTime && !trimmedDate) {
          nextErrors.dueTime = 'لا يمكن تحديد وقت بدون تحديد التاريخ.';
        }

        if (Object.keys(nextErrors).length > 0) {
          setFieldErrors(nextErrors);
          setCreateError(nextErrors.title ?? nextErrors.dueTime ?? 'بيانات المهمة غير صالحة.');
          if (nextErrors.title) {
            titleInputRef.current?.focus();
          } else if (nextErrors.dueTime) {
            dueDateInputRef.current?.focus();
          }
          return;
        }

        pendingUpdateRef.current = {
          taskId: editingTask.id,
          expectedVersion: editingTask.version,
          title: trimmedTitle,
          details: details.trim() || null,
          dueDate: trimmedDate || null,
          dueTime: trimmedTime || null,
          priority,
          status: editStatus,
          idempotencyKey: generateClientRequestId('task-upd'),
        };
      }

      setIsSubmittingCreate(true);
      try {
        const res = await updateTaskAction(pendingUpdateRef.current);
        if (!res.success) {
          if (isAuthRecoveryCode(res.code)) {
            if (typeof window !== 'undefined') {
              window.dispatchEvent(new Event('lawoffice:recheck-session'));
            }
            setCreateSessionExpired(true);
            setIsFrozenCreateRetry(true);
            setCreateError('انتهت صلاحية الجلسة أو يلزم استكمال التحقق. أُبقيت تعديلات المهمة مجمّدة؛ سجّل الدخول ثم أعد المحاولة.');
            return;
          }
          const uncertain = isUncertainMutationOutcome(res.code);
          setIsFrozenCreateRetry(uncertain);
          if (!uncertain) {
            pendingUpdateRef.current = undefined;
          }
          if (res.code === 'CONCURRENCY_CONFLICT') {
            setConflictNotice('تم تعديل البيانات من شاشة أخرى. يرجى تحديث القائمة ومراجعة أحدث نسخة قبل الحفظ.');
            setIsCreateOpen(false);
            setEditingTask(null);
          } else {
            setCreateError(res.error || 'تعذر تحديث المهمة.');
            if (res.fieldErrors) setFieldErrors(res.fieldErrors);
          }
          return;
        }

        pendingUpdateRef.current = undefined;
        setIsFrozenCreateRetry(false);
        setCreateSessionExpired(false);
        setTasks((prev) => prev.map((t) => (t.id === res.data.id ? res.data : t)));
        setIsCreateOpen(false);
        setEditingTask(null);
        setStatusNotice('تم تحديث بيانات المهمة بنجاح.');
        onDataChanged?.();
        router.refresh();
      } catch {
        setIsFrozenCreateRetry(true);
        setCreateError('تعذر استلام تأكيد التعديل من الخادم. يمكنك إعادة المحاولة بنفس المفتاح دون تكرار.');
      } finally {
        setIsSubmittingCreate(false);
      }
      return;
    }

    if (!pendingCreateRef.current) {
      const trimmedTitle = title.trim();
      const trimmedDate = dueDate.trim();
      const trimmedTime = dueTime.trim();
      const nextErrors: Record<string, string> = {};

      if (!trimmedTitle) {
        nextErrors.title = 'عنوان المهمة مطلوب.';
      }
      if (trimmedTime && !trimmedDate) {
        nextErrors.dueTime = 'لا يمكن تحديد وقت بدون تحديد التاريخ.';
      }

      if (Object.keys(nextErrors).length > 0) {
        setFieldErrors(nextErrors);
        setCreateError(nextErrors.title ?? nextErrors.dueTime ?? 'بيانات المهمة غير صالحة.');
        if (nextErrors.title) {
          titleInputRef.current?.focus();
        } else if (nextErrors.dueTime) {
          dueDateInputRef.current?.focus();
        }
        return;
      }

      const payload: CreateTaskInput = {
        title: trimmedTitle,
        details: details.trim() || null,
        matterId: lockedMatterId || matterId ? lockedMatterId || matterId : null,
        proceedingId: proceedingId ? proceedingId : null,
        dueDate: trimmedDate || null,
        dueTime: trimmedTime || null,
        priority,
        idempotencyKey: generateClientRequestId('task'),
      };
      pendingCreateRef.current = payload;
      createDraft.keep(payload);
    }

    setIsSubmittingCreate(true);
    try {
      const res = await createTaskAction(pendingCreateRef.current);
      if (!res.success) {
        if (isAuthRecoveryCode(res.code)) {
          if (typeof window !== 'undefined') {
            window.dispatchEvent(new Event('lawoffice:recheck-session'));
          }
          setCreateSessionExpired(true);
          setIsFrozenCreateRetry(true);
          setCreateError('انتهت صلاحية الجلسة أو يلزم استكمال التحقق. أُبقيت بيانات المهمة مجمّدة؛ سجّل الدخول ثم أعد المحاولة.');
          return;
        }
        const uncertain = isUncertainMutationOutcome(res.code);
        setIsFrozenCreateRetry(uncertain);
        if (!uncertain) {
          pendingCreateRef.current = undefined;
          createDraft.clear();
        }
        setCreateError(res.error || 'تعذر حفظ المهمة.');
        if (res.fieldErrors) setFieldErrors(res.fieldErrors);
        return;
      }

      pendingCreateRef.current = undefined;
      createDraft.clear();
      setIsFrozenCreateRetry(false);
      setCreateSessionExpired(false);
      setTasks((prev) => [res.data, ...prev.filter((t) => t.id !== res.data.id)]);
      setIsCreateOpen(false);
      setStatusNotice('تم حفظ المهمة بنجاح.');
      onDataChanged?.();
      router.refresh();
    } catch {
      setIsFrozenCreateRetry(true);
      setCreateError('تعذر استلام تأكيد الحفظ من الخادم. يمكنك إعادة المحاولة بنفس المفتاح دون تكرار.');
    } finally {
      setIsSubmittingCreate(false);
    }
  };

  const handleCompleteTask = async (task: TaskItemDTO) => {
    if (mutatingTaskId || isReadOnly) return;
    setActionError(null);
    setStatusNotice(null);
    setConflictNotice(null);

    const opKeyId = `complete:${task.id}:${task.version}`;
    const idempotencyKey = pendingTaskKeysRef.current.get(opKeyId) ?? generateClientRequestId('task-done');
    pendingTaskKeysRef.current.set(opKeyId, idempotencyKey);

    setMutatingTaskId(task.id);
    try {
      const res = await completeTaskAction({
        taskId: task.id,
        expectedVersion: task.version,
        idempotencyKey,
      });
      if (!res.success) {
        if (isAuthRecoveryCode(res.code) && typeof window !== 'undefined') {
          window.dispatchEvent(new Event('lawoffice:recheck-session'));
        }
        if (!isUncertainMutationOutcome(res.code)) {
          pendingTaskKeysRef.current.delete(opKeyId);
        }
        if (res.code === 'CONCURRENCY_CONFLICT') {
          setConflictNotice('تم تعديل البيانات من شاشة أخرى. يرجى تحديث القائمة ومراجعة أحدث نسخة قبل التنفيذ.');
        } else {
          setActionError(res.error || 'تعذر إتمام المهمة.');
        }
        return;
      }

      pendingTaskKeysRef.current.delete(opKeyId);
      setTasks((prev) => prev.map((t) => (t.id === res.data.id ? res.data : t)));
      setStatusNotice('تم تسجيل إتمام المهمة (دون تغيير حالة أي موعد قانوني مرتبط).');
      onDataChanged?.();
      router.refresh();
    } catch {
      setActionError('تعذر الاتصال بالخادم لتأكيد إتمام المهمة. يمكنك إعادة المحاولة بأمان.');
    } finally {
      setMutatingTaskId(null);
    }
  };

  const handleConfirmCancelTask = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!cancelTarget || isSubmittingCancel || isReadOnly) return;

    setCancelError(null);
    const opKeyId = `cancel:${cancelTarget.id}:${cancelTarget.version}`;
    const idempotencyKey = pendingTaskKeysRef.current.get(opKeyId) ?? generateClientRequestId('task-cancel');
    pendingTaskKeysRef.current.set(opKeyId, idempotencyKey);

    setIsSubmittingCancel(true);
    try {
      const res = await cancelTaskAction({
        taskId: cancelTarget.id,
        expectedVersion: cancelTarget.version,
        reason: cancelReason.trim() || null,
        idempotencyKey,
      });
      if (!res.success) {
        if (isAuthRecoveryCode(res.code) && typeof window !== 'undefined') {
          window.dispatchEvent(new Event('lawoffice:recheck-session'));
        }
        if (!isUncertainMutationOutcome(res.code)) {
          pendingTaskKeysRef.current.delete(opKeyId);
        }
        if (res.code === 'CONCURRENCY_CONFLICT') {
          setConflictNotice('تم تعديل البيانات من شاشة أخرى. يرجى تحديث القائمة قبل الإلغاء.');
          setCancelTarget(null);
        } else {
          setCancelError(res.error || 'تعذر إلغاء المهمة.');
        }
        return;
      }

      pendingTaskKeysRef.current.delete(opKeyId);
      setTasks((prev) => prev.map((t) => (t.id === res.data.id ? res.data : t)));
      setCancelTarget(null);
      setCancelReason('');
      setStatusNotice('تم إلغاء المهمة بنجاح.');
      onDataChanged?.();
      router.refresh();
    } catch {
      setCancelError('تعذر تأكيد إلغاء المهمة بسبب انقطاع الاتصال. يمكنك إعادة المحاولة.');
    } finally {
      setIsSubmittingCancel(false);
    }
  };

  const filteredTasks = tasks.filter((task) => {
    if (filterMode === 'ACTIVE') return task.status === 'OPEN' || task.status === 'IN_PROGRESS';
    if (filterMode === 'OVERDUE') return task.isOverdue;
    if (filterMode === 'UNDATED') return (task.status === 'OPEN' || task.status === 'IN_PROGRESS') && !task.dueDate;
    if (filterMode === 'DONE') return task.status === 'DONE';
    return true;
  });

  const openCount = tasks.filter((t) => t.status === 'OPEN' || t.status === 'IN_PROGRESS').length;
  const overdueCount = tasks.filter((t) => t.isOverdue).length;
  const undatedCount = tasks.filter((t) => (t.status === 'OPEN' || t.status === 'IN_PROGRESS') && !t.dueDate).length;

  return (
    <div className="space-y-6" data-testid="tasks-view">
      {/* Stitch S08a Header Card */}
      <div className="bg-white border border-[#D5DFE3] rounded-[6px] p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4 shadow-xs">
        <div className="space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs font-semibold text-[#14566B] bg-[#E9F2F5] px-2.5 py-0.5 rounded-[4px] border border-[#C2D9E2]">
              سجل المتابعة الإدارية والإجرائية
            </span>
          </div>
          {lockedMatterId ? (
            <h2 className="text-lg font-bold text-[#172A35]">
              المهام الإجرائية ومهام المتابعة
            </h2>
          ) : (
            <h1 className="text-2xl font-bold text-[#172A35]">
              المهام الإجرائية ومهام المتابعة
            </h1>
          )}
          <p className="text-sm text-[#4D606A]">
            إتمام مهمة متابعة أو قراءة إشعار لا يُغلق أو يعتمد أي موعد قانوني — المواعيد القانونية تُدار بشكل مستقل.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2 shrink-0">
          <button
            type="button"
            data-testid="tasks-refresh-button"
            onClick={refreshTasks}
            disabled={isLoading}
            className="px-4 py-2 bg-white hover:bg-[#F4F6F7] text-[#172A35] text-sm font-semibold rounded-[6px] border border-[#D5DFE3] transition-colors min-h-[44px] disabled:opacity-50"
          >
            تحديث
          </button>
          {!isReadOnly && (
            <button
              type="button"
              data-testid="new-task-button"
              onClick={openNewTaskModal}
              className="px-4 py-2 bg-[#14566B] hover:bg-[#0F4354] text-white text-sm font-bold rounded-[6px] transition-colors shadow-xs min-h-[44px] flex items-center gap-1.5 focus:outline-none focus:ring-2 focus:ring-[#14566B] focus:ring-offset-2"
            >
              <span>{isFrozenCreateRetry ? 'إعادة محاولة حفظ المهمة' : 'مهمة جديدة'}</span>
            </button>
          )}
        </div>
      </div>

      {/* Stitch S08a Metric Summary Tiles */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="bg-white border border-[#D5DFE3] rounded-[6px] p-4 flex items-center justify-between shadow-xs">
          <div>
            <span className="text-xs font-semibold text-[#4D606A] block">المهام الإجرائية المفتوحة</span>
            <div className="flex items-baseline gap-2 mt-1">
              <strong className="text-2xl font-bold text-[#14566B]">{openCount}</strong>
              <span className="text-xs text-[#4D606A]">مهمة قيد المتابعة</span>
            </div>
          </div>
          <span className="w-10 h-10 rounded-[6px] bg-[#E9F2F5] border border-[#C2D9E2] flex items-center justify-center text-[#14566B] font-bold text-sm">
            {openCount}
          </span>
        </div>

        <div className="bg-white border border-[#D5DFE3] rounded-[6px] p-4 flex items-center justify-between shadow-xs">
          <div>
            <span className="text-xs font-semibold text-[#A4262C] block">المهام المتأخرة عن موعدها</span>
            <div className="flex items-baseline gap-2 mt-1">
              <strong className="text-2xl font-bold text-[#A4262C]">{overdueCount}</strong>
              <span className="text-xs text-[#4D606A]">تتطلب إجراءً عاجلاً</span>
            </div>
          </div>
          <span className="w-10 h-10 rounded-[6px] bg-red-50 border border-red-200 flex items-center justify-center text-[#A4262C] font-bold text-sm">
            {overdueCount}
          </span>
        </div>

        <div className="bg-white border border-[#D5DFE3] rounded-[6px] p-4 flex items-center justify-between shadow-xs">
          <div>
            <span className="text-xs font-semibold text-[#4D606A] block">مهام بدون تاريخ استحقاق</span>
            <div className="flex items-baseline gap-2 mt-1">
              <strong className="text-2xl font-bold text-[#172A35]">{undatedCount}</strong>
              <span className="text-xs text-[#4D606A]">مفصولة عن أيام التقويم</span>
            </div>
          </div>
          <span className="w-10 h-10 rounded-[6px] bg-[#F8FAFB] border border-[#D5DFE3] flex items-center justify-center text-[#172A35] font-bold text-sm">
            {undatedCount}
          </span>
        </div>
      </div>

      {/* Notices */}
      {statusNotice && (
        <div
          role="status"
          data-testid="task-status-notice"
          className="p-3 bg-emerald-50 border border-emerald-200 text-[#176449] rounded-[6px] text-sm font-medium flex items-center justify-between gap-2"
        >
          <span>✓ {statusNotice}</span>
          <button
            type="button"
            onClick={() => setStatusNotice(null)}
            aria-label="إغلاق التنبيه"
            className="px-2 py-1 font-bold hover:underline min-h-[44px] min-w-[44px] flex items-center justify-center"
          >
            ✕
          </button>
        </div>
      )}

      {conflictNotice && (
        <div
          role="alert"
          data-testid="task-conflict-banner"
          className="p-4 bg-amber-50 border border-amber-300 text-[#7A4A00] rounded-[6px] text-sm flex flex-col sm:flex-row sm:items-center justify-between gap-3"
        >
          <span>{conflictNotice}</span>
          <button
            type="button"
            onClick={refreshTasks}
            className="px-4 py-2 bg-[#14566B] text-white font-bold rounded-[6px] min-h-[44px] shrink-0"
          >
            تحديث البيانات
          </button>
        </div>
      )}

      {actionError && (
        <div
          role="alert"
          data-testid="task-action-error"
          className="p-3 bg-red-50 border border-red-200 text-[#A4262C] rounded-[6px] text-sm font-medium flex items-center justify-between gap-2"
        >
          <span>{actionError}</span>
          <button
            type="button"
            onClick={() => setActionError(null)}
            aria-label="إغلاق رسالة الخطأ"
            className="px-2 py-1 font-bold min-h-[44px] min-w-[44px] flex items-center justify-center"
          >
            ✕
          </button>
        </div>
      )}

      {/* Filter Bar */}
      <div className="flex flex-wrap items-center gap-2" role="group" aria-label="تصفية المهام">
        {(
          [
            { key: 'ALL', label: `الكل (${tasks.length})` },
            { key: 'ACTIVE', label: `مفتوحة (${openCount})` },
            { key: 'OVERDUE', label: `متأخرة (${overdueCount})` },
            { key: 'UNDATED', label: `بدون تاريخ (${undatedCount})` },
            { key: 'DONE', label: 'منتهية' },
          ] as const
        ).map((tab) => (
          <button
            key={tab.key}
            type="button"
            aria-pressed={filterMode === tab.key}
            onClick={() => setFilterMode(tab.key)}
            className={`px-3.5 py-2 rounded-[6px] text-sm font-semibold border transition-colors min-h-[44px] focus:outline-none focus:ring-2 focus:ring-[#14566B] ${
              filterMode === tab.key
                ? 'bg-[#14566B] text-white border-[#14566B]'
                : 'bg-white text-[#172A35] border-[#D5DFE3] hover:bg-[#F4F6F7]'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Main Content */}
      {isLoading ? (
        <div className="bg-white rounded-[6px] border border-[#D5DFE3] p-8">
          <LoadingIndicator label="جارٍ تحميل المهام..." />
        </div>
      ) : loadError ? (
        <ErrorContainer
          title="تعذر تحميل المهام"
          message={loadError}
          onRetry={refreshTasks}
          isRetrying={isLoading}
        />
      ) : filteredTasks.length === 0 ? (
        <EmptyStateContainer
          title={tasks.length === 0 ? 'لا توجد مهام مسجلة حالياً' : 'لا توجد مهام مطابقة للتصفية الحالية'}
          description={
            tasks.length === 0
              ? 'يمكنك إضافة مهمة متابعة عامة أو ربطها بملف قضية وتحديد تاريخ استحقاق أو تركها بدون تاريخ.'
              : 'غيّر الفلاتر لعرض باقي المهام المسجلة.'
          }
          action={
            tasks.length > 0 && filterMode !== 'ALL' ? (
              <button
                type="button"
                onClick={() => setFilterMode('ALL')}
                className="px-4 py-2 bg-[#14566B] text-white text-sm font-semibold rounded-[6px] min-h-[44px]"
              >
                غيّر الفلاتر لعرض الكل
              </button>
            ) : !isReadOnly ? (
              <button
                type="button"
                onClick={openNewTaskModal}
                className="px-4 py-2 bg-[#14566B] text-white text-sm font-semibold rounded-[6px] min-h-[44px]"
              >
                إضافة أول مهمة
              </button>
            ) : undefined
          }
        />
      ) : (
        <div className="space-y-3" data-testid="tasks-list">
          {filteredTasks.map((task) => {
            const isOpenTask = task.status === 'OPEN' || task.status === 'IN_PROGRESS';
            const isBusy = mutatingTaskId === task.id;
            return (
              <article
                key={task.id}
                data-testid={`task-card-${task.id}`}
                className={`bg-white rounded-[6px] border p-4 sm:p-5 shadow-xs space-y-3 ${
                  task.isOverdue
                    ? 'border-[#A4262C]/50'
                    : isOpenTask
                    ? 'border-[#D5DFE3]'
                    : 'border-[#D5DFE3] bg-[#FAFBFB]'
                }`}
              >
                <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-2 pb-2 border-b border-[#E8EEF1]">
                  <div className="space-y-1 min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <h2 className="text-base font-bold text-[#172A35] [overflow-wrap:anywhere]">
                        {task.title}
                      </h2>
                    </div>
                    <div className="flex flex-wrap items-center gap-2 text-sm text-[#4D606A]">
                      {task.matterId && task.matterTitle ? (
                        <Link
                          href={`/matters/${task.matterId}`}
                          className="text-[#14566B] font-semibold hover:underline"
                        >
                          ملف <bdi dir="ltr">{task.matterFileCode}</bdi> — {task.matterTitle}
                        </Link>
                      ) : (
                        <span className="bg-slate-100 text-slate-700 px-2 py-0.5 rounded border border-slate-200 font-medium">
                          مهمة عامة (بدون ملف)
                        </span>
                      )}
                      {task.proceedingLabel && <span>• {task.proceedingLabel}</span>}
                      {task.deadlineTitle && (
                        <span>
                          • مرتبطة بموعد:{' '}
                          <Link href="/deadlines" className="text-[#14566B] underline">
                            {task.deadlineTitle}
                          </Link>
                        </span>
                      )}
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center gap-2 shrink-0">
                    <span
                      className={`text-sm font-semibold px-2.5 py-0.5 rounded border ${TASK_PRIORITY_CLASSES[task.priority]}`}
                    >
                      الأولوية: {TASK_PRIORITY_LABELS[task.priority]}
                    </span>
                    <span
                      data-testid={`task-status-badge-${task.id}`}
                      className={`text-sm font-bold px-2.5 py-0.5 rounded border ${TASK_STATUS_CLASSES[task.status]}`}
                    >
                      {TASK_STATUS_LABELS[task.status]}
                    </span>
                    {task.isOverdue && (
                      <span className="text-sm font-bold px-2.5 py-0.5 rounded border bg-red-50 text-[#A4262C] border-red-300">
                        متأخرة
                      </span>
                    )}
                  </div>
                </div>

                {task.details && (
                  <p className="text-sm text-[#172A35] whitespace-pre-wrap leading-relaxed">
                    {task.details}
                  </p>
                )}

                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pt-1 text-sm">
                  <div className="flex flex-wrap items-center gap-2 text-[#4D606A]">
                    {task.dueDate ? (
                      <>
                        <span className="font-semibold text-[#172A35]">الاستحقاق:</span>
                        <span>{formatCairoDateArabic(task.dueDate)}</span>
                        <span>(<bdi dir="ltr">{task.dueDate}</bdi>)</span>
                        <span className="bg-[#F4F6F7] px-2 py-0.5 rounded border border-[#D5DFE3]">
                          {task.timeLabel}
                        </span>
                      </>
                    ) : (
                      <span className="px-2.5 py-0.5 rounded bg-slate-100 text-slate-800 border border-slate-200 font-medium">
                        بدون تاريخ استحقاق محدد
                      </span>
                    )}
                  </div>

                  {isOpenTask && !isReadOnly && (
                    <div className="flex flex-wrap items-center gap-2">
                      <button
                        type="button"
                        data-testid={`complete-task-button-${task.id}`}
                        disabled={isBusy}
                        onClick={() => handleCompleteTask(task)}
                        className="px-4 py-2 bg-[#176449] hover:bg-[#114D38] text-white text-sm font-bold rounded-[6px] transition-colors min-h-[44px] disabled:opacity-50 focus:outline-none focus:ring-2 focus:ring-[#176449] focus:ring-offset-2"
                      >
                        {isBusy ? 'جارٍ التنفيذ...' : '✓ تمت'}
                      </button>
                      <button
                        type="button"
                        data-testid={`edit-task-button-${task.id}`}
                        disabled={isBusy}
                        onClick={() => openEditTaskModal(task)}
                        className="px-3.5 py-2 bg-[#F4F6F7] hover:bg-[#E8EEF1] text-[#172A35] text-sm font-semibold rounded-[6px] border border-[#D5DFE3] transition-colors min-h-[44px] disabled:opacity-50 focus:outline-none focus:ring-2 focus:ring-[#14566B] focus:ring-offset-2"
                      >
                        تعديل
                      </button>
                      <button
                        type="button"
                        data-testid={`cancel-task-button-${task.id}`}
                        disabled={isBusy}
                        onClick={() => {
                          setCancelTarget(task);
                          setCancelReason('');
                          setCancelError(null);
                        }}
                        className="px-3.5 py-2 bg-white hover:bg-red-50 text-[#A4262C] text-sm font-semibold rounded-[6px] border border-red-200 transition-colors min-h-[44px] disabled:opacity-50 focus:outline-none focus:ring-2 focus:ring-[#A4262C] focus:ring-offset-2"
                      >
                        إلغاء المهمة
                      </button>
                    </div>
                  )}
                </div>
              </article>
            );
          })}
        </div>
      )}

      {/* Create Task Modal */}
      {isCreateOpen &&
        renderModalPortal(
          <div
            className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-xs overflow-y-auto"
            role="presentation"
            onClick={(e) => {
              if (e.target === e.currentTarget && !isSubmittingCreate) {
                closeCreateModal();
              }
            }}
          >
            <div
              ref={createDialogRef}
              role="dialog"
              aria-modal="true"
              aria-labelledby="create-task-modal-title"
              dir="rtl"
              lang="ar-EG"
              className="bg-white rounded-[6px] border border-[#D5DFE3] shadow-xl w-full max-w-lg max-h-[90vh] overflow-y-auto p-6 space-y-5 text-right my-auto"
            >
              <div className="flex items-center justify-between pb-3 border-b border-[#E8EEF1]">
                <h2 id="create-task-modal-title" className="text-lg font-bold text-[#172A35]">
                  {editingTask ? 'تعديل بيانات المهمة' : 'إضافة مهمة متابعة جديدة'}
                </h2>
                <button
                  type="button"
                  onClick={closeCreateModal}
                  disabled={isSubmittingCreate}
                  aria-label="إغلاق النافذة"
                  className="p-2 text-[#4D606A] hover:text-[#172A35] hover:bg-[#F4F6F7] rounded-[6px] min-h-[44px] min-w-[44px] flex items-center justify-center"
                >
                  ✕
                </button>
              </div>

              {createSessionExpired && (
                <div role="alert" className="p-3 bg-amber-50 border border-amber-300 rounded-[6px] text-sm text-[#7A4A00] space-y-2">
                  <p className="font-bold">انتهت صلاحية الجلسة أو يلزم استكمال التحقق</p>
                  <a
                    href="/login"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center px-4 py-2 bg-[#14566B] text-white font-semibold rounded-[6px] min-h-[44px]"
                  >
                    فتح تسجيل الدخول في نافذة جديدة ↗
                  </a>
                </div>
              )}

              {createError && (
                <div
                  role="alert"
                  data-testid="task-form-error"
                  className="p-3 bg-red-50 border border-red-300 rounded-[6px] text-sm text-[#A4262C] font-semibold"
                >
                  {createError}
                </div>
              )}

              <form onSubmit={handleCreateSubmit} noValidate className="space-y-4">
                <div className="space-y-1">
                  <label htmlFor="task-title-input" className="block text-sm font-bold text-[#172A35]">
                    عنوان المهمة <span className="text-[#A4262C]">*</span>
                  </label>
                  <input
                    ref={titleInputRef}
                    id="task-title-input"
                    data-testid="task-title-input"
                    type="text"
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                    disabled={isSubmittingCreate || isFrozenCreateRetry}
                    aria-invalid={Boolean(fieldErrors.title)}
                    placeholder="مثال: مراجعة حافظة المستندات أو استخراج صورة رسمية"
                    className="w-full px-3 py-2 text-base bg-white border border-[#7B909B] rounded-[6px] min-h-[44px] focus:outline-none focus:ring-2 focus:ring-[#14566B]"
                  />
                </div>

                <div className="space-y-1">
                  <label htmlFor="task-details-input" className="block text-sm font-bold text-[#172A35]">
                    تفاصيل إضافية (اختياري)
                  </label>
                  <textarea
                    id="task-details-input"
                    data-testid="task-details-input"
                    rows={3}
                    value={details}
                    onChange={(e) => setDetails(e.target.value)}
                    disabled={isSubmittingCreate || isFrozenCreateRetry}
                    placeholder="تفاصيل العمل المطلوب..."
                    className="w-full px-3 py-2 text-base bg-white border border-[#7B909B] rounded-[6px] focus:outline-none focus:ring-2 focus:ring-[#14566B]"
                  />
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div className="space-y-1">
                    <label htmlFor="task-due-date-input" className="block text-sm font-bold text-[#172A35]">
                      تاريخ الاستحقاق (اختياري)
                    </label>
                    <input
                      ref={dueDateInputRef}
                      id="task-due-date-input"
                      data-testid="task-due-date-input"
                      type="date"
                      dir="ltr"
                      value={dueDate}
                      onChange={(e) => setDueDate(e.target.value)}
                      disabled={isSubmittingCreate || isFrozenCreateRetry}
                      aria-invalid={Boolean(fieldErrors.dueDate)}
                      className="w-full px-3 py-2 text-base bg-white border border-[#7B909B] rounded-[6px] min-h-[44px] focus:outline-none focus:ring-2 focus:ring-[#14566B]"
                    />
                  </div>

                  <div className="space-y-1">
                    <label htmlFor="task-due-time-input" className="block text-sm font-bold text-[#172A35]">
                      الوقت (اختياري — يتطلب تحديد اليوم)
                    </label>
                    <input
                      id="task-due-time-input"
                      data-testid="task-due-time-input"
                      type="time"
                      dir="ltr"
                      value={dueTime}
                      onChange={(e) => setDueTime(e.target.value)}
                      disabled={isSubmittingCreate || isFrozenCreateRetry}
                      aria-invalid={Boolean(fieldErrors.dueTime)}
                      className="w-full px-3 py-2 text-base bg-white border border-[#7B909B] rounded-[6px] min-h-[44px] focus:outline-none focus:ring-2 focus:ring-[#14566B]"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div className="space-y-1">
                    <label htmlFor="task-priority-select" className="block text-sm font-bold text-[#172A35]">
                      الأولوية
                    </label>
                    <select
                      id="task-priority-select"
                      data-testid="task-priority-select"
                      value={priority}
                      onChange={(e) => setPriority(e.target.value as TaskPriority)}
                      disabled={isSubmittingCreate || isFrozenCreateRetry}
                      className="w-full px-3 py-2 text-base bg-white border border-[#7B909B] rounded-[6px] min-h-[44px] focus:outline-none focus:ring-2 focus:ring-[#14566B]"
                    >
                      <option value="LOW">{TASK_PRIORITY_LABELS.LOW}</option>
                      <option value="NORMAL">{TASK_PRIORITY_LABELS.NORMAL}</option>
                      <option value="HIGH">{TASK_PRIORITY_LABELS.HIGH}</option>
                      <option value="URGENT">{TASK_PRIORITY_LABELS.URGENT}</option>
                    </select>
                  </div>

                  {editingTask ? (
                    <div className="space-y-1">
                      <label htmlFor="task-status-select" className="block text-sm font-bold text-[#172A35]">
                        الحالة
                      </label>
                      <select
                        id="task-status-select"
                        data-testid="task-status-select"
                        value={editStatus}
                        onChange={(e) => setEditStatus(e.target.value as 'OPEN' | 'IN_PROGRESS')}
                        disabled={isSubmittingCreate || isFrozenCreateRetry}
                        className="w-full px-3 py-2 text-base bg-white border border-[#7B909B] rounded-[6px] min-h-[44px] focus:outline-none focus:ring-2 focus:ring-[#14566B]"
                      >
                        <option value="OPEN">{TASK_STATUS_LABELS.OPEN}</option>
                        <option value="IN_PROGRESS">{TASK_STATUS_LABELS.IN_PROGRESS}</option>
                      </select>
                    </div>
                  ) : (
                    !lockedMatterId && (
                      <div className="space-y-1">
                        <label htmlFor="task-matter-select" className="block text-sm font-bold text-[#172A35]">
                          ملف القضية (اختياري)
                        </label>
                        <select
                          id="task-matter-select"
                          data-testid="task-matter-select"
                          value={matterId}
                          onChange={(e) => {
                            setMatterId(e.target.value);
                            setProceedingId('');
                          }}
                          disabled={isSubmittingCreate || isFrozenCreateRetry}
                          className="w-full px-3 py-2 text-base bg-white border border-[#7B909B] rounded-[6px] min-h-[44px] focus:outline-none focus:ring-2 focus:ring-[#14566B]"
                        >
                          <option value="">مهمة عامة (بدون ربط بملف)</option>
                          {selectableMatters.map((m) => (
                            <option key={m.id} value={m.id}>
                              {m.fileCode} — {m.title}
                            </option>
                          ))}
                        </select>
                      </div>
                    )
                  )}
                </div>

                {!editingTask && (lockedMatterId || matterId) && selectedMatterProceedings.length > 0 && (
                  <div className="space-y-1">
                    <label htmlFor="task-proceeding-select" className="block text-sm font-bold text-[#172A35]">
                      القيد القضائي داخل الملف (اختياري)
                    </label>
                    <select
                      id="task-proceeding-select"
                      data-testid="task-proceeding-select"
                      value={proceedingId}
                      onChange={(e) => setProceedingId(e.target.value)}
                      disabled={isSubmittingCreate || isFrozenCreateRetry}
                      className="w-full px-3 py-2 text-base bg-white border border-[#7B909B] rounded-[6px] min-h-[44px] focus:outline-none focus:ring-2 focus:ring-[#14566B]"
                    >
                      <option value="">غير محدد بقيد معين</option>
                      {selectedMatterProceedings.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.label}
                        </option>
                      ))}
                    </select>
                  </div>
                )}

                <div className="flex flex-wrap justify-end gap-2 pt-3 border-t border-[#E8EEF1]">
                  <button
                    type="button"
                    onClick={closeCreateModal}
                    disabled={isSubmittingCreate}
                    className="px-4 py-2 bg-[#F4F6F7] hover:bg-[#E8EEF1] text-[#172A35] text-sm font-semibold rounded-[6px] border border-[#D5DFE3] min-h-[44px]"
                  >
                    إلغاء
                  </button>
                  <button
                    type="submit"
                    data-testid="task-submit-button"
                    disabled={isSubmittingCreate}
                    className="px-5 py-2 bg-[#14566B] hover:bg-[#0F4354] text-white text-sm font-bold rounded-[6px] min-h-[44px] disabled:opacity-50"
                  >
                    {isSubmittingCreate
                      ? 'جارٍ الحفظ...'
                      : isFrozenCreateRetry
                      ? 'إعادة المحاولة بنفس المفتاح'
                      : editingTask
                      ? 'حفظ التعديلات'
                      : 'حفظ المهمة'}
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}

      {/* Cancel Task Modal */}
      {cancelTarget &&
        renderModalPortal(
          <div
            className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-xs overflow-y-auto"
            role="presentation"
            onClick={(e) => {
              if (e.target === e.currentTarget && !isSubmittingCancel) {
                closeCancelModal();
              }
            }}
          >
            <div
              ref={cancelDialogRef}
              role="dialog"
              aria-modal="true"
              aria-labelledby="cancel-task-modal-title"
              dir="rtl"
              lang="ar-EG"
              className="bg-white rounded-[6px] border border-[#D5DFE3] shadow-xl w-full max-w-md max-h-[90vh] overflow-y-auto p-6 space-y-4 text-right my-auto"
            >
              <div className="flex items-center justify-between pb-2 border-b border-[#E8EEF1]">
                <h2 id="cancel-task-modal-title" className="text-lg font-bold text-[#172A35]">
                  إلغاء المهمة
                </h2>
                <button
                  type="button"
                  onClick={closeCancelModal}
                  disabled={isSubmittingCancel}
                  aria-label="إغلاق النافذة"
                  className="p-2 text-[#4D606A] hover:text-[#172A35] rounded-[6px] min-h-[44px] min-w-[44px] flex items-center justify-center"
                >
                  ✕
                </button>
              </div>

              <p className="text-sm text-[#4D606A]">
                هل ترغب في إلغاء المهمة: <strong className="text-[#172A35]">{cancelTarget.title}</strong>؟
              </p>

              {cancelError && (
                <div role="alert" className="p-3 bg-red-50 border border-red-300 rounded-[6px] text-sm text-[#A4262C]">
                  {cancelError}
                </div>
              )}

              <form onSubmit={handleConfirmCancelTask} noValidate className="space-y-4">
                <div className="space-y-1">
                  <label htmlFor="cancel-task-reason" className="block text-sm font-bold text-[#172A35]">
                    سبب الإلغاء (اختياري)
                  </label>
                  <textarea
                    ref={cancelReasonInputRef}
                    id="cancel-task-reason"
                    rows={2}
                    value={cancelReason}
                    onChange={(e) => setCancelReason(e.target.value)}
                    disabled={isSubmittingCancel}
                    className="w-full px-3 py-2 text-base bg-white border border-[#7B909B] rounded-[6px] focus:outline-none focus:ring-2 focus:ring-[#14566B]"
                  />
                </div>

                <div className="flex justify-end gap-2 pt-2">
                  <button
                    type="button"
                    onClick={closeCancelModal}
                    disabled={isSubmittingCancel}
                    className="px-4 py-2 bg-[#F4F6F7] text-[#172A35] text-sm font-semibold rounded-[6px] border border-[#D5DFE3] min-h-[44px]"
                  >
                    رجوع
                  </button>
                  <button
                    type="submit"
                    disabled={isSubmittingCancel}
                    className="px-4 py-2 bg-[#A4262C] hover:bg-[#881D22] text-white text-sm font-bold rounded-[6px] min-h-[44px] disabled:opacity-50"
                  >
                    {isSubmittingCancel ? 'جارٍ الإلغاء...' : 'تأكيد إلغاء المهمة'}
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}
    </div>
  );
}

'use client';

import React, { useEffect, useRef, useState } from 'react';
import Image from 'next/image';
import type {
  DocumentActionResult,
  DocumentDTO,
  DocumentOriginalPresence,
  DocumentSensitivity,
  DocumentType,
  DuplicateChecksumMatchDTO,
  UploadAttemptDTO,
} from '@/modules/documents/document-types';
import type { SelectableMatterOptionDTO } from '@/modules/productivity/productivity-types';
import { generateClientRequestId } from '@/components/matters/matter-ui-types';
import { GuardedLink as Link, useCanLeavePage, useLeaveGuard } from '@/components/navigation-guard';
import {
  IconCheck,
  IconDocument,
  IconRefresh,
  IconUpload,
  IconWarning,
} from '@/components/stitch-icons';
import {
  DOCUMENT_TYPE_OPTIONS,
  MAX_DOCUMENT_TITLE_LENGTH,
  ORIGINAL_PRESENCE_OPTIONS,
  QUEUE_STATUS_META,
  SCAN_STATUS_BADGE_CLASSES,
  SENSITIVITY_OPTIONS,
  UNSCANNED_POLICY_NOTICE_AR,
  clampTitle,
  formatFileSizeArabic,
  isPdfFile,
  isPreviewableImageFile,
  resolveDeclaredMime,
  suggestTitleFromFilename,
  validateClientFile,
  type QueueUploadStatus,
  type SelectablePartyOption,
} from './document-ui-helpers';

interface QueueItem {
  queueId: string;
  file: File;
  previewUrl: string | null;
  previewError: boolean;
  itemTitle: string;
  itemTitleEdited: boolean;
  /** Title sent with the begin request; frozen so an idempotent replay never changes payload. */
  sentTitle?: string;
  status: QueueUploadStatus;
  errorMessage: string | null;
  attemptId?: string;
  contentUploaded: boolean;
  pendingConfirmDuplicate: boolean;
  beginIdempotencyKey: string;
  finalizeIdempotencyKey: string;
  confirmDuplicateIdempotencyKey: string;
  duplicateMatches: DuplicateChecksumMatchDTO[];
  createdDocument: DocumentDTO | null;
}

export interface DocumentUploadFormProps {
  selectableMatters: SelectableMatterOptionDTO[];
  selectableParties: SelectablePartyOption[];
  defaultMatterId?: string;
  defaultPartyId?: string;
  onDocumentUploaded: (doc: DocumentDTO) => void;
  onClose?: () => void;
}

type LinkTargetMode = 'MATTER' | 'PARTY';
type UploadOutcome = 'READY' | 'DUPLICATE_WARNING' | 'REJECTED' | 'INCOMPLETE';
type UploadFailureBody = Extract<DocumentActionResult<unknown>, { success: false }>;

const INPUT_CLASS =
  'w-full max-w-full min-w-0 min-h-[44px] px-3 py-2 text-base bg-white text-[#172A35] border border-[#6E828C] rounded-[6px] focus:outline-none focus:ring-2 focus:ring-[#14566B] focus:border-[#14566B] disabled:bg-[#F4F6F7] disabled:opacity-70';
const FIELD_ERROR_CLASS = 'text-xs text-[#A4262C] mt-1 font-medium min-w-0 break-words [overflow-wrap:anywhere]';
const MESSAGE_CLASS = 'min-w-0 break-words [overflow-wrap:anywhere]';
const INLINE_LINK_CLASS =
  'font-semibold text-[#14566B] underline rounded-[4px] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#14566B]';
const RADIO_LABEL_CLASS =
  'inline-flex items-center gap-2 px-3 py-2 rounded-[6px] border border-[#D5DFE3] bg-[#F8FAFB] min-h-[44px] cursor-pointer focus-within:ring-2 focus-within:ring-[#14566B]';

const SESSION_EXPIRED_MESSAGE =
  'انتهت الجلسة. البيانات لم تُحفظ، يرجى إعادة تسجيل الدخول والمحاولة.';
const NETWORK_ERROR_MESSAGE = 'الاتصال انقطع، البيانات لسه ما اتحفظتش';
const SIZE_EXCEEDED_MESSAGE = 'حجم الملف يتجاوز الحد الأقصى المسموح به (25 ميجابايت).';
const CONFLICT_CODES = new Set<string>([
  'CONCURRENCY_CONFLICT',
  'IDEMPOTENCY_CONCURRENT_CONFLICT',
]);

const isPending = (item: QueueItem) => item.status !== 'READY' && item.status !== 'CANCELLED';
const pendingOf = (items: QueueItem[]) => items.filter(isPending);

/** Conflicts and server/session faults keep the attempt (and its idempotency keys) for a safe replay. */
function classifyFailure(
  httpStatus: number,
  body: UploadFailureBody | null,
  fallback: string
): { status: 'INCOMPLETE' | 'REJECTED'; message: string } {
  const message = body?.error ?? fallback;
  if (httpStatus === 401) return { status: 'INCOMPLETE', message: SESSION_EXPIRED_MESSAGE };
  if (httpStatus === 409 && body && CONFLICT_CODES.has(body.code)) {
    return { status: 'INCOMPLETE', message };
  }
  if (httpStatus >= 500 && body?.code !== 'SCAN_POLICY_UNAVAILABLE') {
    return { status: 'INCOMPLETE', message };
  }
  if (httpStatus === 413) return { status: 'REJECTED', message: SIZE_EXCEEDED_MESSAGE };
  return { status: 'REJECTED', message };
}

type AttemptState = Pick<
  QueueItem,
  | 'attemptId'
  | 'sentTitle'
  | 'contentUploaded'
  | 'pendingConfirmDuplicate'
  | 'duplicateMatches'
  | 'beginIdempotencyKey'
  | 'finalizeIdempotencyKey'
  | 'confirmDuplicateIdempotencyKey'
>;

const freshAttemptPatch = (): AttemptState => ({
  attemptId: undefined,
  sentTitle: undefined,
  contentUploaded: false,
  pendingConfirmDuplicate: false,
  duplicateMatches: [],
  beginIdempotencyKey: generateClientRequestId('doc-begin'),
  finalizeIdempotencyKey: generateClientRequestId('doc-fin'),
  confirmDuplicateIdempotencyKey: generateClientRequestId('doc-dup'),
});

export function DocumentUploadForm({
  selectableMatters,
  selectableParties,
  defaultMatterId,
  defaultPartyId,
  onDocumentUploaded,
  onClose,
}: DocumentUploadFormProps) {
  const initialLinkMode: LinkTargetMode = defaultPartyId && !defaultMatterId ? 'PARTY' : 'MATTER';

  const [linkMode, setLinkMode] = useState<LinkTargetMode>(initialLinkMode);
  const [matterId, setMatterId] = useState<string>(defaultMatterId ?? '');
  const [proceedingId, setProceedingId] = useState<string>('');
  const [partyId, setPartyId] = useState<string>(defaultPartyId ?? '');
  const [title, setTitle] = useState<string>('');
  const [documentType, setDocumentType] = useState<DocumentType>('EVIDENCE');
  const [documentDate, setDocumentDate] = useState<string>('');
  const [originalPresent, setOriginalPresent] = useState<DocumentOriginalPresence>('UNKNOWN');
  const [originalLocation, setOriginalLocation] = useState<string>('');
  const [sensitivity, setSensitivity] = useState<DocumentSensitivity>('CONFIDENTIAL');
  const [description, setDescription] = useState<string>('');

  const [queue, setQueue] = useState<QueueItem[]>([]);
  const [isUploading, setIsUploading] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  const queueRef = useRef<QueueItem[]>([]);
  const objectUrlsRef = useRef<Set<string>>(new Set());
  const uploadAbortRef = useRef<AbortController | null>(null);
  const isMountedRef = useRef(false);
  const titleEditedManuallyRef = useRef(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const replaceInputRef = useRef<HTMLInputElement>(null);
  const replacingQueueIdRef = useRef<string | null>(null);
  const matterSelectRef = useRef<HTMLSelectElement>(null);
  const partySelectRef = useRef<HTMLSelectElement>(null);
  const titleInputRef = useRef<HTMLInputElement>(null);

  const selectedMatter = selectableMatters.find((m) => m.id === matterId) ?? null;
  const availableProceedings = selectedMatter?.proceedings ?? [];

  const canLeavePage = useCanLeavePage();
  const pendingQueue = pendingOf(queue);
  const hasReadyOrCancelled = queue.some(
    (item) => item.status === 'READY' || item.status === 'CANCELLED'
  );
  // Shared metadata is already bound to an incomplete/live attempt awaiting retry or duplicate confirmation.
  const metadataLocked = queue.some(
    (item) =>
      item.status === 'INCOMPLETE' ||
      (Boolean(item.attemptId) && item.status === 'DUPLICATE_WARNING')
  );
  const metadataDisabled = isUploading || metadataLocked;
  const onlyDuplicateWarnings =
    pendingQueue.length > 0 &&
    pendingQueue.every((item) => item.status === 'DUPLICATE_WARNING');

  const hasUnsavedItems = pendingQueue.length > 0;
  useLeaveGuard(
    hasUnsavedItems || (queue.length === 0 && Boolean(title.trim() || description.trim())),
    isUploading
  );

  useEffect(() => {
    const urls = objectUrlsRef.current;
    isMountedRef.current = true;
    uploadAbortRef.current = new AbortController();
    return () => {
      isMountedRef.current = false;
      uploadAbortRef.current?.abort();
      for (const url of urls) {
        URL.revokeObjectURL(url);
      }
      urls.clear();
    };
  }, []);

  const createObjectPreviewUrl = (file: File): string | null => {
    if (!isPreviewableImageFile(file) || typeof URL === 'undefined' || !URL.createObjectURL) {
      return null;
    }
    const url = URL.createObjectURL(file);
    objectUrlsRef.current.add(url);
    return url;
  };

  const revokePreviewUrl = (url: string | null) => {
    if (!url) return;
    URL.revokeObjectURL(url);
    objectUrlsRef.current.delete(url);
  };

  const setQueueSynced = (updater: (prev: QueueItem[]) => QueueItem[]) => {
    const next = updater(queueRef.current);
    queueRef.current = next;
    setQueue(next);
    return next;
  };

  const updateQueueItem = (queueId: string, patch: Partial<QueueItem>) => {
    setQueueSynced((prev) =>
      prev.map((item) => (item.queueId === queueId ? { ...item, ...patch } : item))
    );
  };

  const clearFieldError = (key: string) =>
    setFieldErrors((prev) => {
      if (!(key in prev)) return prev;
      const next = { ...prev };
      delete next[key];
      return next;
    });

  // The shared title mirrors the only pending file's name until the user types their own.
  const syncSharedTitle = (items: QueueItem[]) => {
    if (titleEditedManuallyRef.current) return;
    const pending = pendingOf(items);
    setTitle(pending.length === 1 ? pending[0].itemTitle : '');
  };

  const buildQueueItem = (file: File): QueueItem => {
    const rejection = validateClientFile(file);
    return {
      queueId: generateClientRequestId('doc-q'),
      file,
      previewUrl: rejection ? null : createObjectPreviewUrl(file),
      previewError: false,
      itemTitle: suggestTitleFromFilename(file.name),
      itemTitleEdited: false,
      status: rejection ? 'REJECTED' : 'QUEUED',
      errorMessage: rejection,
      createdDocument: null,
      ...freshAttemptPatch(),
    };
  };

  const handleFilesSelected = (event: React.ChangeEvent<HTMLInputElement>) => {
    const selected = Array.from(event.target.files ?? []);
    event.target.value = '';
    if (selected.length === 0) return;

    setFormError(null);
    clearFieldError('files');

    const newItems = selected.map(buildQueueItem);
    syncSharedTitle(setQueueSynced((prev) => [...prev, ...newItems]));
  };

  const handleRemoveQueueItem = (queueId: string) => {
    if (isUploading) return;
    const target = queueRef.current.find((item) => item.queueId === queueId);
    if (target) {
      revokePreviewUrl(target.previewUrl);
    }
    syncSharedTitle(setQueueSynced((prev) => prev.filter((item) => item.queueId !== queueId)));
  };

  const handleTriggerReplaceFile = (queueId: string) => {
    if (isUploading) return;
    replacingQueueIdRef.current = queueId;
    replaceInputRef.current?.click();
  };

  const handleReplaceFileSelected = (event: React.ChangeEvent<HTMLInputElement>) => {
    const replacement = event.target.files?.[0];
    event.target.value = '';
    const targetId = replacingQueueIdRef.current;
    replacingQueueIdRef.current = null;
    if (!replacement || !targetId) return;

    const existing = queueRef.current.find((item) => item.queueId === targetId);
    if (existing) {
      revokePreviewUrl(existing.previewUrl);
    }

    const rejection = validateClientFile(replacement);
    const nextPreview = rejection ? null : createObjectPreviewUrl(replacement);
    const suggested = suggestTitleFromFilename(replacement.name);

    syncSharedTitle(
      setQueueSynced((prev) =>
        prev.map((item) =>
          item.queueId === targetId
            ? {
                ...item,
                ...freshAttemptPatch(),
                file: replacement,
                previewUrl: nextPreview,
                previewError: false,
                itemTitle: item.itemTitleEdited ? item.itemTitle : suggested,
                status: rejection ? 'REJECTED' : 'QUEUED',
                errorMessage: rejection,
                createdDocument: null,
              }
            : item
        )
      )
    );
  };

  const resolveEffectiveTitle = (item: QueueItem, pending: QueueItem[]): string => {
    if (item.sentTitle) return item.sentTitle;
    if (item.itemTitleEdited) {
      return clampTitle(item.itemTitle);
    }
    const base = title.trim();
    if (pending.length <= 1) {
      return clampTitle(base || item.itemTitle) || suggestTitleFromFilename(item.file.name);
    }
    if (base) {
      const suffix = ` (${pending.findIndex((entry) => entry.queueId === item.queueId) + 1})`;
      return clampTitle(base.slice(0, MAX_DOCUMENT_TITLE_LENGTH - suffix.length)) + suffix;
    }
    return clampTitle(item.itemTitle) || suggestTitleFromFilename(item.file.name);
  };

  const validateBeforeUpload = (): boolean => {
    const pending = pendingOf(queueRef.current);
    const nextFieldErrors: Record<string, string> = {};

    if (pending.length === 0) {
      nextFieldErrors.files = 'اختر ملفاً واحداً على الأقل لرفعه.';
    }
    if (linkMode === 'MATTER' && !matterId) {
      nextFieldErrors.matterId = 'يجب اختيار ملف القضية المرتبط بالمستند.';
    }
    if (linkMode === 'PARTY' && !partyId) {
      nextFieldErrors.partyId = 'يجب اختيار الطرف / الموكل المرتبط بالمستند.';
    }

    for (const item of pending) {
      if (!resolveEffectiveTitle(item, pending)) {
        nextFieldErrors.title = 'عنوان المستند مطلوب.';
        break;
      }
    }

    setFieldErrors(nextFieldErrors);
    if (Object.keys(nextFieldErrors).length > 0) {
      setFormError('يرجى استكمال الحقول المطلوبة قبل بدء الرفع.');
      if (nextFieldErrors.matterId) matterSelectRef.current?.focus();
      else if (nextFieldErrors.partyId) partySelectRef.current?.focus();
      else if (nextFieldErrors.title) titleInputRef.current?.focus();
      else if (nextFieldErrors.files) fileInputRef.current?.focus();
      return false;
    }

    setFormError(null);
    return true;
  };

  const runFinalizeStep = async (
    queueId: string,
    attemptId: string,
    confirmDuplicate: boolean,
    finalizeKey: string
  ): Promise<UploadOutcome> => {
    updateQueueItem(queueId, {
      status: 'VALIDATING',
      errorMessage: null,
      pendingConfirmDuplicate: confirmDuplicate,
    });

    try {
      const response = await fetch(`/api/documents/uploads/${attemptId}/finalize`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: uploadAbortRef.current?.signal,
        body: JSON.stringify({
          confirmDuplicate,
          idempotencyKey: finalizeKey,
        }),
      });

      if (response.status === 401 && typeof window !== 'undefined') {
        window.dispatchEvent(new Event('lawoffice:recheck-session'));
      }

      const body = (await response.json().catch(() => null)) as
        | DocumentActionResult<DocumentDTO>
        | null;
      if (!isMountedRef.current) return 'INCOMPLETE';

      if (response.status === 409 && body && !body.success && body.code === 'DUPLICATE_CHECKSUM_WARNING') {
        updateQueueItem(queueId, {
          status: 'DUPLICATE_WARNING',
          errorMessage: body.error,
          duplicateMatches: body.existingDocuments ?? [],
          pendingConfirmDuplicate: false,
        });
        return 'DUPLICATE_WARNING';
      }

      if (!response.ok || !body || !body.success) {
        const failure = classifyFailure(
          response.status,
          body && !body.success ? body : null,
          'تعذر إتمام التحقق من الملف على الخادم.'
        );
        updateQueueItem(queueId, {
          status: failure.status,
          errorMessage: failure.message,
          ...(failure.status === 'REJECTED'
            ? { pendingConfirmDuplicate: false, sentTitle: undefined }
            : {}),
        });
        return failure.status;
      }

      updateQueueItem(queueId, {
        status: 'READY',
        errorMessage: null,
        duplicateMatches: [],
        pendingConfirmDuplicate: false,
        createdDocument: body.data,
      });
      onDocumentUploaded(body.data);
      return 'READY';
    } catch {
      if (!isMountedRef.current) return 'INCOMPLETE';
      updateQueueItem(queueId, { status: 'INCOMPLETE', errorMessage: NETWORK_ERROR_MESSAGE });
      return 'INCOMPLETE';
    }
  };

  const processSingleQueueItem = async (
    queueId: string,
    effectiveTitle: string
  ): Promise<UploadOutcome> => {
    const current = queueRef.current.find((item) => item.queueId === queueId);
    if (!current) return 'INCOMPLETE';

    let attemptId = current.attemptId;
    let contentUploaded = current.contentUploaded;

    if (current.pendingConfirmDuplicate && attemptId && contentUploaded) {
      return await runFinalizeStep(
        queueId,
        attemptId,
        true,
        current.confirmDuplicateIdempotencyKey
      );
    }

    if (!attemptId) {
      const rejection = validateClientFile(current.file);
      if (rejection) {
        updateQueueItem(queueId, { status: 'REJECTED', errorMessage: rejection });
        return 'REJECTED';
      }

      const frozenTitle = current.sentTitle ?? effectiveTitle;
      updateQueueItem(queueId, {
        status: 'UPLOADING',
        errorMessage: null,
        sentTitle: frozenTitle,
      });

      try {
        const beginRes = await fetch('/api/documents/uploads', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          signal: uploadAbortRef.current?.signal,
          body: JSON.stringify({
            matterId: linkMode === 'MATTER' ? matterId : null,
            partyId: linkMode === 'PARTY' ? partyId : null,
            proceedingId: linkMode === 'MATTER' && proceedingId ? proceedingId : null,
            title: frozenTitle,
            documentType,
            documentDate: documentDate || null,
            description: description.trim() || null,
            originalLocation: originalLocation.trim() || null,
            originalPresent,
            sensitivity,
            originalFilename: current.file.name,
            declaredMime: resolveDeclaredMime(current.file),
            expectedSizeBytes: current.file.size,
            idempotencyKey: current.beginIdempotencyKey,
          }),
        });

        if (beginRes.status === 401 && typeof window !== 'undefined') {
          window.dispatchEvent(new Event('lawoffice:recheck-session'));
        }

        const beginBody = (await beginRes.json().catch(() => null)) as
          | DocumentActionResult<UploadAttemptDTO>
          | null;
        if (!isMountedRef.current) return 'INCOMPLETE';

        if (!beginRes.ok || !beginBody || !beginBody.success) {
          const failureBody = beginBody && !beginBody.success ? beginBody : null;
          const failure = classifyFailure(beginRes.status, failureBody, 'تعذر بدء محاولة رفع الملف.');
          const serverFieldErrors = failureBody?.fieldErrors;
          if (serverFieldErrors && Object.keys(serverFieldErrors).length > 0) {
            setFieldErrors((prev) => ({ ...prev, ...serverFieldErrors }));
          }
          updateQueueItem(queueId, {
            status: failure.status,
            errorMessage:
              (failure.status === 'REJECTED' && serverFieldErrors
                ? Object.values(serverFieldErrors)[0]
                : undefined) ?? failure.message,
            ...(failure.status === 'REJECTED'
              ? { sentTitle: undefined }
              : {}),
          });
          return failure.status;
        }

        attemptId = beginBody.data.id;
        updateQueueItem(queueId, { attemptId, sentTitle: frozenTitle });
      } catch {
        if (!isMountedRef.current) return 'INCOMPLETE';
        updateQueueItem(queueId, { status: 'INCOMPLETE', errorMessage: NETWORK_ERROR_MESSAGE });
        return 'INCOMPLETE';
      }
    }

    if (!contentUploaded) {
      updateQueueItem(queueId, { status: 'UPLOADING', errorMessage: null });

      try {
        const putRes = await fetch(`/api/documents/uploads/${attemptId}/content`, {
          method: 'PUT',
          headers: { 'Content-Type': resolveDeclaredMime(current.file) },
          signal: uploadAbortRef.current?.signal,
          body: current.file,
        });

        if (putRes.status === 401 && typeof window !== 'undefined') {
          window.dispatchEvent(new Event('lawoffice:recheck-session'));
        }

        const putBody = (await putRes.json().catch(() => null)) as
          | DocumentActionResult<UploadAttemptDTO>
          | null;
        if (!isMountedRef.current) return 'INCOMPLETE';

        if (!putRes.ok || !putBody || !putBody.success) {
          const failure = classifyFailure(
            putRes.status,
            putBody && !putBody.success ? putBody : null,
            'تعذر رفع محتوى الملف إلى الحجر الخاص.'
          );
          updateQueueItem(queueId, {
            status: failure.status,
            errorMessage: failure.message,
            ...(failure.status === 'REJECTED' ? { sentTitle: undefined } : {}),
          });
          return failure.status;
        }

        contentUploaded = true;
        updateQueueItem(queueId, { contentUploaded: true });
      } catch {
        if (!isMountedRef.current) return 'INCOMPLETE';
        updateQueueItem(queueId, { status: 'INCOMPLETE', errorMessage: NETWORK_ERROR_MESSAGE });
        return 'INCOMPLETE';
      }
    }

    const latest = queueRef.current.find((item) => item.queueId === queueId);
    const finKey = latest?.finalizeIdempotencyKey ?? current.finalizeIdempotencyKey;
    return await runFinalizeStep(queueId, attemptId, false, finKey);
  };

  const runUploads = async (work: () => Promise<void>) => {
    setIsUploading(true);
    try {
      await work();
    } finally {
      if (isMountedRef.current) setIsUploading(false);
    }
  };

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (isUploading) return;
    if (!validateBeforeUpload()) return;

    const pending = pendingOf(queueRef.current);
    const itemsToRun = pending.filter((item) => item.status !== 'DUPLICATE_WARNING');
    if (itemsToRun.length === 0) {
      setFormError(
        'الملفات المتبقية تنتظر قرارك بشأن تطابق البصمة. أكّد رفع نسخة منفصلة أو ألغِ الملف أولاً.'
      );
      return;
    }

    await runUploads(async () => {
      for (const item of itemsToRun) {
        if (!isMountedRef.current || uploadAbortRef.current?.signal.aborted) break;
        if (item.status === 'REJECTED') {
          updateQueueItem(item.queueId, freshAttemptPatch());
        }
        const current = queueRef.current.find((entry) => entry.queueId === item.queueId) ?? item;
        const outcome = await processSingleQueueItem(
          item.queueId,
          resolveEffectiveTitle(current, pending)
        );
        if (outcome === 'INCOMPLETE') {
          break;
        }
      }
    });
  };

  const handleRetryQueueItem = async (queueId: string) => {
    if (isUploading) return;
    const item = queueRef.current.find((entry) => entry.queueId === queueId);
    if (!item) return;

    const nextErrors: Record<string, string> = {};
    if (linkMode === 'MATTER' && !matterId) nextErrors.matterId = 'يجب اختيار ملف القضية.';
    if (linkMode === 'PARTY' && !partyId) nextErrors.partyId = 'يجب اختيار الطرف.';
    if (Object.keys(nextErrors).length > 0) {
      setFieldErrors(nextErrors);
      setFormError('يرجى تحديد الجهة المرتبطة قبل إعادة المحاولة.');
      return;
    }

    setFormError(null);
    setFieldErrors({});
    await runUploads(async () => {
      if (item.status === 'REJECTED') {
        updateQueueItem(queueId, freshAttemptPatch());
      }
      const current = queueRef.current.find((entry) => entry.queueId === queueId) ?? item;
      await processSingleQueueItem(
        queueId,
        resolveEffectiveTitle(current, pendingOf(queueRef.current))
      );
    });
  };

  const handleConfirmDuplicate = async (queueId: string) => {
    if (isUploading) return;
    const item = queueRef.current.find((entry) => entry.queueId === queueId);
    if (!item?.attemptId) return;
    const attemptId = item.attemptId;

    await runUploads(async () => {
      await runFinalizeStep(queueId, attemptId, true, item.confirmDuplicateIdempotencyKey);
    });
  };

  const handleCancelDuplicate = (queueId: string) => {
    if (isUploading) return;
    syncSharedTitle(
      setQueueSynced((prev) =>
        prev.map((item) =>
          item.queueId === queueId
            ? { ...item, status: 'CANCELLED', errorMessage: null, duplicateMatches: [] }
            : item
        )
      )
    );
  };

  const handleClearCompleted = () => {
    if (isUploading) return;
    syncSharedTitle(
      setQueueSynced((prev) =>
        prev.filter((item) => {
          if (item.status === 'READY' || item.status === 'CANCELLED') {
            revokePreviewUrl(item.previewUrl);
            return false;
          }
          return true;
        })
      )
    );
  };

  return (
    <section
      id="document-upload-section"
      aria-labelledby="upload-form-heading"
      data-testid="document-upload-section"
      className="bg-white rounded-[6px] border border-[#D5DFE3] p-4 sm:p-6 shadow-xs space-y-5 min-w-0 max-w-full"
    >
      <div className="flex flex-wrap items-center justify-between gap-3 pb-3 border-b border-[#D5DFE3]">
        <div className="space-y-1">
          <h2 id="upload-form-heading" className="text-lg font-bold text-[#172A35]">
            رفع مستند جديد
          </h2>
          <p className="text-sm text-[#4D606A]">
            يُحفظ كل ملف في التخزين الخاص بعد التحقق من صيغته وبصمته دون دمج تلقائي بين الصور.
          </p>
        </div>
        {onClose && (
          <button
            type="button"
            onClick={() => {
              if (canLeavePage()) onClose();
            }}
            disabled={isUploading}
            data-testid="close-upload-form-button"
            className="inline-flex items-center justify-center px-3 py-2 text-sm font-medium text-[#4D606A] hover:text-[#172A35] bg-[#F4F6F7] hover:bg-[#E8EEF1] border border-[#D5DFE3] rounded-[6px] min-h-[44px] disabled:opacity-50 focus:outline-none focus:ring-2 focus:ring-[#14566B]"
          >
            إغلاق نموذج الرفع
          </button>
        )}
      </div>

      {/* Pre-selection format, size, and multi-file policy notice */}
      <div
        data-testid="upload-limits-notice"
        className="rounded-[6px] bg-[#F8FAFB] border border-[#D5DFE3] p-3 sm:p-4 text-sm text-[#172A35] space-y-1.5"
      >
        <p className="font-semibold text-[#14566B]">ضوابط وشروط الرفع:</p>
        <ul className="list-disc list-inside space-y-1 text-sm text-[#4D606A]">
          <li>
            الصيغ المسموحة: <bdi dir="ltr" className="font-mono text-[#172A35]">PDF / JPEG / PNG</bdi>، والحد الأقصى{' '}
            <strong className="text-[#172A35]">25 ميجابايت</strong> لكل ملف.
          </li>
          <li>
            الصور المتعددة تُرفع كمستندات منفصلة (بدون دمج تلقائي في ملف واحد).
          </li>
          <li>
            وفق سياسة المرحلة الأولى (<bdi dir="ltr">ADR 0003</bdi>)، لا يُجرى فحص تلقائي ضد الفيروسات وتُعرض حالة الملف بوضوح بعبارة:{' '}
            <strong className="text-[#7A4A00]">{UNSCANNED_POLICY_NOTICE_AR}</strong>.
          </li>
        </ul>
      </div>

      {formError && (
        <div
          role="alert"
          data-testid="upload-form-error"
          className="p-3 rounded-[6px] bg-red-50 border border-red-200 text-sm text-[#A4262C] flex items-start gap-2"
        >
          <IconWarning className="w-5 h-5 shrink-0 mt-0.5" />
          <span className={MESSAGE_CLASS}>{formError}</span>
        </div>
      )}

      <form onSubmit={handleSubmit} noValidate className="space-y-5">
        {/* File selection area */}
        <div className="space-y-2 min-w-0">
          <span className="block text-sm font-bold text-[#172A35]">
            اختيار الملفات أو الصور (أو الالتقاط بالكاميرا) *
          </span>
          <div className="flex flex-wrap items-center gap-3 min-w-0">
            <input
              ref={fileInputRef}
              id="document-files-input"
              data-testid="upload-file-input"
              type="file"
              accept=".pdf,.jpg,.jpeg,.png,application/pdf,image/jpeg,image/png"
              multiple
              disabled={isUploading}
              onChange={handleFilesSelected}
              aria-invalid={Boolean(fieldErrors.files)}
              aria-describedby={fieldErrors.files ? 'upload-files-error' : undefined}
              className="sr-only peer"
            />
            <label
              htmlFor="document-files-input"
              className={`inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-[6px] border border-[#14566B] text-sm font-semibold bg-[#E9F2F5] text-[#14566B] hover:bg-[#DCEAF0] min-h-[44px] max-w-full cursor-pointer peer-focus:ring-2 peer-focus:ring-[#14566B] peer-focus:ring-offset-2 ${
                isUploading ? 'opacity-50 pointer-events-none' : ''
              }`}
            >
              <IconUpload className="w-4 h-4 shrink-0" />
              <span>اختيار ملفات أو صور</span>
            </label>
            <span className="text-xs text-[#4D606A]">
              {queue.length > 0 ? `عدد الملفات المختارة: ${queue.length}` : 'لم يتم اختيار ملفات بعد'}
            </span>
            <input
              ref={replaceInputRef}
              type="file"
              accept=".pdf,.jpg,.jpeg,.png,application/pdf,image/jpeg,image/png"
              onChange={handleReplaceFileSelected}
              className="hidden"
              tabIndex={-1}
              aria-hidden="true"
            />
          </div>
          {fieldErrors.files && (
            <p id="upload-files-error" className={`text-sm text-[#A4262C] font-medium ${MESSAGE_CLASS}`}>
              {fieldErrors.files}
            </p>
          )}
        </div>

        {/* Queued files & previews */}
        {queue.length > 0 && (
          <div className="space-y-3" data-testid="upload-queue-list">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h3 className="text-sm font-bold text-[#172A35]">
                الملفات المحددة ({queue.length})
              </h3>
              {hasReadyOrCancelled && (
                <button
                  type="button"
                  onClick={handleClearCompleted}
                  disabled={isUploading}
                  className="text-xs font-semibold text-[#14566B] hover:underline min-h-[44px] px-2 rounded-[4px] disabled:opacity-50 disabled:no-underline focus:outline-none focus-visible:ring-2 focus-visible:ring-[#14566B]"
                >
                  إزالة المكتملة من القائمة
                </button>
              )}
            </div>

            <div className="space-y-3">
              {queue.map((item, idx) => {
                const statusMeta = QUEUE_STATUS_META[item.status];
                const clientRejection = validateClientFile(item.file);
                const canRemoveOrEdit =
                  !isUploading &&
                  item.status !== 'UPLOADING' &&
                  item.status !== 'VALIDATING' &&
                  item.status !== 'READY';

                return (
                  <div
                    key={item.queueId}
                    data-testid={`upload-queue-item-${idx}`}
                    data-filename={item.file.name}
                    className="rounded-[6px] border border-[#D5DFE3] bg-[#F8FAFB] p-3 sm:p-4 space-y-3"
                  >
                    <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3 min-w-0">
                      <div className="flex flex-wrap items-start gap-3 min-w-0 flex-1">
                        {item.previewUrl && !item.previewError ? (
                          <Image
                            src={item.previewUrl}
                            alt={`معاينة الصورة المحددة: ${item.file.name}`}
                            width={88}
                            height={88}
                            unoptimized
                            data-testid={`queue-image-preview-${idx}`}
                            onError={() => updateQueueItem(item.queueId, { previewError: true })}
                            className="w-[72px] h-[72px] sm:w-[88px] sm:h-[88px] shrink-0 object-contain rounded-[4px] border border-[#D5DFE3] bg-white"
                          />
                        ) : (
                          <div
                            className="w-[64px] h-[64px] shrink-0 rounded-[4px] border border-[#D5DFE3] bg-white flex flex-col items-center justify-center text-[#14566B]"
                            aria-hidden="true"
                          >
                            <IconDocument className="w-6 h-6" />
                            <span className="text-[11px] font-mono mt-0.5">
                              {isPdfFile(item.file) ? 'PDF' : 'FILE'}
                            </span>
                          </div>
                        )}

                        <div className="min-w-0 flex-1 space-y-1">
                          <p className="text-sm font-bold text-[#172A35] break-all">
                            <bdi dir="ltr">{item.file.name}</bdi>
                          </p>
                          <p className="text-xs text-[#4D606A]">
                            الحجم: {formatFileSizeArabic(item.file.size)}
                            {item.previewError && (
                              <span className="block text-[#7A4A00] mt-0.5">
                                تعذر عرض معاينة محلية للصورة — قد لا يكون محتوى الملف صورة صالحة.
                              </span>
                            )}
                            {isPdfFile(item.file) && !clientRejection && item.status !== 'REJECTED' && (
                              <span className="block text-[#176449] mt-0.5">
                                ملف <bdi dir="ltr">PDF</bdi> جاهز للإرسال والتحقق
                              </span>
                            )}
                          </p>
                          <div className="flex flex-wrap items-center gap-2 pt-1">
                            <span
                              data-testid={`queue-item-status-${idx}`}
                              role="status"
                              aria-live="polite"
                              className={`inline-flex items-center gap-1 px-2.5 py-0.5 text-xs font-semibold rounded-[4px] border ${statusMeta.badgeClass}`}
                            >
                              {item.status === 'READY' && <IconCheck className="w-3.5 h-3.5" />}
                              {(item.status === 'REJECTED' || item.status === 'INCOMPLETE' || item.status === 'DUPLICATE_WARNING') && (
                                <IconWarning className="w-3.5 h-3.5" />
                              )}
                              <span>{statusMeta.label}</span>
                            </span>

                            {item.status === 'READY' && item.createdDocument?.currentVersion && (
                              <span
                                data-testid={`queue-item-scan-badge-${idx}`}
                                className={`inline-flex items-center gap-1 px-2.5 py-0.5 text-xs font-semibold rounded-[4px] border ${SCAN_STATUS_BADGE_CLASSES[item.createdDocument.currentVersion.scanStatus]}`}
                              >
                                {item.createdDocument.currentVersion.scanStatus === 'CLEAN' ? (
                                  <IconCheck className="w-3.5 h-3.5" />
                                ) : (
                                  <IconWarning className="w-3.5 h-3.5" />
                                )}
                                <span>{item.createdDocument.currentVersion.scanStatusLabel}</span>
                              </span>
                            )}
                          </div>
                        </div>
                      </div>

                      {canRemoveOrEdit && (
                        <div className="flex flex-wrap items-center gap-2 shrink-0">
                          <button
                            type="button"
                            aria-label={`استبدال الملف ${item.file.name}`}
                            onClick={() => handleTriggerReplaceFile(item.queueId)}
                            className="inline-flex items-center justify-center px-3 py-2 text-xs font-semibold text-[#14566B] bg-white hover:bg-[#E9F2F5] border border-[#D5DFE3] rounded-[6px] min-h-[44px] focus:outline-none focus:ring-2 focus:ring-[#14566B]"
                          >
                            استبدال الملف
                          </button>
                          <button
                            type="button"
                            data-testid={`queue-remove-${idx}`}
                            aria-label={`إزالة ${item.file.name}`}
                            onClick={() => handleRemoveQueueItem(item.queueId)}
                            className="inline-flex items-center justify-center px-3 py-2 text-xs font-semibold text-[#A4262C] bg-white hover:bg-red-50 border border-red-200 rounded-[6px] min-h-[44px] focus:outline-none focus:ring-2 focus:ring-[#A4262C]"
                          >
                            إزالة
                          </button>
                        </div>
                      )}
                    </div>

                    {/* Individual editable title when multiple files are pending */}
                    {pendingQueue.length > 1 && isPending(item) && (
                      <div className="pt-1">
                        <label
                          htmlFor={`queue-title-${item.queueId}`}
                          className="block text-xs font-semibold text-[#4D606A] mb-1"
                        >
                          عنوان هذا المستند المنفصل
                        </label>
                        <input
                          id={`queue-title-${item.queueId}`}
                          type="text"
                          maxLength={MAX_DOCUMENT_TITLE_LENGTH}
                          value={
                            item.itemTitleEdited
                              ? item.itemTitle
                              : resolveEffectiveTitle(item, pendingQueue)
                          }
                          disabled={
                            isUploading ||
                            item.status === 'INCOMPLETE' ||
                            (Boolean(item.attemptId) && item.status !== 'REJECTED')
                          }
                          onChange={(e) =>
                            updateQueueItem(item.queueId, {
                              itemTitle: e.target.value,
                              itemTitleEdited: true,
                            })
                          }
                          className="w-full min-h-[44px] px-3 py-2 text-sm bg-white text-[#172A35] border border-[#6E828C] rounded-[6px] focus:outline-none focus:ring-2 focus:ring-[#14566B] disabled:bg-[#F4F6F7] disabled:opacity-70"
                        />
                      </div>
                    )}

                    {/* Error / Incomplete recovery */}
                    {(item.status === 'INCOMPLETE' || item.status === 'REJECTED') && item.errorMessage && (
                      <div
                        role="alert"
                        data-testid={`queue-item-error-${idx}`}
                        className="p-3 rounded-[6px] bg-red-50 border border-red-200 text-sm text-[#A4262C] flex flex-col sm:flex-row sm:items-center justify-between gap-3"
                      >
                        <span className={MESSAGE_CLASS}>{item.errorMessage}</span>
                        {!clientRejection && (
                          <button
                            type="button"
                            data-testid={`queue-retry-${idx}`}
                            aria-label={`إعادة المحاولة للملف ${item.file.name}`}
                            onClick={() => handleRetryQueueItem(item.queueId)}
                            disabled={isUploading}
                            className="inline-flex items-center justify-center gap-1.5 px-4 py-2 bg-[#14566B] hover:bg-[#0F4354] text-white text-xs font-semibold rounded-[6px] min-h-[44px] shrink-0 disabled:opacity-50 focus:outline-none focus:ring-2 focus:ring-[#14566B]"
                          >
                            <IconRefresh className="w-4 h-4" />
                            <span>إعادة المحاولة</span>
                          </button>
                        )}
                      </div>
                    )}

                    {/* Duplicate SHA-256 warning */}
                    {item.status === 'DUPLICATE_WARNING' && (
                      <div
                        role="alert"
                        data-testid={`queue-duplicate-warning-${idx}`}
                        className="p-3 rounded-[6px] bg-[#FFF7E6] border border-[#E0B46A] text-sm text-[#7A4A00] space-y-2.5"
                      >
                        <p className={`font-bold ${MESSAGE_CLASS}`}>{item.errorMessage}</p>
                        {item.duplicateMatches.length > 0 && (
                          <ul className="list-disc list-inside space-y-1 text-xs text-[#172A35]">
                            {item.duplicateMatches.map((match) => (
                              <li key={match.versionId} className={MESSAGE_CLASS}>
                                <Link href={`/documents/${match.documentId}`} className={INLINE_LINK_CLASS}>
                                  {match.title}
                                </Link>{' '}
                                (<bdi dir="ltr">{match.originalFilename}</bdi>)
                                {match.matterFileCode ? (
                                  <span>
                                    {' '}
                                    — قضية <bdi dir="ltr">{match.matterFileCode}</bdi>
                                  </span>
                                ) : match.partyName ? (
                                  <span> — طرف: {match.partyName}</span>
                                ) : null}
                              </li>
                            ))}
                          </ul>
                        )}
                        <div className="flex flex-wrap items-center gap-2 pt-1">
                          <button
                            type="button"
                            data-testid={`queue-confirm-duplicate-${idx}`}
                            aria-label={`تأكيد رفع نسخة منفصلة من الملف ${item.file.name}`}
                            onClick={() => handleConfirmDuplicate(item.queueId)}
                            disabled={isUploading}
                            className="inline-flex items-center justify-center px-4 py-2 bg-[#14566B] hover:bg-[#0F4354] text-white text-xs font-semibold rounded-[6px] min-h-[44px] disabled:opacity-50 focus:outline-none focus:ring-2 focus:ring-[#14566B]"
                          >
                            تأكيد رفع نسخة منفصلة
                          </button>
                          <button
                            type="button"
                            data-testid={`queue-cancel-duplicate-${idx}`}
                            aria-label={`إلغاء رفع الملف ${item.file.name}`}
                            onClick={() => handleCancelDuplicate(item.queueId)}
                            disabled={isUploading}
                            className="inline-flex items-center justify-center px-4 py-2 bg-white hover:bg-[#F4F6F7] text-[#172A35] border border-[#D5DFE3] text-xs font-semibold rounded-[6px] min-h-[44px] disabled:opacity-50 focus:outline-none focus:ring-2 focus:ring-[#14566B]"
                          >
                            إلغاء
                          </button>
                        </div>
                      </div>
                    )}

                    {/* Success link */}
                    {item.status === 'READY' && item.createdDocument && (
                      <div
                        data-testid={`queue-ready-summary-${idx}`}
                        role="status"
                        aria-live="polite"
                        className="p-3 rounded-[6px] bg-emerald-50 border border-emerald-200 text-sm text-[#176449] flex flex-wrap items-center justify-between gap-2"
                      >
                        <span className={MESSAGE_CLASS}>
                          تم اعتماد المستند وحفظه في الأرشيف الخاص ({item.createdDocument.title}).
                        </span>
                        <Link
                          href={`/documents/${item.createdDocument.id}`}
                          data-testid={`queue-ready-link-${idx}`}
                          className="inline-flex items-center justify-center px-4 py-2 bg-white hover:bg-[#E9F2F5] text-[#14566B] border border-[#14566B] text-xs font-bold rounded-[6px] min-h-[44px] focus:outline-none focus:ring-2 focus:ring-[#14566B]"
                        >
                          فتح ومعاينة المستند
                        </Link>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {metadataLocked && (
          <div
            role="status"
            data-testid="upload-metadata-locked-note"
            className={`rounded-[6px] bg-[#FFF7E6] border border-[#E0B46A] px-3 py-2 text-xs text-[#7A4A00] ${MESSAGE_CLASS}`}
          >
            البيانات الأساسية مقفلة مؤقتاً لوجود محاولة رفع تنتظر إعادة المحاولة أو تأكيد التطابق. أكمل الإجراء أو أزِل الملف لتعديل البيانات.
          </div>
        )}

        {/* Link Target Selection */}
        <fieldset className="space-y-3 pt-2 border-t border-[#D5DFE3] min-w-0">
          <legend className="text-sm font-bold text-[#172A35] px-1">
            ربط المستند بجهة محفوظة *
          </legend>
          <div className="flex flex-wrap gap-3">
            <label className={RADIO_LABEL_CLASS}>
              <input
                type="radio"
                name="document-link-mode"
                value="MATTER"
                checked={linkMode === 'MATTER'}
                disabled={metadataDisabled}
                onChange={() => {
                  setLinkMode('MATTER');
                  setPartyId('');
                  clearFieldError('partyId');
                }}
                className="w-4 h-4 accent-[#14566B]"
              />
              <span className="text-sm font-semibold text-[#172A35]">قضية</span>
            </label>

            <label className={RADIO_LABEL_CLASS}>
              <input
                type="radio"
                name="document-link-mode"
                value="PARTY"
                checked={linkMode === 'PARTY'}
                disabled={metadataDisabled}
                onChange={() => {
                  setLinkMode('PARTY');
                  setMatterId('');
                  setProceedingId('');
                  clearFieldError('matterId');
                }}
                className="w-4 h-4 accent-[#14566B]"
              />
              <span className="text-sm font-semibold text-[#172A35]">طرف / موكل</span>
            </label>
          </div>

          {linkMode === 'MATTER' ? (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 min-w-0">
              <div className="min-w-0">
                <label
                  htmlFor="upload-matter-select"
                  className="block text-sm font-semibold text-[#172A35] mb-1.5"
                >
                  ملف القضية *
                </label>
                <select
                  ref={matterSelectRef}
                  id="upload-matter-select"
                  data-testid="upload-matter-select"
                  value={matterId}
                  disabled={metadataDisabled}
                  aria-invalid={Boolean(fieldErrors.matterId)}
                  aria-describedby={fieldErrors.matterId ? 'upload-matter-error' : undefined}
                  onChange={(e) => {
                    setMatterId(e.target.value);
                    setProceedingId('');
                    clearFieldError('matterId');
                  }}
                  className={INPUT_CLASS}
                >
                  <option value="">— اختر ملف القضية —</option>
                  {selectableMatters.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.fileCode} — {m.title}
                    </option>
                  ))}
                </select>
                {fieldErrors.matterId && (
                  <p id="upload-matter-error" className={FIELD_ERROR_CLASS}>
                    {fieldErrors.matterId}
                  </p>
                )}
              </div>

              <div className="min-w-0">
                <label
                  htmlFor="upload-proceeding-select"
                  className="block text-sm font-semibold text-[#172A35] mb-1.5"
                >
                  القيد القضائي / الدرجة (اختياري)
                </label>
                <select
                  id="upload-proceeding-select"
                  data-testid="upload-proceeding-select"
                  value={proceedingId}
                  disabled={metadataDisabled || !matterId || availableProceedings.length === 0}
                  onChange={(e) => setProceedingId(e.target.value)}
                  className={INPUT_CLASS}
                >
                  <option value="">
                    {!matterId
                      ? 'اختر القضية أولاً'
                      : availableProceedings.length === 0
                        ? 'لا توجد قيود مسجلة لهذه القضية'
                        : '— بدون ربط بقيد محدد —'}
                  </option>
                  {availableProceedings.map((proc) => (
                    <option key={proc.id} value={proc.id}>
                      {proc.label}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          ) : (
            <div>
              <label
                htmlFor="upload-party-select"
                className="block text-sm font-semibold text-[#172A35] mb-1.5"
              >
                الطرف / الموكل *
              </label>
              <select
                ref={partySelectRef}
                id="upload-party-select"
                data-testid="upload-party-select"
                value={partyId}
                disabled={metadataDisabled}
                aria-invalid={Boolean(fieldErrors.partyId)}
                aria-describedby={fieldErrors.partyId ? 'upload-party-error' : undefined}
                onChange={(e) => {
                  setPartyId(e.target.value);
                  clearFieldError('partyId');
                }}
                className={INPUT_CLASS}
              >
                <option value="">— اختر الطرف أو الموكل —</option>
                {selectableParties.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
              {fieldErrors.partyId && (
                <p id="upload-party-error" className={FIELD_ERROR_CLASS}>
                  {fieldErrors.partyId}
                </p>
              )}
            </div>
          )}
        </fieldset>

        {/* Core Metadata Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 min-w-0">
          <div className="min-w-0">
            <label
              htmlFor="upload-title-input"
              className="block text-sm font-semibold text-[#172A35] mb-1.5"
            >
              عنوان المستند {pendingQueue.length > 1 ? '(عنوان أساسي اختياري للدفعة)' : '*'}
            </label>
            <input
              ref={titleInputRef}
              id="upload-title-input"
              data-testid="upload-title-input"
              type="text"
              value={title}
              disabled={metadataDisabled}
              maxLength={MAX_DOCUMENT_TITLE_LENGTH}
              aria-invalid={Boolean(fieldErrors.title)}
              aria-describedby={fieldErrors.title ? 'upload-title-error' : undefined}
              placeholder={
                pendingQueue.length > 1
                  ? 'اختياري: يُستخدم كأساس مرقّم أو اسم كل ملف'
                  : 'يُقترح تلقائياً من اسم الملف عند اختياره'
              }
              onChange={(e) => {
                titleEditedManuallyRef.current = e.target.value.trim().length > 0;
                setTitle(e.target.value);
                clearFieldError('title');
              }}
              className={INPUT_CLASS}
            />
            {fieldErrors.title && (
              <p id="upload-title-error" className={FIELD_ERROR_CLASS}>
                {fieldErrors.title}
              </p>
            )}
          </div>

          <div className="min-w-0">
            <label
              htmlFor="upload-type-select"
              className="block text-sm font-semibold text-[#172A35] mb-1.5"
            >
              نوع المستند *
            </label>
            <select
              id="upload-type-select"
              data-testid="upload-type-select"
              value={documentType}
              disabled={metadataDisabled}
              onChange={(e) => setDocumentType(e.target.value as DocumentType)}
              className={INPUT_CLASS}
            >
              {DOCUMENT_TYPE_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </div>

          <div className="min-w-0">
            <label
              htmlFor="upload-date-input"
              className="block text-sm font-semibold text-[#172A35] mb-1.5"
            >
              تاريخ المستند (اختياري)
            </label>
            <input
              id="upload-date-input"
              data-testid="upload-date-input"
              type="date"
              dir="ltr"
              value={documentDate}
              disabled={metadataDisabled}
              onChange={(e) => setDocumentDate(e.target.value)}
              className={INPUT_CLASS}
            />
          </div>

          <div className="min-w-0">
            <label
              htmlFor="upload-sensitivity-select"
              className="block text-sm font-semibold text-[#172A35] mb-1.5"
            >
              درجة السرية *
            </label>
            <select
              id="upload-sensitivity-select"
              data-testid="upload-sensitivity-select"
              value={sensitivity}
              disabled={metadataDisabled}
              onChange={(e) => setSensitivity(e.target.value as DocumentSensitivity)}
              className={INPUT_CLASS}
            >
              {SENSITIVITY_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </div>

          <div className="min-w-0">
            <label
              htmlFor="upload-original-present-select"
              className="block text-sm font-semibold text-[#172A35] mb-1.5"
            >
              هل الأصل الورقي موجود بالمكتب؟
            </label>
            <select
              id="upload-original-present-select"
              data-testid="upload-original-present-select"
              value={originalPresent}
              disabled={metadataDisabled}
              onChange={(e) => setOriginalPresent(e.target.value as DocumentOriginalPresence)}
              className={INPUT_CLASS}
            >
              {ORIGINAL_PRESENCE_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </div>

          <div className="min-w-0">
            <label
              htmlFor="upload-original-location-input"
              className="block text-sm font-semibold text-[#172A35] mb-1.5"
            >
              مكان حفظ الأصل الورقي (اختياري)
            </label>
            <input
              id="upload-original-location-input"
              data-testid="upload-original-location-input"
              type="text"
              maxLength={300}
              value={originalLocation}
              disabled={metadataDisabled}
              placeholder="مثال: دولاب القضايا المدني — رف 3"
              onChange={(e) => setOriginalLocation(e.target.value)}
              className={INPUT_CLASS}
            />
          </div>
        </div>

        <div>
          <label
            htmlFor="upload-description-input"
            className="block text-sm font-semibold text-[#172A35] mb-1.5"
          >
            وصف وملاحظات المستند (اختياري)
          </label>
          <textarea
            id="upload-description-input"
            data-testid="upload-description-input"
            rows={2}
            maxLength={2000}
            value={description}
            disabled={metadataDisabled}
            onChange={(e) => setDescription(e.target.value)}
            className="w-full px-3 py-2 text-base bg-white text-[#172A35] border border-[#6E828C] rounded-[6px] focus:outline-none focus:ring-2 focus:ring-[#14566B] focus:border-[#14566B] disabled:bg-[#F4F6F7] disabled:opacity-70"
          />
        </div>

        <div className="flex flex-wrap items-center justify-end gap-3 pt-2 border-t border-[#D5DFE3]">
          {onlyDuplicateWarnings && (
            <p
              role="status"
              data-testid="upload-duplicate-pending-note"
              className={`text-xs text-[#7A4A00] me-auto ${MESSAGE_CLASS}`}
            >
              الملفات المتبقية بانتظار قرارك بشأن تطابق بصمة <bdi dir="ltr">SHA-256</bdi> أعلاه.
            </p>
          )}
          <button
            type="submit"
            data-testid="upload-submit-button"
            disabled={isUploading || onlyDuplicateWarnings}
            aria-busy={isUploading}
            className="inline-flex items-center justify-center gap-2 px-6 py-2.5 bg-[#14566B] hover:bg-[#0F4354] disabled:opacity-50 text-white font-semibold text-sm rounded-[6px] shadow-xs transition-colors min-h-[44px] focus:outline-none focus:ring-2 focus:ring-[#14566B] focus:ring-offset-2"
          >
            <IconUpload className="w-4 h-4" />
            <span>{isUploading ? 'جارٍ الرفع والتحقق...' : 'بدء الرفع والحفظ'}</span>
          </button>
        </div>
      </form>
    </section>
  );
}

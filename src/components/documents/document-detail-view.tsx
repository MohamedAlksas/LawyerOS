'use client';

import React, { useEffect, useRef, useState } from 'react';
import Image from 'next/image';
import { useRouter } from 'next/navigation';
import type {
  DocumentActionResult,
  DocumentDetailDTO,
  DocumentOriginalPresence,
  DocumentSensitivity,
  DocumentType,
  DocumentVersionDTO,
  DuplicateChecksumMatchDTO,
  UploadAttemptDTO,
} from '@/modules/documents/document-types';
import { formatCairoDateArabic } from '@/lib/cairo-date';
import { generateClientRequestId } from '@/components/matters/matter-ui-types';
import { GuardedLink as Link, useLeaveGuard } from '@/components/navigation-guard';
import {
  IconCheck,
  IconClock,
  IconDocument,
  IconDownload,
  IconRefresh,
  IconUpload,
  IconWarning,
} from '@/components/stitch-icons';
import {
  DOCUMENT_FIELD_ERROR_CLASS as FIELD_ERROR_CLASS,
  DOCUMENT_INPUT_CLASS as INPUT_CLASS,
  DOCUMENT_MESSAGE_CLASS as MESSAGE_CLASS,
  DOCUMENT_NETWORK_ERROR_MESSAGE as NETWORK_ERROR_MESSAGE,
  DOCUMENT_SESSION_EXPIRED_MESSAGE as SESSION_EXPIRED_MESSAGE,
  DOCUMENT_TYPE_LABELS_AR,
  DOCUMENT_TYPE_OPTIONS,
  DOWNLOAD_DEVICE_RETENTION_NOTICE_AR,
  MAX_DOCUMENT_TITLE_LENGTH,
  ORIGINAL_PRESENCE_LABELS,
  ORIGINAL_PRESENCE_OPTIONS,
  QUEUE_STATUS_META,
  SCAN_STATUS_BADGE_CLASSES,
  SENSITIVITY_BADGE_CLASSES,
  SENSITIVITY_LABELS,
  SENSITIVITY_OPTIONS,
  UNSCANNED_POLICY_NOTICE_AR,
  classifyUploadFailure,
  formatCairoInstantArabic,
  formatFileSizeArabic,
  isPdfFile,
  isPreviewableImageFile,
  resolveDeclaredMime,
  validateClientFile,
  type QueueUploadStatus,
} from './document-ui-helpers';

export interface DocumentDetailViewProps {
  document: DocumentDetailDTO;
  canWriteDocuments?: boolean;
}

interface VersionCandidateState {
  file: File;
  localPreviewUrl: string | null;
  localPreviewError: boolean;
  status: QueueUploadStatus;
  errorMessage: string | null;
  isConcurrencyConflict: boolean;
  attemptId?: string;
  sentExpectedVersion?: number;
  contentUploaded: boolean;
  pendingConfirmDuplicate: boolean;
  duplicateMatches: DuplicateChecksumMatchDTO[];
  beginIdempotencyKey: string;
  finalizeIdempotencyKey: string;
  confirmDuplicateIdempotencyKey: string;
}

interface MetadataSnapshot {
  title: string;
  documentType: DocumentType;
  documentDate: string;
  sensitivity: DocumentSensitivity;
  originalPresent: DocumentOriginalPresence;
  originalLocation: string;
  description: string;
}

interface FrozenMetadataRequest {
  expectedVersion: number;
  idempotencyKey: string;
  payload: {
    expectedVersion: number;
    idempotencyKey: string;
    title: string;
    documentType: DocumentType;
    documentDate: string | null;
    description: string | null;
    originalPresent: DocumentOriginalPresence;
    originalLocation: string | null;
    sensitivity: DocumentSensitivity;
  };
}

const INLINE_LINK_CLASS =
  'text-[#14566B] hover:underline rounded-[4px] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#14566B]';

function snapshotFromDocument(doc: DocumentDetailDTO): MetadataSnapshot {
  return {
    title: doc.title,
    documentType: doc.documentType,
    documentDate: doc.documentDate ?? '',
    sensitivity: doc.sensitivity,
    originalPresent: doc.originalPresent,
    originalLocation: doc.originalLocation ?? '',
    description: doc.description ?? '',
  };
}

function normalizeNullableText(value: string): string | null {
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function isSameMetadata(draft: MetadataSnapshot, doc: DocumentDetailDTO): boolean {
  return (
    draft.title.trim() === doc.title.trim() &&
    draft.documentType === doc.documentType &&
    normalizeNullableText(draft.documentDate) === (doc.documentDate ?? null) &&
    draft.sensitivity === doc.sensitivity &&
    draft.originalPresent === doc.originalPresent &&
    normalizeNullableText(draft.originalLocation) === (doc.originalLocation ?? null) &&
    normalizeNullableText(draft.description) === (doc.description ?? null)
  );
}

function makeFreshVersionKeys() {
  return {
    attemptId: undefined,
    sentExpectedVersion: undefined,
    contentUploaded: false,
    pendingConfirmDuplicate: false,
    duplicateMatches: [] as DuplicateChecksumMatchDTO[],
    isConcurrencyConflict: false,
    beginIdempotencyKey: generateClientRequestId('doc-ver-begin'),
    finalizeIdempotencyKey: generateClientRequestId('doc-ver-fin'),
    confirmDuplicateIdempotencyKey: generateClientRequestId('doc-ver-dup'),
  };
}

function formatShortSha256(sha256: string | null): string {
  if (!sha256) return '—';
  return sha256.length > 16 ? `${sha256.slice(0, 16)}…` : sha256;
}

export function DocumentDetailView({
  document: initialDocument,
  canWriteDocuments = false,
}: DocumentDetailViewProps) {
  const router = useRouter();
  const propStamp = `${initialDocument.version}:${initialDocument.updatedAt}`;
  const [prevPropStamp, setPrevPropStamp] = useState(propStamp);
  const [docState, setDocState] = useState<DocumentDetailDTO>(initialDocument);
  const [selectedVersionId, setSelectedVersionId] = useState<string | null>(
    initialDocument.currentVersionId
  );
  const [imageLoadError, setImageLoadError] = useState(false);
  const [imageRetryNonce, setImageRetryNonce] = useState(0);

  // Add New Version state
  const [candidate, setCandidate] = useState<VersionCandidateState | null>(null);
  const [isUploadingVersion, setIsUploadingVersion] = useState(false);
  const [versionSuccessMessage, setVersionSuccessMessage] = useState<string | null>(null);
  const versionInputRef = useRef<HTMLInputElement>(null);
  const candidateRef = useRef<VersionCandidateState | null>(null);
  const uploadAbortRef = useRef<AbortController | null>(null);
  const refreshAbortRef = useRef<AbortController | null>(null);
  const refreshSeqRef = useRef(0);

  // Paper original & metadata editor state
  const [draft, setDraft] = useState<MetadataSnapshot>(() => snapshotFromDocument(initialDocument));
  const [isSavingMetadata, setIsSavingMetadata] = useState(false);
  const [metadataError, setMetadataError] = useState<string | null>(null);
  const [metadataFieldErrors, setMetadataFieldErrors] = useState<Record<string, string>>({});
  const [metadataConflict, setMetadataConflict] = useState(false);
  const [metadataSuccessMessage, setMetadataSuccessMessage] = useState<string | null>(null);
  const [metadataIdempotencyKey, setMetadataIdempotencyKey] = useState(() =>
    generateClientRequestId('doc-meta')
  );
  const [frozenMetadataRequest, setFrozenMetadataRequest] =
    useState<FrozenMetadataRequest | null>(null);
  const [isRefreshingDetail, setIsRefreshingDetail] = useState(false);
  const [refreshError, setRefreshError] = useState<string | null>(null);

  const isMountedRef = useRef(false);
  const docStateRef = useRef<DocumentDetailDTO>(initialDocument);
  const draftRef = useRef<MetadataSnapshot>(draft);
  const metadataTitleInputRef = useRef<HTMLInputElement>(null);
  const metadataTypeSelectRef = useRef<HTMLSelectElement>(null);
  const metadataDateInputRef = useRef<HTMLInputElement>(null);
  const metadataSensitivitySelectRef = useRef<HTMLSelectElement>(null);
  const metadataOriginalPresentSelectRef = useRef<HTMLSelectElement>(null);
  const metadataOriginalLocationInputRef = useRef<HTMLInputElement>(null);
  const metadataDescriptionInputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    docStateRef.current = docState;
  }, [docState]);

  useEffect(() => {
    draftRef.current = draft;
  }, [draft]);

  // Reconcile local state when Next.js router.refresh() delivers updated server props.
  if (propStamp !== prevPropStamp) {
    setPrevPropStamp(propStamp);
    if (
      initialDocument.version > docState.version ||
      (initialDocument.version === docState.version &&
        initialDocument.updatedAt >= docState.updatedAt)
    ) {
      setDocState(initialDocument);
      if (
        !selectedVersionId ||
        selectedVersionId === docState.currentVersionId ||
        !initialDocument.versions.some((v) => v.id === selectedVersionId)
      ) {
        setSelectedVersionId(initialDocument.currentVersionId);
      }
      if (isSameMetadata(draft, docState)) {
        setDraft(snapshotFromDocument(initialDocument));
      }
    }
  }

  const isArchived = Boolean(docState.archivedAt);
  const isReadOnly = isArchived || !canWriteDocuments;
  const isMetadataDirty = !isSameMetadata(draft, docState);

  const hasUnsavedVersionCandidate = Boolean(
    candidate &&
      candidate.status !== 'READY' &&
      candidate.status !== 'CANCELLED' &&
      candidate.status !== 'REJECTED'
  );
  const hasDirtyState = isMetadataDirty || hasUnsavedVersionCandidate || Boolean(frozenMetadataRequest);
  const inFlightPending = isUploadingVersion || isSavingMetadata;

  useLeaveGuard(!isReadOnly && hasDirtyState, !isReadOnly && inFlightPending);

  const syncCandidate = (
    updater:
      | VersionCandidateState
      | null
      | ((prev: VersionCandidateState | null) => VersionCandidateState | null)
  ) => {
    const next = typeof updater === 'function' ? updater(candidateRef.current) : updater;
    candidateRef.current = next;
    setCandidate(next);
    return next;
  };

  useEffect(() => {
    isMountedRef.current = true;
    uploadAbortRef.current = new AbortController();
    return () => {
      isMountedRef.current = false;
      uploadAbortRef.current?.abort();
      refreshAbortRef.current?.abort();
      if (candidateRef.current?.localPreviewUrl) {
        URL.revokeObjectURL(candidateRef.current.localPreviewUrl);
      }
    };
  }, []);

  const versions: DocumentVersionDTO[] = [
    ...(docState.versions && docState.versions.length > 0
      ? docState.versions
      : docState.currentVersion
        ? [docState.currentVersion]
        : []),
  ].sort((a, b) => b.versionNumber - a.versionNumber);

  const currentVersion =
    docState.currentVersion ??
    versions.find((v) => v.id === docState.currentVersionId) ??
    versions[0] ??
    null;

  const previewVersion =
    versions.find((v) => v.id === selectedVersionId) ?? currentVersion;

  const isImage =
    previewVersion?.detectedMime === 'image/jpeg' || previewVersion?.detectedMime === 'image/png';
  const isPdf = previewVersion?.detectedMime === 'application/pdf';
  const currentScanBadgeClass = currentVersion
    ? SCAN_STATUS_BADGE_CLASSES[currentVersion.scanStatus]
    : SCAN_STATUS_BADGE_CLASSES.PENDING;
  const currentScanLabel = currentVersion?.scanStatusLabel ?? UNSCANNED_POLICY_NOTICE_AR;
  const downloadNotice = docState.downloadDeviceNotice || DOWNLOAD_DEVICE_RETENTION_NOTICE_AR;

  const inlineUrl = previewVersion
    ? `/api/documents/${docState.id}/content?disposition=inline&versionId=${previewVersion.id}`
    : null;
  const imageSrc =
    inlineUrl && imageRetryNonce > 0 ? `${inlineUrl}&retry=${imageRetryNonce}` : inlineUrl;
  const downloadUrl = previewVersion
    ? `/api/documents/${docState.id}/content?disposition=attachment&versionId=${previewVersion.id}`
    : null;

  const applyLatestDetail = (nextDoc: DocumentDetailDTO, options?: { syncDraft?: boolean }) => {
    const prevDoc = docStateRef.current;
    if (nextDoc.version < prevDoc.version) return;
    const currentDraft = draftRef.current;
    const prevCurrentId = prevDoc.currentVersionId;
    docStateRef.current = nextDoc;
    setDocState(nextDoc);
    setSelectedVersionId((curr) => {
      if (!curr || curr === prevCurrentId) {
        return nextDoc.currentVersionId;
      }
      const stillExists = nextDoc.versions?.some((v) => v.id === curr);
      return stillExists ? curr : nextDoc.currentVersionId;
    });
    if (options?.syncDraft || isSameMetadata(currentDraft, prevDoc)) {
      const nextSnapshot = snapshotFromDocument(nextDoc);
      draftRef.current = nextSnapshot;
      setDraft(nextSnapshot);
    }
    setImageLoadError(false);
    setImageRetryNonce(0);
  };

  const refreshDocumentDetail = async (options?: {
    resetVersionConflict?: boolean;
    syncDraft?: boolean;
  }) => {
    refreshAbortRef.current?.abort();
    const controller = new AbortController();
    refreshAbortRef.current = controller;
    const seq = ++refreshSeqRef.current;

    setIsRefreshingDetail(true);
    setRefreshError(null);
    try {
      const res = await fetch(`/api/documents/${docStateRef.current.id}`, {
        cache: 'no-store',
        signal: controller.signal,
      });
      if (controller.signal.aborted || seq !== refreshSeqRef.current) return;
      if (res.status === 401) {
        if (typeof window !== 'undefined') {
          window.dispatchEvent(new Event('lawoffice:recheck-session'));
        }
        if (isMountedRef.current) {
          setRefreshError(SESSION_EXPIRED_MESSAGE);
        }
        return;
      }
      const body = (await res.json().catch(() => null)) as
        | DocumentActionResult<DocumentDetailDTO>
        | null;
      if (controller.signal.aborted || !isMountedRef.current || seq !== refreshSeqRef.current) return;
      if (!res.ok || !body || !body.success) {
        const failureBody = body && !body.success ? body : null;
        setRefreshError(
          failureBody?.error ?? 'تعذر تحديث بيانات المستند. يرجى المحاولة مرة أخرى.'
        );
        return;
      }
      applyLatestDetail(body.data, { syncDraft: options?.syncDraft });
      if (options?.resetVersionConflict && candidateRef.current) {
        syncCandidate((prev) =>
          prev
            ? {
                ...prev,
                ...makeFreshVersionKeys(),
                status: 'QUEUED',
                errorMessage: null,
              }
            : null
        );
      }
      if (options?.syncDraft) {
        setMetadataConflict(false);
        setFrozenMetadataRequest(null);
        setMetadataIdempotencyKey(generateClientRequestId('doc-meta'));
        setMetadataError(null);
        setMetadataFieldErrors({});
      }
      router.refresh();
    } catch {
      if (controller.signal.aborted || !isMountedRef.current || seq !== refreshSeqRef.current) return;
      setRefreshError(NETWORK_ERROR_MESSAGE);
    } finally {
      if (refreshAbortRef.current === controller) {
        refreshAbortRef.current = null;
      }
      if (isMountedRef.current && seq === refreshSeqRef.current) {
        setIsRefreshingDetail(false);
      }
    }
  };

  const handleImageError = () => {
    setImageLoadError(true);
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new Event('lawoffice:recheck-session'));
    }
  };

  const handleImageRetry = () => {
    setImageLoadError(false);
    setImageRetryNonce((n) => n + 1);
  };

  const handleSelectPreviewVersion = (ver: DocumentVersionDTO) => {
    setSelectedVersionId(ver.id);
    setImageLoadError(false);
    setImageRetryNonce(0);
    const previewHeading = window.document.getElementById('document-preview-heading');
    const prefersReducedMotion =
      typeof window !== 'undefined' &&
      typeof window.matchMedia === 'function' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    previewHeading?.scrollIntoView({
      behavior: prefersReducedMotion ? 'auto' : 'smooth',
      block: 'start',
    });
  };

  // =========================================================================
  // Add New Version Handlers
  // =========================================================================

  const handleVersionFileSelected = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file || isUploadingVersion || isReadOnly) return;

    if (candidateRef.current?.localPreviewUrl) {
      URL.revokeObjectURL(candidateRef.current.localPreviewUrl);
    }

    setVersionSuccessMessage(null);
    const rejection = validateClientFile(file);
    const localPreviewUrl =
      !rejection && isPreviewableImageFile(file) && typeof URL !== 'undefined' && URL.createObjectURL
        ? URL.createObjectURL(file)
        : null;

    syncCandidate({
      file,
      localPreviewUrl,
      localPreviewError: false,
      status: rejection ? 'REJECTED' : 'QUEUED',
      errorMessage: rejection,
      ...makeFreshVersionKeys(),
    });
  };

  const handleClearCandidate = () => {
    if (isUploadingVersion) return;
    if (candidateRef.current?.localPreviewUrl) {
      URL.revokeObjectURL(candidateRef.current.localPreviewUrl);
    }
    syncCandidate(null);
  };

  const runVersionFinalize = async (
    attemptId: string,
    confirmDuplicate: boolean,
    finalizeKey: string
  ): Promise<void> => {
    syncCandidate((prev) =>
      prev
        ? {
            ...prev,
            status: 'VALIDATING',
            errorMessage: null,
            isConcurrencyConflict: false,
            pendingConfirmDuplicate: confirmDuplicate,
          }
        : null
    );

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
        | DocumentActionResult<DocumentDetailDTO>
        | null;
      if (!isMountedRef.current) return;

      if (
        response.status === 409 &&
        body &&
        !body.success &&
        body.code === 'DUPLICATE_CHECKSUM_WARNING'
      ) {
        syncCandidate((prev) =>
          prev
            ? {
                ...prev,
                status: 'DUPLICATE_WARNING',
                errorMessage: body.error,
                duplicateMatches: body.existingDocuments ?? [],
                pendingConfirmDuplicate: false,
              }
            : null
        );
        return;
      }

      if (!response.ok || !body || !body.success) {
        const failure = classifyUploadFailure(
          response.status,
          body && !body.success ? body : null,
          'تعذر إتمام التحقق من الإصدار الجديد على الخادم.'
        );
        syncCandidate((prev) => {
          if (!prev) return null;
          if (failure.status === 'REJECTED') {
            return {
              ...prev,
              ...makeFreshVersionKeys(),
              status: 'REJECTED',
              errorMessage: failure.message,
              isConcurrencyConflict: false,
            };
          }
          return {
            ...prev,
            status: failure.status,
            errorMessage: failure.message,
            isConcurrencyConflict: failure.isConcurrencyConflict,
          };
        });
        return;
      }

      const updatedDoc = body.data;
      if (candidateRef.current?.localPreviewUrl) {
        URL.revokeObjectURL(candidateRef.current.localPreviewUrl);
      }
      syncCandidate(null);
      applyLatestDetail(updatedDoc);
      const nextVerNum = updatedDoc.currentVersion?.versionNumber;
      setVersionSuccessMessage(
        nextVerNum
          ? `تم اعتماد الإصدار رقم ${nextVerNum} بنجاح وأصبح هو الإصدار الحالي.`
          : 'تم اعتماد الإصدار الجديد بنجاح.'
      );
      router.refresh();
    } catch {
      if (!isMountedRef.current) return;
      syncCandidate((prev) =>
        prev
          ? {
              ...prev,
              status: 'INCOMPLETE',
              errorMessage: NETWORK_ERROR_MESSAGE,
              isConcurrencyConflict: false,
            }
          : null
      );
    }
  };

  const executeVersionUpload = async (isRetry = false) => {
    const current = candidateRef.current;
    if (!current || isUploadingVersion || isReadOnly) return;

    const clientRejection = validateClientFile(current.file);
    if (clientRejection) {
      syncCandidate((prev) =>
        prev ? { ...prev, status: 'REJECTED', errorMessage: clientRejection } : null
      );
      return;
    }

    setVersionSuccessMessage(null);
    setIsUploadingVersion(true);

    try {
      let working = candidateRef.current;
      if (!working) return;

      if (!isRetry && working.status === 'REJECTED') {
        working = syncCandidate((prev) =>
          prev ? { ...prev, ...makeFreshVersionKeys(), status: 'QUEUED', errorMessage: null } : null
        );
      } else if (working.isConcurrencyConflict) {
        working = syncCandidate((prev) =>
          prev ? { ...prev, ...makeFreshVersionKeys(), status: 'QUEUED', errorMessage: null } : null
        );
      }
      if (!working) return;

      let attemptId = working.attemptId;
      let contentUploaded = working.contentUploaded;

      if (working.pendingConfirmDuplicate && attemptId && contentUploaded) {
        await runVersionFinalize(attemptId, true, working.confirmDuplicateIdempotencyKey);
        return;
      }

      if (!attemptId) {
        const expectedDocumentVersion = working.sentExpectedVersion ?? docStateRef.current.version;
        syncCandidate((prev) =>
          prev
            ? {
                ...prev,
                status: 'UPLOADING',
                errorMessage: null,
                isConcurrencyConflict: false,
                sentExpectedVersion: expectedDocumentVersion,
              }
            : null
        );

        try {
          const beginRes = await fetch(`/api/documents/${docState.id}/versions`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            signal: uploadAbortRef.current?.signal,
            body: JSON.stringify({
              expectedDocumentVersion,
              originalFilename: working.file.name,
              declaredMime: resolveDeclaredMime(working.file),
              expectedSizeBytes: working.file.size,
              idempotencyKey: working.beginIdempotencyKey,
            }),
          });

          if (beginRes.status === 401 && typeof window !== 'undefined') {
            window.dispatchEvent(new Event('lawoffice:recheck-session'));
          }

          const beginBody = (await beginRes.json().catch(() => null)) as
            | DocumentActionResult<UploadAttemptDTO>
            | null;
          if (!isMountedRef.current) return;

          if (!beginRes.ok || !beginBody || !beginBody.success) {
            const failure = classifyUploadFailure(
              beginRes.status,
              beginBody && !beginBody.success ? beginBody : null,
              'تعذر بدء محاولة رفع الإصدار الجديد.'
            );
            syncCandidate((prev) => {
              if (!prev) return null;
              if (failure.status === 'REJECTED') {
                return {
                  ...prev,
                  ...makeFreshVersionKeys(),
                  status: 'REJECTED',
                  errorMessage: failure.message,
                  isConcurrencyConflict: false,
                };
              }
              return {
                ...prev,
                status: failure.status,
                errorMessage: failure.message,
                isConcurrencyConflict: failure.isConcurrencyConflict,
              };
            });
            return;
          }

          attemptId = beginBody.data.id;
          syncCandidate((prev) => (prev ? { ...prev, attemptId } : null));
        } catch {
          if (!isMountedRef.current) return;
          syncCandidate((prev) =>
            prev
              ? {
                  ...prev,
                  status: 'INCOMPLETE',
                  errorMessage: NETWORK_ERROR_MESSAGE,
                  isConcurrencyConflict: false,
                }
              : null
          );
          return;
        }
      }

      if (!contentUploaded) {
        syncCandidate((prev) =>
          prev ? { ...prev, status: 'UPLOADING', errorMessage: null } : null
        );

        try {
          const putRes = await fetch(`/api/documents/uploads/${attemptId}/content`, {
            method: 'PUT',
            headers: { 'Content-Type': resolveDeclaredMime(working.file) },
            signal: uploadAbortRef.current?.signal,
            body: working.file,
          });

          if (putRes.status === 401 && typeof window !== 'undefined') {
            window.dispatchEvent(new Event('lawoffice:recheck-session'));
          }

          const putBody = (await putRes.json().catch(() => null)) as
            | DocumentActionResult<UploadAttemptDTO>
            | null;
          if (!isMountedRef.current) return;

          if (!putRes.ok || !putBody || !putBody.success) {
            const failure = classifyUploadFailure(
              putRes.status,
              putBody && !putBody.success ? putBody : null,
              'تعذر رفع محتوى الإصدار إلى الحجر الخاص.'
            );
            syncCandidate((prev) => {
              if (!prev) return null;
              if (failure.status === 'REJECTED') {
                return {
                  ...prev,
                  ...makeFreshVersionKeys(),
                  status: 'REJECTED',
                  errorMessage: failure.message,
                  isConcurrencyConflict: false,
                };
              }
              return {
                ...prev,
                status: failure.status,
                errorMessage: failure.message,
                isConcurrencyConflict: failure.isConcurrencyConflict,
              };
            });
            return;
          }

          contentUploaded = true;
          syncCandidate((prev) => (prev ? { ...prev, contentUploaded: true } : null));
        } catch {
          if (!isMountedRef.current) return;
          syncCandidate((prev) =>
            prev
              ? {
                  ...prev,
                  status: 'INCOMPLETE',
                  errorMessage: NETWORK_ERROR_MESSAGE,
                  isConcurrencyConflict: false,
                }
              : null
          );
          return;
        }
      }

      const latest = candidateRef.current;
      const finKey = latest?.finalizeIdempotencyKey ?? working.finalizeIdempotencyKey;
      await runVersionFinalize(attemptId, false, finKey);
    } finally {
      if (isMountedRef.current) {
        setIsUploadingVersion(false);
      }
    }
  };

  const handleConfirmVersionDuplicate = async () => {
    const current = candidateRef.current;
    if (!current?.attemptId || isUploadingVersion || isReadOnly) return;
    setIsUploadingVersion(true);
    try {
      await runVersionFinalize(
        current.attemptId,
        true,
        current.confirmDuplicateIdempotencyKey
      );
    } finally {
      if (isMountedRef.current) {
        setIsUploadingVersion(false);
      }
    }
  };

  // =========================================================================
  // Paper Original & Metadata Editor Handlers
  // =========================================================================

  const updateDraftField = <K extends keyof MetadataSnapshot>(
    key: K,
    value: MetadataSnapshot[K]
  ) => {
    setDraft((prev) => ({ ...prev, [key]: value }));
    setMetadataSuccessMessage(null);
    setMetadataError(null);
    setMetadataConflict(false);
    setMetadataFieldErrors((prev) => {
      if (!(key in prev)) return prev;
      const next = { ...prev };
      delete next[key];
      return next;
    });
  };

  const handleResetMetadataDraft = () => {
    if (isSavingMetadata || isReadOnly) return;
    setDraft(snapshotFromDocument(docState));
    setMetadataError(null);
    setMetadataFieldErrors({});
    setMetadataConflict(false);
    setMetadataSuccessMessage(null);
    setFrozenMetadataRequest(null);
    setMetadataIdempotencyKey(generateClientRequestId('doc-meta'));
  };

  const handleSaveMetadata = async (event: React.FormEvent) => {
    event.preventDefault();
    if (isSavingMetadata || isReadOnly) return;

    const trimmedTitle = draft.title.trim();
    if (!trimmedTitle) {
      setMetadataFieldErrors({ title: 'عنوان المستند مطلوب.' });
      setMetadataError('يرجى إدخال عنوان المستند قبل الحفظ.');
      metadataTitleInputRef.current?.focus();
      return;
    }

    const requestToSend: FrozenMetadataRequest = frozenMetadataRequest ?? {
      expectedVersion: docState.version,
      idempotencyKey: metadataIdempotencyKey,
      payload: {
        expectedVersion: docState.version,
        idempotencyKey: metadataIdempotencyKey,
        title: trimmedTitle,
        documentType: draft.documentType,
        documentDate: normalizeNullableText(draft.documentDate),
        description: normalizeNullableText(draft.description),
        originalPresent: draft.originalPresent,
        originalLocation: normalizeNullableText(draft.originalLocation),
        sensitivity: draft.sensitivity,
      },
    };

    setIsSavingMetadata(true);
    setMetadataError(null);
    setMetadataFieldErrors({});
    setMetadataSuccessMessage(null);
    setMetadataConflict(false);

    try {
      const response = await fetch(`/api/documents/${docState.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(requestToSend.payload),
      });

      if (response.status === 401 && typeof window !== 'undefined') {
        window.dispatchEvent(new Event('lawoffice:recheck-session'));
      }

      const body = (await response.json().catch(() => null)) as
        | DocumentActionResult<DocumentDetailDTO>
        | null;
      if (!isMountedRef.current) return;

      if (!response.ok || !body || !body.success) {
        const failureBody = body && !body.success ? body : null;
        const code = failureBody?.code;

        if (response.status === 401) {
          setFrozenMetadataRequest(requestToSend);
          setMetadataError(SESSION_EXPIRED_MESSAGE);
          return;
        }

        if (response.status === 409 && code === 'CONCURRENCY_CONFLICT') {
          setMetadataConflict(true);
          setFrozenMetadataRequest(null);
          setMetadataIdempotencyKey(generateClientRequestId('doc-meta'));
          setMetadataError(
            failureBody?.error ??
              'تم تعديل بيانات المستند من جلسة أخرى. حدّث بيانات المستند ثم أعد المحاولة.'
          );
          return;
        }

        if (
          (response.status === 409 && code === 'IDEMPOTENCY_CONCURRENT_CONFLICT') ||
          response.status >= 500
        ) {
          setFrozenMetadataRequest(requestToSend);
          setMetadataError(
            failureBody?.error ?? 'حدث خطأ مؤقت أثناء حفظ التعديلات. يمكنك إعادة المحاولة.'
          );
          return;
        }

        // Validation errors or IDEMPOTENCY_PAYLOAD_MISMATCH never stay frozen
        setFrozenMetadataRequest(null);
        setMetadataIdempotencyKey(generateClientRequestId('doc-meta'));
        if (failureBody?.fieldErrors) {
          setMetadataFieldErrors(failureBody.fieldErrors);
          if (failureBody.fieldErrors.title) {
            metadataTitleInputRef.current?.focus();
          } else if (failureBody.fieldErrors.documentType) {
            metadataTypeSelectRef.current?.focus();
          } else if (failureBody.fieldErrors.documentDate) {
            metadataDateInputRef.current?.focus();
          } else if (failureBody.fieldErrors.sensitivity) {
            metadataSensitivitySelectRef.current?.focus();
          } else if (failureBody.fieldErrors.originalPresent) {
            metadataOriginalPresentSelectRef.current?.focus();
          } else if (failureBody.fieldErrors.originalLocation) {
            metadataOriginalLocationInputRef.current?.focus();
          } else if (failureBody.fieldErrors.description) {
            metadataDescriptionInputRef.current?.focus();
          }
        }
        setMetadataError(failureBody?.error ?? 'تعذر حفظ تعديلات بيانات المستند.');
        return;
      }

      setFrozenMetadataRequest(null);
      setMetadataIdempotencyKey(generateClientRequestId('doc-meta'));
      applyLatestDetail(body.data, { syncDraft: true });
      setMetadataSuccessMessage('تم حفظ بيانات المستند وحالة الأصل الورقي بنجاح.');
      router.refresh();
    } catch {
      if (!isMountedRef.current) return;
      setFrozenMetadataRequest(requestToSend);
      setMetadataError(NETWORK_ERROR_MESSAGE);
    } finally {
      if (isMountedRef.current) {
        setIsSavingMetadata(false);
      }
    }
  };

  const candidateStatusMeta = candidate ? QUEUE_STATUS_META[candidate.status] : null;
  const candidateClientRejection = candidate ? validateClientFile(candidate.file) : null;
  const metadataInputsDisabled = isSavingMetadata || isReadOnly || Boolean(frozenMetadataRequest);

  return (
    <div className="space-y-6 min-w-0 max-w-full" data-testid="document-detail-view">
      {/* Top Breadcrumb & Title Header */}
      <div className="bg-white rounded-[6px] border border-[#D5DFE3] p-4 sm:p-6 shadow-xs space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <Link
            href="/documents"
            data-testid="back-to-documents-link"
            className="inline-flex items-center justify-center px-3.5 py-2 bg-[#F4F6F7] hover:bg-[#E8EEF1] text-[#172A35] border border-[#D5DFE3] text-sm font-medium rounded-[6px] min-h-[44px] focus:outline-none focus:ring-2 focus:ring-[#14566B]"
          >
            العودة إلى أرشيف المستندات
          </Link>

          <div className="flex flex-wrap items-center gap-2">
            {currentVersion && (
              <span
                data-testid="detail-current-version-badge"
                className="inline-flex items-center px-2.5 py-1 rounded-[4px] border text-xs font-bold bg-[#F4F6F7] text-[#172A35] border-[#D5DFE3]"
              >
                الإصدار الحالي: {currentVersion.versionNumber}
              </span>
            )}
            <span className="inline-flex items-center px-2.5 py-1 rounded-[4px] border text-xs font-semibold bg-[#E9F2F5] text-[#14566B] border-[#C2D9E2]">
              {DOCUMENT_TYPE_LABELS_AR[docState.documentType]}
            </span>
            <span
              className={`inline-flex items-center px-2.5 py-1 rounded-[4px] border text-xs font-semibold ${SENSITIVITY_BADGE_CLASSES[docState.sensitivity]}`}
            >
              {SENSITIVITY_LABELS[docState.sensitivity]}
            </span>
            <span
              data-testid="detail-scan-status-badge"
              className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-[4px] border text-xs font-bold ${currentScanBadgeClass}`}
            >
              {currentVersion?.scanStatus === 'CLEAN' ? (
                <IconCheck className="w-4 h-4 shrink-0" />
              ) : currentVersion?.scanStatus === 'PENDING' ? (
                <IconClock className="w-4 h-4 shrink-0" />
              ) : (
                <IconWarning className="w-4 h-4 shrink-0" />
              )}
              <span>{currentScanLabel}</span>
            </span>
          </div>
        </div>

        <div className="flex items-start gap-3 min-w-0">
          <IconDocument className="w-7 h-7 text-[#14566B] shrink-0 mt-1" />
          <div className="min-w-0 space-y-1">
            <h1
              data-testid="document-detail-title"
              className="text-xl sm:text-2xl font-bold text-[#172A35] break-words [overflow-wrap:anywhere]"
            >
              {docState.title}
            </h1>
            {docState.description && (
              <p className="text-sm text-[#4D606A] leading-relaxed whitespace-pre-line break-words [overflow-wrap:anywhere]">
                {docState.description}
              </p>
            )}
          </div>
        </div>

        {refreshError && (
          <div
            role="alert"
            data-testid="detail-refresh-error"
            className="rounded-[6px] bg-red-50 border border-red-200 p-3 text-sm text-[#A4262C] flex flex-wrap items-center justify-between gap-2"
          >
            <div className="flex items-start gap-2 min-w-0">
              <IconWarning className="w-4 h-4 shrink-0 mt-0.5" />
              <span className={MESSAGE_CLASS}>{refreshError}</span>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <button
                type="button"
                data-testid="detail-refresh-retry"
                disabled={isRefreshingDetail}
                onClick={() => void refreshDocumentDetail()}
                className="inline-flex items-center justify-center gap-1.5 px-3 py-1.5 bg-[#14566B] hover:bg-[#0F4354] text-white text-xs font-semibold rounded-[6px] min-h-[44px] disabled:opacity-50 focus:outline-none focus:ring-2 focus:ring-[#14566B]"
              >
                <IconRefresh className="w-4 h-4" />
                <span>{isRefreshingDetail ? 'جارٍ التحديث...' : 'إعادة التحديث'}</span>
              </button>
              <button
                type="button"
                onClick={() => setRefreshError(null)}
                className="text-xs font-semibold underline min-h-[44px] px-2 rounded-[4px] focus:outline-none focus:ring-2 focus:ring-[#A4262C]"
              >
                إغلاق
              </button>
            </div>
          </div>
        )}

        {isArchived && (
          <div
            role="status"
            data-testid="detail-archived-banner"
            className="rounded-[6px] bg-stone-100 border border-stone-300 p-3 text-sm text-stone-800"
          >
            هذا المستند مؤرشف حالياً. يمكنك معاينة وتحميل الإصدارات المعتمدة، ولا يمكن إضافة إصدارات أو تعديل البيانات.
          </div>
        )}

        {!isArchived && !canWriteDocuments && (
          <div
            role="status"
            data-testid="detail-readonly-banner"
            className="rounded-[6px] bg-stone-100 border border-stone-300 p-3 text-sm text-stone-800"
          >
            وضع القراءة فقط: لا تمتلك صلاحية تعديل بيانات المستند أو إضافة إصدارات جديدة.
          </div>
        )}

        {currentVersion?.scanStatus === 'NOT_SCANNED_POLICY' && (
          <div
            data-testid="detail-adr0003-notice"
            className="rounded-[6px] bg-[#FFF7E6] border border-[#E0B46A] p-3.5 text-sm text-[#7A4A00] flex items-start gap-2.5"
          >
            <IconWarning className="w-5 h-5 shrink-0 mt-0.5" />
            <div className="space-y-1 min-w-0">
              <p className="font-bold">{currentScanLabel}</p>
              <p className="text-xs sm:text-sm leading-relaxed break-words [overflow-wrap:anywhere]">
                تم اعتماد هذا المستند وفق سياسة المرحلة الأولى المؤجلة (<bdi dir="ltr">ADR 0003</bdi>) بعد التحقق من صيغة الملف وتوقيعه الرقمي وبصمته وحجمه، دون إجراء فحص فيروسات تلقائي.
              </p>
            </div>
          </div>
        )}
      </div>

      {/* Metadata Card */}
      <section
        aria-labelledby="document-metadata-heading"
        className="bg-white rounded-[6px] border border-[#D5DFE3] p-4 sm:p-6 shadow-xs space-y-4"
      >
        <h2 id="document-metadata-heading" className="text-lg font-bold text-[#172A35]">
          البيانات القانونية والتقنية للمستند
        </h2>

        <dl className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 text-sm min-w-0">
          <div className="min-w-0 p-3 rounded-[6px] bg-[#F8FAFB] border border-[#E5ECEE] space-y-1">
            <dt className="text-xs font-semibold text-[#4D606A]">الارتباط</dt>
            <dd className="font-medium text-[#172A35] break-words [overflow-wrap:anywhere]">
              {docState.matterId ? (
                <Link href={`/matters/${docState.matterId}`} className={INLINE_LINK_CLASS}>
                  <bdi dir="ltr">{docState.matterFileCode}</bdi> — {docState.matterTitle}
                </Link>
              ) : docState.partyId ? (
                <Link href={`/parties/${docState.partyId}`} className={INLINE_LINK_CLASS}>
                  {docState.partyName}
                </Link>
              ) : (
                '—'
              )}
              {docState.matterId && docState.proceedingId && docState.proceedingLabel && (
                <span className="block text-xs text-[#4D606A] mt-1">
                  القيد:{' '}
                  <Link
                    href={`/matters/${docState.matterId}/proceedings/${docState.proceedingId}`}
                    className={INLINE_LINK_CLASS}
                  >
                    <bdi>{docState.proceedingLabel}</bdi>
                  </Link>
                </span>
              )}
              {docState.hearingId && (
                <span className="block text-xs text-[#4D606A] mt-0.5">
                  الجلسة:{' '}
                  <Link href={`/hearings/${docState.hearingId}`} className={INLINE_LINK_CLASS}>
                    <bdi>
                      {docState.hearingDate
                        ? formatCairoDateArabic(docState.hearingDate)
                        : 'عرض الجلسة'}
                    </bdi>
                  </Link>
                </span>
              )}
            </dd>
          </div>

          <div className="min-w-0 p-3 rounded-[6px] bg-[#F8FAFB] border border-[#E5ECEE] space-y-1">
            <dt className="text-xs font-semibold text-[#4D606A]">تاريخ المستند</dt>
            <dd className="font-medium text-[#172A35]">
              {docState.documentDate ? formatCairoDateArabic(docState.documentDate) : 'غير محدد'}
            </dd>
          </div>

          <div className="min-w-0 p-3 rounded-[6px] bg-[#F8FAFB] border border-[#E5ECEE] space-y-1">
            <dt className="text-xs font-semibold text-[#4D606A]">الأصل الورقي ومكانه</dt>
            <dd
              data-testid="detail-original-presence"
              className="font-medium text-[#172A35] break-words [overflow-wrap:anywhere]"
            >
              <span>{ORIGINAL_PRESENCE_LABELS[docState.originalPresent]}</span>
              {docState.originalLocation && (
                <span
                  data-testid="detail-original-location"
                  className="block text-xs text-[#4D606A] mt-1"
                >
                  المكان: {docState.originalLocation}
                </span>
              )}
            </dd>
          </div>

          {currentVersion && (
            <>
              <div className="min-w-0 p-3 rounded-[6px] bg-[#F8FAFB] border border-[#E5ECEE] space-y-1">
                <dt className="text-xs font-semibold text-[#4D606A]">اسم الملف والصيغة المعتمدة</dt>
                <dd className="font-medium text-[#172A35] break-all">
                  <bdi dir="ltr">{currentVersion.originalFilename}</bdi>
                  <span className="block text-xs text-[#4D606A] mt-1">
                    <bdi dir="ltr">
                      {currentVersion.detectedMime ?? currentVersion.declaredMime ?? '—'}
                    </bdi>
                    {' • '}
                    {formatFileSizeArabic(currentVersion.sizeBytes)}
                  </span>
                </dd>
              </div>

              <div className="min-w-0 p-3 rounded-[6px] bg-[#F8FAFB] border border-[#E5ECEE] space-y-1">
                <dt className="text-xs font-semibold text-[#4D606A]">سياسة التحقق والفحص</dt>
                <dd className="font-medium text-[#172A35] min-w-0">
                  <span>{currentScanLabel}</span>
                  {currentVersion.scanPolicyCode && (
                    <span className="block max-w-full break-all [overflow-wrap:anywhere] text-xs text-[#4D606A] mt-1">
                      <bdi dir="ltr">
                        {currentVersion.scanPolicyCode} ({currentVersion.scanPolicyVersion ?? '—'})
                      </bdi>
                    </span>
                  )}
                </dd>
              </div>

              <div className="min-w-0 p-3 rounded-[6px] bg-[#F8FAFB] border border-[#E5ECEE] space-y-1">
                <dt className="text-xs font-semibold text-[#4D606A]">تاريخ الرفع والاعتماد</dt>
                <dd className="font-medium text-[#172A35]">
                  {formatCairoInstantArabic(currentVersion.createdAt)}
                </dd>
              </div>

              <div className="sm:col-span-2 lg:col-span-3 min-w-0 p-3 rounded-[6px] bg-[#F8FAFB] border border-[#E5ECEE] space-y-1">
                <dt className="text-xs font-semibold text-[#4D606A]">
                  البصمة الرقمية للسلامة (<bdi dir="ltr">SHA-256</bdi>)
                </dt>
                <dd
                  data-testid="detail-sha256"
                  className="font-mono text-xs text-[#172A35] break-all select-all"
                >
                  <bdi dir="ltr">{currentVersion.sha256 ?? '—'}</bdi>
                </dd>
              </div>
            </>
          )}
        </dl>
      </section>

      {/* Authorized Preview & Download Section */}
      <section
        aria-labelledby="document-preview-heading"
        className="bg-white rounded-[6px] border border-[#D5DFE3] p-4 sm:p-6 shadow-xs space-y-4"
      >
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="space-y-1 min-w-0">
            <h2 id="document-preview-heading" className="text-lg font-bold text-[#172A35]">
              المعاينة والتحميل المصرح به
            </h2>
            {previewVersion && (
              <div className="space-y-1">
                <p
                  data-testid="preview-active-version-label"
                  className="text-xs text-[#4D606A] break-words [overflow-wrap:anywhere]"
                >
                  يتم عرض الإصدار رقم{' '}
                  <strong className="text-[#172A35]">{previewVersion.versionNumber}</strong>{' '}
                  {previewVersion.id === docState.currentVersionId
                    ? '(الإصدار الحالي)'
                    : '(إصدار سابق)'}{' '}
                  — <bdi dir="ltr">{previewVersion.originalFilename}</bdi>
                </p>
                <div className="flex flex-wrap items-center gap-2 pt-1">
                  <span
                    data-testid="preview-version-scan-badge"
                    className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-[4px] text-xs font-semibold border ${
                      SCAN_STATUS_BADGE_CLASSES[previewVersion.scanStatus]
                    }`}
                  >
                    {previewVersion.scanStatus === 'CLEAN' ? (
                      <IconCheck className="w-3.5 h-3.5 shrink-0" />
                    ) : previewVersion.scanStatus === 'PENDING' ? (
                      <IconClock className="w-3.5 h-3.5 shrink-0" />
                    ) : (
                      <IconWarning className="w-3.5 h-3.5 shrink-0" />
                    )}
                    <span>{previewVersion.scanStatusLabel}</span>
                  </span>
                  {previewVersion.scanStatus === 'NOT_SCANNED_POLICY' && (
                    <span className="text-xs text-[#7A4A00]">
                      ({UNSCANNED_POLICY_NOTICE_AR})
                    </span>
                  )}
                </div>
              </div>
            )}
          </div>

          {previewVersion?.isReady && downloadUrl && (
            <div className="flex flex-wrap items-center gap-2">
              {previewVersion.id !== docState.currentVersionId && currentVersion && (
                <button
                  type="button"
                  data-testid="preview-return-current-button"
                  onClick={() => handleSelectPreviewVersion(currentVersion)}
                  className="inline-flex items-center justify-center px-3.5 py-2 bg-[#F4F6F7] hover:bg-[#E8EEF1] text-[#172A35] border border-[#D5DFE3] text-xs font-semibold rounded-[6px] min-h-[44px] focus:outline-none focus:ring-2 focus:ring-[#14566B]"
                >
                  العودة لمعاينة الإصدار الحالي
                </button>
              )}
              {isPdf && inlineUrl && (
                <a
                  href={inlineUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  data-testid="document-open-inline-tab"
                  className="inline-flex items-center justify-center gap-2 px-4 py-2.5 bg-white hover:bg-[#F4F6F7] text-[#172A35] border border-[#D5DFE3] text-sm font-semibold rounded-[6px] min-h-[44px] focus:outline-none focus:ring-2 focus:ring-[#14566B] focus:ring-offset-2"
                >
                  <IconDocument className="w-4 h-4 text-[#14566B]" />
                  <span>فتح المعاينة في تبويب جديد</span>
                </a>
              )}
              <a
                href={downloadUrl}
                download
                data-testid="document-download-link"
                className="inline-flex items-center justify-center gap-2 px-5 py-2.5 bg-[#14566B] hover:bg-[#0F4354] text-white text-sm font-semibold rounded-[6px] shadow-xs min-h-[44px] focus:outline-none focus:ring-2 focus:ring-[#14566B] focus:ring-offset-2"
              >
                <IconDownload className="w-4 h-4" />
                <span>تحميل النسخة الرقمية</span>
              </a>
            </div>
          )}
        </div>

        <div
          role="note"
          data-testid="device-retention-notice"
          className="rounded-[6px] bg-[#F8FAFB] border border-[#D5DFE3] p-3 text-xs sm:text-sm text-[#4D606A] min-w-0 break-words [overflow-wrap:anywhere]"
        >
          {downloadNotice}
        </div>

        {!previewVersion || !previewVersion.isReady || !inlineUrl ? (
          <div
            role="alert"
            className="p-4 rounded-[6px] bg-red-50 border border-red-200 text-sm text-[#A4262C] min-w-0 break-words [overflow-wrap:anywhere]"
          >
            المستند غير جاهز للمعاينة أو التحميل حالياً.
          </div>
        ) : isImage ? (
          imageLoadError ? (
            <div
              role="alert"
              data-testid="document-preview-image-error"
              className="p-4 rounded-[6px] bg-red-50 border border-red-200 text-sm text-[#A4262C] space-y-3"
            >
              <p className={`font-semibold ${MESSAGE_CLASS}`}>
                تعذّر تحميل معاينة الصورة. قد تكون الجلسة انتهت أو حدث انقطاع مؤقت في الاتصال.
              </p>
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  data-testid="document-preview-retry"
                  onClick={handleImageRetry}
                  className="inline-flex items-center justify-center gap-1.5 px-4 py-2 bg-[#14566B] hover:bg-[#0F4354] text-white text-xs font-semibold rounded-[6px] min-h-[44px] focus:outline-none focus:ring-2 focus:ring-[#14566B] focus:ring-offset-2"
                >
                  <IconRefresh className="w-4 h-4" />
                  <span>إعادة محاولة المعاينة</span>
                </button>
                {downloadUrl && (
                  <a
                    href={downloadUrl}
                    download
                    className="inline-flex items-center justify-center gap-1.5 px-4 py-2 bg-white hover:bg-[#F4F6F7] text-[#172A35] border border-[#D5DFE3] text-xs font-semibold rounded-[6px] min-h-[44px] focus:outline-none focus:ring-2 focus:ring-[#14566B]"
                  >
                    <IconDownload className="w-4 h-4 text-[#14566B]" />
                    <span>تحميل النسخة الرقمية</span>
                  </a>
                )}
              </div>
            </div>
          ) : (
            <div className="bg-[#F8FAFB] border border-[#D5DFE3] rounded-[6px] p-3 sm:p-4 flex justify-center">
              <Image
                key={imageSrc ?? inlineUrl}
                src={imageSrc ?? inlineUrl}
                alt={`معاينة المستند: ${docState.title} — الإصدار ${previewVersion.versionNumber}`}
                width={960}
                height={540}
                unoptimized
                data-testid="document-preview-image"
                onError={handleImageError}
                className="w-auto h-auto max-w-full max-h-[540px] object-contain rounded-[4px]"
              />
            </div>
          )
        ) : isPdf ? (
          <div className="space-y-2">
            <iframe
              key={inlineUrl}
              src={inlineUrl}
              title={`معاينة مستند PDF: ${docState.title} — الإصدار ${previewVersion.versionNumber}`}
              data-testid="document-preview-iframe"
              className="w-full h-[360px] sm:h-[540px] max-h-[70vh] border border-[#D5DFE3] rounded-[6px] bg-white"
            />
            <p className="text-xs text-[#4D606A]">
              إذا تعذّر عرض ملف <bdi dir="ltr">PDF</bdi> داخل المتصفح، يمكنك فتح المعاينة في تبويب جديد أو استخدام زر «تحميل النسخة الرقمية» أعلاه بعد التحقق من الجلسة.
            </p>
          </div>
        ) : (
          <p className="text-sm text-[#4D606A]">
            المعاينة المباشرة غير متاحة لهذه الصيغة، ويمكنك تنزيل النسخة الرقمية عبر الزر أعلاه.
          </p>
        )}
      </section>

      {/* Version History ("سجل الإصدارات") */}
      <section
        aria-labelledby="version-history-heading"
        data-testid="version-history-section"
        className="bg-white rounded-[6px] border border-[#D5DFE3] p-4 sm:p-6 shadow-xs space-y-4 min-w-0 max-w-full"
      >
        <div className="flex flex-wrap items-center justify-between gap-2 pb-3 border-b border-[#E5ECEE]">
          <div className="space-y-0.5">
            <h2 id="version-history-heading" className="text-lg font-bold text-[#172A35]">
              سجل الإصدارات
            </h2>
            <p className="text-xs sm:text-sm text-[#4D606A]">
              جميع الإصدارات محفوظة بشكل منفصل ولا يستبدل الإصدار الجديد النسخ السابقة.
            </p>
          </div>
          <span className="text-xs font-semibold text-[#4D606A]">
            إجمالي الإصدارات: {versions.length}
          </span>
        </div>

        {versions.length === 0 ? (
          <p className="text-sm text-[#4D606A]">لا توجد إصدارات مسجلة لهذا المستند.</p>
        ) : (
          <ol className="space-y-3" data-testid="version-history-list">
            {versions.map((ver) => {
              const isCurrent = ver.id === docState.currentVersionId;
              const isPreviewing = ver.id === previewVersion?.id;
              const verScanClass = SCAN_STATUS_BADGE_CLASSES[ver.scanStatus];
              const verInlineUrl = `/api/documents/${docState.id}/content?disposition=inline&versionId=${ver.id}`;
              const verDownloadUrl = `/api/documents/${docState.id}/content?disposition=attachment&versionId=${ver.id}`;

              return (
                <li
                  key={ver.id}
                  data-testid={`version-row-${ver.versionNumber}`}
                  className={`rounded-[6px] border p-3.5 sm:p-4 space-y-3 min-w-0 ${
                    isCurrent
                      ? 'bg-[#F8FAFB] border-[#14566B]/40'
                      : 'bg-white border-[#D5DFE3]'
                  }`}
                >
                  <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3 min-w-0">
                    <div className="space-y-1.5 min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="inline-flex items-center px-2.5 py-0.5 rounded-[4px] border text-xs font-bold bg-[#E9F2F5] text-[#14566B] border-[#C2D9E2]">
                          الإصدار {ver.versionNumber}
                        </span>
                        {isCurrent && (
                          <span
                            data-testid={`version-current-badge-${ver.versionNumber}`}
                            className="inline-flex items-center px-2.5 py-0.5 rounded-[4px] border text-xs font-bold bg-emerald-50 text-[#176449] border-emerald-300"
                          >
                            الحالي
                          </span>
                        )}
                        {isPreviewing && (
                          <span
                            data-testid={`version-previewing-badge-${ver.versionNumber}`}
                            className="inline-flex items-center px-2 py-0.5 rounded-[4px] border text-xs font-semibold bg-slate-100 text-[#172A35] border-slate-300"
                          >
                            قيد المعاينة
                          </span>
                        )}
                        <span
                          data-testid={`version-scan-badge-${ver.versionNumber}`}
                          className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-[4px] border text-xs font-semibold ${verScanClass}`}
                        >
                          {ver.scanStatus === 'CLEAN' ? (
                            <IconCheck className="w-3.5 h-3.5 shrink-0" />
                          ) : ver.scanStatus === 'PENDING' ? (
                            <IconClock className="w-3.5 h-3.5 shrink-0" />
                          ) : (
                            <IconWarning className="w-3.5 h-3.5 shrink-0" />
                          )}
                          <span>{ver.scanStatusLabel}</span>
                        </span>
                        {ver.scanPolicyCode && (
                          <span className="max-w-full break-all [overflow-wrap:anywhere] text-[11px] text-[#4D606A] bg-[#F4F6F7] px-2 py-0.5 rounded border border-[#E5ECEE]">
                            <bdi dir="ltr">
                              {ver.scanPolicyCode} ({ver.scanPolicyVersion ?? '—'})
                            </bdi>
                          </span>
                        )}
                      </div>

                      <p className="text-sm font-bold text-[#172A35] break-all">
                        <bdi dir="ltr">{ver.originalFilename}</bdi>
                      </p>

                      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-[#4D606A]">
                        <span>
                          <bdi dir="ltr">{ver.detectedMime ?? ver.declaredMime ?? '—'}</bdi>
                        </span>
                        <span>•</span>
                        <span>{formatFileSizeArabic(ver.sizeBytes)}</span>
                        <span>•</span>
                        <span>
                          <bdi dir="ltr" className="font-mono" title={ver.sha256 ?? undefined}>
                            SHA-256: {formatShortSha256(ver.sha256)}
                          </bdi>
                        </span>
                        <span>•</span>
                        <span>{formatCairoInstantArabic(ver.createdAt)}</span>
                      </div>
                    </div>

                    <div className="flex flex-wrap items-center gap-2 shrink-0">
                      {ver.isReady ? (
                        <>
                          <button
                            type="button"
                            data-testid={`version-preview-btn-${ver.versionNumber}`}
                            aria-label={`معاينة الإصدار رقم ${ver.versionNumber}: ${ver.originalFilename}`}
                            aria-pressed={isPreviewing}
                            onClick={() => handleSelectPreviewVersion(ver)}
                            className="inline-flex items-center justify-center px-3.5 py-2 bg-white hover:bg-[#E9F2F5] text-[#14566B] border border-[#14566B] text-xs font-semibold rounded-[6px] min-h-[44px] focus:outline-none focus:ring-2 focus:ring-[#14566B]"
                          >
                            معاينة هذا الإصدار
                          </button>
                          <a
                            href={verInlineUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            aria-label={`فتح الإصدار رقم ${ver.versionNumber} في تبويب جديد: ${ver.originalFilename}`}
                            className="inline-flex items-center justify-center px-3 py-2 bg-[#F4F6F7] hover:bg-[#E8EEF1] text-[#172A35] border border-[#D5DFE3] text-xs font-medium rounded-[6px] min-h-[44px] focus:outline-none focus:ring-2 focus:ring-[#14566B]"
                          >
                            تبويب جديد
                          </a>
                          <a
                            href={verDownloadUrl}
                            download
                            data-testid={`version-download-link-${ver.versionNumber}`}
                            aria-label={`تحميل الإصدار رقم ${ver.versionNumber}: ${ver.originalFilename}`}
                            className="inline-flex items-center justify-center gap-1.5 px-3.5 py-2 bg-[#14566B] hover:bg-[#0F4354] text-white text-xs font-semibold rounded-[6px] min-h-[44px] focus:outline-none focus:ring-2 focus:ring-[#14566B]"
                          >
                            <IconDownload className="w-4 h-4" />
                            <span>تحميل</span>
                          </a>
                        </>
                      ) : (
                        <span className="text-xs font-semibold text-[#A4262C]">
                          غير جاهز للمعاينة أو التحميل
                        </span>
                      )}
                    </div>
                  </div>
                </li>
              );
            })}
          </ol>
        )}
      </section>

      {/* Add New Version ("إضافة إصدار جديد") */}
      {canWriteDocuments && (
        <section
          aria-labelledby="add-version-heading"
          data-testid="add-version-section"
          className="bg-white rounded-[6px] border border-[#D5DFE3] p-4 sm:p-6 shadow-xs space-y-4 min-w-0 max-w-full"
        >
          <div className="space-y-1 pb-3 border-b border-[#E5ECEE]">
            <h2 id="add-version-heading" className="text-lg font-bold text-[#172A35]">
              إضافة إصدار جديد
            </h2>
            <p className="text-xs sm:text-sm text-[#4D606A]">
              الصيغ المسموحة: <bdi dir="ltr" className="font-mono text-[#172A35]">PDF / JPEG / PNG</bdi> بحد أقصى 25 ميجابايت. فشل التحقق لا يمس الإصدار الحالي المعتمد.
            </p>
          </div>

          {versionSuccessMessage && (
            <div
              role="status"
              aria-live="polite"
              data-testid="version-upload-success"
              className="p-3 rounded-[6px] bg-emerald-50 border border-emerald-200 text-sm text-[#176449] flex flex-wrap items-center justify-between gap-2"
            >
            <div className="flex items-center gap-2 min-w-0">
              <IconCheck className="w-4 h-4 shrink-0" />
              <span className={MESSAGE_CLASS}>{versionSuccessMessage}</span>
            </div>
            <button
              type="button"
              onClick={() => setVersionSuccessMessage(null)}
              className="text-xs font-semibold underline min-h-[44px] px-2 rounded-[4px] focus:outline-none focus:ring-2 focus:ring-[#176449]"
            >
              إغلاق
            </button>
          </div>
        )}

        <div className="flex flex-wrap items-center gap-3">
          <input
            ref={versionInputRef}
            id="document-new-version-input"
            data-testid="version-file-input"
            type="file"
            accept=".pdf,.jpg,.jpeg,.png,application/pdf,image/jpeg,image/png"
            disabled={isUploadingVersion || isArchived}
            onChange={handleVersionFileSelected}
            className="sr-only peer"
          />
          <label
            htmlFor="document-new-version-input"
            className={`inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-[6px] border border-[#14566B] text-sm font-semibold bg-[#E9F2F5] text-[#14566B] hover:bg-[#DCEAF0] min-h-[44px] cursor-pointer peer-focus:ring-2 peer-focus:ring-[#14566B] peer-focus:ring-offset-2 ${
              isUploadingVersion || isArchived ? 'opacity-50 pointer-events-none' : ''
            }`}
          >
            <IconUpload className="w-4 h-4 shrink-0" />
            <span>{candidate ? 'اختيار ملف آخر' : 'اختيار ملف الإصدار الجديد'}</span>
          </label>
          <span className="text-xs text-[#4D606A] min-w-0 max-w-full break-all">
            {candidate ? (
              <>
                الملف المختار:{' '}
                <bdi dir="ltr" className="min-w-0 max-w-full break-all">
                  {candidate.file.name}
                </bdi>
              </>
            ) : (
              'لم يتم اختيار ملف لإصدار جديد بعد'
            )}
          </span>
        </div>

        {candidate && candidateStatusMeta && (
          <div
            data-testid="version-candidate-card"
            className="rounded-[6px] border border-[#D5DFE3] bg-[#F8FAFB] p-3.5 sm:p-4 space-y-3 min-w-0"
          >
            <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3 min-w-0">
              <div className="flex flex-wrap items-start gap-3 min-w-0 flex-1">
                {candidate.localPreviewUrl && !candidate.localPreviewError ? (
                  <Image
                    src={candidate.localPreviewUrl}
                    alt={`معاينة محلية للملف: ${candidate.file.name}`}
                    width={72}
                    height={72}
                    unoptimized
                    onError={() =>
                      syncCandidate((prev) => (prev ? { ...prev, localPreviewError: true } : null))
                    }
                    className="w-[72px] h-[72px] shrink-0 object-contain rounded-[4px] border border-[#D5DFE3] bg-white"
                  />
                ) : (
                  <div
                    className="w-[64px] h-[64px] shrink-0 rounded-[4px] border border-[#D5DFE3] bg-white flex flex-col items-center justify-center text-[#14566B]"
                    aria-hidden="true"
                  >
                    <IconDocument className="w-6 h-6" />
                    <span className="text-[11px] font-mono mt-0.5">
                      {isPdfFile(candidate.file) ? 'PDF' : 'FILE'}
                    </span>
                  </div>
                )}

                <div className="min-w-0 flex-1 space-y-1">
                  <p className="text-sm font-bold text-[#172A35] break-all">
                    <bdi dir="ltr">{candidate.file.name}</bdi>
                  </p>
                  <p className="text-xs text-[#4D606A]">
                    الحجم: {formatFileSizeArabic(candidate.file.size)}
                  </p>
                  <span
                    data-testid="version-candidate-status"
                    role="status"
                    aria-live="polite"
                    className={`inline-flex items-center gap-1 px-2.5 py-0.5 text-xs font-semibold rounded-[4px] border ${candidateStatusMeta.badgeClass}`}
                  >
                    {(candidate.status === 'REJECTED' ||
                      candidate.status === 'INCOMPLETE' ||
                      candidate.status === 'DUPLICATE_WARNING') && (
                      <IconWarning className="w-3.5 h-3.5" />
                    )}
                    <span>{candidateStatusMeta.label}</span>
                  </span>
                </div>
              </div>

              {!isUploadingVersion && (
                <button
                  type="button"
                  data-testid="version-candidate-clear"
                  onClick={handleClearCandidate}
                  className="inline-flex items-center justify-center px-3 py-2 text-xs font-semibold text-[#A4262C] bg-white hover:bg-red-50 border border-red-200 rounded-[6px] min-h-[44px] shrink-0 focus:outline-none focus:ring-2 focus:ring-[#A4262C]"
                >
                  إزالة الاختيار
                </button>
              )}
            </div>

            {(candidate.status === 'INCOMPLETE' || candidate.status === 'REJECTED') &&
              candidate.errorMessage && (
                <div
                  role="alert"
                  data-testid="version-candidate-error"
                  className="p-3 rounded-[6px] bg-red-50 border border-red-200 text-sm text-[#A4262C] space-y-2"
                >
                  <p className={`font-semibold ${MESSAGE_CLASS}`}>
                    تعذر اعتماد الملف (<bdi dir="ltr">{candidate.file.name}</bdi>):{' '}
                    {candidate.errorMessage}
                  </p>
                  {currentVersion && (
                    <p className="text-xs text-[#172A35]">
                      لم يتم المساس بالإصدار الحالي المعتمد (الإصدار {currentVersion.versionNumber}) ويظل متاحاً للمعاينة والتحميل.
                    </p>
                  )}
                  <div className="flex flex-wrap items-center gap-2 pt-1">
                    {candidate.isConcurrencyConflict && (
                      <button
                        type="button"
                        data-testid="version-conflict-refresh"
                        disabled={isRefreshingDetail || isUploadingVersion}
                        onClick={() => void refreshDocumentDetail({ resetVersionConflict: true })}
                        className="inline-flex items-center justify-center gap-1.5 px-4 py-2 bg-[#14566B] hover:bg-[#0F4354] text-white text-xs font-semibold rounded-[6px] min-h-[44px] disabled:opacity-50 focus:outline-none focus:ring-2 focus:ring-[#14566B]"
                      >
                        <IconRefresh className="w-4 h-4" />
                        <span>{isRefreshingDetail ? 'جارٍ التحديث...' : 'تحديث بيانات المستند'}</span>
                      </button>
                    )}
                    {!candidateClientRejection &&
                      !candidate.isConcurrencyConflict &&
                      (candidate.status === 'INCOMPLETE' || candidate.status === 'REJECTED') && (
                        <button
                          type="button"
                          data-testid="version-upload-retry"
                          disabled={isUploadingVersion}
                          onClick={() =>
                            void executeVersionUpload(candidate.status === 'INCOMPLETE')
                          }
                          className="inline-flex items-center justify-center gap-1.5 px-4 py-2 bg-[#14566B] hover:bg-[#0F4354] text-white text-xs font-semibold rounded-[6px] min-h-[44px] disabled:opacity-50 focus:outline-none focus:ring-2 focus:ring-[#14566B]"
                        >
                          <IconRefresh className="w-4 h-4" />
                          <span>
                            {candidate.status === 'REJECTED'
                              ? 'إعادة المحاولة برفع جديد'
                              : 'إعادة المحاولة'}
                          </span>
                        </button>
                      )}
                  </div>
                </div>
              )}

            {candidate.status === 'DUPLICATE_WARNING' && (
              <div
                role="alert"
                data-testid="version-duplicate-warning"
                className="p-3 rounded-[6px] bg-[#FFF7E6] border border-[#E0B46A] text-sm text-[#7A4A00] space-y-2.5"
              >
                <p className={`font-bold ${MESSAGE_CLASS}`}>{candidate.errorMessage}</p>
                {candidate.duplicateMatches.length > 0 && (
                  <ul className="list-disc list-inside space-y-1 text-xs text-[#172A35]">
                    {candidate.duplicateMatches.map((match) => (
                      <li key={match.versionId} className={MESSAGE_CLASS}>
                        <Link href={`/documents/${match.documentId}`} className={INLINE_LINK_CLASS}>
                          {match.title}
                        </Link>{' '}
                        (<bdi dir="ltr">{match.originalFilename}</bdi>)
                      </li>
                    ))}
                  </ul>
                )}
                <div className="flex flex-wrap items-center gap-2 pt-1">
                  <button
                    type="button"
                    data-testid="version-confirm-duplicate"
                    disabled={isUploadingVersion}
                    onClick={() => void handleConfirmVersionDuplicate()}
                    className="inline-flex items-center justify-center px-4 py-2 bg-[#14566B] hover:bg-[#0F4354] text-white text-xs font-semibold rounded-[6px] min-h-[44px] disabled:opacity-50 focus:outline-none focus:ring-2 focus:ring-[#14566B]"
                  >
                    تأكيد إضافة هذا الإصدار
                  </button>
                  <button
                    type="button"
                    data-testid="version-cancel-duplicate"
                    disabled={isUploadingVersion}
                    onClick={handleClearCandidate}
                    className="inline-flex items-center justify-center px-4 py-2 bg-white hover:bg-[#F4F6F7] text-[#172A35] border border-[#D5DFE3] text-xs font-semibold rounded-[6px] min-h-[44px] disabled:opacity-50 focus:outline-none focus:ring-2 focus:ring-[#14566B]"
                  >
                    إلغاء
                  </button>
                </div>
              </div>
            )}

            {candidate.status === 'QUEUED' && (
              <div className="flex justify-end">
                <button
                  type="button"
                  data-testid="version-upload-submit"
                  disabled={isUploadingVersion || isReadOnly}
                  aria-busy={isUploadingVersion}
                  onClick={() => void executeVersionUpload(false)}
                  className="inline-flex items-center justify-center gap-2 px-5 py-2.5 bg-[#14566B] hover:bg-[#0F4354] disabled:opacity-50 text-white text-sm font-semibold rounded-[6px] min-h-[44px] focus:outline-none focus:ring-2 focus:ring-[#14566B] focus:ring-offset-2"
                >
                  <IconUpload className="w-4 h-4" />
                  <span>{isUploadingVersion ? 'جارٍ الرفع والتحقق...' : 'رفع واعتماد الإصدار الجديد'}</span>
                </button>
              </div>
            )}
          </div>
        )}
        </section>
      )}

      {/* Paper Original & Metadata Editor ("الأصل الورقي وبيانات المستند") */}
      <section
        aria-labelledby="metadata-editor-heading"
        data-testid="document-metadata-editor-section"
        className="bg-white rounded-[6px] border border-[#D5DFE3] p-4 sm:p-6 shadow-xs space-y-4 min-w-0 max-w-full"
      >
        <div className="space-y-1 pb-3 border-b border-[#E5ECEE]">
          <h2 id="metadata-editor-heading" className="text-lg font-bold text-[#172A35]">
            الأصل الورقي وبيانات المستند
          </h2>
          <p className="text-xs sm:text-sm text-[#4D606A]">
            تحديث حالة الأصل الورقي أو بيانات المستند لا يغيّر محتوى أو بصمة الإصدارات الرقمية المحفوظة.
          </p>
        </div>

        {metadataSuccessMessage && (
          <div
            role="status"
            aria-live="polite"
            data-testid="metadata-save-success"
            className="p-3 rounded-[6px] bg-emerald-50 border border-emerald-200 text-sm text-[#176449] flex items-center gap-2"
          >
            <IconCheck className="w-4 h-4 shrink-0" />
            <span className={MESSAGE_CLASS}>{metadataSuccessMessage}</span>
          </div>
        )}

        {metadataError && (
          <div
            role="alert"
            data-testid="metadata-save-error"
            className="p-3 rounded-[6px] bg-red-50 border border-red-200 text-sm text-[#A4262C] space-y-2"
          >
            <div className="flex items-start gap-2">
              <IconWarning className="w-4 h-4 shrink-0 mt-0.5" />
              <span className={MESSAGE_CLASS}>{metadataError}</span>
            </div>
            {metadataConflict && (
              <button
                type="button"
                data-testid="metadata-conflict-refresh"
                disabled={isRefreshingDetail || isSavingMetadata}
                onClick={() => void refreshDocumentDetail({ syncDraft: true })}
                className="inline-flex items-center justify-center gap-1.5 px-4 py-2 bg-[#14566B] hover:bg-[#0F4354] text-white text-xs font-semibold rounded-[6px] min-h-[44px] disabled:opacity-50 focus:outline-none focus:ring-2 focus:ring-[#14566B]"
              >
                <IconRefresh className="w-4 h-4" />
                <span>{isRefreshingDetail ? 'جارٍ التحديث...' : 'تحديث بيانات المستند'}</span>
              </button>
            )}
          </div>
        )}

        <form onSubmit={handleSaveMetadata} noValidate className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 min-w-0">
            <div className="min-w-0">
              <label
                htmlFor="metadata-title-input"
                className="block text-sm font-semibold text-[#172A35] mb-1.5"
              >
                عنوان المستند *
              </label>
              <input
                ref={metadataTitleInputRef}
                id="metadata-title-input"
                data-testid="metadata-title-input"
                type="text"
                maxLength={MAX_DOCUMENT_TITLE_LENGTH}
                value={draft.title}
                disabled={metadataInputsDisabled}
                aria-invalid={Boolean(metadataFieldErrors.title)}
                aria-describedby={metadataFieldErrors.title ? 'metadata-title-error' : undefined}
                onChange={(e) => updateDraftField('title', e.target.value)}
                className={INPUT_CLASS}
              />
              {metadataFieldErrors.title && (
                <p id="metadata-title-error" className={FIELD_ERROR_CLASS}>
                  {metadataFieldErrors.title}
                </p>
              )}
            </div>

            <div className="min-w-0">
              <label
                htmlFor="metadata-type-select"
                className="block text-sm font-semibold text-[#172A35] mb-1.5"
              >
                نوع المستند *
              </label>
              <select
                ref={metadataTypeSelectRef}
                id="metadata-type-select"
                data-testid="metadata-type-select"
                value={draft.documentType}
                disabled={metadataInputsDisabled}
                aria-invalid={Boolean(metadataFieldErrors.documentType)}
                aria-describedby={
                  metadataFieldErrors.documentType ? 'metadata-type-error' : undefined
                }
                onChange={(e) => updateDraftField('documentType', e.target.value as DocumentType)}
                className={INPUT_CLASS}
              >
                {DOCUMENT_TYPE_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
              {metadataFieldErrors.documentType && (
                <p id="metadata-type-error" className={FIELD_ERROR_CLASS}>
                  {metadataFieldErrors.documentType}
                </p>
              )}
            </div>

            <div className="min-w-0">
              <label
                htmlFor="metadata-date-input"
                className="block text-sm font-semibold text-[#172A35] mb-1.5"
              >
                تاريخ المستند (اختياري)
              </label>
              <input
                ref={metadataDateInputRef}
                id="metadata-date-input"
                data-testid="metadata-date-input"
                type="date"
                dir="ltr"
                value={draft.documentDate}
                disabled={metadataInputsDisabled}
                aria-invalid={Boolean(metadataFieldErrors.documentDate)}
                aria-describedby={
                  metadataFieldErrors.documentDate ? 'metadata-date-error' : undefined
                }
                onChange={(e) => updateDraftField('documentDate', e.target.value)}
                className={INPUT_CLASS}
              />
              {metadataFieldErrors.documentDate && (
                <p id="metadata-date-error" className={FIELD_ERROR_CLASS}>
                  {metadataFieldErrors.documentDate}
                </p>
              )}
            </div>

            <div className="min-w-0">
              <label
                htmlFor="metadata-sensitivity-select"
                className="block text-sm font-semibold text-[#172A35] mb-1.5"
              >
                درجة السرية *
              </label>
              <select
                ref={metadataSensitivitySelectRef}
                id="metadata-sensitivity-select"
                data-testid="metadata-sensitivity-select"
                value={draft.sensitivity}
                disabled={metadataInputsDisabled}
                aria-invalid={Boolean(metadataFieldErrors.sensitivity)}
                aria-describedby={
                  metadataFieldErrors.sensitivity ? 'metadata-sensitivity-error' : undefined
                }
                onChange={(e) =>
                  updateDraftField('sensitivity', e.target.value as DocumentSensitivity)
                }
                className={INPUT_CLASS}
              >
                {SENSITIVITY_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
              {metadataFieldErrors.sensitivity && (
                <p id="metadata-sensitivity-error" className={FIELD_ERROR_CLASS}>
                  {metadataFieldErrors.sensitivity}
                </p>
              )}
            </div>

            <div className="min-w-0">
              <label
                htmlFor="metadata-original-present-select"
                className="block text-sm font-semibold text-[#172A35] mb-1.5"
              >
                حالة الأصل الورقي
              </label>
              <select
                ref={metadataOriginalPresentSelectRef}
                id="metadata-original-present-select"
                data-testid="metadata-original-present-select"
                value={draft.originalPresent}
                disabled={metadataInputsDisabled}
                aria-invalid={Boolean(metadataFieldErrors.originalPresent)}
                aria-describedby={
                  metadataFieldErrors.originalPresent
                    ? 'metadata-original-present-error'
                    : undefined
                }
                onChange={(e) =>
                  updateDraftField('originalPresent', e.target.value as DocumentOriginalPresence)
                }
                className={INPUT_CLASS}
              >
                {ORIGINAL_PRESENCE_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
              {metadataFieldErrors.originalPresent && (
                <p id="metadata-original-present-error" className={FIELD_ERROR_CLASS}>
                  {metadataFieldErrors.originalPresent}
                </p>
              )}
            </div>

            <div className="min-w-0">
              <label
                htmlFor="metadata-original-location-input"
                className="block text-sm font-semibold text-[#172A35] mb-1.5"
              >
                مكان حفظ الأصل الورقي (اختياري)
              </label>
              <input
                ref={metadataOriginalLocationInputRef}
                id="metadata-original-location-input"
                data-testid="metadata-original-location-input"
                type="text"
                maxLength={300}
                value={draft.originalLocation}
                disabled={metadataInputsDisabled}
                aria-invalid={Boolean(metadataFieldErrors.originalLocation)}
                aria-describedby={
                  metadataFieldErrors.originalLocation
                    ? 'metadata-original-location-error'
                    : undefined
                }
                placeholder="مثال: دولاب القضايا المدني — رف 3"
                onChange={(e) => updateDraftField('originalLocation', e.target.value)}
                className={INPUT_CLASS}
              />
              {metadataFieldErrors.originalLocation && (
                <p id="metadata-original-location-error" className={FIELD_ERROR_CLASS}>
                  {metadataFieldErrors.originalLocation}
                </p>
              )}
            </div>
          </div>

          <div className="min-w-0">
            <label
              htmlFor="metadata-description-input"
              className="block text-sm font-semibold text-[#172A35] mb-1.5"
            >
              وصف وملاحظات المستند (اختياري)
            </label>
            <textarea
              ref={metadataDescriptionInputRef}
              id="metadata-description-input"
              data-testid="metadata-description-input"
              rows={2}
              maxLength={2000}
              value={draft.description}
              disabled={metadataInputsDisabled}
              aria-invalid={Boolean(metadataFieldErrors.description)}
              aria-describedby={
                metadataFieldErrors.description ? 'metadata-description-error' : undefined
              }
              onChange={(e) => updateDraftField('description', e.target.value)}
              className={INPUT_CLASS}
            />
            {metadataFieldErrors.description && (
              <p id="metadata-description-error" className={FIELD_ERROR_CLASS}>
                {metadataFieldErrors.description}
              </p>
            )}
          </div>

          {canWriteDocuments && (
            <div className="flex flex-wrap items-center justify-end gap-3 pt-2 border-t border-[#E5ECEE]">
              {(isMetadataDirty || Boolean(frozenMetadataRequest)) && !isReadOnly && (
                <button
                  type="button"
                  data-testid="metadata-reset-button"
                  disabled={isSavingMetadata}
                  onClick={handleResetMetadataDraft}
                  className="inline-flex items-center justify-center px-4 py-2 bg-white hover:bg-[#F4F6F7] text-[#172A35] border border-[#D5DFE3] text-sm font-medium rounded-[6px] min-h-[44px] disabled:opacity-50 focus:outline-none focus:ring-2 focus:ring-[#14566B]"
                >
                  تراجع عن التعديلات
                </button>
              )}
              <button
                type="submit"
                data-testid="metadata-save-button"
                disabled={isSavingMetadata || isReadOnly || (!isMetadataDirty && !frozenMetadataRequest)}
                aria-busy={isSavingMetadata}
                className="inline-flex items-center justify-center px-6 py-2.5 bg-[#14566B] hover:bg-[#0F4354] disabled:opacity-50 text-white text-sm font-semibold rounded-[6px] shadow-xs min-h-[44px] focus:outline-none focus:ring-2 focus:ring-[#14566B] focus:ring-offset-2"
              >
                {isSavingMetadata
                  ? 'جارٍ الحفظ...'
                  : frozenMetadataRequest
                    ? 'إعادة محاولة الحفظ'
                    : 'حفظ التعديلات'}
              </button>
            </div>
          )}
        </form>
      </section>
    </div>
  );
}

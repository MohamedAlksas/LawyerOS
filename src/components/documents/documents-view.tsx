'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import type {
  DocumentActionResult,
  DocumentDTO,
  DocumentType,
  ListDocumentsResult,
} from '@/modules/documents/document-types';
import type { SelectableMatterOptionDTO } from '@/modules/productivity/productivity-types';
import { formatCairoDateArabic } from '@/lib/cairo-date';
import {
  EmptyStateContainer,
  ErrorContainer,
  LoadingIndicator,
} from '@/components/presentation-state';
import {
  IconDocument,
  IconDownload,
  IconPlus,
  IconRefresh,
  IconSearch,
  IconWarning,
} from '@/components/stitch-icons';
import { DocumentUploadForm } from './document-upload-form';
import {
  DOCUMENT_TYPE_LABELS_AR,
  DOCUMENT_TYPE_OPTIONS,
  SCAN_STATUS_BADGE_CLASSES,
  SENSITIVITY_BADGE_CLASSES,
  SENSITIVITY_LABELS,
  UNSCANNED_POLICY_NOTICE_AR,
  formatFileSizeArabic,
  type SelectablePartyOption,
} from './document-ui-helpers';

export interface DocumentsViewProps {
  initialDocuments: DocumentDTO[];
  initialTotal: number;
  selectableMatters: SelectableMatterOptionDTO[];
  selectableParties: SelectablePartyOption[];
  initialFilters: {
    matterId?: string;
    partyId?: string;
    documentType?: DocumentType;
    q?: string;
  };
  initialError?: string;
}

export function DocumentsView({
  initialDocuments,
  initialTotal,
  selectableMatters,
  selectableParties,
  initialFilters,
  initialError,
}: DocumentsViewProps) {
  const [documents, setDocuments] = useState<DocumentDTO[]>(initialDocuments);
  const [total, setTotal] = useState<number>(initialTotal);
  const [isLoading, setIsLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(initialError ?? null);
  const [isUploadOpen, setIsUploadOpen] = useState(false);

  const [query, setQuery] = useState<string>(initialFilters.q ?? '');
  const [selectedType, setSelectedType] = useState<string>(initialFilters.documentType ?? '');
  const [selectedMatterId, setSelectedMatterId] = useState<string>(initialFilters.matterId ?? '');
  const [selectedPartyId, setSelectedPartyId] = useState<string>(initialFilters.partyId ?? '');
  const [appliedFilters, setAppliedFilters] = useState({
    q: (initialFilters.q ?? '').trim(),
    documentType: initialFilters.documentType ?? '',
    matterId: initialFilters.matterId ?? '',
    partyId: initialFilters.partyId ?? '',
  });

  const documentsRef = useRef<DocumentDTO[]>(initialDocuments);
  const abortRef = useRef<AbortController | null>(null);
  const reqSeqRef = useRef(0);

  useEffect(() => {
    documentsRef.current = documents;
  }, [documents]);

  useEffect(() => {
    return () => {
      abortRef.current?.abort();
    };
  }, []);

  const fetchDocuments = useCallback(
    async (filters: {
      q: string;
      documentType: string;
      matterId: string;
      partyId: string;
    }) => {
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;
      const seq = ++reqSeqRef.current;

      setIsLoading(true);
      setLoadError(null);

      try {
        const sp = new URLSearchParams();
        const trimmedQ = filters.q.trim();
        if (trimmedQ) sp.set('q', trimmedQ);
        if (filters.documentType) sp.set('documentType', filters.documentType);
        if (filters.matterId) sp.set('matterId', filters.matterId);
        if (filters.partyId) sp.set('partyId', filters.partyId);
        sp.set('limit', '50');

        const res = await fetch(`/api/documents?${sp.toString()}`, {
          cache: 'no-store',
          signal: controller.signal,
        });

        if (res.status === 401 && typeof window !== 'undefined') {
          window.dispatchEvent(new Event('lawoffice:recheck-session'));
        }

        const body = (await res.json().catch(() => null)) as
          | DocumentActionResult<ListDocumentsResult>
          | null;

        if (seq !== reqSeqRef.current) return;

        if (!res.ok || !body || !body.success) {
          throw new Error(
            body && !body.success
              ? body.error
              : 'تعذر تحميل قائمة المستندات من الخادم.'
          );
        }

        documentsRef.current = body.data.documents;
        setDocuments(body.data.documents);
        setTotal(body.data.total);
        setAppliedFilters({
          q: trimmedQ,
          documentType: filters.documentType,
          matterId: filters.matterId,
          partyId: filters.partyId,
        });
      } catch (err) {
        if (controller.signal.aborted || seq !== reqSeqRef.current) return;
        setLoadError(
          err instanceof Error
            ? err.message
            : 'تعذر الاتصال بالخادم لتحميل المستندات.'
        );
      } finally {
        if (abortRef.current === controller) {
          abortRef.current = null;
        }
        if (seq === reqSeqRef.current) {
          setIsLoading(false);
        }
      }
    },
    []
  );

  const handleFilterSubmit = (event: React.FormEvent) => {
    event.preventDefault();
    void fetchDocuments({
      q: query,
      documentType: selectedType,
      matterId: selectedMatterId,
      partyId: selectedPartyId,
    });
  };

  const handleClearFilters = () => {
    setQuery('');
    setSelectedType('');
    setSelectedMatterId('');
    setSelectedPartyId('');
    void fetchDocuments({
      q: '',
      documentType: '',
      matterId: '',
      partyId: '',
    });
  };

  const hasActiveFilters = Boolean(
    appliedFilters.q ||
      appliedFilters.documentType ||
      appliedFilters.matterId ||
      appliedFilters.partyId
  );

  const hasFilterControlInput = hasActiveFilters || Boolean(query.trim());

  const handleDocumentUploaded = useCallback(
    (doc: DocumentDTO) => {
      if (hasActiveFilters) {
        void fetchDocuments(appliedFilters);
        return;
      }
      const prev = documentsRef.current;
      const alreadyExists = prev.some((existing) => existing.id === doc.id);
      const next = alreadyExists
        ? prev.map((existing) => (existing.id === doc.id ? doc : existing))
        : [doc, ...prev];
      documentsRef.current = next;
      setDocuments(next);
      if (!alreadyExists) {
        setTotal((currentTotal) => currentTotal + 1);
      }
    },
    [appliedFilters, fetchDocuments, hasActiveFilters]
  );

  return (
    <div className="space-y-6 min-w-0 max-w-full" data-testid="documents-view">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 pb-4 border-b border-[#D5DFE3]">
        <div className="space-y-1 min-w-0">
          <h1 className="text-2xl font-bold text-[#172A35]">المستندات</h1>
          <p className="text-sm text-[#4D606A]">
            أرشيف المستندات الخاصة المرتبطة بملفات القضايا والأطراف.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2 shrink-0">
          <button
            type="button"
            data-testid="documents-refresh-button"
            onClick={() =>
              void fetchDocuments({
                q: query,
                documentType: selectedType,
                matterId: selectedMatterId,
                partyId: selectedPartyId,
              })
            }
            disabled={isLoading}
            className="inline-flex items-center justify-center gap-1.5 px-3.5 py-2.5 bg-white hover:bg-[#F4F6F7] text-[#172A35] border border-[#D5DFE3] text-sm font-medium rounded-[6px] min-h-[44px] disabled:opacity-50 focus:outline-none focus:ring-2 focus:ring-[#14566B] focus:ring-offset-2"
          >
            <IconRefresh className="w-4 h-4 text-[#14566B]" />
            <span>تحديث</span>
          </button>

          <button
            type="button"
            data-testid="open-upload-form-button"
            aria-expanded={isUploadOpen}
            onClick={() => setIsUploadOpen((prev) => !prev)}
            className="inline-flex items-center justify-center gap-2 px-4 py-2.5 bg-[#14566B] hover:bg-[#0F4354] text-white text-sm font-semibold rounded-[6px] shadow-xs min-h-[44px] focus:outline-none focus:ring-2 focus:ring-[#14566B] focus:ring-offset-2"
          >
            <IconPlus className="w-4 h-4" />
            <span>{isUploadOpen ? 'إخفاء نموذج الرفع' : 'رفع مستند جديد'}</span>
          </button>
        </div>
      </div>

      {/* Truthful ADR 0003 workspace banner */}
      <div
        data-testid="documents-adr0003-banner"
        className="rounded-[6px] bg-[#FFF7E6] border border-[#E0B46A] px-4 py-3 text-sm text-[#7A4A00] flex items-start gap-2.5"
      >
        <IconWarning className="w-5 h-5 shrink-0 mt-0.5" />
        <p className="leading-relaxed">
          تنبيه السياسة المعتمدة (ADR 0003): المستندات المرفوعة تُفحص من حيث الصيغة والحجم والتوقيع الرقمي دون فحص فيروسات تلقائي، وتظهر بحالة{' '}
          <strong>«{UNSCANNED_POLICY_NOTICE_AR}»</strong>.
        </p>
      </div>

      {/* Expandable Upload Form */}
      {isUploadOpen && (
        <DocumentUploadForm
          selectableMatters={selectableMatters}
          selectableParties={selectableParties}
          defaultMatterId={selectedMatterId || undefined}
          defaultPartyId={selectedPartyId || undefined}
          onDocumentUploaded={handleDocumentUploaded}
          onClose={() => setIsUploadOpen(false)}
        />
      )}

      {/* Filter Bar */}
      <form
        onSubmit={handleFilterSubmit}
        data-testid="documents-filter-form"
        className="bg-white rounded-[6px] border border-[#D5DFE3] p-4 shadow-xs space-y-3 min-w-0 max-w-full"
      >
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 min-w-0">
          <div className="min-w-0">
            <label
              htmlFor="documents-search-input"
              className="block text-xs font-semibold text-[#4D606A] mb-1"
            >
              بحث في العنوان أو اسم الملف
            </label>
            <input
              id="documents-search-input"
              data-testid="documents-search-input"
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="ابحث بعنوان المستند أو اسم الملف..."
              className="w-full max-w-full min-w-0 min-h-[44px] px-3 py-2 text-base bg-white text-[#172A35] border border-[#6E828C] rounded-[6px] focus:outline-none focus:ring-2 focus:ring-[#14566B]"
            />
          </div>

          <div className="min-w-0">
            <label
              htmlFor="documents-type-filter"
              className="block text-xs font-semibold text-[#4D606A] mb-1"
            >
              نوع المستند
            </label>
            <select
              id="documents-type-filter"
              data-testid="documents-type-filter"
              value={selectedType}
              onChange={(e) => {
                const nextType = e.target.value;
                setSelectedType(nextType);
                void fetchDocuments({
                  q: query,
                  documentType: nextType,
                  matterId: selectedMatterId,
                  partyId: selectedPartyId,
                });
              }}
              className="w-full max-w-full min-w-0 min-h-[44px] px-3 py-2 text-base bg-white text-[#172A35] border border-[#6E828C] rounded-[6px] focus:outline-none focus:ring-2 focus:ring-[#14566B]"
            >
              <option value="">كل الأنواع</option>
              {DOCUMENT_TYPE_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </div>

          <div className="min-w-0">
            <label
              htmlFor="documents-matter-filter"
              className="block text-xs font-semibold text-[#4D606A] mb-1"
            >
              ملف القضية
            </label>
            <select
              id="documents-matter-filter"
              data-testid="documents-matter-filter"
              value={selectedMatterId}
              onChange={(e) => {
                const nextMatter = e.target.value;
                setSelectedMatterId(nextMatter);
                void fetchDocuments({
                  q: query,
                  documentType: selectedType,
                  matterId: nextMatter,
                  partyId: selectedPartyId,
                });
              }}
              className="w-full max-w-full min-w-0 min-h-[44px] px-3 py-2 text-base bg-white text-[#172A35] border border-[#6E828C] rounded-[6px] focus:outline-none focus:ring-2 focus:ring-[#14566B]"
            >
              <option value="">كل القضايا</option>
              {selectableMatters.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.fileCode} — {m.title}
                </option>
              ))}
            </select>
          </div>

          <div className="flex items-end gap-2">
            <button
              type="submit"
              data-testid="documents-filter-submit"
              className="flex-1 inline-flex items-center justify-center gap-1.5 px-4 py-2.5 bg-[#14566B] hover:bg-[#0F4354] text-white text-sm font-semibold rounded-[6px] min-h-[44px] focus:outline-none focus:ring-2 focus:ring-[#14566B] focus:ring-offset-2"
            >
              <IconSearch className="w-4 h-4" />
              <span>بحث</span>
            </button>
            {hasFilterControlInput && (
              <button
                type="button"
                data-testid="documents-clear-filters"
                onClick={handleClearFilters}
                className="inline-flex items-center justify-center px-3.5 py-2.5 bg-white hover:bg-[#F4F6F7] text-[#172A35] border border-[#D5DFE3] text-sm font-medium rounded-[6px] min-h-[44px] focus:outline-none focus:ring-2 focus:ring-[#14566B]"
              >
                مسح الفلاتر
              </button>
            )}
          </div>
        </div>

        <div className="flex items-center justify-between text-xs text-[#4D606A] pt-1">
          <span data-testid="documents-total-count">
            إجمالي النتائج المعروضة: {documents.length} من {total}
          </span>
        </div>
      </form>

      {/* Content */}
      {isLoading && (
        <div className="bg-white rounded-[6px] border border-[#D5DFE3] p-8">
          <LoadingIndicator label="جارٍ تحميل المستندات..." />
        </div>
      )}

      {!isLoading && loadError && (
        <ErrorContainer
          title="تعذر تحميل المستندات"
          message={loadError}
          onRetry={() =>
            void fetchDocuments({
              q: query,
              documentType: selectedType,
              matterId: selectedMatterId,
              partyId: selectedPartyId,
            })
          }
        />
      )}

      {!isLoading && !loadError && documents.length === 0 && (
        <EmptyStateContainer
          testId="documents-empty-state"
          title="لا توجد مستندات مطابقة حالياً"
          description={
            hasActiveFilters
              ? 'لا توجد مستندات تطابق معايير البحث الحالية. يمكنك تغيير الفلاتر أو مسحها.'
              : 'لم يتم رفع أي مستندات بعد. ابدأ برفع أول مستند رقمي وربطه بالقضية أو الطرف المناسب.'
          }
          action={
            hasActiveFilters ? (
              <button
                type="button"
                onClick={handleClearFilters}
                className="inline-flex items-center justify-center px-5 py-2.5 bg-[#14566B] hover:bg-[#0F4354] text-white text-sm font-semibold rounded-[6px] min-h-[44px] focus:outline-none focus:ring-2 focus:ring-[#14566B] focus:ring-offset-2"
              >
                غيّر الفلاتر
              </button>
            ) : (
              <button
                type="button"
                onClick={() => setIsUploadOpen(true)}
                className="inline-flex items-center justify-center gap-2 px-5 py-2.5 bg-[#14566B] hover:bg-[#0F4354] text-white text-sm font-semibold rounded-[6px] min-h-[44px] focus:outline-none focus:ring-2 focus:ring-[#14566B] focus:ring-offset-2"
              >
                <IconPlus className="w-4 h-4" />
                <span>رفع مستند جديد</span>
              </button>
            )
          }
        />
      )}

      {!isLoading && !loadError && documents.length > 0 && (
        <div className="space-y-3" data-testid="documents-list">
          {documents.map((doc) => {
            const ver = doc.currentVersion;
            const scanBadgeClass = ver
              ? SCAN_STATUS_BADGE_CLASSES[ver.scanStatus]
              : SCAN_STATUS_BADGE_CLASSES.PENDING;
            const scanLabel = ver?.scanStatusLabel ?? UNSCANNED_POLICY_NOTICE_AR;

            return (
              <article
                key={doc.id}
                data-testid={`document-card-${doc.id}`}
                className="bg-white rounded-[6px] border border-[#D5DFE3] p-4 sm:p-5 shadow-xs space-y-3"
              >
                <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3">
                  <div className="space-y-1.5 min-w-0">
                    <div className="flex items-start gap-2.5 min-w-0">
                      <IconDocument className="w-5 h-5 text-[#14566B] shrink-0 mt-1" />
                      <h2 className="text-base font-bold text-[#172A35] break-words [overflow-wrap:anywhere]">
                        <Link
                          href={`/documents/${doc.id}`}
                          data-testid={`document-link-${doc.id}`}
                          className="hover:text-[#14566B] hover:underline focus:outline-none focus:ring-2 focus:ring-[#14566B] rounded-[4px]"
                        >
                          {doc.title}
                        </Link>
                      </h2>
                    </div>

                    <div className="flex flex-wrap items-center gap-2 text-xs">
                      <span className="inline-flex items-center px-2 py-0.5 rounded-[4px] border bg-[#E9F2F5] text-[#14566B] border-[#C2D9E2] font-semibold">
                        {DOCUMENT_TYPE_LABELS_AR[doc.documentType]}
                      </span>
                      <span
                        className={`inline-flex items-center px-2 py-0.5 rounded-[4px] border font-semibold ${SENSITIVITY_BADGE_CLASSES[doc.sensitivity]}`}
                      >
                        {SENSITIVITY_LABELS[doc.sensitivity]}
                      </span>
                      <span
                        data-testid={`document-scan-badge-${doc.id}`}
                        className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-[4px] border font-semibold ${scanBadgeClass}`}
                      >
                        <IconWarning className="w-3.5 h-3.5 shrink-0" />
                        <span>{scanLabel}</span>
                      </span>
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center gap-2 shrink-0">
                    <Link
                      href={`/documents/${doc.id}`}
                      data-testid={`document-open-detail-${doc.id}`}
                      className="inline-flex items-center justify-center px-4 py-2 bg-[#14566B] hover:bg-[#0F4354] text-white text-xs font-semibold rounded-[6px] min-h-[44px] focus:outline-none focus:ring-2 focus:ring-[#14566B] focus:ring-offset-2"
                    >
                      معاينة والتفاصيل
                    </Link>

                    {ver?.isReady && (
                      <a
                        href={`/api/documents/${doc.id}/content?disposition=attachment&versionId=${ver.id}`}
                        download
                        data-testid={`document-card-download-${doc.id}`}
                        className="inline-flex items-center justify-center gap-1.5 px-3.5 py-2 bg-white hover:bg-[#F4F6F7] text-[#172A35] border border-[#D5DFE3] text-xs font-semibold rounded-[6px] min-h-[44px] focus:outline-none focus:ring-2 focus:ring-[#14566B]"
                      >
                        <IconDownload className="w-4 h-4 text-[#14566B]" />
                        <span>تحميل</span>
                      </a>
                    )}
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2 pt-2 border-t border-[#E5ECEE] text-xs text-[#4D606A]">
                  <div className="min-w-0 break-words">
                    <span className="font-semibold text-[#172A35]">الربط: </span>
                    {doc.matterId ? (
                      <Link
                        href={`/matters/${doc.matterId}`}
                        className="text-[#14566B] hover:underline font-medium"
                      >
                        <bdi dir="ltr">{doc.matterFileCode}</bdi> — {doc.matterTitle}
                      </Link>
                    ) : doc.partyId ? (
                      <Link
                        href={`/parties/${doc.partyId}`}
                        className="text-[#14566B] hover:underline font-medium"
                      >
                        {doc.partyName}
                      </Link>
                    ) : (
                      '—'
                    )}
                    {doc.proceedingLabel && (
                      <span className="block mt-0.5 text-[#4D606A]">
                        القيد: {doc.proceedingLabel}
                      </span>
                    )}
                  </div>

                  {ver && (
                    <div className="min-w-0 break-all">
                      <span className="font-semibold text-[#172A35]">الملف: </span>
                      <bdi dir="ltr">{ver.originalFilename}</bdi>
                      <span className="mx-1">•</span>
                      <span>{formatFileSizeArabic(ver.sizeBytes)}</span>
                    </div>
                  )}

                  <div>
                    <span className="font-semibold text-[#172A35]">تاريخ المستند: </span>
                    <span>
                      {doc.documentDate ? formatCairoDateArabic(doc.documentDate) : 'غير محدد'}
                    </span>
                  </div>
                </div>
              </article>
            );
          })}
        </div>
      )}
    </div>
  );
}

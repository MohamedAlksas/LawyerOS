'use client';

import React, { useState, useCallback, useRef, useEffect } from 'react';
import Link from 'next/link';
import { searchMattersAction } from '@/modules/matters/matter-actions';
import { MatterListItemDTO, MatterKind, MatterStatus } from '@/modules/matters/matter-types';
import {
  MATTER_KIND_LABELS,
  MATTER_STATUS_LABELS,
  MATTER_STATUS_CLASSES,
  formatCairoDateOnly,
} from './matter-ui-types';
import {
  LoadingIndicator,
  ErrorContainer,
  EmptyStateContainer,
} from '@/components/presentation-state';

interface MatterListClientProps {
  initialMatters?: MatterListItemDTO[];
  initialTotal?: number;
  initialPage?: number;
  initialTotalPages?: number;
  initialLimit?: number;
  initialQuery?: string;
  initialKind?: MatterKind;
  initialStatus?: MatterStatus;
  initialCourtId?: string;
  initialClientId?: string;
  initialIncompleteData?: boolean;
  initialIncludeArchived?: boolean;
  initialError?: string;
  courts?: { id: string; name: string }[];
  clients?: { id: string; name: string }[];
}

export function MatterListClient({
  initialMatters = [],
  initialTotal = 0,
  initialPage = 1,
  initialTotalPages = 1,
  initialLimit = 20,
  initialQuery = '',
  initialKind,
  initialStatus,
  initialCourtId,
  initialClientId,
  initialIncompleteData = false,
  initialIncludeArchived = false,
  initialError,
  courts = [],
  clients = [],
}: MatterListClientProps) {
  const [query, setQuery] = useState(() => {
    if (typeof window !== 'undefined') {
      const urlQ = new URLSearchParams(window.location.search).get('query');
      if (urlQ) return urlQ;
      const transient = (window.history.state as { searchTransientQuery?: string } | null)?.searchTransientQuery;
      if (transient) return transient;
    }
    return initialQuery;
  });
  const [selectedKind, setSelectedKind] = useState<MatterKind | undefined>(initialKind);
  const [selectedStatus, setSelectedStatus] = useState<MatterStatus | undefined>(initialStatus);
  const [selectedCourtId, setSelectedCourtId] = useState<string | undefined>(initialCourtId);
  const [selectedClientId, setSelectedClientId] = useState<string | undefined>(initialClientId);
  const [incompleteData, setIncompleteData] = useState<boolean>(initialIncompleteData);
  const [includeArchived, setIncludeArchived] = useState<boolean>(initialIncludeArchived);
  const [page, setPage] = useState<number>(() => {
    if (typeof window !== 'undefined') {
      const urlP = parseInt(new URLSearchParams(window.location.search).get('page') || '', 10);
      if (!isNaN(urlP) && urlP > 0) return urlP;
    }
    return initialPage;
  });
  const [totalPages, setTotalPages] = useState<number>(initialTotalPages);
  const [limit] = useState<number>(initialLimit);
  const [matters, setMatters] = useState<MatterListItemDTO[]>(initialMatters);
  const [totalCount, setTotalCount] = useState<number>(initialTotal);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(initialError || null);

  const requestGenRef = useRef(0);
  const requestedPageRef = useRef<number>(initialPage);

  type FetchMattersFn = (
    searchQuery: string,
    kind?: MatterKind,
    status?: MatterStatus,
    incArch?: boolean,
    pageNum?: number,
    court?: string,
    client?: string,
    incData?: boolean
  ) => Promise<void>;

  const fetchMattersRef = useRef<FetchMattersFn | null>(null);

  const syncUrl = useCallback(
    (
      q: string,
      k?: MatterKind,
      s?: MatterStatus,
      incArch?: boolean,
      p?: number,
      court?: string,
      client?: string,
      incData?: boolean
    ) => {
      if (typeof window === 'undefined') return;
      const params = new URLSearchParams();
      // Omit `query` from the URL string completely so no private names or numbers appear in browser history or URLs
      if (k) params.set('kind', k);
      if (s) params.set('status', s);
      if (court) params.set('courtId', court);
      if (client) params.set('clientId', client);
      if (incData) params.set('incompleteData', 'true');
      if (incArch) params.set('includeArchived', 'true');
      if (p && p > 1) params.set('page', String(p));
      const newQuery = params.toString();
      const cleanUrl = newQuery ? `${window.location.pathname}?${newQuery}` : window.location.pathname;
      const currentState = (window.history.state && typeof window.history.state === 'object') ? window.history.state : {};
      window.history.replaceState({ ...currentState, searchTransientQuery: q }, '', cleanUrl);
    },
    []
  );

  const fetchMatters = useCallback(
    async (
      searchQuery: string,
      kind?: MatterKind,
      status?: MatterStatus,
      incArch: boolean = false,
      pageNum: number = 1,
      court?: string,
      client?: string,
      incData: boolean = false
    ) => {
      const currentGen = ++requestGenRef.current;
      requestedPageRef.current = pageNum;
      setIsLoading(true);
      setError(null);
      syncUrl(searchQuery, kind, status, incArch, pageNum, court, client, incData);

      try {
        const res = await searchMattersAction({
          query: searchQuery.trim() || undefined,
          kind,
          status,
          courtId: court,
          clientId: client,
          incompleteData: incData,
          includeArchived: incArch,
          page: pageNum,
          limit,
        });

        if (currentGen !== requestGenRef.current) return;

        if (!res.success) {
          setError(res.error || 'تعذر تحميل ملفات القضايا.');
          setIsLoading(false);
          return;
        }

        // When the result set shrinks, clamp and refetch the last valid page
        if (res.data.matters.length === 0 && pageNum > 1 && res.data.total > 0) {
          const lastValidPage = Math.max(1, Math.ceil(res.data.total / limit));
          if (lastValidPage !== pageNum) {
            await fetchMattersRef.current?.(searchQuery, kind, status, incArch, lastValidPage, court, client, incData);
            return;
          }
        }

        setMatters(res.data.matters);
        setTotalCount(res.data.total);
        setPage(res.data.page ?? pageNum);
        setTotalPages(res.data.totalPages ?? 1);
        setIsLoading(false);
      } catch (err: unknown) {
        if (currentGen !== requestGenRef.current) return;
        setError(
          err instanceof Error
            ? err.message
            : 'حدث خطأ في الاتصال أثناء تحميل ملفات القضايا.'
        );
        setIsLoading(false);
      }
    },
    [limit, syncUrl]
  );

  useEffect(() => {
    fetchMattersRef.current = fetchMatters;
  });

  const handleSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setPage(1);
    fetchMatters(query, selectedKind, selectedStatus, includeArchived, 1, selectedCourtId, selectedClientId, incompleteData);
  };

  const handleKindChange = (kind?: MatterKind) => {
    setSelectedKind(kind);
    setPage(1);
    fetchMatters(query, kind, selectedStatus, includeArchived, 1, selectedCourtId, selectedClientId, incompleteData);
  };

  const handleStatusChange = (status?: MatterStatus) => {
    setSelectedStatus(status);
    setPage(1);
    fetchMatters(query, selectedKind, status, includeArchived, 1, selectedCourtId, selectedClientId, incompleteData);
  };

  const handleCourtChange = (courtId?: string) => {
    setSelectedCourtId(courtId);
    setPage(1);
    fetchMatters(query, selectedKind, selectedStatus, includeArchived, 1, courtId, selectedClientId, incompleteData);
  };

  const handleClientChange = (clientId?: string) => {
    setSelectedClientId(clientId);
    setPage(1);
    fetchMatters(query, selectedKind, selectedStatus, includeArchived, 1, selectedCourtId, clientId, incompleteData);
  };

  const handleIncompleteDataChange = (checked: boolean) => {
    setIncompleteData(checked);
    setPage(1);
    fetchMatters(query, selectedKind, selectedStatus, includeArchived, 1, selectedCourtId, selectedClientId, checked);
  };

  const handleIncludeArchivedChange = (checked: boolean) => {
    setIncludeArchived(checked);
    setPage(1);
    fetchMatters(query, selectedKind, selectedStatus, checked, 1, selectedCourtId, selectedClientId, incompleteData);
  };

  const handleClearFilters = () => {
    setQuery('');
    setSelectedKind(undefined);
    setSelectedStatus(undefined);
    setSelectedCourtId(undefined);
    setSelectedClientId(undefined);
    setIncompleteData(false);
    setIncludeArchived(false);
    setPage(1);
    fetchMatters('', undefined, undefined, false, 1, undefined, undefined, false);
  };

  const handlePageChange = (newPage: number) => {
    setPage(newPage);
    fetchMatters(query, selectedKind, selectedStatus, includeArchived, newPage, selectedCourtId, selectedClientId, incompleteData);
  };

  // Clean URL on initial mount if coming with query in searchParams
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const urlParams = new URLSearchParams(window.location.search);
    const urlQuery = urlParams.get('query');
    if (urlQuery) {
      syncUrl(urlQuery, selectedKind, selectedStatus, includeArchived, page, selectedCourtId, selectedClientId, incompleteData);
    }
  }, [syncUrl, selectedKind, selectedStatus, includeArchived, page, selectedCourtId, selectedClientId, incompleteData]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const syncFromUrl = (event?: PopStateEvent | PageTransitionEvent) => {
      const params = new URLSearchParams(window.location.search);
      const urlPage = parseInt(params.get('page') || '1', 10) || 1;
      const urlKind = (params.get('kind') as MatterKind) || undefined;
      const urlStatus = (params.get('status') as MatterStatus) || undefined;
      const urlCourt = params.get('courtId') || undefined;
      const urlClient = params.get('clientId') || undefined;
      const urlIncData = params.get('incompleteData') === 'true';
      const urlIncArch = params.get('includeArchived') === 'true';
      const restoredQuery =
        ((event as PopStateEvent)?.state?.searchTransientQuery as string | undefined) ??
        (window.history.state?.searchTransientQuery as string | undefined) ??
        '';

      setQuery(restoredQuery);
      setSelectedKind(urlKind);
      setSelectedStatus(urlStatus);
      setSelectedCourtId(urlCourt);
      setSelectedClientId(urlClient);
      setIncompleteData(urlIncData);
      setIncludeArchived(urlIncArch);
      setPage(urlPage);
      fetchMatters(restoredQuery, urlKind, urlStatus, urlIncArch, urlPage, urlCourt, urlClient, urlIncData);
    };

    window.addEventListener('popstate', syncFromUrl);
    window.addEventListener('pageshow', syncFromUrl);
    return () => {
      window.removeEventListener('popstate', syncFromUrl);
      window.removeEventListener('pageshow', syncFromUrl);
    };
  }, [fetchMatters]);

  const hasActiveFilters = Boolean(
    query.trim() ||
      selectedKind ||
      selectedStatus ||
      selectedCourtId ||
      selectedClientId ||
      incompleteData ||
      includeArchived
  );

  return (
    <div className="space-y-6">
      {/* Header & Quick Action */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 pb-4 border-b border-[#D5DFE3]">
        <div className="space-y-1">
          <h1 className="text-2xl font-bold text-[#172A35] tracking-tight">
            ملفات القضايا والخدمات القانونية
          </h1>
          <p className="text-xs text-[#4D606A] leading-relaxed">
            تنظيم ومتابعة ملفات القضايا الداخلية، القيود بالمحاكم، الأطراف، وسندات الوكالة.
          </p>
        </div>

        <Link
          href="/matters/new"
          data-testid="new-matter-button"
          className="inline-flex items-center justify-center gap-2 px-4 py-2.5 bg-[#14566B] hover:bg-[#0F4354] text-white text-sm font-semibold rounded-[6px] shadow-xs transition-colors focus:outline-none focus:ring-2 focus:ring-[#14566B] focus:ring-offset-2 min-h-[44px]"
        >
          <span aria-hidden="true" className="text-base">➕</span>
          <span>فتح ملف جديد</span>
        </Link>
      </div>

      {/* Search and Filters Bar */}
      <div className="bg-white rounded-[6px] border border-[#D5DFE3] p-4 shadow-xs space-y-4">
        <form onSubmit={handleSearchSubmit} className="flex flex-col sm:flex-row gap-3">
          <div className="relative flex-1">
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="ابحث بالعنوان أو كود الملف (مثال: 2026/0001)..."
              aria-label="البحث في ملفات القضايا"
              data-testid="matters-search-input"
              className="w-full pl-3 pr-10 py-2 text-sm bg-white border border-[#D5DFE3] rounded-[6px] text-[#172A35] placeholder-[#4D606A] focus:outline-none focus:ring-2 focus:ring-[#14566B] focus:border-transparent min-h-[44px]"
            />
            <span
              className="absolute right-3 top-1/2 -translate-y-1/2 text-base text-[#4D606A] pointer-events-none"
              aria-hidden="true"
            >
              🔍
            </span>
          </div>

          <div className="flex gap-2">
            <button
              type="submit"
              data-testid="matters-search-submit"
              className="px-5 py-2 bg-[#14566B] hover:bg-[#0F4354] text-white text-sm font-medium rounded-[6px] transition-colors focus:outline-none focus:ring-2 focus:ring-[#14566B] focus:ring-offset-2 min-h-[44px]"
            >
              بحث
            </button>
            {hasActiveFilters && (
              <button
                type="button"
                data-testid="matters-clear-filters"
                onClick={handleClearFilters}
                className="px-4 py-2 bg-[#F4F6F7] hover:bg-[#E8EEF1] text-[#172A35] text-sm font-medium rounded-[6px] border border-[#D5DFE3] transition-colors focus:outline-none focus:ring-2 focus:ring-[#14566B] min-h-[44px]"
              >
                مسح
              </button>
            )}
          </div>
        </form>

        {/* Filter Pills */}
        <div className="flex flex-wrap items-center justify-between gap-3 pt-2 border-t border-[#E8EEF1]">
          <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="تصفية حسب طبيعة الملف">
            <span className="text-xs font-semibold text-[#4D606A] ml-1">النوع:</span>
            <button
              type="button"
              data-testid="filter-kind-all"
              onClick={() => handleKindChange(undefined)}
              aria-pressed={selectedKind === undefined}
              className={`px-3 py-1.5 text-xs font-medium rounded-[6px] min-h-[36px] transition-colors focus:outline-none focus:ring-2 focus:ring-[#14566B] ${
                selectedKind === undefined
                  ? 'bg-[#14566B] text-white shadow-xs'
                  : 'bg-[#F4F6F7] text-[#172A35] hover:bg-[#E8EEF1]'
              }`}
            >
              الكل
            </button>
            {(['LITIGATION', 'CONSULTATION', 'CONTRACT', 'OTHER'] as MatterKind[]).map((kind) => (
              <button
                key={kind}
                type="button"
                data-testid={`filter-kind-${kind.toLowerCase()}`}
                onClick={() => handleKindChange(kind)}
                aria-pressed={selectedKind === kind}
                className={`px-3 py-1.5 text-xs font-medium rounded-[6px] min-h-[36px] transition-colors focus:outline-none focus:ring-2 focus:ring-[#14566B] ${
                  selectedKind === kind
                    ? 'bg-[#14566B] text-white shadow-xs'
                    : 'bg-[#F4F6F7] text-[#172A35] hover:bg-[#E8EEF1]'
                }`}
              >
                {MATTER_KIND_LABELS[kind]}
              </button>
            ))}
          </div>

          <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="تصفية حسب الحالة">
            <span className="text-xs font-semibold text-[#4D606A] ml-1">الحالة:</span>
            <button
              type="button"
              data-testid="filter-status-all"
              onClick={() => handleStatusChange(undefined)}
              aria-pressed={selectedStatus === undefined}
              className={`px-2.5 py-1 text-xs font-medium rounded-[6px] min-h-[32px] transition-colors focus:outline-none focus:ring-2 focus:ring-[#14566B] ${
                selectedStatus === undefined
                  ? 'bg-[#14566B] text-white'
                  : 'bg-[#F4F6F7] text-[#172A35] hover:bg-[#E8EEF1]'
              }`}
            >
              الكل
            </button>
            {(['ACTIVE', 'DRAFT', 'ON_HOLD', 'CLOSED', 'ARCHIVED'] as MatterStatus[]).map((st) => (
              <button
                key={st}
                type="button"
                data-testid={`filter-status-${st.toLowerCase()}`}
                onClick={() => handleStatusChange(st)}
                aria-pressed={selectedStatus === st}
                className={`px-2.5 py-1 text-xs font-medium rounded-[6px] min-h-[32px] transition-colors focus:outline-none focus:ring-2 focus:ring-[#14566B] ${
                  selectedStatus === st
                    ? 'bg-[#14566B] text-white'
                    : 'bg-[#F4F6F7] text-[#172A35] hover:bg-[#E8EEF1]'
                }`}
              >
                {MATTER_STATUS_LABELS[st]}
              </button>
            ))}
          </div>

          {/* Include Archived Toggle */}
          <div className="flex items-center gap-2">
            <label className="inline-flex items-center gap-2 cursor-pointer select-none text-xs font-medium text-[#172A35] py-1 px-2 rounded hover:bg-[#F4F6F7]">
              <input
                type="checkbox"
                data-testid="include-archived-checkbox"
                checked={includeArchived}
                onChange={(e) => handleIncludeArchivedChange(e.target.checked)}
                className="w-4 h-4 rounded text-[#14566B] focus:ring-[#14566B] border-[#D5DFE3]"
              />
              <span>تضمين الملفات المؤرشفة</span>
            </label>
          </div>

          <div className="text-xs font-medium text-[#4D606A]" data-testid="matters-total-count">
            إجمالي الملفات: <span className="font-bold text-[#172A35]">{totalCount}</span>
          </div>
        </div>

        {/* Extended Filters: Court, Client, Incomplete Data */}
        <div className="flex flex-wrap items-center justify-between gap-3 pt-2 border-t border-[#E8EEF1]">
          <div className="flex flex-wrap items-center gap-3">
            {/* Court Filter */}
            <div className="flex items-center gap-1.5">
              <label htmlFor="filter-court" className="text-xs font-semibold text-[#4D606A]">المحكمة:</label>
              <select
                id="filter-court"
                data-testid="filter-court-select"
                value={selectedCourtId || ''}
                onChange={(e) => handleCourtChange(e.target.value || undefined)}
                className="text-xs py-1.5 px-2.5 border border-[#D5DFE3] rounded-[6px] bg-white text-[#172A35] min-h-[36px] focus:outline-none focus:ring-2 focus:ring-[#14566B]"
              >
                <option value="">كل المحاكم</option>
                {courts.map((c) => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </select>
            </div>

            {/* Client Filter */}
            <div className="flex items-center gap-1.5">
              <label htmlFor="filter-client" className="text-xs font-semibold text-[#4D606A]">الموكل:</label>
              <select
                id="filter-client"
                data-testid="filter-client-select"
                value={selectedClientId || ''}
                onChange={(e) => handleClientChange(e.target.value || undefined)}
                className="text-xs py-1.5 px-2.5 border border-[#D5DFE3] rounded-[6px] bg-white text-[#172A35] min-h-[36px] focus:outline-none focus:ring-2 focus:ring-[#14566B]"
              >
                <option value="">كل الموكلين</option>
                {clients.map((cl) => (
                  <option key={cl.id} value={cl.id}>{cl.name}</option>
                ))}
              </select>
            </div>

            {/* Incomplete Data Toggle */}
            <label className="inline-flex items-center gap-2 cursor-pointer select-none text-xs font-medium text-[#172A35] py-1 px-2 rounded hover:bg-[#F4F6F7]">
              <input
                type="checkbox"
                data-testid="incomplete-data-checkbox"
                checked={incompleteData}
                onChange={(e) => handleIncompleteDataChange(e.target.checked)}
                className="w-4 h-4 rounded text-[#14566B] focus:ring-[#14566B] border-[#D5DFE3]"
              />
              <span>بيانات غير مكتملة</span>
            </label>
          </div>
        </div>
      </div>

      {/* Content Area */}
      {isLoading ? (
        <LoadingIndicator label="جارٍ تحميل ملفات القضايا..." />
      ) : error ? (
        <ErrorContainer
          title="تعذر تحميل ملفات القضايا"
          message={error}
          onRetry={() =>
            fetchMatters(
              query,
              selectedKind,
              selectedStatus,
              includeArchived,
              requestedPageRef.current,
              selectedCourtId,
              selectedClientId,
              incompleteData
            )
          }
        />
      ) : matters.length === 0 ? (
        hasActiveFilters ? (
          <EmptyStateContainer
            testId="empty-search-container"
            icon="🔍"
            title="لم يتم العثور على نتائج"
            description="لا توجد ملفات مطابقة لمعايير البحث الحالية."
            action={
              <button
                type="button"
                onClick={handleClearFilters}
                className="px-4 py-2 bg-[#14566B] text-white text-sm font-medium rounded-[6px] min-h-[44px]"
              >
                مسح الفلاتر وعرض الكل
              </button>
            }
          />
        ) : (
          <EmptyStateContainer
            testId="empty-state-container"
            icon="📁"
            title="لا توجد ملفات قضايا مسجلة حتى الآن"
            description="ابدأ بفتح أول ملف قضية أو استشارة في المكتب لتنظيم الجلسات والمستندات."
            action={
              <Link
                href="/matters/new"
                className="inline-flex items-center justify-center gap-2 px-4 py-2.5 bg-[#14566B] text-white text-sm font-medium rounded-[6px] min-h-[44px]"
              >
                <span>فتح ملف قضية جديد</span>
              </Link>
            }
          />
        )
      ) : (
        <div className="space-y-4">
          {/* Desktop Table View */}
          <div className="hidden md:block bg-white rounded-[6px] border border-[#D5DFE3] overflow-hidden shadow-xs">
            <div className="overflow-x-auto">
              <table
                data-testid="matters-table"
                className="w-full text-right text-sm text-[#172A35] border-collapse"
              >
                <thead className="bg-[#F4F6F7] text-xs font-semibold text-[#4D606A] border-b border-[#D5DFE3]">
                  <tr>
                    <th scope="col" className="px-4 py-3">كود الملف</th>
                    <th scope="col" className="px-4 py-3">عنوان الملف</th>
                    <th scope="col" className="px-4 py-3">النوع والتخصص</th>
                    <th scope="col" className="px-4 py-3">الموكل الأساسي</th>
                    <th scope="col" className="px-4 py-3">الحالة</th>
                    <th scope="col" className="px-4 py-3">الحفظ الورقي</th>
                    <th scope="col" className="px-4 py-3">تاريخ الفتح</th>
                    <th scope="col" className="px-4 py-3 text-center">الإجراءات</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#E8EEF1]">
                  {matters.map((matter) => {
                    const primaryClient = matter.primaryClientName;
                    const otherClientCount = Math.max(0, matter.clientCount - 1);

                    return (
                      <tr
                        key={matter.id}
                        data-testid={`matter-row-${matter.id}`}
                        className="hover:bg-[#F9FBFC] transition-colors"
                      >
                        <td className="px-4 py-3 font-semibold">
                          <bdi dir="ltr" className="font-mono text-xs text-[#14566B] bg-slate-50 px-2 py-0.5 rounded border border-slate-200 inline-block">
                            {matter.fileCode}
                          </bdi>
                        </td>
                        <td className="px-4 py-3 font-semibold text-[#172A35] max-w-xs truncate">
                          <Link
                            href={`/matters/${matter.id}`}
                            className="hover:text-[#14566B] hover:underline focus:outline-none focus:ring-1 focus:ring-[#14566B] rounded"
                          >
                            {matter.title}
                          </Link>
                        </td>
                        <td className="px-4 py-3 text-xs">
                          <div className="flex flex-col gap-0.5">
                            <span className="font-medium text-[#172A35]">
                              {MATTER_KIND_LABELS[matter.kind]}
                            </span>
                            {matter.practiceAreaName && (
                              <span className="text-[#4D606A]">
                                {matter.practiceAreaName}
                              </span>
                            )}
                          </div>
                        </td>
                        <td className="px-4 py-3 text-xs">
                          {primaryClient ? (
                            <div className="flex items-center gap-1.5">
                              <span className="font-semibold text-[#172A35]">
                                {primaryClient}
                              </span>
                              {otherClientCount > 0 && (
                                <span className="text-[10px] bg-slate-100 text-[#4D606A] px-1.5 py-0.5 rounded border border-slate-200">
                                  +{otherClientCount}
                                </span>
                              )}
                            </div>
                          ) : (
                            <span className="text-[#4D606A] italic">بدون موكل (مسودة)</span>
                          )}
                        </td>
                        <td className="px-4 py-3">
                          {matter.status === 'ARCHIVED' || matter.archivedAt ? (
                            <span
                              data-testid="matter-archived-badge"
                              className="inline-flex items-center px-2 py-0.5 rounded text-xs font-semibold border bg-stone-100 text-stone-700 border-stone-300"
                            >
                              مؤرشف
                            </span>
                          ) : (
                            <span
                              className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-semibold border ${
                                MATTER_STATUS_CLASSES[matter.status]
                              }`}
                            >
                              {MATTER_STATUS_LABELS[matter.status]}
                            </span>
                          )}
                        </td>
                        <td className="px-4 py-3 text-xs">
                          {matter.paperLocationName ? (
                            <span className="text-[#172A35]">{matter.paperLocationName}</span>
                          ) : (
                            <span className="text-amber-700 bg-amber-50 px-1.5 py-0.5 rounded border border-amber-200 inline-flex items-center gap-1">
                              <span>⚠️</span>
                              <span>غير محدد</span>
                            </span>
                          )}
                        </td>
                        <td className="px-4 py-3 text-xs text-[#4D606A]">
                          {formatCairoDateOnly(matter.openingDate)}
                        </td>
                        <td className="px-4 py-3 text-center">
                          <Link
                            href={`/matters/${matter.id}`}
                            data-testid={`view-matter-${matter.id}`}
                            className="inline-flex items-center justify-center px-3 py-1.5 text-xs font-semibold text-[#14566B] hover:bg-[#E8EEF1] rounded-[6px] border border-[#D5DFE3] transition-colors min-h-[36px]"
                          >
                            عرض الملف
                          </Link>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>

          {/* Mobile Card View */}
          <div className="md:hidden space-y-3">
            {matters.map((matter) => {
              const primaryClient = matter.primaryClientName;

              return (
                <div
                  key={matter.id}
                  data-testid={`matter-card-${matter.id}`}
                  className="bg-white rounded-[6px] border border-[#D5DFE3] p-4 shadow-xs space-y-3"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0 space-y-1">
                      <bdi dir="ltr" className="font-mono text-xs text-[#14566B] bg-slate-50 px-2 py-0.5 rounded border border-slate-200 inline-block font-bold">
                        {matter.fileCode}
                      </bdi>
                      <h2 className="text-base font-bold text-[#172A35] leading-snug break-words">
                        <Link
                          href={`/matters/${matter.id}`}
                          className="hover:text-[#14566B] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#14566B]"
                        >
                          {matter.title}
                        </Link>
                      </h2>
                    </div>
                    {matter.status === 'ARCHIVED' || matter.archivedAt ? (
                      <span
                        data-testid="matter-archived-badge"
                        className="inline-flex items-center px-2 py-0.5 rounded text-xs font-semibold border shrink-0 bg-stone-100 text-stone-700 border-stone-300"
                      >
                        مؤرشف
                      </span>
                    ) : (
                      <span
                        className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-semibold border shrink-0 ${
                          MATTER_STATUS_CLASSES[matter.status]
                        }`}
                      >
                        {MATTER_STATUS_LABELS[matter.status]}
                      </span>
                    )}
                  </div>

                  <div className="text-xs text-[#4D606A] space-y-1.5 pt-2 border-t border-[#E8EEF1]">
                    <div className="flex justify-between items-center">
                      <span className="font-medium">الموكل:</span>
                      <span className="font-semibold text-[#172A35]">
                        {primaryClient ? primaryClient : '— (مسودة)'}
                      </span>
                    </div>

                    <div className="flex justify-between items-center">
                      <span className="font-medium">النوع:</span>
                      <span className="text-[#172A35]">
                        {MATTER_KIND_LABELS[matter.kind]}
                        {matter.practiceAreaName ? ` — ${matter.practiceAreaName}` : ''}
                      </span>
                    </div>

                    <div className="flex justify-between items-center">
                      <span className="font-medium">الحفظ الورقي:</span>
                      <span>
                        {matter.paperLocationName ? (
                          matter.paperLocationName
                        ) : (
                          <span className="text-amber-700 font-medium">⚠️ غير محدد</span>
                        )}
                      </span>
                    </div>
                  </div>

                  <div className="pt-2">
                    <Link
                      href={`/matters/${matter.id}`}
                      className="w-full flex items-center justify-center px-4 py-2 bg-[#F4F6F7] hover:bg-[#E8EEF1] text-[#14566B] text-xs font-bold rounded-[6px] border border-[#D5DFE3] min-h-[44px]"
                    >
                      عرض ملف القضية الكامل
                    </Link>
                  </div>
                </div>
              );
            })}
          </div>

          {/* Pagination Controls */}
          {totalPages > 1 && (
            <div
              data-testid="pagination-controls"
              className="flex items-center justify-between bg-white px-4 py-3 rounded-[6px] border border-[#D5DFE3] text-sm"
            >
              <button
                type="button"
                data-testid="prev-page-button"
                onClick={() => handlePageChange(page - 1)}
                disabled={page <= 1}
                className="px-3 py-1.5 text-xs font-medium rounded-[6px] border border-[#D5DFE3] text-[#172A35] hover:bg-[#E8EEF1] disabled:opacity-40 disabled:cursor-not-allowed min-h-[44px]"
              >
                السابق
              </button>

              <span className="text-xs text-[#4D606A]">
                صفحة <span className="font-bold text-[#172A35]">{page}</span> من{' '}
                <span className="font-bold text-[#172A35]">{totalPages}</span>
              </span>

              <button
                type="button"
                data-testid="next-page-button"
                onClick={() => handlePageChange(page + 1)}
                disabled={page >= totalPages}
                className="px-3 py-1.5 text-xs font-medium rounded-[6px] border border-[#D5DFE3] text-[#172A35] hover:bg-[#E8EEF1] disabled:opacity-40 disabled:cursor-not-allowed min-h-[44px]"
              >
                التالي
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

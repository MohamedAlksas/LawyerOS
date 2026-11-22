'use client';

import React, { useState, useCallback, useRef, useEffect } from 'react';
import Link from 'next/link';
import { searchMattersAction, searchMatterClientsAction } from '@/modules/matters/matter-actions';
import {
  bindSearchSession,
  clearSearchSessionStore,
  readSearchHistory,
  writeSearchHistory,
} from '@/lib/search-session-store';
import { DEFAULT_SEARCH_LIMIT, matterSearchFilters, readParam } from '@/lib/search-params';
import { MatterListItemDTO, MatterKind, MatterStatus } from '@/modules/matters/matter-types';
import {
  MATTER_KIND_LABELS,
  MATTER_STATUS_LABELS,
  MATTER_STATUS_CLASSES,
  formatCairoDateOnly,
  isAuthRecoveryCode,
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
  initialKind?: MatterKind;
  initialStatus?: MatterStatus;
  initialCourtId?: string;
  initialIncompleteData?: boolean;
  initialIncludeArchived?: boolean;
  initialError?: string;
  courts?: { id: string; name: string }[];
  clients?: { id: string; name: string }[];
  sessionId: string;
}

type MatterView = ReturnType<typeof matterSearchFilters>;
type ClientOption = { id: string; name: string };

function includesArchivedClients(view: MatterView) {
  return view.includeArchived || view.status === 'ARCHIVED';
}

export function MatterListClient({
  initialMatters = [],
  initialTotal = 0,
  initialPage = 1,
  initialTotalPages = 1,
  initialLimit = DEFAULT_SEARCH_LIMIT,
  initialKind,
  initialStatus,
  initialCourtId,
  initialIncompleteData = false,
  initialIncludeArchived = false,
  initialError,
  courts = [],
  clients = [],
  sessionId,
}: MatterListClientProps) {
  const [query, setQuery] = useState('');
  const [selectedClient, setSelectedClient] = useState<ClientOption>();
  const selectedClientId = selectedClient?.id;
  const [view, setView] = useState<MatterView>({
    kind: initialKind,
    status: initialStatus,
    courtId: initialCourtId,
    incompleteData: initialIncompleteData,
    includeArchived: initialIncludeArchived,
    page: initialPage,
    limit: initialLimit,
  });
  const { kind: selectedKind, status: selectedStatus, courtId: selectedCourtId, incompleteData, includeArchived, page } = view;
  const [totalPages, setTotalPages] = useState(initialTotalPages);
  const [matters, setMatters] = useState(initialMatters);
  const [totalCount, setTotalCount] = useState(initialTotal);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(initialError ?? null);
  const requestGenRef = useRef(0);
  const cancelMatterSearch = useCallback(() => {
    requestGenRef.current++;
  }, []);

  const [clientsList, setClientsList] = useState(clients);
  const [isClientPickerOpen, setIsClientPickerOpen] = useState(false);
  const [clientPickerQuery, setClientPickerQuery] = useState('');
  const [isSearchingClients, setIsSearchingClients] = useState(false);
  const [clientSearchError, setClientSearchError] = useState<string | null>(null);
  const [clientPickerPage, setClientPickerPage] = useState(1);
  const [clientPickerTotalPages, setClientPickerTotalPages] = useState(1);
  const [clientPickerTotalCount, setClientPickerTotalCount] = useState(clients.length);
  const clientPickerRef = useRef<HTMLDivElement>(null);
  const searchClientsTimeoutRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const clientSearchGenRef = useRef(0);

  const clientSelectOptions = selectedClient && !clientsList.some(({ id }) => id === selectedClient.id)
    ? [selectedClient, ...clientsList]
    : clientsList;

  const cancelClientSearch = useCallback(() => {
    clearTimeout(searchClientsTimeoutRef.current);
    clientSearchGenRef.current++;
  }, []);

  const closeClientPicker = useCallback(() => {
    cancelClientSearch();
    setIsClientPickerOpen(false);
    setIsSearchingClients(false);
  }, [cancelClientSearch]);

  const hidePrivateResults = useCallback(() => {
    clearSearchSessionStore();
    cancelMatterSearch();
    setQuery('');
    setSelectedClient(undefined);
    setClientsList([]);
    setClientPickerQuery('');
    setMatters([]);
    setTotalCount(0);
    setIsLoading(false);
    closeClientPicker();
    window.dispatchEvent(new Event('lawoffice:recheck-session'));
  }, [cancelMatterSearch, closeClientPicker]);

  const fetchClientOptions = useCallback(async (text: string, page: number, includeArchived: boolean) => {
    const request = ++clientSearchGenRef.current;
    setIsSearchingClients(true);
    setClientSearchError(null);
    try {
      const res = await searchMatterClientsAction({
        query: text.trim() || undefined,
        includeArchived,
        page,
        limit: 10,
      });
      if (request !== clientSearchGenRef.current) return;
      if (res.success) {
        setClientsList(res.data.clients);
        setClientPickerPage(res.data.page);
        setClientPickerTotalPages(res.data.totalPages);
        setClientPickerTotalCount(res.data.total);
      } else {
        if (isAuthRecoveryCode(res.code) || res.code === 'FORBIDDEN') hidePrivateResults();
        setClientSearchError(res.error || 'تعذر البحث في الموكلين.');
      }
    } catch {
      if (request === clientSearchGenRef.current) setClientSearchError('حدث خطأ أثناء البحث في الموكلين.');
    } finally {
      if (request === clientSearchGenRef.current) setIsSearchingClients(false);
    }
  }, [hidePrivateResults]);

  const handleClientPickerQueryChange = (text: string) => {
    setClientPickerQuery(text);
    cancelClientSearch();
    setClientsList([]);
    setClientPickerTotalPages(1);
    setIsSearchingClients(true);
    searchClientsTimeoutRef.current = setTimeout(
      () => fetchClientOptions(text, 1, includesArchivedClients(view)),
      300,
    );
  };

  useEffect(() => {
    if (!isClientPickerOpen) return;
    const handleClickOutside = (event: MouseEvent) => {
      if (clientPickerRef.current && !clientPickerRef.current.contains(event.target as Node)) {
        closeClientPicker();
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [closeClientPicker, isClientPickerOpen]);

  const syncHistory = useCallback((text: string, filters: MatterView, client?: ClientOption) => {
    const params = new URLSearchParams();
    if (filters.kind) params.set('kind', filters.kind);
    if (filters.status) params.set('status', filters.status);
    if (filters.courtId) params.set('courtId', filters.courtId);
    if (filters.incompleteData) params.set('incompleteData', 'true');
    if (filters.includeArchived) params.set('includeArchived', 'true');
    if (filters.page > 1) params.set('page', String(filters.page));
    if (filters.limit !== DEFAULT_SEARCH_LIMIT) params.set('limit', String(filters.limit));
    writeSearchHistory(sessionId, { query: text, client }, params);
  }, [sessionId]);

  const fetchMatters = useCallback(async (text: string, filters: MatterView, client?: ClientOption) => {
    const request = ++requestGenRef.current;
    setView(filters);
    setIsLoading(true);
    setError(null);
    try {
      const res = await searchMattersAction({ ...filters, query: text.trim() || undefined, clientId: client?.id });
      if (request !== requestGenRef.current) return;
      if (!res.success) {
        if (isAuthRecoveryCode(res.code) || res.code === 'FORBIDDEN') hidePrivateResults();
        setError(res.error || 'تعذر تحميل ملفات القضايا.');
        return;
      }
      const resolved = { ...filters, page: res.data.page ?? filters.page };
      setView(resolved);
      setMatters(res.data.matters);
      setTotalCount(res.data.total);
      setTotalPages(res.data.totalPages ?? 1);
      syncHistory(text, resolved, client);
    } catch {
      if (request === requestGenRef.current) setError('حدث خطأ في الاتصال أثناء تحميل ملفات القضايا.');
    } finally {
      if (request === requestGenRef.current) setIsLoading(false);
    }
  }, [hidePrivateResults, syncHistory]);

  useEffect(() => {
    bindSearchSession(sessionId);
    const restore = (filters: MatterView) => {
      const saved = readSearchHistory(sessionId);
      setQuery(saved?.query ?? '');
      setSelectedClient(saved?.client);
      void fetchMatters(saved?.query ?? '', filters, saved?.client);
    };
    const initial = {
      kind: initialKind,
      status: initialStatus,
      courtId: initialCourtId,
      incompleteData: initialIncompleteData,
      includeArchived: initialIncludeArchived,
      page: initialPage,
      limit: initialLimit,
    };
    const onHistory = () => {
      if (window.location.pathname !== '/matters') return;
      const params = new URLSearchParams(window.location.search);
      const filters = matterSearchFilters((name) => readParam(params, name));
      closeClientPicker();
      setClientsList([]);
      void fetchClientOptions('', 1, includesArchivedClients(filters));
      restore(filters);
    };
    // Back navigation can reuse an earlier render's server props.
    const saved = readSearchHistory(sessionId);
    const firstRestore = saved ? setTimeout(onHistory, 0) : undefined;
    if (!saved) syncHistory('', initial);
    window.addEventListener('popstate', onHistory);
    return () => {
      clearTimeout(firstRestore);
      cancelClientSearch();
      cancelMatterSearch();
      window.removeEventListener('popstate', onHistory);
    };
  }, [cancelClientSearch, cancelMatterSearch, closeClientPicker, fetchClientOptions, fetchMatters, initialCourtId, initialIncludeArchived,
    initialIncompleteData, initialKind, initialLimit, initialPage, initialStatus, sessionId, syncHistory]);

  const handleSearchSubmit = (event: React.FormEvent) => {
    event.preventDefault();
    void fetchMatters(query, { ...view, page: 1 }, selectedClient);
  };

  const applyFilters = (filters: MatterView) => {
    const previousScope = includesArchivedClients(view);
    const nextScope = includesArchivedClients(filters);
    let client = selectedClient;
    if (previousScope !== nextScope) {
      closeClientPicker();
      setClientsList([]);
      if (!nextScope) {
        client = undefined;
        setSelectedClient(undefined);
      }
      void fetchClientOptions('', 1, nextScope);
    }
    void fetchMatters(query, { ...filters, page: 1 }, client);
  };

  const handleKindChange = (kind?: MatterKind) => applyFilters({ ...view, kind });
  const handleStatusChange = (status?: MatterStatus) => applyFilters({ ...view, status });
  const handleCourtChange = (courtId?: string) => applyFilters({ ...view, courtId });
  const handleIncompleteDataChange = (incompleteData: boolean) => applyFilters({ ...view, incompleteData });
  const handleIncludeArchivedChange = (includeArchived: boolean) => applyFilters({ ...view, includeArchived });

  const handleClientChange = (client?: ClientOption) => {
    setSelectedClient(client);
    void fetchMatters(query, { ...view, page: 1 }, client);
  };

  const handleClearFilters = () => {
    setQuery('');
    setSelectedClient(undefined);
    closeClientPicker();
    setClientsList([]);
    void fetchClientOptions('', 1, false);
    void fetchMatters('', { ...matterSearchFilters(() => undefined), limit: view.limit });
  };

  const handlePageChange = (page: number) => {
    void fetchMatters(query, { ...view, page }, selectedClient);
  };

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
            <div className="flex items-center gap-1.5 relative" ref={clientPickerRef}>
              <label htmlFor="filter-client" className="text-xs font-semibold text-[#4D606A]">الموكل:</label>
              <select
                id="filter-client"
                data-testid="filter-client-select"
                value={selectedClientId || ''}
                onChange={(e) => handleClientChange(clientSelectOptions.find(({ id }) => id === e.target.value))}
                className="text-xs py-1.5 px-2.5 border border-[#D5DFE3] rounded-[6px] bg-white text-[#172A35] min-h-[36px] focus:outline-none focus:ring-2 focus:ring-[#14566B]"
              >
                <option value="">كل الموكلين</option>
                {clientSelectOptions.map((cl) => (
                  <option key={cl.id} value={cl.id}>{cl.name}</option>
                ))}
              </select>

              <button
                type="button"
                data-testid="open-client-picker-button"
                aria-expanded={isClientPickerOpen}
                aria-controls={isClientPickerOpen ? 'matter-client-picker' : undefined}
                onClick={() => {
                  if (isClientPickerOpen) {
                    closeClientPicker();
                  } else {
                    setIsClientPickerOpen(true);
                    void fetchClientOptions(clientPickerQuery, 1, includesArchivedClients(view));
                  }
                }}
                className="px-2 py-1.5 text-xs bg-[#F4F6F7] hover:bg-[#E8EEF1] border border-[#D5DFE3] rounded-[6px] text-[#14566B] font-medium min-h-[36px] transition-colors focus:outline-none focus:ring-2 focus:ring-[#14566B]"
                title="بحث موسع في الموكلين"
              >
                🔍 بحث
              </button>

              {isClientPickerOpen && (
                <div
                  id="matter-client-picker"
                  data-testid="client-picker-popover"
                  onKeyDown={(event) => {
                    if (event.key === 'Escape') {
                      closeClientPicker();
                      clientPickerRef.current?.querySelector('button')?.focus();
                    }
                  }}
                  className="absolute top-full mt-1.5 right-0 z-30 w-72 bg-white border border-[#D5DFE3] rounded-[6px] shadow-lg p-3 space-y-2 text-xs"
                >
                  <div className="flex items-center justify-between pb-1 border-b border-[#E8EEF1]">
                    <span className="font-semibold text-[#172A35]">اختيار موكل</span>
                    <button
                      type="button"
                      data-testid="close-client-picker-button"
                      onClick={closeClientPicker}
                      className="text-[#4D606A] hover:text-[#172A35] text-sm p-1"
                    >
                      ✕
                    </button>
                  </div>

                  <input
                    type="search"
                    data-testid="filter-client-search-input"
                    aria-label="ابحث عن موكل بالاسم أو الهاتف"
                    value={clientPickerQuery}
                    onChange={(e) => handleClientPickerQueryChange(e.target.value)}
                    placeholder="ابحث بالاسم أو الهاتف..."
                    className="w-full px-2.5 py-1.5 border border-[#D5DFE3] rounded-[4px] text-xs text-[#172A35] focus:outline-none focus:ring-1 focus:ring-[#14566B]"
                  />

                  {isSearchingClients ? (
                    <div role="status" className="py-3 text-center text-[#4D606A]" data-testid="client-picker-loading">
                      جارٍ البحث في الموكلين...
                    </div>
                  ) : clientSearchError ? (
                    <div role="alert" className="py-2 text-center text-[#B3261E]" data-testid="client-picker-error">
                      {clientSearchError}
                    </div>
                  ) : clientsList.length === 0 ? (
                    <div role="status" className="py-3 text-center text-[#4D606A]">لا يوجد موكلين مطابقين</div>
                  ) : (
                    <div className="max-h-48 overflow-y-auto divide-y divide-[#E8EEF1] border border-[#E8EEF1] rounded-[4px]">
                      <button
                        type="button"
                        data-testid="filter-client-option-all"
                        onClick={() => {
                          handleClientChange(undefined);
                          closeClientPicker();
                        }}
                        className="w-full text-right px-2.5 py-1.5 hover:bg-[#F4F6F7] text-[#172A35] font-medium block"
                      >
                        كل الموكلين
                      </button>
                      {clientsList.map((cl) => (
                        <button
                          key={cl.id}
                          type="button"
                          data-testid={`filter-client-option-${cl.id}`}
                          onClick={() => {
                            handleClientChange(cl);
                            closeClientPicker();
                          }}
                          className={`w-full text-right px-2.5 py-1.5 hover:bg-[#F4F6F7] block transition-colors ${
                            selectedClientId === cl.id ? 'bg-[#E8EEF1] font-bold text-[#14566B]' : 'text-[#172A35]'
                          }`}
                        >
                          {cl.name}
                        </button>
                      ))}
                    </div>
                  )}

                  {clientPickerTotalPages > 1 && (
                    <div className="flex items-center justify-between pt-1 border-t border-[#E8EEF1] text-[11px] text-[#4D606A]">
                      <span data-testid="filter-client-picker-page-info">
                        صفحة {clientPickerPage} من {clientPickerTotalPages} ({clientPickerTotalCount} موكل)
                      </span>
                      <div className="flex gap-1">
                        <button
                          type="button"
                          data-testid="filter-client-picker-prev"
                          disabled={clientPickerPage <= 1}
                          onClick={() => {
                            const p = clientPickerPage - 1;
                            void fetchClientOptions(clientPickerQuery, p, includesArchivedClients(view));
                          }}
                          className="px-1.5 py-0.5 border border-[#D5DFE3] rounded disabled:opacity-40"
                        >
                          السابق
                        </button>
                        <button
                          type="button"
                          data-testid="filter-client-picker-next"
                          disabled={clientPickerPage >= clientPickerTotalPages}
                          onClick={() => {
                            const p = clientPickerPage + 1;
                            void fetchClientOptions(clientPickerQuery, p, includesArchivedClients(view));
                          }}
                          className="px-1.5 py-0.5 border border-[#D5DFE3] rounded disabled:opacity-40"
                        >
                          التالي
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              )}
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
          onRetry={() => fetchMatters(query, view, selectedClient)}
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

'use client';

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { GuardedLink as Link } from '@/components/navigation-guard';
import { unifiedSearchAction } from '@/modules/matters/matter-actions';
import {
  UnifiedSearchResult,
  UnifiedSearchResultItem,
  UnifiedSearchType,
} from '@/modules/matters/matter-types';
import {
  LoadingIndicator,
  ErrorContainer,
  EmptyStateContainer,
} from '@/components/presentation-state';
import { formatCairoDateOnly, isAuthRecoveryCode } from '@/components/matters/matter-ui-types';
import { DEFAULT_SEARCH_LIMIT, readParam, unifiedSearchFilters } from '@/lib/search-params';
import {
  bindSearchSession,
  clearSearchSessionStore,
  readSearchHistory,
  writeSearchHistory,
} from '@/lib/search-session-store';

interface UnifiedSearchClientProps {
  initialResult?: UnifiedSearchResult;
  initialType?: UnifiedSearchType;
  initialIncludeArchived?: boolean;
  initialPage?: number;
  initialLimit?: number;
  initialError?: string;
  sessionId: string;
}

const ENTITY_TYPE_CONFIG: Record<
  UnifiedSearchResultItem['entityType'],
  { label: string; icon: string; badgeClass: string }
> = {
  MATTER: {
    label: 'ملف قضية',
    icon: '',
    badgeClass: 'bg-blue-50 text-blue-800 border-blue-200',
  },
  PROCEEDING: {
    label: 'قيد قضائي',
    icon: '',
    badgeClass: 'bg-emerald-50 text-emerald-800 border-emerald-200',
  },
  PARTY: {
    label: 'طرف / موكل',
    icon: '',
    badgeClass: 'bg-purple-50 text-purple-800 border-purple-200',
  },
  DOCUMENT: {
    label: 'مستند',
    icon: '',
    badgeClass: 'bg-[#FFF7E6] text-[#7A4A00] border-[#E0B46A]',
  },
};

export function UnifiedSearchClient({
  initialResult,
  initialType = 'ALL',
  initialIncludeArchived = false,
  initialPage = 1,
  initialLimit = DEFAULT_SEARCH_LIMIT,
  initialError,
  sessionId,
}: UnifiedSearchClientProps) {
  const [query, setQuery] = useState('');
  const [filters, setFilters] = useState({
    type: initialType,
    includeArchived: initialIncludeArchived,
    page: initialPage,
    limit: initialLimit,
  });
  const { type: searchType, includeArchived, page } = filters;
  const [searchResult, setSearchResult] = useState(initialResult);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(initialError ?? null);
  const debounceTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const requestGeneration = useRef(0);
  const cancelSearch = useCallback(() => {
    clearTimeout(debounceTimer.current);
    requestGeneration.current++;
  }, []);

  const syncHistory = useCallback((text: string, view: ReturnType<typeof unifiedSearchFilters>) => {
    const params = new URLSearchParams();
    if (view.type !== 'ALL') params.set('type', view.type);
    if (view.includeArchived) params.set('includeArchived', 'true');
    if (view.page > 1) params.set('page', String(view.page));
    if (view.limit !== DEFAULT_SEARCH_LIMIT) params.set('limit', String(view.limit));
    writeSearchHistory(sessionId, { query: text }, params);
  }, [sessionId]);

  const executeSearch = useCallback(async (text: string, view: ReturnType<typeof unifiedSearchFilters>) => {
    clearTimeout(debounceTimer.current);
    const request = ++requestGeneration.current;
    setFilters(view);
    setIsLoading(true);
    setError(null);

    try {
      const res = await unifiedSearchAction({ ...view, query: text.trim() || undefined });
      if (request !== requestGeneration.current) return;
      if (!res.success) {
        if (isAuthRecoveryCode(res.code) || res.code === 'FORBIDDEN') {
          clearSearchSessionStore();
          setQuery('');
          setSearchResult(undefined);
          window.dispatchEvent(new Event('lawoffice:recheck-session'));
        }
        setError(res.error || 'تعذر استرجاع نتائج البحث.');
        return;
      }

      const resolved = { ...view, page: res.data.page };
      setFilters(resolved);
      setSearchResult(res.data);
      syncHistory(text, resolved);
    } catch {
      if (request === requestGeneration.current) {
        setError('حدث خطأ في الاتصال أثناء البحث.');
      }
    } finally {
      if (request === requestGeneration.current) setIsLoading(false);
    }
  }, [syncHistory]);

  const hasInitialResult = Boolean(initialResult);

  useEffect(() => {
    bindSearchSession(sessionId);
    const restore = (view: ReturnType<typeof unifiedSearchFilters>, text: string) => {
      setQuery(text);
      void executeSearch(text, view);
    };
    const initial = {
      type: initialType,
      includeArchived: initialIncludeArchived,
      page: initialPage,
      limit: initialLimit,
    };
    const onHistory = () => {
      if (window.location.pathname !== '/search') return;
      const params = new URLSearchParams(window.location.search);
      restore(unifiedSearchFilters((name) => readParam(params, name)), readSearchHistory(sessionId)?.query ?? '');
    };
    // Back navigation can reuse an earlier render's server props.
    const saved = readSearchHistory(sessionId);
    const currentParams = new URLSearchParams(window.location.search);
    const currentFilters = unifiedSearchFilters((name) => readParam(currentParams, name));
    const matchesInitial =
      hasInitialResult &&
      saved?.query === '' &&
      currentFilters.type === initial.type &&
      currentFilters.includeArchived === initial.includeArchived &&
      currentFilters.page === initial.page &&
      currentFilters.limit === initial.limit;
    const firstRestore = saved && !matchesInitial ? setTimeout(onHistory, 0) : undefined;
    if (!saved) syncHistory('', initial);
    window.addEventListener('popstate', onHistory);
    return () => {
      clearTimeout(firstRestore);
      cancelSearch();
      window.removeEventListener('popstate', onHistory);
    };
  }, [cancelSearch, executeSearch, hasInitialResult, initialIncludeArchived, initialLimit, initialPage, initialType, sessionId, syncHistory]);

  const handleQueryChange = (text: string) => {
    setQuery(text);
    cancelSearch();
    setIsLoading(true);
    debounceTimer.current = setTimeout(() => executeSearch(text, { ...filters, page: 1 }), 300);
  };

  const handleFormSubmit = (event: React.FormEvent) => {
    event.preventDefault();
    void executeSearch(query, { ...filters, page: 1 });
  };

  const handleClear = () => {
    setQuery('');
    void executeSearch('', { ...filters, type: 'ALL', includeArchived: false, page: 1 });
  };

  const handleTypeChange = (type: UnifiedSearchType) => {
    void executeSearch(query, { ...filters, type, page: 1 });
  };

  const handleIncludeArchivedChange = (includeArchived: boolean) => {
    void executeSearch(query, { ...filters, includeArchived, page: 1 });
  };

  const handlePageChange = (page: number) => {
    void executeSearch(query, { ...filters, page });
  };

  const items = searchResult?.items || [];
  const counts = searchResult?.counts || { all: 0, parties: 0, matters: 0, proceedings: 0, documents: 0 };
  const totalCount = searchResult?.total || 0;
  const totalPages = searchResult?.totalPages || 1;
  const hasActiveFilters = Boolean(query.trim() || searchType !== 'ALL' || includeArchived);

  return (
    <div className="space-y-6 min-w-0 max-w-full" dir="rtl" lang="ar-EG">
      {/* 1. Header */}
      <div className="pb-4 border-b border-[#D5DFE3] space-y-1">
        <h1 className="text-2xl font-bold text-[#172A35] tracking-tight">
          البحث الموحد الشامل
        </h1>
        <p className="text-xs sm:text-sm text-[#4D606A] leading-relaxed">
          بحث فوري متكامل عبر ملفات القضايا، القيود والدعاوى القضائية بالمحاكم، دليل الأطراف والموكلين، والمستندات.
        </p>
      </div>

      {/* 2. Search & Filter Bar */}
      <div className="bg-white rounded-[6px] border border-[#D5DFE3] p-4 shadow-xs space-y-4">
        <form onSubmit={handleFormSubmit} className="flex flex-col sm:flex-row gap-3">
          <div className="relative flex-1 min-w-0">
            <input
              type="search"
              value={query}
              onChange={(e) => handleQueryChange(e.target.value)}
              placeholder="ابحث بالاسم، كود الملف، رقم الدعوى بالمحكمة، رقم الهاتف، أو عنوان المستند..."
              aria-label="البحث الموحد"
              data-testid="unified-search-input"
              className="w-full px-3 py-2.5 text-sm bg-white border border-[#D5DFE3] rounded-[6px] text-[#172A35] placeholder-[#4D606A] focus:outline-none focus:ring-2 focus:ring-[#14566B] focus:border-transparent min-h-[44px]"
            />
            </div>

          <div className="flex gap-2">
            <button
              type="submit"
              data-testid="search-submit-button"
              className="px-5 py-2.5 bg-[#14566B] hover:bg-[#0F4354] text-white text-sm font-medium rounded-[6px] transition-colors focus:outline-none focus:ring-2 focus:ring-[#14566B] focus:ring-offset-2 min-h-[44px]"
            >
              بحث
            </button>
            {hasActiveFilters && (
              <button
                type="button"
                data-testid="search-clear-button"
                onClick={handleClear}
                className="px-4 py-2.5 bg-[#F4F6F7] hover:bg-[#E8EEF1] text-[#172A35] text-sm font-medium rounded-[6px] border border-[#D5DFE3] transition-colors focus:outline-none focus:ring-2 focus:ring-[#14566B] min-h-[44px]"
              >
                مسح
              </button>
            )}
          </div>
        </form>

        {/* Tabs Bar & Archive Toggle */}
        <div className="flex flex-wrap items-center justify-between gap-3 pt-3 border-t border-[#E8EEF1]">
          {/* Type Filter Pills */}
          <div
            role="group"
            aria-label="أقسام البحث"
            className="flex flex-wrap items-center gap-1.5"
          >
            <button
              type="button"
              aria-pressed={searchType === 'ALL'}
              data-testid="tab-all"
              onClick={() => handleTypeChange('ALL')}
              className={`px-3 py-1.5 text-xs font-medium rounded-[6px] transition-colors min-h-[44px] flex items-center gap-1.5 ${
                searchType === 'ALL'
                  ? 'bg-[#14566B] text-white shadow-xs'
                  : 'bg-[#F4F6F7] text-[#172A35] hover:bg-[#E8EEF1]'
              }`}
            >
              <span>الكل</span>
              <span
                className={`text-[11px] px-1.5 py-0.2 rounded-full font-bold ${
                  searchType === 'ALL' ? 'bg-white/20 text-white' : 'bg-slate-200 text-[#172A35]'
                }`}
              >
                {counts.all}
              </span>
            </button>

            <button
              type="button"
              aria-pressed={searchType === 'MATTER'}
              data-testid="tab-matter"
              onClick={() => handleTypeChange('MATTER')}
              className={`px-3 py-1.5 text-xs font-medium rounded-[6px] transition-colors min-h-[44px] flex items-center gap-1.5 ${
                searchType === 'MATTER'
                  ? 'bg-[#14566B] text-white shadow-xs'
                  : 'bg-[#F4F6F7] text-[#172A35] hover:bg-[#E8EEF1]'
              }`}
            >
              <span>ملفات القضايا</span>
              <span
                className={`text-[11px] px-1.5 py-0.2 rounded-full font-bold ${
                  searchType === 'MATTER' ? 'bg-white/20 text-white' : 'bg-slate-200 text-[#172A35]'
                }`}
              >
                {counts.matters}
              </span>
            </button>

            <button
              type="button"
              aria-pressed={searchType === 'PROCEEDING'}
              data-testid="tab-proceeding"
              onClick={() => handleTypeChange('PROCEEDING')}
              className={`px-3 py-1.5 text-xs font-medium rounded-[6px] transition-colors min-h-[44px] flex items-center gap-1.5 ${
                searchType === 'PROCEEDING'
                  ? 'bg-[#14566B] text-white shadow-xs'
                  : 'bg-[#F4F6F7] text-[#172A35] hover:bg-[#E8EEF1]'
              }`}
            >
              <span>القيود القضائية</span>
              <span
                className={`text-[11px] px-1.5 py-0.2 rounded-full font-bold ${
                  searchType === 'PROCEEDING' ? 'bg-white/20 text-white' : 'bg-slate-200 text-[#172A35]'
                }`}
              >
                {counts.proceedings}
              </span>
            </button>

            <button
              type="button"
              aria-pressed={searchType === 'PARTY'}
              data-testid="tab-party"
              onClick={() => handleTypeChange('PARTY')}
              className={`px-3 py-1.5 text-xs font-medium rounded-[6px] transition-colors min-h-[44px] flex items-center gap-1.5 ${
                searchType === 'PARTY'
                  ? 'bg-[#14566B] text-white shadow-xs'
                  : 'bg-[#F4F6F7] text-[#172A35] hover:bg-[#E8EEF1]'
              }`}
            >
              <span>دليل الأطراف</span>
              <span
                className={`text-[11px] px-1.5 py-0.2 rounded-full font-bold ${
                  searchType === 'PARTY' ? 'bg-white/20 text-white' : 'bg-slate-200 text-[#172A35]'
                }`}
              >
                {counts.parties}
              </span>
            </button>

            <button
              type="button"
              aria-pressed={searchType === 'DOCUMENT'}
              data-testid="tab-document"
              onClick={() => handleTypeChange('DOCUMENT')}
              className={`px-3 py-1.5 text-xs font-medium rounded-[6px] transition-colors min-h-[44px] flex items-center gap-1.5 ${
                searchType === 'DOCUMENT'
                  ? 'bg-[#14566B] text-white shadow-xs'
                  : 'bg-[#F4F6F7] text-[#172A35] hover:bg-[#E8EEF1]'
              }`}
            >
              <span>المستندات</span>
              <span
                className={`text-[11px] px-1.5 py-0.2 rounded-full font-bold ${
                  searchType === 'DOCUMENT' ? 'bg-white/20 text-white' : 'bg-slate-200 text-[#172A35]'
                }`}
              >
                {counts.documents}
              </span>
            </button>
          </div>

          {/* Include Archived Toggle */}
          <div className="flex items-center gap-2">
            <label className="inline-flex items-center gap-2 cursor-pointer select-none text-xs font-medium text-[#172A35] py-1 px-2 rounded hover:bg-[#F4F6F7] min-h-[44px]">
              <input
                type="checkbox"
                data-testid="include-archived-checkbox"
                checked={includeArchived}
                onChange={(e) => handleIncludeArchivedChange(e.target.checked)}
                className="w-4 h-4 rounded text-[#14566B] focus:ring-[#14566B] border-[#D5DFE3]"
              />
              <span>تضمين السجلات المؤرشفة</span>
            </label>
          </div>
        </div>
      </div>

      {/* 3. Search Feedback / Results Count */}
      <div className="flex items-center justify-between text-xs text-[#4D606A] px-1">
        <span>
          نتائج البحث: <span className="font-bold text-[#172A35]">{totalCount}</span> نتيجة
        </span>
        {query.trim() && (
          <span>
            البحث عن: &quot;<span className="font-bold text-[#14566B]">{query.trim()}</span>&quot;
          </span>
        )}
      </div>

      {/* 4. Results Section */}
      {isLoading ? (
        <LoadingIndicator label="جارٍ البحث في ملفات القضايا والقيود والأطراف والمستندات..." />
      ) : error ? (
        <ErrorContainer
          title="تعذر استرجاع نتائج البحث"
          message={error}
          onRetry={() => executeSearch(query, filters)}
        />
      ) : items.length === 0 ? (
        hasActiveFilters ? (
          <EmptyStateContainer
            testId="empty-search-container"
            icon=""
            title="لم يتم العثور على نتائج"
            description="لا توجد سجلات مطابقة لكلمات البحث أو الفلاتر المحددة."
            action={
              <button
                type="button"
                onClick={handleClear}
                className="px-4 py-2 bg-[#14566B] text-white text-xs font-bold rounded-[6px] min-h-[44px]"
              >
                مسح الفلاتر وإعادة البحث
              </button>
            }
          />
        ) : (
          <EmptyStateContainer
            testId="empty-state-container"
            icon=""
            title="ابدأ بالبحث في النظام"
            description="اكتب كود الملف (مثال: 2026/0001)، أو اسم الموكل أو الخصم، أو رقم الدعوى بالمحكمة، أو عنوان المستند للوصول المباشر."
          />
        )
      ) : (
        <div className="space-y-4">
          <div
            data-testid="search-results-list"
            className="space-y-3"
            role="feed"
            aria-busy={isLoading}
            aria-label="قائمة نتائج البحث"
          >
            {items.map((item) => {
              const config = ENTITY_TYPE_CONFIG[item.entityType] || {
                label: 'سجل',
                icon: '',
                badgeClass: 'bg-gray-100 text-gray-800 border-gray-300',
              };

              return (
                <article
                  key={`${item.entityType}-${item.id}`}
                  data-testid={`search-result-${item.id}`}
                  className="bg-white rounded-[6px] border border-[#D5DFE3] p-4 shadow-xs space-y-3 hover:border-[#14566B]/50 transition-colors"
                >
                  <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
                    <div className="space-y-1.5 min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        {/* Entity Type Pill */}
                        <span
                          className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded text-xs font-bold border ${config.badgeClass}`}
                        >
                          {config.icon && <span aria-hidden="true">{config.icon}</span>}
                          <span>{config.label}</span>
                        </span>

                        {/* Optional Code */}
                        {item.code && (
                          <bdi
                            dir="ltr"
                            className="font-mono text-xs text-[#14566B] font-bold bg-slate-50 px-2 py-0.5 rounded border border-slate-200"
                          >
                            {item.code}
                          </bdi>
                        )}

                        {/* Optional Badge */}
                        {item.badge && (
                          <span className="text-[11px] text-[#4D606A] bg-[#F4F6F7] px-2 py-0.5 rounded border border-[#E8EEF1]">
                            {item.badge}
                          </span>
                        )}

                        {/* Archived Badge */}
                        {item.isArchived && (
                          <span
                            data-testid="item-archived-badge"
                            className="inline-flex items-center px-2 py-0.5 rounded text-xs font-bold border bg-stone-100 text-stone-700 border-stone-300"
                          >
                            مؤرشف
                          </span>
                        )}
                      </div>

                      {/* Title */}
                      <h2 className="text-base font-bold text-[#172A35] leading-snug break-words [overflow-wrap:anywhere]">
                        <Link
                          href={item.href}
                          className="inline-flex items-center min-h-[44px] hover:text-[#14566B] hover:underline focus:outline-none focus:ring-2 focus:ring-[#14566B] rounded"
                        >
                          {item.title}
                        </Link>
                      </h2>

                      {/* Subtitle / Details */}
                      {item.subtitle && (
                        <p className="text-xs text-[#4D606A] leading-relaxed break-words [overflow-wrap:anywhere]">
                          {item.subtitle}
                        </p>
                      )}
                    </div>

                    <div className="shrink-0 pt-1 sm:pt-0">
                      <Link
                        href={item.href}
                        className="inline-flex items-center justify-center gap-1.5 px-3.5 py-2 bg-[#F4F6F7] hover:bg-[#E8EEF1] text-[#14566B] text-xs font-bold rounded-[6px] border border-[#D5DFE3] transition-colors min-h-[44px]"
                      >
                        <span>عرض التفاصيل</span>
                        <span aria-hidden="true">&larr;</span>
                      </Link>
                    </div>
                  </div>

                  <div className="pt-2 border-t border-[#E8EEF1] flex items-center justify-between text-[11px] text-[#4D606A]">
                    <span>آخر تحديث: {formatCairoDateOnly(item.updatedAt)}</span>
                  </div>
                </article>
              );
            })}
          </div>

          {/* 5. Pagination */}
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

'use client';

import React, { useState, useEffect, useRef, useCallback } from 'react';
import Link from 'next/link';
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
import { formatCairoDateOnly } from '@/components/matters/matter-ui-types';
import {
  createNavigationKey,
  setPrivateSearchState,
  getPrivateSearchState,
} from '@/lib/search-session-store';

interface UnifiedSearchClientProps {
  initialResult?: UnifiedSearchResult;
  initialQuery?: string;
  initialType?: UnifiedSearchType;
  initialIncludeArchived?: boolean;
  initialPage?: number;
  initialError?: string;
}

const ENTITY_TYPE_CONFIG: Record<
  UnifiedSearchResultItem['entityType'],
  { label: string; icon: string; badgeClass: string }
> = {
  MATTER: {
    label: 'ملف قضية',
    icon: '📁',
    badgeClass: 'bg-blue-50 text-blue-800 border-blue-200',
  },
  PROCEEDING: {
    label: 'قيد قضائي',
    icon: '⚖️',
    badgeClass: 'bg-emerald-50 text-emerald-800 border-emerald-200',
  },
  PARTY: {
    label: 'طرف / موكل',
    icon: '👥',
    badgeClass: 'bg-purple-50 text-purple-800 border-purple-200',
  },
};

export function UnifiedSearchClient({
  initialResult,
  initialQuery = '',
  initialType = 'ALL',
  initialIncludeArchived = false,
  initialPage = 1,
  initialError,
}: UnifiedSearchClientProps) {
  const isRestoringRef = useRef(false);
  const [query, setQuery] = useState(() => {
    if (typeof window !== 'undefined') {
      const urlQ = new URLSearchParams(window.location.search).get('query');
      if (urlQ) return urlQ;
      const navKey = (window.history.state as { navKey?: string } | null)?.navKey;
      const entry = getPrivateSearchState(navKey);
      if (entry?.query) return entry.query;
    }
    return initialQuery;
  });
  const [searchType, setSearchType] = useState<UnifiedSearchType>(() => {
    if (typeof window !== 'undefined') {
      const t = new URLSearchParams(window.location.search).get('type') as UnifiedSearchType;
      if (t && ['ALL', 'PARTY', 'MATTER', 'PROCEEDING'].includes(t)) return t;
    }
    return initialType;
  });
  const [includeArchived, setIncludeArchived] = useState<boolean>(() => {
    if (typeof window !== 'undefined') {
      const urlInc = new URLSearchParams(window.location.search).get('includeArchived');
      if (urlInc !== null) return urlInc === 'true';
    }
    return initialIncludeArchived;
  });
  const [page, setPage] = useState<number>(() => {
    if (typeof window !== 'undefined') {
      const p = parseInt(new URLSearchParams(window.location.search).get('page') || '', 10);
      if (p > 0) return p;
    }
    return initialPage;
  });

  const [searchResult, setSearchResult] = useState<UnifiedSearchResult | null>(
    initialResult || {
      query: initialQuery,
      type: initialType,
      includeArchived: initialIncludeArchived,
      page: initialPage,
      limit: 20,
      total: 0,
      totalPages: 1,
      items: [],
      counts: {
        all: 0,
        parties: 0,
        matters: 0,
        proceedings: 0,
      },
    }
  );

  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(initialError || null);

  const isInitialMount = useRef(true);
  const debounceTimerRef = useRef<NodeJS.Timeout | null>(null);
  const requestGenRef = useRef(0);
  const requestedPageRef = useRef<number>(initialPage);

  type ExecuteSearchFn = (
    q: string,
    t: UnifiedSearchType,
    incArch: boolean,
    pageNum: number
  ) => Promise<void>;

  const executeSearchRef = useRef<ExecuteSearchFn | null>(null);

  const syncUrl = useCallback(
    (q: string, t: UnifiedSearchType, incArch: boolean, p: number) => {
      if (typeof window === 'undefined') return;
      const params = new URLSearchParams();
      // Omit `query` from the URL string completely so no private names or numbers appear in browser history, address bar, or URLs
      if (t !== 'ALL') params.set('type', t);
      if (incArch) params.set('includeArchived', 'true');
      if (p > 1) params.set('page', String(p));
      const newQuery = params.toString();
      const cleanUrl = newQuery ? `${window.location.pathname}?${newQuery}` : window.location.pathname;
      const currentState = (window.history.state && typeof window.history.state === 'object') ? window.history.state : {};
      const navKey = currentState.navKey || createNavigationKey();
      setPrivateSearchState(navKey, q);
      window.history.replaceState({ ...currentState, navKey }, '', cleanUrl);
    },
    []
  );

  const executeSearch = useCallback(
    async (
      q: string,
      t: UnifiedSearchType,
      incArch: boolean,
      pageNum: number
    ) => {
      const currentGen = ++requestGenRef.current;
      requestedPageRef.current = pageNum;
      setIsLoading(true);
      setError(null);
      syncUrl(q, t, incArch, pageNum);

      try {
        const res = await unifiedSearchAction({
          query: q.trim() || undefined,
          type: t,
          includeArchived: incArch,
          page: pageNum,
          limit: 20,
        });

        if (currentGen !== requestGenRef.current) return;

        if (!res.success) {
          setError(res.error || 'تعذر استرجاع نتائج البحث.');
          setIsLoading(false);
          return;
        }

        // When the result set shrinks, clamp and refetch the last valid page
        if (res.data.items.length === 0 && pageNum > 1 && res.data.total > 0) {
          const lastValidPage = Math.max(1, Math.ceil(res.data.total / 20));
          if (lastValidPage !== pageNum) {
            await executeSearchRef.current?.(q, t, incArch, lastValidPage);
            return;
          }
        }

        setSearchResult(res.data);
        setPage(res.data.page);
        setIsLoading(false);
      } catch (err: unknown) {
        if (currentGen !== requestGenRef.current) return;
        setError(err instanceof Error ? err.message : 'حدث خطأ في الاتصال أثناء البحث.');
        setIsLoading(false);
      }
    },
    [syncUrl]
  );

  useEffect(() => {
    executeSearchRef.current = executeSearch;
  });

  // Debounced input change (300ms) for direct typing only
  useEffect(() => {
    if (isInitialMount.current) {
      isInitialMount.current = false;
      // If query was restored on mount, fetch the matching results once asynchronously
      if (query) {
        setTimeout(() => {
          executeSearchRef.current?.(query, searchType, includeArchived, page);
        }, 0);
      }
      return;
    }

    if (isRestoringRef.current) {
      isRestoringRef.current = false;
      return;
    }

    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
    }

    debounceTimerRef.current = setTimeout(() => {
      setPage(1);
      executeSearch(query, searchType, includeArchived, 1);
    }, 300);

    return () => {
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
      }
    };
  }, [query, searchType, includeArchived, executeSearch, page]);

  // Clean URL on initial mount if coming with query in searchParams
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const urlParams = new URLSearchParams(window.location.search);
    const urlQuery = urlParams.get('query');
    if (urlQuery) {
      syncUrl(urlQuery, searchType, includeArchived, page);
    }
  }, [syncUrl, searchType, includeArchived, page]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const syncFromUrl = (event?: PopStateEvent) => {
      const params = new URLSearchParams(window.location.search);
      const urlType = (params.get('type') as UnifiedSearchType) || 'ALL';
      const urlIncArch = params.get('includeArchived') === 'true';
      const urlPage = parseInt(params.get('page') || '1', 10) || 1;
      const navKey = (event?.state as { navKey?: string } | null)?.navKey ?? (window.history.state as { navKey?: string } | null)?.navKey;
      const restoredQuery = getPrivateSearchState(navKey)?.query ?? '';

      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
      }
      isRestoringRef.current = true;
      setQuery(restoredQuery);
      setSearchType(urlType);
      setIncludeArchived(urlIncArch);
      setPage(urlPage);
      executeSearch(restoredQuery, urlType, urlIncArch, urlPage);
    };

    window.addEventListener('popstate', syncFromUrl);
    return () => {
      window.removeEventListener('popstate', syncFromUrl);
    };
  }, [executeSearch]);

  const handleFormSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
    }
    setPage(1);
    executeSearch(query, searchType, includeArchived, 1);
  };

  const handleClear = () => {
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
    }
    setQuery('');
    setSearchType('ALL');
    setIncludeArchived(false);
    setPage(1);
    executeSearch('', 'ALL', false, 1);
  };

  const handleTypeChange = (newType: UnifiedSearchType) => {
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
    }
    setSearchType(newType);
    setPage(1);
    executeSearch(query, newType, includeArchived, 1);
  };

  const handleIncludeArchivedChange = (checked: boolean) => {
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
    }
    setIncludeArchived(checked);
    setPage(1);
    executeSearch(query, searchType, checked, 1);
  };

  const handlePageChange = (newPage: number) => {
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
    }
    setPage(newPage);
    executeSearch(query, searchType, includeArchived, newPage);
  };

  const items = searchResult?.items || [];
  const counts = searchResult?.counts || { all: 0, parties: 0, matters: 0, proceedings: 0 };
  const totalCount = searchResult?.total || 0;
  const totalPages = searchResult?.totalPages || 1;
  const hasActiveFilters = Boolean(query.trim() || searchType !== 'ALL' || includeArchived);

  return (
    <div className="space-y-6" dir="rtl" lang="ar-EG">
      {/* 1. Header */}
      <div className="pb-4 border-b border-[#D5DFE3] space-y-1">
        <h1 className="text-2xl font-bold text-[#172A35] tracking-tight">
          البحث الموحد الشامل
        </h1>
        <p className="text-xs sm:text-sm text-[#4D606A] leading-relaxed">
          بحث فوري متكامل عبر ملفات القضايا، القيود والدعاوى القضائية بالمحاكم، ودليل الأطراف والموكلين.
        </p>
      </div>

      {/* 2. Search & Filter Bar */}
      <div className="bg-white rounded-[6px] border border-[#D5DFE3] p-4 shadow-xs space-y-4">
        <form onSubmit={handleFormSubmit} className="flex flex-col sm:flex-row gap-3">
          <div className="relative flex-1">
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="ابحث بالاسم، كود الملف، رقم الدعوى بالمحكمة، أو رقم الهاتف..."
              aria-label="البحث الموحد"
              data-testid="unified-search-input"
              className="w-full pl-3 pr-10 py-2.5 text-sm bg-white border border-[#D5DFE3] rounded-[6px] text-[#172A35] placeholder-[#4D606A] focus:outline-none focus:ring-2 focus:ring-[#14566B] focus:border-transparent min-h-[44px]"
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
          {/* Tabs */}
          <div
            role="tablist"
            aria-label="أقسام البحث"
            className="flex flex-wrap items-center gap-1.5"
          >
            <button
              type="button"
              role="tab"
              aria-selected={searchType === 'ALL'}
              data-testid="tab-all"
              onClick={() => handleTypeChange('ALL')}
              className={`px-3 py-1.5 text-xs font-medium rounded-[6px] transition-colors min-h-[38px] flex items-center gap-1.5 ${
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
              role="tab"
              aria-selected={searchType === 'MATTER'}
              data-testid="tab-matter"
              onClick={() => handleTypeChange('MATTER')}
              className={`px-3 py-1.5 text-xs font-medium rounded-[6px] transition-colors min-h-[38px] flex items-center gap-1.5 ${
                searchType === 'MATTER'
                  ? 'bg-[#14566B] text-white shadow-xs'
                  : 'bg-[#F4F6F7] text-[#172A35] hover:bg-[#E8EEF1]'
              }`}
            >
              <span>📁 ملفات القضايا</span>
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
              role="tab"
              aria-selected={searchType === 'PROCEEDING'}
              data-testid="tab-proceeding"
              onClick={() => handleTypeChange('PROCEEDING')}
              className={`px-3 py-1.5 text-xs font-medium rounded-[6px] transition-colors min-h-[38px] flex items-center gap-1.5 ${
                searchType === 'PROCEEDING'
                  ? 'bg-[#14566B] text-white shadow-xs'
                  : 'bg-[#F4F6F7] text-[#172A35] hover:bg-[#E8EEF1]'
              }`}
            >
              <span>⚖️ القيود القضائية</span>
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
              role="tab"
              aria-selected={searchType === 'PARTY'}
              data-testid="tab-party"
              onClick={() => handleTypeChange('PARTY')}
              className={`px-3 py-1.5 text-xs font-medium rounded-[6px] transition-colors min-h-[38px] flex items-center gap-1.5 ${
                searchType === 'PARTY'
                  ? 'bg-[#14566B] text-white shadow-xs'
                  : 'bg-[#F4F6F7] text-[#172A35] hover:bg-[#E8EEF1]'
              }`}
            >
              <span>👥 دليل الأطراف</span>
              <span
                className={`text-[11px] px-1.5 py-0.2 rounded-full font-bold ${
                  searchType === 'PARTY' ? 'bg-white/20 text-white' : 'bg-slate-200 text-[#172A35]'
                }`}
              >
                {counts.parties}
              </span>
            </button>
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
        <LoadingIndicator label="جارٍ البحث في ملفات القضايا والقيود والأطراف..." />
      ) : error ? (
        <ErrorContainer
          title="تعذر استرجاع نتائج البحث"
          message={error}
          onRetry={() => executeSearch(query, searchType, includeArchived, requestedPageRef.current)}
        />
      ) : items.length === 0 ? (
        hasActiveFilters ? (
          <EmptyStateContainer
            testId="empty-search-container"
            icon="🔍"
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
            icon="🔍"
            title="ابدأ بالبحث في النظام"
            description="اكتب كود الملف (مثال: 2026/0001)، أو اسم الموكل أو الخصم، أو رقم الدعوى بالمحكمة للوصول المباشر."
          />
        )
      ) : (
        <div className="space-y-4">
          <div
            data-testid="search-results-list"
            className="space-y-3"
            role="feed"
            aria-label="قائمة نتائج البحث"
          >
            {items.map((item) => {
              const config = ENTITY_TYPE_CONFIG[item.entityType] || {
                label: 'سجل',
                icon: '📄',
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
                          <span aria-hidden="true">{config.icon}</span>
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
                      <h2 className="text-base font-bold text-[#172A35] leading-snug">
                        <Link
                          href={item.href}
                          className="hover:text-[#14566B] hover:underline focus:outline-none focus:ring-1 focus:ring-[#14566B] rounded"
                        >
                          {item.title}
                        </Link>
                      </h2>

                      {/* Subtitle / Details */}
                      {item.subtitle && (
                        <p className="text-xs text-[#4D606A] leading-relaxed">
                          {item.subtitle}
                        </p>
                      )}
                    </div>

                    <div className="shrink-0 pt-1 sm:pt-0">
                      <Link
                        href={item.href}
                        className="inline-flex items-center justify-center gap-1.5 px-3.5 py-2 bg-[#F4F6F7] hover:bg-[#E8EEF1] text-[#14566B] text-xs font-bold rounded-[6px] border border-[#D5DFE3] transition-colors min-h-[40px]"
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

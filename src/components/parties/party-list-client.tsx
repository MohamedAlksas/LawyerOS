'use client';

import React, { useState, useCallback, useRef } from 'react';
import Link from 'next/link';
import { searchPartiesAction } from '@/modules/parties/actions';
import { PartyKind, SearchPartiesResult } from '@/modules/parties/types';
import {
  PARTY_KIND_SHORT_LABELS,
  IDENTIFICATION_TYPE_LABELS,
  formatCairoDateOnly,
} from './party-types';
import {
  LoadingIndicator,
  ErrorContainer,
  EmptyStateContainer,
} from '@/components/presentation-state';

interface PartyListClientProps {
  initialResult?: SearchPartiesResult | null;
  initialQuery?: string;
  initialKind?: PartyKind;
}

export function PartyListClient({
  initialResult,
  initialQuery = '',
  initialKind,
}: PartyListClientProps) {
  const [query, setQuery] = useState(initialQuery);
  const [selectedKind, setSelectedKind] = useState<PartyKind | undefined>(initialKind);
  const [page, setPage] = useState(1);

  const [partiesResult, setPartiesResult] = useState<SearchPartiesResult | null>(
    initialResult || {
      parties: [],
      totalCount: 0,
      page: 1,
      totalPages: 1,
    }
  );
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const requestGenRef = useRef(0);

  const fetchParties = useCallback(
    async (searchQuery: string, kind?: PartyKind, pageNum: number = 1) => {
      const currentGen = ++requestGenRef.current;
      setIsLoading(true);
      setError(null);

      try {
        const res = await searchPartiesAction({
          query: searchQuery.trim() || undefined,
          kind,
          page: pageNum,
          limit: 20,
        });

        if (currentGen !== requestGenRef.current) {
          // Discard response if a newer search request has already been issued
          return;
        }

        if (!res.success) {
          setError(res.error || 'تعذر تحميل بيانات الأطراف.');
          setIsLoading(false);
          return;
        }

        setPartiesResult(res.data);
        setIsLoading(false);
      } catch (err: unknown) {
        if (currentGen !== requestGenRef.current) {
          return;
        }
        setError(
          err instanceof Error
            ? err.message
            : 'حدث خطأ في الاتصال أثناء تحميل بيانات الأطراف.'
        );
        setIsLoading(false);
      }
    },
    []
  );

  const handleSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setPage(1);
    fetchParties(query, selectedKind, 1);
  };

  const handleKindFilterChange = (kind?: PartyKind) => {
    setSelectedKind(kind);
    setPage(1);
    fetchParties(query, kind, 1);
  };

  const handleClearFilters = () => {
    setQuery('');
    setSelectedKind(undefined);
    setPage(1);
    fetchParties('', undefined, 1);
  };

  const handlePageChange = (newPage: number) => {
    setPage(newPage);
    fetchParties(query, selectedKind, newPage);
  };

  const parties = partiesResult?.parties || [];
  const totalCount = partiesResult?.totalCount ?? 0;
  const totalPages = partiesResult?.totalPages ?? 1;
  const hasActiveFilters = Boolean(query.trim() || selectedKind);

  return (
    <div className="space-y-6">
      {/* 1. Header Bar */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 pb-4 border-b border-[#D5DFE3]">
        <div>
          <h1 className="text-2xl font-bold text-[#172A35] tracking-tight">
            دليل الأطراف والموكلين
          </h1>
          <p className="text-sm text-[#4D606A] mt-1">
            إدارة بيانات الموكلين والخصوم، وسجلات التوكيلات، وملاحظات التواصل
          </p>
        </div>

        <div>
          <Link
            href="/parties/new"
            data-testid="add-party-button"
            className="inline-flex items-center justify-center gap-2 px-4 py-2.5 bg-[#14566B] hover:bg-[#0F4354] text-white font-medium text-sm rounded-[6px] shadow-xs transition-colors focus:outline-none focus:ring-2 focus:ring-[#14566B] focus:ring-offset-2 min-h-[44px] min-w-[44px]"
          >
            <span aria-hidden="true" className="text-base font-bold">＋</span>
            <span>إضافة طرف جديد</span>
          </Link>
        </div>
      </div>

      {/* 2. Filters & Search Section */}
      <div className="bg-white p-4 rounded-[6px] border border-[#D5DFE3] space-y-4 shadow-xs">
        <form onSubmit={handleSearchSubmit} className="flex flex-col sm:flex-row gap-3">
          <div className="flex-1 relative">
            <label htmlFor="party-search-input" className="sr-only">
              البحث بالاسم أو رقم الهاتف
            </label>
            <input
              id="party-search-input"
              data-testid="party-search-input"
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="البحث بالاسم أو رقم الهاتف..."
              className="w-full px-3.5 py-2.5 rounded-[6px] border border-[#A7B9C1] text-sm text-[#172A35] placeholder-[#4D606A] focus:outline-none focus:ring-2 focus:ring-[#14566B] focus:border-transparent min-h-[44px]"
            />
          </div>

          <button
            type="submit"
            data-testid="party-search-submit"
            className="px-5 py-2.5 bg-[#14566B] hover:bg-[#0F4354] text-white font-medium text-sm rounded-[6px] shadow-xs transition-colors focus:outline-none focus:ring-2 focus:ring-[#14566B] focus:ring-offset-2 min-h-[44px] shrink-0"
          >
            بحث
          </button>
        </form>

        {/* Kind Filters */}
        <div className="flex flex-wrap items-center justify-between gap-3 pt-2 border-t border-[#E8EEF1]">
          <div className="flex items-center gap-2" role="group" aria-label="تصفية حسب نوع الطرف">
            <span className="text-xs font-semibold text-[#4D606A] ml-1">التصنيف:</span>

            <button
              type="button"
              data-testid="filter-all"
              onClick={() => handleKindFilterChange(undefined)}
              aria-pressed={selectedKind === undefined}
              className={`px-3 py-1.5 text-xs font-medium rounded-[6px] min-h-[36px] transition-colors focus:outline-none focus:ring-2 focus:ring-[#14566B] ${
                selectedKind === undefined
                  ? 'bg-[#14566B] text-white shadow-xs'
                  : 'bg-[#F4F6F7] text-[#172A35] hover:bg-[#E8EEF1]'
              }`}
            >
              الكل
            </button>

            <button
              type="button"
              data-testid="filter-person"
              onClick={() => handleKindFilterChange('PERSON')}
              aria-pressed={selectedKind === 'PERSON'}
              className={`px-3 py-1.5 text-xs font-medium rounded-[6px] min-h-[36px] transition-colors focus:outline-none focus:ring-2 focus:ring-[#14566B] ${
                selectedKind === 'PERSON'
                  ? 'bg-[#14566B] text-white shadow-xs'
                  : 'bg-[#F4F6F7] text-[#172A35] hover:bg-[#E8EEF1]'
              }`}
            >
              أفراد (طبيعي)
            </button>

            <button
              type="button"
              data-testid="filter-organization"
              onClick={() => handleKindFilterChange('ORGANIZATION')}
              aria-pressed={selectedKind === 'ORGANIZATION'}
              className={`px-3 py-1.5 text-xs font-medium rounded-[6px] min-h-[36px] transition-colors focus:outline-none focus:ring-2 focus:ring-[#14566B] ${
                selectedKind === 'ORGANIZATION'
                  ? 'bg-[#14566B] text-white shadow-xs'
                  : 'bg-[#F4F6F7] text-[#172A35] hover:bg-[#E8EEF1]'
              }`}
            >
              شركات ومؤسسات (اعتباري)
            </button>
          </div>

          <div className="text-xs font-medium text-[#4D606A]" data-testid="party-total-count">
            إجمالي الأطراف: <span className="font-bold text-[#172A35]">{totalCount}</span>
          </div>
        </div>
      </div>

      {/* 3. Main Content: Loading, Error, Empty, or Table */}
      {isLoading ? (
        <LoadingIndicator label="جارٍ تحميل دليل الأطراف..." />
      ) : error ? (
        <ErrorContainer
          title="تعذر تحميل دليل الأطراف"
          message={error}
          onRetry={() => fetchParties(query, selectedKind, page)}
        />
      ) : parties.length === 0 ? (
        hasActiveFilters ? (
          <EmptyStateContainer
            testId="empty-search-container"
            icon="🔍"
            title="لم يتم العثور على نتائج"
            description="لا يوجد أطراف مسجلة مطابقة لمعايير البحث الحالية."
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
            icon="👥"
            title="لا توجد أطراف مسجلة حتى الآن"
            description="ابدأ بإضافة أول طرف أو موكل في مكتبك لتسجيل التوكيلات والملاحظات."
            action={
              <Link
                href="/parties/new"
                className="inline-flex items-center justify-center gap-2 px-4 py-2.5 bg-[#14566B] text-white text-sm font-medium rounded-[6px] min-h-[44px]"
              >
                <span>إضافة طرف جديد</span>
              </Link>
            }
          />
        )
      ) : (
        <div className="space-y-4">
          {/* Desktop Table */}
          <div className="hidden md:block bg-white rounded-[6px] border border-[#D5DFE3] overflow-hidden shadow-xs">
            <div className="overflow-x-auto">
              <table
                data-testid="parties-table"
                className="w-full text-right text-sm text-[#172A35] border-collapse"
              >
                <thead className="bg-[#F4F6F7] text-xs font-semibold text-[#4D606A] border-b border-[#D5DFE3]">
                  <tr>
                    <th scope="col" className="px-4 py-3">الاسم</th>
                    <th scope="col" className="px-4 py-3">النوع</th>
                    <th scope="col" className="px-4 py-3">الهاتف الأساسي</th>
                    <th scope="col" className="px-4 py-3">إثبات الهوية</th>
                    <th scope="col" className="px-4 py-3">تاريخ الإضافة</th>
                    <th scope="col" className="px-4 py-3 text-center">الإجراءات</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#E8EEF1]">
                  {parties.map((party) => (
                    <tr
                      key={party.id}
                      data-testid={`party-row-${party.id}`}
                      className="hover:bg-[#F9FBFC] transition-colors"
                    >
                      <td className="px-4 py-3 font-semibold text-[#172A35]">
                        <Link
                          href={`/parties/${party.id}`}
                          className="hover:text-[#14566B] hover:underline focus:outline-none focus:ring-1 focus:ring-[#14566B] rounded"
                        >
                          {party.name}
                        </Link>
                      </td>
                      <td className="px-4 py-3">
                        <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-[#E8EEF1] text-[#172A35]">
                          {PARTY_KIND_SHORT_LABELS[party.kind]}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        {party.primaryPhone ? (
                          <bdi dir="ltr" className="font-mono text-xs text-[#172A35]">
                            {party.primaryPhone}
                          </bdi>
                        ) : (
                          <span className="text-xs text-[#4D606A]">—</span>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        {party.identityMask ? (
                          <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded text-xs bg-slate-100 text-slate-800 border border-slate-200">
                            <span className="font-medium">
                              {IDENTIFICATION_TYPE_LABELS[party.identityMask.identificationType]}
                            </span>
                            <bdi dir="ltr" className="font-mono">
                              ••••{party.identityMask.lastFour}
                            </bdi>
                          </span>
                        ) : (
                          <span className="text-xs text-[#4D606A]">غير مسجلة</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-xs text-[#4D606A]">
                        {formatCairoDateOnly(party.createdAt)}
                      </td>
                      <td className="px-4 py-3 text-center">
                        <Link
                          href={`/parties/${party.id}`}
                          data-testid={`view-party-${party.id}`}
                          className="inline-flex items-center justify-center px-3 py-1.5 text-xs font-medium text-[#14566B] hover:bg-[#E8EEF1] rounded-[6px] border border-[#D5DFE3] transition-colors min-h-[36px]"
                        >
                          عرض الملف
                        </Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Mobile & Tablet Card List */}
          <div className="md:hidden space-y-3" data-testid="parties-mobile-list">
            {parties.map((party) => (
              <div
                key={party.id}
                data-testid={`party-card-${party.id}`}
                className="bg-white p-4 rounded-[6px] border border-[#D5DFE3] space-y-3 shadow-xs"
              >
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <span className="inline-block px-2 py-0.5 rounded text-[11px] font-medium bg-[#E8EEF1] text-[#172A35] mb-1">
                      {PARTY_KIND_SHORT_LABELS[party.kind]}
                    </span>
                    <h2 className="text-base font-bold text-[#172A35]">
                      <Link href={`/parties/${party.id}`} className="hover:underline">
                        {party.name}
                      </Link>
                    </h2>
                  </div>

                  <Link
                    href={`/parties/${party.id}`}
                    data-testid={`mobile-view-party-${party.id}`}
                    className="shrink-0 px-3 py-1.5 text-xs font-medium text-[#14566B] bg-[#F4F6F7] hover:bg-[#E8EEF1] border border-[#D5DFE3] rounded-[6px] min-h-[44px] flex items-center justify-center"
                  >
                    عرض الملف
                  </Link>
                </div>

                <div className="text-xs text-[#4D606A] space-y-1 pt-2 border-t border-[#E8EEF1]">
                  {party.primaryPhone && (
                    <div className="flex items-center justify-between">
                      <span>الهاتف:</span>
                      <bdi dir="ltr" className="font-mono text-[#172A35]">
                        {party.primaryPhone}
                      </bdi>
                    </div>
                  )}

                  {party.identityMask && (
                    <div className="flex items-center justify-between">
                      <span>الهوية:</span>
                      <span className="inline-flex items-center gap-1 font-mono">
                        {IDENTIFICATION_TYPE_LABELS[party.identityMask.identificationType]} (••••{party.identityMask.lastFour})
                      </span>
                    </div>
                  )}

                  <div className="flex items-center justify-between text-[11px] text-[#4D606A] pt-1">
                    <span>تاريخ الإضافة:</span>
                    <span>{formatCairoDateOnly(party.createdAt)}</span>
                  </div>
                </div>
              </div>
            ))}
          </div>

          {/* 4. Pagination */}
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

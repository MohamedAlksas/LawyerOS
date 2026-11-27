'use client';

import React, { useState, useEffect, useCallback, useRef } from 'react';
import { GuardedLink as Link } from '@/components/navigation-guard';
import { revealPartyIdentityAction } from '@/modules/parties/actions';
import { getPartyMatterAssociationsAction } from '@/modules/matters/matter-actions';
import { PartyMatterAssociationDTO } from '@/modules/matters/matter-types';
import { ClientProfileDTO, LinkableDocumentSummary } from '@/modules/parties/types';
import {
  isAuthRecoveryCode,
  MATTER_PARTY_ROLE_LABELS,
  MATTER_STATUS_LABELS,
} from '@/components/matters/matter-ui-types';
import {
  PARTY_KIND_LABELS,
  IDENTIFICATION_TYPE_LABELS,
  formatCairoDateOnly,
} from './party-types';
import { CommunicationNotesSection } from './communication-notes-section';
import { PoaSection } from './poa-section';

interface PartyProfileClientProps {
  ownerId: string;
  party: ClientProfileDTO;
  canReadDocuments?: boolean;
  availablePoaDocuments?: LinkableDocumentSummary[];
  poaDocumentsError?: string;
}

export function PartyProfileClient({
  ownerId,
  party,
  canReadDocuments = false,
  availablePoaDocuments = [],
  poaDocumentsError,
}: PartyProfileClientProps) {
  const isArchived = Boolean(party.archivedAt);
  const [revealedNumber, setRevealedNumber] = useState<string | null>(null);
  const [isRevealing, setIsRevealing] = useState(false);
  const [revealError, setRevealError] = useState<string | null>(null);

  const [linkedMatters, setLinkedMatters] = useState<PartyMatterAssociationDTO[]>([]);
  const [isLoadingMatters, setIsLoadingMatters] = useState(true);
  const [mattersError, setMattersError] = useState<string | null>(null);
  const [mattersPage, setMattersPage] = useState(0);
  const requestedMattersPage = useRef(0);
  const [mattersTotal, setMattersTotal] = useState(0);
  const mattersGenRef = useRef(0);
  const MATTERS_PAGE_SIZE = 50;
  const mattersTotalPages = Math.max(1, Math.ceil(mattersTotal / MATTERS_PAGE_SIZE));

  const loadMatters = useCallback(
    async (pageIndex: number) => {
      const gen = ++mattersGenRef.current;
      requestedMattersPage.current = pageIndex;
      setIsLoadingMatters(true);
      setMattersError(null);
      try {
        const fetchPage = (index: number) => getPartyMatterAssociationsAction({
          partyId: party.id,
          limit: MATTERS_PAGE_SIZE,
          offset: index * MATTERS_PAGE_SIZE,
        });
        let res = await fetchPage(pageIndex);
        if (gen !== mattersGenRef.current) return;
        if (res.success && res.data.associations.length === 0 && pageIndex > 0) {
          pageIndex = Math.max(0, Math.ceil(res.data.total / MATTERS_PAGE_SIZE) - 1);
          requestedMattersPage.current = pageIndex;
          res = await fetchPage(pageIndex);
        }
        if (gen !== mattersGenRef.current) return;
        if (!res.success) {
          if (isAuthRecoveryCode(res.code)) {
            window.dispatchEvent(new Event('lawoffice:recheck-session'));
          }
          setMattersError(res.error || 'تعذر تحميل ملفات القضايا المرتبطة بهذا الطرف.');
          return;
        }
        setLinkedMatters(res.data.associations);
        setMattersTotal(res.data.total);
        setMattersPage(pageIndex);
      } catch {
        if (gen !== mattersGenRef.current) return;
        setMattersError('حدث خطأ في الاتصال أثناء استرجاع القضايا المرتبطة.');
      } finally {
        if (gen === mattersGenRef.current) setIsLoadingMatters(false);
      }
    },
    [party.id]
  );

  useEffect(() => {
    let ignore = false;
    const gen = ++mattersGenRef.current;
    getPartyMatterAssociationsAction({
      partyId: party.id,
      limit: MATTERS_PAGE_SIZE,
      offset: 0,
    })
      .then((res) => {
        if (ignore || gen !== mattersGenRef.current) return;
        setIsLoadingMatters(false);
        if (!res.success) {
          if (isAuthRecoveryCode(res.code)) {
            window.dispatchEvent(new Event('lawoffice:recheck-session'));
          }
          setMattersError(res.error || 'تعذر تحميل ملفات القضايا المرتبطة بهذا الطرف.');
          return;
        }
        setLinkedMatters(res.data.associations);
        setMattersTotal(res.data.total);
        setMattersPage(0);
      })
      .catch(() => {
        if (ignore || gen !== mattersGenRef.current) return;
        setIsLoadingMatters(false);
        setMattersError('حدث خطأ في الاتصال أثناء استرجاع القضايا المرتبطة.');
      });
    return () => {
      ignore = true;
    };
  }, [party.id]);

  const handleRevealIdentity = async () => {
    setIsRevealing(true);
    setRevealError(null);

    try {
      const res = await revealPartyIdentityAction(
        party.id,
        'استعراض رقم الهوية لأغراض التحقق القانوني بالمكتب'
      );

      if (!res.success) {
        if (isAuthRecoveryCode(res.code)) {
          window.dispatchEvent(new Event('lawoffice:recheck-session'));
        }
        setRevealError(res.error || 'تعذر فك تشفير رقم الهوية.');
        setIsRevealing(false);
        return;
      }

      setRevealedNumber(res.data.number);
      setIsRevealing(false);
    } catch {
      setRevealError('حدث خطأ أثناء الاتصال بالخادم لكشف الهوية.');
      setIsRevealing(false);
    }
  };

  const handleHideIdentity = () => {
    setRevealedNumber(null);
    setRevealError(null);
  };

  return (
    <div className="space-y-6 max-w-4xl">
      {/* 1. Header / Breadcrumb */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 pb-4 border-b border-[#D5DFE3]">
        <div className="space-y-1 min-w-0">
          <nav aria-label="مسار التصفح" className="text-xs text-[#4D606A] flex flex-wrap items-center gap-1.5 min-w-0">
            <Link href="/parties" className="hover:text-[#14566B] hover:underline">
              دليل الأطراف
            </Link>
            <span aria-hidden="true">/</span>
            <span className="text-[#172A35] font-medium min-w-0 [overflow-wrap:anywhere]">{party.name}</span>
          </nav>
          <div className="flex flex-wrap items-center gap-3 min-w-0">
            <h1 className="min-w-0 [overflow-wrap:anywhere] text-2xl font-bold text-[#172A35] tracking-tight">
              {party.name}
            </h1>
            <span className="inline-block px-2.5 py-0.5 rounded text-xs font-semibold bg-[#E8EEF1] text-[#14566B]">
              {PARTY_KIND_LABELS[party.kind]}
            </span>
            {isArchived && (
              <span
                data-testid="party-archived-badge"
                className="inline-block px-2.5 py-0.5 rounded text-xs font-bold bg-stone-100 text-stone-700 border border-stone-300"
              >
                مؤرشف
              </span>
            )}
          </div>
        </div>

        <div className="flex items-center gap-2">
          {!isArchived ? (
            <Link
              href={`/parties/${party.id}/edit`}
              data-testid="edit-party-button"
              className="inline-flex items-center justify-center gap-2 px-4 py-2 bg-[#14566B] hover:bg-[#0F4354] text-white text-xs font-bold rounded-[6px] transition-colors min-h-[44px]"
            >
              <span>تعديل البيانات</span>
            </Link>
          ) : (
            <span
              className="text-xs text-stone-600 bg-stone-100 px-3 py-1.5 rounded border border-stone-300 font-semibold"
            >
              ملف قراءة فقط
            </span>
          )}
        </div>
      </div>

      {/* Read-Only Banner for Archived Party */}
      {isArchived && (
        <div
          role="alert"
          data-testid="party-archived-banner"
          className="p-4 bg-stone-100 border-2 border-stone-300 rounded-[6px] text-stone-900 space-y-1 shadow-xs"
        >
          <div className="flex items-center gap-2 font-bold text-sm text-stone-900">
            <span>ملف الطرف مؤرشف — وضع القراءة فقط</span>
          </div>
          <p className="text-xs text-stone-700 leading-relaxed">
            تمت أرشفة هذا الطرف وهو في وضع القراءة فقط. تم تعطيل عمليات تعديل البيانات وإضافة ملاحظات التواصل وسندات الوكالة.
          </p>
        </div>
      )}

      {/* 2. Core Profile Details Card */}
      <div
        data-testid="party-summary-card"
        className="bg-white rounded-[6px] border border-[#D5DFE3] p-5 sm:p-6 space-y-6 shadow-xs"
      >
        <h2 className="text-base font-bold text-[#172A35] pb-2 border-b border-[#E8EEF1]">
          البيانات الأساسية ومعلومات الاتصال
        </h2>

        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-5 text-sm">
          {/* Primary Phone */}
          <div>
            <span className="block text-xs font-semibold text-[#4D606A] mb-1">
              رقم الهاتف الأساسي
            </span>
            {party.primaryPhone ? (
              <bdi dir="ltr" className="font-mono text-base font-semibold text-[#172A35]">
                {party.primaryPhone}
              </bdi>
            ) : (
              <span className="text-[#4D606A]">غير محدد</span>
            )}
          </div>

          {/* Additional Phones */}
          <div>
            <span className="block text-xs font-semibold text-[#4D606A] mb-1">
              أرقام هواتف إضافية
            </span>
            {party.additionalPhones && party.additionalPhones.length > 0 ? (
              <div className="flex flex-wrap gap-1 font-mono text-xs">
                {party.additionalPhones.map((phone, idx) => (
                  <bdi
                    key={idx}
                    dir="ltr"
                    className="inline-block bg-[#F4F6F7] px-2 py-0.5 rounded border border-[#D5DFE3]"
                  >
                    {phone}
                  </bdi>
                ))}
              </div>
            ) : (
              <span className="text-[#4D606A]">لا يوجد</span>
            )}
          </div>

          {/* Email */}
          <div>
            <span className="block text-xs font-semibold text-[#4D606A] mb-1">
              البريد الإلكتروني
            </span>
            {party.email ? (
              <bdi dir="ltr" className="text-sm font-medium text-[#172A35] break-all">
                {party.email}
              </bdi>
            ) : (
              <span className="text-[#4D606A]">غير محدد</span>
            )}
          </div>

          {/* Address */}
          <div className="sm:col-span-2">
            <span className="block text-xs font-semibold text-[#4D606A] mb-1">
              العنوان الوطني / المختار
            </span>
            <p className="text-sm text-[#172A35]">
              {party.address || 'غير محدد'}
            </p>
          </div>

          {/* Registration Date */}
          <div>
            <span className="block text-xs font-semibold text-[#4D606A] mb-1">
              تاريخ التسجيل بالمنظومة
            </span>
            <span className="text-xs text-[#172A35]">
              {formatCairoDateOnly(party.createdAt)}
            </span>
          </div>
        </div>

        {/* Masked Identity Section */}
        <div className="pt-4 border-t border-[#E8EEF1] space-y-2">
          <span className="block text-xs font-semibold text-[#4D606A]">
            وثيقة إثبات الهوية المشفرة
          </span>

          {party.identityMask ? (
            <div className="p-3.5 bg-[#F9FBFC] rounded-[6px] border border-[#D5DFE3] space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="space-y-1">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-bold text-[#172A35]">
                      {IDENTIFICATION_TYPE_LABELS[party.identityMask.identificationType]}
                    </span>
                    {!revealedNumber ? (
                      <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-mono bg-slate-100 text-slate-800 border border-slate-200">
                        •••• •••• •••• <bdi dir="ltr">{party.identityMask.lastFour}</bdi>
                      </span>
                    ) : (
                      <span
                        data-testid="revealed-identity-number"
                        className="inline-flex items-center px-2.5 py-1 rounded text-sm font-mono font-bold bg-emerald-50 text-emerald-900 border border-emerald-300"
                      >
                        <bdi dir="ltr">{revealedNumber}</bdi>
                      </span>
                    )}
                  </div>

                  <p className="text-[11px] text-[#4D606A]">
                    مشفرة بتقنية AES-256-GCM. الرقم الكامل محجوب افتراضياً لحماية الخصوصية.
                  </p>
                </div>

                {!isArchived && (
                  <div>
                    {!revealedNumber ? (
                      <button
                        type="button"
                        data-testid="reveal-identity-button"
                        onClick={handleRevealIdentity}
                        disabled={isRevealing}
                        className="px-3 py-1.5 bg-slate-200 hover:bg-slate-300 text-[#172A35] text-xs font-semibold rounded-[6px] transition-colors min-h-[44px]"
                      >
                        {isRevealing ? 'جارٍ كشف الهوية...' : 'عرض الرقم الكامل'}
                      </button>
                    ) : (
                      <button
                        type="button"
                        data-testid="hide-identity-button"
                        onClick={handleHideIdentity}
                        className="px-3 py-1.5 bg-slate-200 hover:bg-slate-300 text-[#172A35] text-xs font-semibold rounded-[6px] transition-colors min-h-[44px]"
                      >
                        إخفاء الرقم
                      </button>
                    )}
                  </div>
                )}
              </div>

              {revealError && (
                <div role="alert" className="p-2 text-xs text-red-700 bg-red-50 border border-red-200 rounded">
                  {revealError}
                </div>
              )}

              {revealedNumber && (
                <p
                  data-testid="reveal-audit-notice"
                  className="text-[11px] text-emerald-800 bg-emerald-50/60 p-2 rounded border border-emerald-200"
                >
                  ✓ تم فك التشفير وعرض الرقم الكامل بنجاح. تم تسجيل العملية في سجل التدقيق الأمني (Audit Log).
                </p>
              )}
            </div>
          ) : (
            <p className="text-xs text-[#4D606A] italic">
              لم يتم تسجيل وثيقة إثبات هوية لهذا الطرف.
            </p>
          )}
        </div>

        {/* Notes if present */}
        {party.notes && (
          <div className="pt-4 border-t border-[#E8EEF1]">
            <span className="block text-xs font-semibold text-[#4D606A] mb-1">
              ملاحظات عامة
            </span>
            <p className="text-xs text-[#172A35] whitespace-pre-wrap leading-relaxed bg-[#F9FBFC] p-3 rounded border border-[#E8EEF1]">
              {party.notes}
            </p>
          </div>
        )}
      </div>

      {/* 3. Communication Notes Timeline */}
      <CommunicationNotesSection ownerId={ownerId} partyId={party.id} initialNotes={party.communicationNotes} readOnly={isArchived} />

      {/* 4. Powers of Attorney Section */}
      <PoaSection
        ownerId={ownerId}
        partyId={party.id}
        initialPoas={party.powersOfAttorney}
        canReadDocuments={canReadDocuments}
        availableDocuments={availablePoaDocuments}
        documentsLoadError={poaDocumentsError}
        readOnly={isArchived}
      />

      {/* 5. Linked Matters Section */}
      <div className="bg-white rounded-[6px] border border-[#D5DFE3] p-5 sm:p-6 shadow-xs space-y-4" data-testid="party-matters-section">
        <div className="flex items-center justify-between pb-2 border-b border-[#E8EEF1]">
          <h2 className="text-base font-bold text-[#172A35]">
            ملفات القضايا والنزاعات المرتبطة ({mattersError ? '—' : isLoadingMatters && mattersTotal === 0 ? '…' : mattersTotal})
          </h2>
          {!isArchived && (
            <Link
              href="/matters/new"
              className="text-xs font-semibold text-[#14566B] hover:underline"
            >
              + فتح ملف جديد
            </Link>
          )}
        </div>

        {mattersError ? (
          <div
            role="alert"
            data-testid="party-matters-error-banner"
            className="p-3 bg-red-50 border border-red-200 rounded-[6px] text-xs text-[#A4262C] flex items-center justify-between gap-2"
          >
            <span>{mattersError}</span>
            <button
              type="button"
              onClick={() => loadMatters(requestedMattersPage.current)}
              className="px-2.5 py-1 bg-white hover:bg-red-100 text-[#A4262C] font-semibold border border-red-300 rounded text-xs"
            >
              إعادة المحاولة
            </button>
          </div>
        ) : isLoadingMatters ? (
          <p className="text-xs text-[#4D606A] italic">جارٍ تحميل ملفات القضايا المرتبطة...</p>
        ) : mattersTotal === 0 ? (
          <p className="text-xs text-[#4D606A] italic">لا توجد ملفات قضايا مسجلة لهذا الطرف بعد.</p>
        ) : (
          <div className="space-y-3">
            <div className="divide-y divide-[#E8EEF1]">
            {linkedMatters.map((m) => (
              <div
                key={m.matterPartyId}
                data-testid={`linked-matter-${m.matterId}`}
                className="py-3 flex items-center justify-between gap-3 text-xs"
              >
                <div className="space-y-1 min-w-0">
                  <div className="flex flex-wrap items-center gap-2 min-w-0">
                    <bdi dir="ltr" className="font-mono font-bold text-[#14566B] bg-slate-50 px-2 py-0.5 rounded border border-slate-200">
                      {m.fileCode}
                    </bdi>
                    <Link
                      href={`/matters/${m.matterId}`}
                      className="min-w-0 [overflow-wrap:anywhere] font-bold text-sm text-[#172A35] hover:text-[#14566B] hover:underline"
                    >
                      {m.title}
                    </Link>
                    <span
                      data-testid={`matter-role-badge-${m.matterId}`}
                      className={`px-2 py-0.5 rounded text-[11px] font-bold border ${
                        m.role === 'CLIENT'
                          ? 'bg-blue-50 text-blue-800 border-blue-200'
                          : m.role === 'OPPONENT'
                          ? 'bg-rose-50 text-rose-800 border-rose-200'
                          : 'bg-slate-100 text-slate-700 border-slate-300'
                      }`}
                    >
                      {MATTER_PARTY_ROLE_LABELS[m.role]}
                    </span>
                    {m.isPrimaryContact && (
                      <span className="px-1.5 py-0.5 rounded bg-amber-50 text-amber-800 border border-amber-200 text-[10px] font-semibold">
                        جهة الاتصال الرئيسية
                      </span>
                    )}
                  </div>
                  <span className="text-[#4D606A] block">
                    الحالة: {MATTER_STATUS_LABELS[m.status] || m.status}
                  </span>
                </div>

                <Link
                  href={`/matters/${m.matterId}`}
                  className="px-3 py-1.5 text-xs font-semibold text-[#14566B] bg-[#F4F6F7] hover:bg-[#E8EEF1] rounded border border-[#D5DFE3] min-h-[44px] flex items-center"
                >
                  عرض الملف
                </Link>
              </div>
            ))}
            </div>

            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 pt-1 text-[11px] text-[#4D606A]">
              <span data-testid="party-matters-count">
                عرض {linkedMatters.length} من {mattersTotal} ارتباط — صفحة {mattersPage + 1} من{' '}
                {mattersTotalPages}
              </span>
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => loadMatters(mattersPage - 1)}
                  disabled={mattersPage <= 0 || isLoadingMatters}
                  data-testid="party-matters-prev"
                  className="px-2.5 py-1 rounded border border-[#D5DFE3] bg-white disabled:opacity-40 min-h-[44px]"
                >
                  السابق
                </button>
                <button
                  type="button"
                  onClick={() => loadMatters(mattersPage + 1)}
                  disabled={mattersPage + 1 >= mattersTotalPages || isLoadingMatters}
                  data-testid="party-matters-next"
                  className="px-2.5 py-1 rounded border border-[#D5DFE3] bg-white disabled:opacity-40 min-h-[44px]"
                >
                  التالي
                </button>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* 6. Future Financial Modules Indicator */}
      <div className="p-4 bg-[#F4F6F7] rounded-[6px] border border-dashed border-[#D5DFE3] text-xs text-[#4D606A] space-y-1">
        <span className="font-bold text-[#172A35] block">
          الحسابات المالية والأتعاب
        </span>
        <p>
          وحدات حسابات الأتعاب والمصروفات
          غير مفعلة في هذه المرحلة التشغيلية، وسيتم ربطها تلقائياً بملف هذا الطرف عند إطلاقها.
        </p>
      </div>
    </div>
  );
}

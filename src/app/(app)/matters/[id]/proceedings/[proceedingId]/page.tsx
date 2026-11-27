import React from 'react';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireActor } from '@/modules/identity/require-actor';
import { redirectOnAuthError } from '@/modules/identity/auth-redirect';
import { AuthenticationError, AuthorizationError } from '@/modules/identity/types';
import { authorize } from '@/modules/identity/authorize';
import { getMatter } from '@/modules/matters/matter-service';
import { hasCompleteProceedingRegistration } from '@/modules/matters/matter-types';
import { NotFoundError } from '@/modules/matters/matter-types';
import { EmptyStateContainer } from '@/components/presentation-state';
import {
  PROCEEDING_INSTANCE_LABELS,
  PROCEEDING_STATUS_LABELS,
  PROCEEDING_STATUS_CLASSES,
  PROCEEDING_LEGAL_CAPACITY_LABELS,
  formatCairoDateOnly,
} from '@/components/matters/matter-ui-types';
import { listHearingsForProceeding } from '@/modules/scheduling/hearing-service';
import { HearingList } from '@/components/hearings/hearing-list';
import type { HearingDTO } from '@/components/hearings/hearing-ui-types';

interface ProceedingDetailPageProps {
  params: Promise<{
    id: string;
    proceedingId: string;
  }>;
}

export const metadata = { title: 'القيد القضائي — LawOffice OS' };

const UUID_REGEX = /^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i;

export default async function ProceedingDetailPage({ params }: ProceedingDetailPageProps) {
  const { id, proceedingId } = await params;
  let actor;
  try {
    actor = await requireActor({ requiredPermission: 'READ_CLIENT_DATA' });
  } catch (error) {
    if (error instanceof AuthenticationError) {
      await redirectOnAuthError(error, `/matters/${id}/proceedings/${proceedingId}`);
    }
    if (error instanceof AuthorizationError) {
      return (
        <div role="alert" className="max-w-4xl mx-auto p-6 bg-white rounded border border-red-200 text-[#A4262C]">
          <h1 className="text-xl font-bold mb-2">وصول مرفوض</h1>
          <p>لا تمتلك الصلاحيات الكافية لاستعراض هذا القيد القضائي.</p>
        </div>
      );
    }
    throw error;
  }

  if (!UUID_REGEX.test(id) || !UUID_REGEX.test(proceedingId)) {
    notFound();
  }

  const canWriteClientData = authorize(actor, 'WRITE_CLIENT_DATA');
  const canReadDocuments = authorize(actor, 'READ_DOCUMENTS');

  let matter;
  try {
    matter = await getMatter(id, actor);
  } catch (error) {
    if (error instanceof NotFoundError) {
      return (
        <div className="max-w-3xl mx-auto py-12">
          <EmptyStateContainer
            icon=""
            headingLevel="h1"
            title="الملف غير موجود"
            description="لم يتم العثور على ملف القضية المطلوب."
            action={
              <Link
                href="/matters"
                className="px-4 py-2 bg-[#14566B] text-white text-xs font-semibold rounded-[6px] min-h-[44px] flex items-center justify-center"
              >
                العودة لدليل ملفات القضايا
              </Link>
            }
          />
        </div>
      );
    }
    throw error;
  }

  const proceeding = (matter.proceedings || []).find((p) => p.id === proceedingId);
  if (!proceeding || proceeding.matterId !== id) {
    return (
      <div className="max-w-3xl mx-auto py-12">
        <EmptyStateContainer
          icon=""
          headingLevel="h1"
          title="القيد القضائي غير موجود"
          description="لم يتم العثور على القيد القضائي المطلوب داخل هذا الملف، أو قد يكون تابعاً لملف آخر."
          action={
            <Link
              href={`/matters/${matter.id}`}
              className="px-4 py-2 bg-[#14566B] text-white text-xs font-semibold rounded-[6px] min-h-[44px] flex items-center justify-center"
            >
              العودة لملف القضية
            </Link>
          }
        />
      </div>
    );
  }

  const isDraft = !hasCompleteProceedingRegistration(proceeding);
  const isProcArchived = Boolean(proceeding.archivedAt);
  const isParentMatterArchived = matter.status === 'ARCHIVED' || Boolean(matter.archivedAt);
  const isReadOnly = isProcArchived || isParentMatterArchived;

  const hearings: HearingDTO[] = await listHearingsForProceeding(actor, proceedingId);

  return (
    <div className="max-w-5xl mx-auto space-y-6" dir="rtl" lang="ar-EG">
      {/* Breadcrumb Navigation */}
      <nav aria-label="مسار التنقل" className="text-xs text-[#4D606A] flex flex-wrap items-center gap-1.5">
        <Link href="/" className="hover:text-[#172A35]">
          الرئيسية
        </Link>
        <span aria-hidden="true">/</span>
        <Link href="/matters" className="hover:text-[#172A35]">
          ملفات القضايا
        </Link>
        <span aria-hidden="true">/</span>
        <Link href={`/matters/${matter.id}`} className="hover:text-[#172A35]">
          ملف <bdi dir="ltr">{matter.fileCode}</bdi>
        </Link>
        <span aria-hidden="true">/</span>
        <span className="font-bold text-[#172A35]">تفاصيل القيد القضائي</span>
      </nav>

      {/* Read-Only Banner for Archived Proceeding or Archived Parent Matter */}
      {isReadOnly && (
        <div
          role="alert"
          data-testid="proceeding-archived-banner"
          className="p-4 bg-stone-100 border-2 border-stone-300 rounded-[6px] text-stone-900 space-y-1 shadow-xs"
        >
          <div className="flex items-center gap-2 font-bold text-sm text-stone-900">
            <span>
              {isParentMatterArchived
                ? 'ملف القضية الرئيسي مؤرشف — القيد في وضع القراءة فقط'
                : 'القيد القضائي مؤرشف — وضع القراءة فقط'}
            </span>
          </div>
          <p className="text-xs text-stone-700 leading-relaxed">
            {isParentMatterArchived
              ? 'تمت أرشفة ملف القضية الرئيسي، وبالتالي تم قفل هذا القيد القضائي وتعطيل أي تعديلات عليه.'
              : 'تمت أرشفة هذا القيد القضائي وأصبح في وضع القراءة فقط. تم تعطيل تعديل بيانات القيد.'}
          </p>
        </div>
      )}

      {/* Header */}
      <div className="bg-white rounded-[6px] border border-[#D5DFE3] p-6 shadow-xs space-y-4">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div className="space-y-1.5">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-xl font-bold text-[#172A35]" data-testid="proceeding-court-heading">
                {proceeding.courtName}
              </h1>
              <span className="text-xs font-semibold px-2.5 py-0.5 rounded bg-[#E8EEF1] text-[#14566B]">
                {PROCEEDING_INSTANCE_LABELS[proceeding.instance]}
              </span>
              {isProcArchived ? (
                <span
                  data-testid="proceeding-archived-badge"
                  className="text-xs font-bold px-2.5 py-0.5 rounded bg-stone-100 text-stone-700 border border-stone-300 inline-flex items-center gap-1"
                >
                  <span>مؤرشف</span>
                </span>
              ) : isDraft ? (
                <span
                  data-testid="proceeding-draft-badge"
                  className="text-xs font-bold px-2.5 py-0.5 rounded bg-amber-50 text-amber-800 border border-amber-300 inline-flex items-center gap-1"
                >
                  <span>الرقم غير مستكمل (مسودة قيد)</span>
                </span>
              ) : (
                <span
                  data-testid="proceeding-status-badge"
                  className={`text-xs font-semibold px-2.5 py-0.5 rounded border ${
                    PROCEEDING_STATUS_CLASSES[proceeding.status] || 'bg-gray-100 text-gray-700 border-gray-300'
                  }`}
                >
                  {PROCEEDING_STATUS_LABELS[proceeding.status]}
                </span>
              )}
            </div>

            <div className="text-xs text-[#4D606A] flex flex-wrap items-center gap-3 pt-1">
              <span>الملف: <bdi dir="ltr" className="font-semibold text-[#172A35]">{matter.fileCode}</bdi></span>
              <span aria-hidden="true">•</span>
              <span className="text-[#14566B] font-medium">{matter.title}</span>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2 shrink-0">
            {!isReadOnly && canWriteClientData && (
              <Link
                href={`/matters/${matter.id}/proceedings/${proceeding.id}/edit`}
                data-testid="edit-proceeding-button"
                className="px-4 py-2 bg-[#14566B] hover:bg-[#0F4354] text-white text-xs font-bold rounded-[6px] transition-colors min-h-[44px] flex items-center gap-1.5"
              >
                <span>تعديل بيانات القيد</span>
              </Link>
            )}
            <Link
              href={`/matters/${matter.id}`}
              className="px-3.5 py-2 bg-[#F4F6F7] hover:bg-[#E8EEF1] text-[#172A35] text-xs font-semibold rounded-[6px] border border-[#D5DFE3] transition-colors min-h-[44px] flex items-center"
            >
              العودة للملف
            </Link>
          </div>
        </div>
      </div>

      {/* Docket Information Card */}
      <div className="bg-white rounded-[6px] border border-[#D5DFE3] p-6 shadow-xs space-y-4" data-testid="proceeding-docket-card">
        <h2 className="text-base font-bold text-[#172A35] pb-2 border-b border-[#E8EEF1]">
          بيانات القيد والجدول القضائي
        </h2>

        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-6 text-xs">
          <div className="space-y-1">
            <span className="text-[#4D606A] block font-semibold">رقم الدعوى والسنة:</span>
            {proceeding.numberText && proceeding.yearLabel ? (
              <span className="font-mono text-sm font-bold text-[#14566B] bg-slate-50 px-2.5 py-1 rounded border border-slate-200 inline-block">
                <bdi dir="ltr">{proceeding.numberText}</bdi> لسنة <bdi dir="ltr">{proceeding.yearLabel}</bdi>
              </span>
            ) : (
              <span className="text-amber-800 font-semibold italic">لم يقيد برقم رسمي بعد</span>
            )}
          </div>

          <div className="space-y-1">
            <span className="text-[#4D606A] block font-semibold">نوع الجدول / القيد:</span>
            <span className="font-bold text-[#172A35]">{proceeding.registerType || '—'}</span>
          </div>

          <div className="space-y-1">
            <span className="text-[#4D606A] block font-semibold">درجة التقاضي:</span>
            <span className="font-bold text-[#172A35]">{PROCEEDING_INSTANCE_LABELS[proceeding.instance]}</span>
          </div>

          <div className="space-y-1">
            <span className="text-[#4D606A] block font-semibold">المحكمة:</span>
            <span className="font-bold text-[#172A35]">{proceeding.courtName}</span>
          </div>

          <div className="space-y-1">
            <span className="text-[#4D606A] block font-semibold">الدائرة القضائية:</span>
            <span className="font-bold text-[#172A35]">{proceeding.circuit || '—'}</span>
          </div>

          <div className="space-y-1">
            <span className="text-[#4D606A] block font-semibold">تاريخ رفع الدعوى / القيد:</span>
            <span className="font-bold text-[#172A35]">{formatCairoDateOnly(proceeding.filingDate)}</span>
          </div>

          <div className="space-y-1">
            <span className="text-[#4D606A] block font-semibold">قيمة المطالبة:</span>
            <span className="font-bold text-[#172A35]">
              {proceeding.claimAmount ? (
                <>
                  <bdi dir="ltr">{proceeding.claimAmount}</bdi> ج.م
                </>
              ) : (
                'غير محدد'
              )}
            </span>
          </div>

          <div className="space-y-1">
            <span className="text-[#4D606A] block font-semibold">حالة القيد الحالية:</span>
            <span className="font-bold text-[#172A35]">{PROCEEDING_STATUS_LABELS[proceeding.status]}</span>
          </div>
        </div>

        {/* Parent Proceeding linkage (Appeal -> First instance) */}
        {proceeding.parentProceedingSummary && (
          <div
            data-testid="parent-proceeding-link"
            className="mt-4 p-3 bg-blue-50/70 border border-blue-200 rounded-[6px] text-xs text-blue-900 flex items-center justify-between gap-3"
          >
            <div className="flex items-center gap-2">
              <span className="font-bold">مرتبط بالدعوى السابقة:</span>
              <span>{proceeding.parentProceedingSummary}</span>
            </div>
            {proceeding.parentProceedingId && (
              <Link
                href={`/matters/${matter.id}/proceedings/${proceeding.parentProceedingId}`}
                className="text-[#14566B] font-bold hover:underline shrink-0 min-h-[44px] inline-flex items-center"
              >
                عرض القيد السابق ←
              </Link>
            )}
          </div>
        )}
      </div>

      {/* Parties Legal Capacities in this Proceeding */}
      <div className="bg-white rounded-[6px] border border-[#D5DFE3] p-6 shadow-xs space-y-4" data-testid="proceeding-parties-card">
        <div className="flex items-center justify-between pb-2 border-b border-[#E8EEF1]">
          <div className="space-y-0.5">
            <h2 className="text-base font-bold text-[#172A35]">
              الصفات الإجرائية لأطراف الدعوى في هذا القيد
            </h2>
            <p className="text-xs text-[#4D606A]">
              تحديد صفة كل طرف في هذه الدرجة القضائية (مدعي، مدعى عليه، مستأنف، إلخ).
            </p>
          </div>
        </div>

        {proceeding.parties && proceeding.parties.length > 0 ? (
          <div className="overflow-x-auto">
            <table className="w-full text-xs text-right border-collapse">
              <thead>
                <tr className="bg-[#F4F6F7] text-[#4D606A] border-b border-[#D5DFE3]">
                  <th scope="col" className="p-3 font-semibold">اسم الطرف</th>
                  <th scope="col" className="p-3 font-semibold">الصفة الإجرائية المقررة</th>
                  <th scope="col" className="p-3 font-semibold">الوصف التفصيلي للصفة</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#E8EEF1]">
                {proceeding.parties.map((pp) => (
                  <tr key={pp.id} data-testid={`proceeding-party-row-${pp.id}`} className="hover:bg-[#F9FBFC]">
                    <td className="p-3 font-bold text-[#172A35]">
                      {pp.partyName}
                    </td>
                    <td className="p-3">
                      {pp.legalCapacity ? (
                        <span className="px-2 py-0.5 rounded bg-blue-50 text-blue-800 border border-blue-200 font-semibold">
                          {PROCEEDING_LEGAL_CAPACITY_LABELS[pp.legalCapacity]}
                        </span>
                      ) : (
                        <span className="text-[#4D606A] italic">غير محدد</span>
                      )}
                    </td>
                    <td className="p-3 text-[#14566B] font-medium">
                      {pp.capacityText || '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="p-6 text-center text-[#4D606A] bg-[#F4F6F7] rounded-[6px] border border-[#D5DFE3] space-y-1">
            <p className="font-bold text-xs">لم يتم ربط أطراف بصفات إجرائية مخصصة لهذا القيد بعد.</p>
            <p className="text-[11px]">يمكنك إضافة الصفات الإجرائية وتحديثها من خلال صفحة تعديل القيد.</p>
          </div>
        )}
      </div>

      {/* Hearings & Court Calendar Section (S05 & S06) */}
      <div className="bg-white rounded-[6px] border border-[#D5DFE3] p-6 shadow-xs">
        <HearingList
          key={`${actor.id}:${proceeding.id}`}
          actorId={actor.id}
          proceedingId={proceeding.id}
          matterId={matter.id}
          initialHearings={hearings}
          courtName={proceeding.courtName}
          circuit={proceeding.circuit}
          isReadOnly={isReadOnly || !canWriteClientData}
        />
      </div>

      {/* Active Matter Documents Link */}
      {canReadDocuments && (
        <div className="bg-white rounded-[6px] border border-[#D5DFE3] p-5 shadow-xs space-y-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-sm font-bold text-[#172A35]">مستندات القضية والقيد</h2>
            <Link
              href={`/documents?matterId=${id}`}
              className="text-xs font-semibold text-[#14566B] hover:underline min-h-[44px] inline-flex items-center"
            >
              عرض مستندات الملف في الأرشيف &larr;
            </Link>
          </div>
          <p className="text-xs text-[#4D606A] leading-relaxed">
            يمكنك استعراض ورفع المستندات والمذكرات المرتبطة بهذا الملف عبر أرشيف المستندات.
          </p>
        </div>
      )}
    </div>
  );
}

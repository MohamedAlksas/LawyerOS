import React from 'react';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { requireActor } from '@/modules/identity/require-actor';
import { AuthenticationError, AuthorizationError } from '@/modules/identity/types';
import { getMatter } from '@/modules/matters/matter-service';
import { NotFoundError } from '@/modules/matters/matter-types';
import { EmptyStateContainer } from '@/components/presentation-state';
import {
  PROCEEDING_INSTANCE_LABELS,
  PROCEEDING_STATUS_LABELS,
  PROCEEDING_STATUS_CLASSES,
  PROCEEDING_LEGAL_CAPACITY_LABELS,
  formatCairoDateOnly,
} from '@/components/matters/matter-ui-types';

interface ProceedingDetailPageProps {
  params: Promise<{
    id: string;
    proceedingId: string;
  }>;
}

export async function generateMetadata({ params }: ProceedingDetailPageProps) {
  const { id, proceedingId } = await params;
  try {
    const actor = await requireActor();
    const matter = await getMatter(id, actor);
    const proceeding = (matter.proceedings || []).find((p) => p.id === proceedingId);
    if (!proceeding) {
      return {
        title: 'القيد القضائي — LawOffice OS',
      };
    }
    const docket = proceeding.numberText && proceeding.yearLabel
      ? `${proceeding.numberText}/${proceeding.yearLabel}`
      : 'مسودة';
    return {
      title: `قيد قضائي ${docket} — ${matter.fileCode} — LawOffice OS`,
    };
  } catch {
    return {
      title: 'القيد القضائي — LawOffice OS',
    };
  }
}

export default async function ProceedingDetailPage({ params }: ProceedingDetailPageProps) {
  const { id, proceedingId } = await params;
  let actor;
  try {
    actor = await requireActor();
  } catch (error) {
    if (error instanceof AuthenticationError) {
      if (error.code === 'MFA_REQUIRED') {
        redirect('/verify?returnTo=' + encodeURIComponent(`/matters/${id}/proceedings/${proceedingId}`));
      }
      redirect('/login?error=session_expired&returnTo=' + encodeURIComponent(`/matters/${id}/proceedings/${proceedingId}`));
    }
    if (error instanceof AuthorizationError) {
      return (
        <div className="max-w-4xl mx-auto p-6 bg-white rounded border border-red-200 text-[#A4262C]">
          <h1 className="text-xl font-bold mb-2">وصول مرفوض</h1>
          <p>لا تمتلك الصلاحيات الكافية لاستعراض هذا القيد القضائي.</p>
        </div>
      );
    }
    throw error;
  }

  let matter;
  try {
    matter = await getMatter(id, actor);
  } catch (error) {
    if (error instanceof NotFoundError) {
      return (
        <div className="max-w-3xl mx-auto py-12">
          <EmptyStateContainer
            icon="⚠️"
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
          icon="⚠️"
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

  const isDraft = !proceeding.numberText || !proceeding.yearLabel;

  return (
    <div className="max-w-5xl mx-auto p-4 sm:p-6 lg:p-8 space-y-6" dir="rtl" lang="ar-EG">
      {/* Breadcrumb Navigation */}
      <nav aria-label="مسار التنقل" className="text-xs text-[#4D606A] flex flex-wrap items-center gap-1.5">
        <Link href="/" className="hover:text-[#172A35]">
          الرئيسية
        </Link>
        <span>/</span>
        <Link href="/matters" className="hover:text-[#172A35]">
          ملفات القضايا
        </Link>
        <span>/</span>
        <Link href={`/matters/${matter.id}`} className="hover:text-[#172A35]">
          ملف <bdi dir="ltr">{matter.fileCode}</bdi>
        </Link>
        <span>/</span>
        <span className="font-bold text-[#172A35]">تفاصيل القيد القضائي</span>
      </nav>

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
              {isDraft ? (
                <span
                  data-testid="proceeding-draft-badge"
                  className="text-xs font-bold px-2.5 py-0.5 rounded bg-amber-50 text-amber-800 border border-amber-300 inline-flex items-center gap-1"
                >
                  <span>⚠️</span>
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
              <span>•</span>
              <span className="text-[#14566B] font-medium">{matter.title}</span>
            </div>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <Link
              href={`/matters/${matter.id}/proceedings/${proceeding.id}/edit`}
              data-testid="edit-proceeding-button"
              className="px-4 py-2 bg-[#14566B] hover:bg-[#0F4354] text-white text-xs font-bold rounded-[6px] transition-colors min-h-[40px] flex items-center gap-1.5"
            >
              <span>✏️</span>
              <span>تعديل بيانات القيد</span>
            </Link>
            <Link
              href={`/matters/${matter.id}`}
              className="px-3.5 py-2 bg-[#F4F6F7] hover:bg-[#E8EEF1] text-[#172A35] text-xs font-semibold rounded-[6px] border border-[#D5DFE3] transition-colors min-h-[40px] flex items-center"
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
              <bdi dir="ltr" className="font-mono text-sm font-bold text-[#14566B] bg-slate-50 px-2.5 py-1 rounded border border-slate-200 inline-block">
                {proceeding.numberText} لسنة {proceeding.yearLabel}
              </bdi>
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
              {proceeding.claimAmount ? `${proceeding.claimAmount} ج.م` : 'غير محدد'}
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
              <span aria-hidden="true">🔗</span>
              <span className="font-bold">مرتبط بالدعوى السابقة:</span>
              <span>{proceeding.parentProceedingSummary}</span>
            </div>
            {proceeding.parentProceedingId && (
              <Link
                href={`/matters/${matter.id}/proceedings/${proceeding.parentProceedingId}`}
                className="text-[#14566B] font-bold hover:underline shrink-0"
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
                  <th className="p-3 font-semibold">اسم الطرف</th>
                  <th className="p-3 font-semibold">الصفة الإجرائية المقررة</th>
                  <th className="p-3 font-semibold">الوصف التفصيلي للصفة</th>
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

      {/* Honest Future Modules Placeholder */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div className="bg-white rounded-[6px] border border-dashed border-[#D5DFE3] p-5 shadow-xs space-y-2 opacity-75">
          <div className="flex items-center gap-2">
            <span className="text-base">⚖️</span>
            <h3 className="text-sm font-bold text-[#172A35]">الجلسات والقرارات القضائية</h3>
          </div>
          <p className="text-xs text-[#4D606A] leading-relaxed">
            سجل رول الجلسات، القرارات المؤجلة، ومنطوق الأحكام القضائية سيكون متاحاً في مرحلة تالية للنظام.
          </p>
          <span className="inline-block text-[11px] font-semibold text-slate-500 bg-slate-100 px-2 py-0.5 rounded">
            قريباً في المرحلة القادمة
          </span>
        </div>

        <div className="bg-white rounded-[6px] border border-dashed border-[#D5DFE3] p-5 shadow-xs space-y-2 opacity-75">
          <div className="flex items-center gap-2">
            <span className="text-base">📄</span>
            <h3 className="text-sm font-bold text-[#172A35]">المذكرات والمستندات القضائية</h3>
          </div>
          <p className="text-xs text-[#4D606A] leading-relaxed">
            إيداع حافظة المستندات ومذكرات الدفاع والدفوع القانونية سيكون متاحاً في مرحلة تالية للنظام.
          </p>
          <span className="inline-block text-[11px] font-semibold text-slate-500 bg-slate-100 px-2 py-0.5 rounded">
            قريباً في المرحلة القادمة
          </span>
        </div>
      </div>
    </div>
  );
}
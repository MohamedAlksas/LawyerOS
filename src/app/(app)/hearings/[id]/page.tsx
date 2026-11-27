import React from 'react';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireActor } from '@/modules/identity/require-actor';
import { redirectOnAuthError } from '@/modules/identity/auth-redirect';
import { AuthenticationError, AuthorizationError } from '@/modules/identity/types';
import { authorize } from '@/modules/identity/authorize';
import { getPrismaClient } from '@/lib/auth';
import {
  HEARING_STATUS_LABELS,
  HEARING_STATUS_CLASSES,
} from '@/components/hearings/hearing-ui-types';
import { hasCompleteProceedingRegistration } from '@/modules/matters/matter-types';
import { mapLinkableDocumentSummary } from '@/modules/scheduling/hearing-types';
import {
  DOCUMENT_TYPE_LABELS_AR,
  LINKABLE_DOCUMENT_SELECT,
  type LinkableDocumentRow,
} from '@/modules/documents/document-types';
import { getLinkableDocumentScanBadgeClass } from '@/components/documents/document-ui-helpers';
import { formatCairoDateOnly } from '@/components/matters/matter-ui-types';

const UUID_REGEX = /^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i;

interface HearingDetailPageProps {
  params: Promise<{
    id: string;
  }>;
}

export const metadata = { title: 'تفاصيل الجلسة — LawOffice OS' };

export default async function HearingDetailPage({ params }: HearingDetailPageProps) {
  const { id } = await params;

  let actor;
  try {
    actor = await requireActor({ requiredPermission: 'READ_CLIENT_DATA' });
  } catch (error) {
    if (error instanceof AuthenticationError) {
      await redirectOnAuthError(error, `/hearings/${id}`);
    }
    if (error instanceof AuthorizationError) {
      return (
        <div role="alert" className="max-w-4xl mx-auto p-6 bg-white rounded border border-red-200 text-[#A4262C]">
          <h1 className="text-xl font-bold mb-2">وصول مرفوض</h1>
          <p>لا تمتلك الصلاحيات الكافية لاستعراض تفاصيل هذه الجلسة.</p>
        </div>
      );
    }
    throw error;
  }

  if (!UUID_REGEX.test(id)) {
    notFound();
  }

  const canReadDocuments = authorize(actor, 'READ_DOCUMENTS');
  const prisma = getPrismaClient();
  const hearing = await prisma.hearing.findUnique({
    where: { id },
    include: {
      proceeding: {
        include: {
          court: true,
          matter: true,
        },
      },
      results: {
        orderBy: { revision: 'desc' },
        ...(canReadDocuments
          ? {
              include: {
                decisionDocument: {
                  select: LINKABLE_DOCUMENT_SELECT,
                },
              },
            }
          : {}),
      },
    },
  });

  if (!hearing) {
    notFound();
  }

  const proceeding = hearing.proceeding;
  const matter = proceeding.matter;
  const isProceedingComplete = hasCompleteProceedingRegistration(proceeding);
  const docketText = proceeding.numberText && proceeding.yearLabel
    ? `${proceeding.numberText}/${proceeding.yearLabel}`
    : null;
  const canWriteClientData = authorize(actor, 'WRITE_CLIENT_DATA');
  const isArchived = Boolean(proceeding.archivedAt || matter.archivedAt || matter.status === 'ARCHIVED');
  const canOpenResult =
    canWriteClientData &&
    !isArchived &&
    (hearing.status === 'SCHEDULED' || hearing.status === 'COMPLETED');

  const dateIso = hearing.hearingDate.toISOString().slice(0, 10);
  const formattedDate = formatCairoDateOnly(hearing.hearingDate.toISOString());
  const latestResult = hearing.results[0] || null;
  const rawDecisionDoc =
    canReadDocuments && latestResult && 'decisionDocument' in latestResult
      ? (latestResult.decisionDocument as LinkableDocumentRow | null | undefined)
      : null;
  const latestDecisionDoc = canReadDocuments ? mapLinkableDocumentSummary(rawDecisionDoc) : null;

  return (
    <div className="max-w-4xl mx-auto space-y-6 pb-12" dir="rtl" lang="ar-EG">
      {/* Navigation Breadcrumb */}
      <nav aria-label="مسار التنقل" className="text-xs text-[#4D606A] flex items-center gap-1.5 flex-wrap">
        <Link href="/matters" className="hover:text-[#14566B] hover:underline">
          القضايا
        </Link>
        <span>/</span>
        <Link href={`/matters/${matter.id}`} className="hover:text-[#14566B] hover:underline font-mono">
          <bdi dir="ltr">{matter.fileCode}</bdi>
        </Link>
        <span>/</span>
        <Link
          href={`/matters/${matter.id}/proceedings/${proceeding.id}`}
          className="hover:text-[#14566B] hover:underline"
        >
          {isProceedingComplete ? (
            <>
              قيد قضائي <bdi dir="ltr">{docketText}</bdi>
            </>
          ) : (
            'قيد قضائي (مسودة)'
          )}
        </Link>
        <span>/</span>
        <span className="text-[#172A35] font-semibold">تفاصيل الجلسة</span>
      </nav>

      {/* Main Header Card */}
      <div className="bg-white rounded-[8px] border border-[#D5DFE3] p-6 shadow-xs space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#E8EEF1] pb-4">
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <h1 className="text-xl font-bold text-[#172A35]">
                تفاصيل موعد الجلسة
              </h1>
              <span className={`px-2.5 py-0.5 rounded-[4px] text-xs font-semibold ${HEARING_STATUS_CLASSES[hearing.status]}`}>
                {HEARING_STATUS_LABELS[hearing.status]}
              </span>
            </div>
            <p className="text-xs text-[#4D606A]">
              تاريخ الجلسة: <bdi dir="ltr" className="font-semibold text-[#172A35]">{dateIso}</bdi> ({formattedDate})
            </p>
          </div>

          <div className="flex items-center gap-2">
            {canOpenResult ? (
              <Link
                href={`/hearings/${hearing.id}/result`}
                data-testid="hearing-result-link"
                className="px-4 py-2 bg-[#14566B] hover:bg-[#0F4354] text-white text-xs font-bold rounded-[6px] transition-colors min-h-[44px] flex items-center gap-1.5 shadow-xs"
              >
                <span>{hearing.status === 'COMPLETED' ? 'عرض النتيجة / تصحيح' : 'تسجيل قرار ونتيجة الجلسة'}</span>
              </Link>
            ) : isArchived ? (
              <span
                data-testid="hearing-readonly-badge"
                className="px-3 py-1.5 bg-stone-100 text-stone-700 border border-stone-300 rounded-[6px] text-xs font-semibold"
              >
                أرشيف (للقراءة فقط)
              </span>
            ) : null}
          </div>
        </div>

        {/* Proceeding Status Indicator (Incomplete vs Registered) */}
        {!isProceedingComplete && (
          <div
            role="alert"
            data-testid="incomplete-proceeding-badge"
            className="p-3 bg-amber-50 border border-amber-300 rounded-[6px] text-xs text-amber-900 flex items-center gap-2"
          >
            <div className="space-y-0.5">
              <span className="font-bold">الرقم غير مستكمل</span>:
              <span className="text-[#4D606A] mr-1">
                هذه الجلسة مقيدة ضمن قيد قضائي مسودة لم يستكمل رقم القضية بالمحكمة بعد. الموعد ساري ومنظم.
              </span>
            </div>
          </div>
        )}

        {/* Hearing Metadata Grid */}
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4 text-xs pt-2">
          <div className="space-y-1 p-3 bg-[#F8FAFB] rounded-[6px] border border-[#E8EEF1]">
            <span className="text-[#4D606A] block font-medium">ساعة الانعقاد:</span>
            <div className="font-bold text-[#172A35]">
              {hearing.hearingTime ? (
                <bdi dir="ltr" className="font-mono text-sm">{hearing.hearingTime}</bdi>
              ) : (
                <span data-testid={`hearing-time-${hearing.id}`} className="text-[#64748B] italic">
                  الساعة غير محددة
                </span>
              )}
            </div>
          </div>

          <div className="space-y-1 p-3 bg-[#F8FAFB] rounded-[6px] border border-[#E8EEF1]">
            <span className="text-[#4D606A] block font-medium">المحكمة والدائرة:</span>
            <div className="font-bold text-[#172A35]">
              {proceeding.court.name} {proceeding.circuit ? `— ${proceeding.circuit}` : ''}
            </div>
          </div>

          <div className="space-y-1 p-3 bg-[#F8FAFB] rounded-[6px] border border-[#E8EEF1]">
            <span className="text-[#4D606A] block font-medium">القيد والقضية:</span>
            <div className="font-bold text-[#172A35]">
              {isProceedingComplete ? (
                <span>
                  رقم <bdi dir="ltr">{docketText}</bdi>
                </span>
              ) : (
                <span className="text-amber-700">مسودة بدون رقم رسمي</span>
              )}
            </div>
          </div>

          {hearing.courtHall && (
            <div className="space-y-1 p-3 bg-[#F8FAFB] rounded-[6px] border border-[#E8EEF1]">
              <span className="text-[#4D606A] block font-medium">القاعة / الدور:</span>
              <div className="font-bold text-[#172A35]">{hearing.courtHall}</div>
            </div>
          )}

          {hearing.rollNumber && (
            <div className="space-y-1 p-3 bg-[#F8FAFB] rounded-[6px] border border-[#E8EEF1]">
              <span className="text-[#4D606A] block font-medium">رقم الرول:</span>
              <div className="font-bold text-[#172A35] font-mono">
                <bdi dir="ltr">{hearing.rollNumber}</bdi>
              </div>
            </div>
          )}

          {hearing.purpose && (
            <div className="space-y-1 p-3 bg-[#F8FAFB] rounded-[6px] border border-[#E8EEF1] sm:col-span-2">
              <span className="text-[#4D606A] block font-medium">الغرض المطلوب:</span>
              <div className="font-semibold text-[#172A35]">{hearing.purpose}</div>
            </div>
          )}
        </div>

        {hearing.status === 'RESCHEDULED' && hearing.rescheduleReason && (
          <div className="p-3 bg-amber-50 border border-amber-200 rounded-[6px] text-xs text-amber-900">
            <span className="font-bold">سبب تعديل الموعد: </span>
            <span>{hearing.rescheduleReason}</span>
          </div>
        )}

        {hearing.status === 'CANCELLED' && hearing.cancellationReason && (
          <div className="p-3 bg-stone-100 border border-stone-300 rounded-[6px] text-xs text-stone-800">
            <span className="font-bold">سبب الإلغاء: </span>
            <span>{hearing.cancellationReason}</span>
          </div>
        )}
      </div>

      {/* Recorded Result & Revision History (if completed) */}
      {latestResult && (
        <div className="bg-white rounded-[8px] border border-[#D5DFE3] p-6 shadow-xs space-y-4">
          <div className="flex items-center justify-between border-b border-[#E8EEF1] pb-3">
            <h2 className="text-base font-bold text-[#172A35] flex items-center gap-2">
              <span>قرار المحكمة المسجل</span>
            </h2>
            <span className="text-xs text-[#4D606A]">
              المراجعة #{latestResult.revision} • سُجلت بتاريخ {formatCairoDateOnly(latestResult.recordedAt.toISOString())}
            </span>
          </div>

          <div className="p-4 bg-teal-50/60 border border-teal-200 rounded-[6px] space-y-2">
            <span className="text-xs text-[#14566B] font-bold block">منطوق القرار:</span>
            <p className="text-sm font-bold text-[#172A35] whitespace-pre-wrap leading-relaxed">
              {latestResult.decisionText}
            </p>
          </div>

          {latestResult.decisionDocumentId && canReadDocuments && (
            <div className="p-3 bg-[#F8FAFB] border border-[#D5DFE3] rounded-[6px] text-xs flex flex-wrap items-center gap-2">
              <span className="font-bold text-[#4D606A]">مستند القرار المرتبط:</span>
              <Link
                href={`/documents/${latestResult.decisionDocumentId}`}
                data-testid="hearing-decision-document-link"
                className="inline-flex flex-wrap items-center gap-2 px-3 py-1.5 rounded-[6px] bg-white border border-[#D5DFE3] text-[#14566B] hover:bg-[#E8EEF1] font-semibold min-h-[44px] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#14566B]"
              >
                <bdi className="[overflow-wrap:anywhere]">
                  {latestDecisionDoc?.title ?? 'عرض مستند القرار'}
                </bdi>
                {latestDecisionDoc && (
                  <span className="text-[11px] text-[#4D606A]">
                    ({DOCUMENT_TYPE_LABELS_AR[latestDecisionDoc.documentType]})
                  </span>
                )}
                {latestDecisionDoc?.scanStatusLabel && (
                  <span
                    className={`inline-flex items-center px-2 py-0.5 rounded-[4px] text-[11px] font-semibold border ${getLinkableDocumentScanBadgeClass(latestDecisionDoc)}`}
                  >
                    {latestDecisionDoc.scanStatusLabel}
                  </span>
                )}
              </Link>
            </div>
          )}

          {latestResult.correctionReason && (
            <div className="p-3 bg-amber-50 border border-amber-200 rounded-[6px] text-xs text-amber-900 space-y-1">
              <span className="font-bold block">سبب التصحيح:</span>
              <p>{latestResult.correctionReason}</p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

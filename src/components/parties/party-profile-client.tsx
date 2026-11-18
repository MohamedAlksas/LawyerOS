'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import { revealPartyIdentityAction } from '@/modules/parties/actions';
import { ClientProfileDTO } from '@/modules/parties/types';
import {
  PARTY_KIND_LABELS,
  IDENTIFICATION_TYPE_LABELS,
  formatCairoDateOnly,
} from './party-types';
import { CommunicationNotesSection } from './communication-notes-section';
import { PoaSection } from './poa-section';

interface PartyProfileClientProps {
  party: ClientProfileDTO;
}

export function PartyProfileClient({ party }: PartyProfileClientProps) {
  const [revealedNumber, setRevealedNumber] = useState<string | null>(null);
  const [isRevealing, setIsRevealing] = useState(false);
  const [revealError, setRevealError] = useState<string | null>(null);

  const handleRevealIdentity = async () => {
    setIsRevealing(true);
    setRevealError(null);

    try {
      const res = await revealPartyIdentityAction(
        party.id,
        'استعراض رقم الهوية لأغراض التحقق القانوني بالمكتب'
      );

      if (!res.success) {
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
        <div className="space-y-1">
          <nav aria-label="مسار التصفح" className="text-xs text-[#4D606A] flex items-center gap-1.5">
            <Link href="/parties" className="hover:text-[#14566B] hover:underline">
              دليل الأطراف
            </Link>
            <span aria-hidden="true">&gt;</span>
            <span className="text-[#172A35] font-medium">{party.name}</span>
          </nav>
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-bold text-[#172A35] tracking-tight">
              {party.name}
            </h1>
            <span className="inline-block px-2.5 py-0.5 rounded text-xs font-semibold bg-[#E8EEF1] text-[#14566B]">
              {PARTY_KIND_LABELS[party.kind]}
            </span>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <Link
            href={`/parties/${party.id}/edit`}
            data-testid="edit-party-button"
            className="inline-flex items-center justify-center gap-2 px-4 py-2 bg-[#14566B] hover:bg-[#0F4354] text-white text-xs font-bold rounded-[6px] transition-colors min-h-[44px]"
          >
            <span>✏️</span>
            <span>تعديل البيانات</span>
          </Link>
        </div>
      </div>

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
      <CommunicationNotesSection partyId={party.id} initialNotes={party.communicationNotes} />

      {/* 4. Powers of Attorney Section */}
      <PoaSection partyId={party.id} initialPoas={party.powersOfAttorney} />

      {/* 5. Future Modules Indicator (Contract S09: strictly non-interactive, no fake data) */}
      <div className="p-4 bg-[#F4F6F7] rounded-[6px] border border-dashed border-[#D5DFE3] text-xs text-[#4D606A] space-y-1">
        <span className="font-bold text-[#172A35] block">
          📁 ملفات القضايا والحسابات المالية المرتبطة
        </span>
        <p>
          وحدات القضايا والنزاعات (T06) والمستندات الرقمية (T10) وحسابات الأتعاب والمصروفات (T11/T12)
          غير مفعلة في هذه المرحلة التشغيلية، وسيتم ربطها تلقائياً بملف هذا الطرف عند إطلاقها.
        </p>
      </div>
    </div>
  );
}

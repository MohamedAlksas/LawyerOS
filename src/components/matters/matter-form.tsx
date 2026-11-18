'use client';

import React, { useState, useId } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { openMatterAction, updateMatterAction } from '@/modules/matters/matter-actions';
import {
  MatterDTO,
  MatterKind,
  MatterStatus,
  OpenMatterInput,
  UpdateMatterInput,
} from '@/modules/matters/matter-types';
import {
  MATTER_KIND_LABELS,
  MATTER_STATUS_LABELS,
  generateClientRequestId,
} from './matter-ui-types';

interface OptionItem {
  id: string;
  name: string;
}

interface ClientOptionItem {
  id: string;
  name: string;
  primaryPhone?: string | null;
}

interface MatterFormProps {
  initialMatter?: MatterDTO;
  practiceAreas: OptionItem[];
  storageLocations: OptionItem[];
  parties?: ClientOptionItem[];
}

export function MatterForm({
  initialMatter,
  practiceAreas,
  storageLocations,
  parties = [],
}: MatterFormProps) {
  const router = useRouter();
  const isEdit = Boolean(initialMatter);

  // Form State
  const [title, setTitle] = useState(initialMatter?.title || '');
  const [kind, setKind] = useState<MatterKind>(initialMatter?.kind || 'LITIGATION');
  const [status, setStatus] = useState<MatterStatus>(initialMatter?.status || 'ACTIVE');
  const [practiceAreaId, setPracticeAreaId] = useState<string>(initialMatter?.practiceAreaId || '');
  const [paperLocationId, setPaperLocationId] = useState<string>(initialMatter?.paperLocationId || '');
  const [openingDate, setOpeningDate] = useState<string>(
    initialMatter?.openingDate || new Date().toISOString().slice(0, 10)
  );
  const [closingDate, setClosingDate] = useState<string>(initialMatter?.closingDate || '');
  const [summary, setSummary] = useState(initialMatter?.summary || '');
  const [notes, setNotes] = useState(initialMatter?.notes || '');

  // Client Selection for Create mode
  const [selectedClientId, setSelectedClientId] = useState<string>('');
  const [clientSearchQuery, setClientSearchQuery] = useState('');

  // UI States
  const [isSaving, setIsSaving] = useState(false);
  const [generalError, setGeneralError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [concurrencyConflict, setConcurrencyConflict] = useState(false);

  // Stable Idempotency Key in memory
  const [idempotencyKey] = useState(() => generateClientRequestId('mform'));

  const formId = useId();

  const filteredParties = clientSearchQuery.trim()
    ? parties.filter((p) => p.name.toLowerCase().includes(clientSearchQuery.trim().toLowerCase()))
    : parties.slice(0, 10);

  const selectedClient = parties.find((p) => p.id === selectedClientId);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSaving(true);
    setGeneralError(null);
    setFieldErrors({});
    setConcurrencyConflict(false);

    try {
      if (isEdit && initialMatter) {
        const payload: UpdateMatterInput = {
          id: initialMatter.id,
          expectedVersion: initialMatter.version,
          title: title.trim(),
          kind,
          status,
          practiceAreaId: practiceAreaId || null,
          paperLocationId: paperLocationId || null,
          openingDate: openingDate || null,
          closingDate: closingDate || null,
          summary: summary.trim() || null,
          notes: notes.trim() || null,
          idempotencyKey,
        };

        const res = await updateMatterAction(payload);
        if (!res.success) {
          if (res.code === 'CONCURRENCY_CONFLICT') {
            setConcurrencyConflict(true);
          } else {
            setGeneralError(res.error || 'تعذر تعديل بيانات الملف.');
            if (res.fieldErrors) setFieldErrors(res.fieldErrors);
          }
          setIsSaving(false);
          return;
        }

        router.push(`/matters/${res.data.matter.id}`);
      } else {
        const payload: OpenMatterInput = {
          title: title.trim(),
          kind,
          practiceAreaId: practiceAreaId || null,
          paperLocationId: paperLocationId || null,
          openingDate: openingDate || null,
          summary: summary.trim() || null,
          notes: notes.trim() || null,
          initialClientId: selectedClientId || null,
          status: selectedClientId ? 'ACTIVE' : 'DRAFT',
          idempotencyKey,
        };

        const res = await openMatterAction(payload);
        if (!res.success) {
          setGeneralError(res.error || 'تعذر فتح ملف القضية.');
          if (res.fieldErrors) setFieldErrors(res.fieldErrors);
          setIsSaving(false);
          return;
        }

        router.push(`/matters/${res.data.matter.id}`);
      }
    } catch (err: unknown) {
      setGeneralError(
        err instanceof Error ? err.message : 'حدث خطأ في الاتصال أثناء حفظ البيانات.'
      );
      setIsSaving(false);
    }
  };

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      {/* Header */}
      <div className="pb-4 border-b border-[#D5DFE3] flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <nav aria-label="مسار التنقل" className="text-xs text-[#4D606A] mb-1">
            <Link href="/matters" className="hover:text-[#14566B] hover:underline">
              ملفات القضايا
            </Link>
            <span aria-hidden="true" className="mx-1.5">/</span>
            <span>{isEdit ? 'تعديل الملف' : 'فتح ملف جديد'}</span>
          </nav>
          <h1 className="text-2xl font-bold text-[#172A35]">
            {isEdit ? `تعديل الملف: ${initialMatter?.title}` : 'فتح ملف قضية جديد'}
          </h1>
        </div>

        {isEdit && initialMatter && (
          <div className="flex items-center gap-2">
            <span className="text-xs text-[#4D606A]">كود الملف:</span>
            <bdi dir="ltr" className="font-mono text-sm font-bold bg-slate-100 text-[#14566B] px-2.5 py-1 rounded border border-slate-300">
              {initialMatter.fileCode}
            </bdi>
          </div>
        )}
      </div>

      {/* Concurrency Conflict Alert */}
      {concurrencyConflict && (
        <div
          role="alert"
          data-testid="concurrency-conflict-alert"
          className="p-4 bg-amber-50 border border-amber-300 rounded-[6px] text-amber-900 space-y-3"
        >
          <div className="flex items-center gap-2 font-bold text-sm">
            <span>⚠️</span>
            <span>تعارض في التعديل المتزامن (تحديث أحدث متوفر)</span>
          </div>
          <p className="text-xs leading-relaxed">
            تم تعديل بيانات هذا الملف من نافذة أخرى أو مستخدم آخر أثناء تحريرك للبيانات. للحفاظ على سلامة القيود، يرجى تحديث الصفحة لمراجعة أحدث التعديلات ثم إعادة الحفظ.
          </p>
          <div>
            <button
              type="button"
              onClick={() => router.refresh()}
              className="px-3 py-1.5 bg-[#14566B] text-white text-xs font-semibold rounded-[6px]"
            >
              تحديث الصفحة وتحميل أحدث البيانات
            </button>
          </div>
        </div>
      )}

      {/* General Error Banner */}
      {generalError && (
        <div
          role="alert"
          data-testid="form-error-banner"
          className="p-4 bg-red-50 border border-red-200 rounded-[6px] text-[#A4262C] space-y-1"
        >
          <div className="flex items-center gap-2 font-bold text-sm">
            <span>⚠️</span>
            <span>تعذر إتمام العملية</span>
          </div>
          <p className="text-xs leading-relaxed">{generalError}</p>
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-6">
        {/* Section 1: Basic Information */}
        <div className="bg-white rounded-[6px] border border-[#D5DFE3] p-5 sm:p-6 shadow-xs space-y-4">
          <h2 className="text-base font-bold text-[#172A35] pb-2 border-b border-[#E8EEF1]">
            البيانات الأساسية للملف
          </h2>

          {/* Title */}
          <div className="space-y-1">
            <label htmlFor={`${formId}-title`} className="block text-xs font-bold text-[#172A35]">
              عنوان الملف أو موضوعه <span className="text-red-600">*</span>
            </label>
            <input
              id={`${formId}-title`}
              type="text"
              required
              maxLength={255}
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="مثال: دعوى تعويض عن حادث سيارة ضد شركة التأمين"
              data-testid="matter-title-input"
              aria-invalid={Boolean(fieldErrors.title)}
              aria-describedby={fieldErrors.title ? `${formId}-title-error` : undefined}
              className="w-full px-3 py-2 text-sm bg-white border border-[#D5DFE3] rounded-[6px] text-[#172A35] placeholder-[#4D606A] focus:outline-none focus:ring-2 focus:ring-[#14566B] min-h-[44px]"
            />
            {fieldErrors.title && (
              <p id={`${formId}-title-error`} className="text-xs text-red-600 font-medium">
                {fieldErrors.title}
              </p>
            )}
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {/* Kind */}
            <div className="space-y-1">
              <label htmlFor={`${formId}-kind`} className="block text-xs font-bold text-[#172A35]">
                طبيعة العمل القانوني <span className="text-red-600">*</span>
              </label>
              <select
                id={`${formId}-kind`}
                value={kind}
                onChange={(e) => setKind(e.target.value as MatterKind)}
                data-testid="matter-kind-select"
                className="w-full px-3 py-2 text-sm bg-white border border-[#D5DFE3] rounded-[6px] text-[#172A35] focus:outline-none focus:ring-2 focus:ring-[#14566B] min-h-[44px]"
              >
                {(['LITIGATION', 'CONSULTATION', 'CONTRACT', 'OTHER'] as MatterKind[]).map((k) => (
                  <option key={k} value={k}>
                    {MATTER_KIND_LABELS[k]}
                  </option>
                ))}
              </select>
            </div>

            {/* Practice Area */}
            <div className="space-y-1">
              <label htmlFor={`${formId}-practiceArea`} className="block text-xs font-bold text-[#172A35]">
                دائرة التخصص القانوني (اختياري)
              </label>
              <select
                id={`${formId}-practiceArea`}
                value={practiceAreaId}
                onChange={(e) => setPracticeAreaId(e.target.value)}
                data-testid="matter-practice-area-select"
                className="w-full px-3 py-2 text-sm bg-white border border-[#D5DFE3] rounded-[6px] text-[#172A35] focus:outline-none focus:ring-2 focus:ring-[#14566B] min-h-[44px]"
              >
                <option value="">— غير محدد —</option>
                {practiceAreas.map((pa) => (
                  <option key={pa.id} value={pa.id}>
                    {pa.name}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {/* Opening Date */}
            <div className="space-y-1">
              <label htmlFor={`${formId}-openingDate`} className="block text-xs font-bold text-[#172A35]">
                تاريخ فتح الملف بالمكتب
              </label>
              <input
                id={`${formId}-openingDate`}
                type="date"
                value={openingDate}
                onChange={(e) => setOpeningDate(e.target.value)}
                data-testid="matter-opening-date-input"
                className="w-full px-3 py-2 text-sm bg-white border border-[#D5DFE3] rounded-[6px] text-[#172A35] focus:outline-none focus:ring-2 focus:ring-[#14566B] min-h-[44px]"
              />
            </div>

            {/* Status (Edit mode only) */}
            {isEdit && (
              <div className="space-y-1">
                <label htmlFor={`${formId}-status`} className="block text-xs font-bold text-[#172A35]">
                  حالة الملف <span className="text-red-600">*</span>
                </label>
                <select
                  id={`${formId}-status`}
                  value={status}
                  onChange={(e) => setStatus(e.target.value as MatterStatus)}
                  data-testid="matter-status-select"
                  className="w-full px-3 py-2 text-sm bg-white border border-[#D5DFE3] rounded-[6px] text-[#172A35] focus:outline-none focus:ring-2 focus:ring-[#14566B] min-h-[44px]"
                >
                  <option value="ACTIVE">{MATTER_STATUS_LABELS.ACTIVE}</option>
                  <option value="DRAFT">{MATTER_STATUS_LABELS.DRAFT}</option>
                  <option value="SUSPENDED">{MATTER_STATUS_LABELS.SUSPENDED}</option>
                  <option value="CLOSED">{MATTER_STATUS_LABELS.CLOSED}</option>
                </select>
              </div>
            )}
          </div>

          {/* Closing Date if Closed */}
          {isEdit && status === 'CLOSED' && (
            <div className="space-y-1 pt-2">
              <label htmlFor={`${formId}-closingDate`} className="block text-xs font-bold text-[#172A35]">
                تاريخ إغلاق الملف
              </label>
              <input
                id={`${formId}-closingDate`}
                type="date"
                value={closingDate}
                onChange={(e) => setClosingDate(e.target.value)}
                data-testid="matter-closing-date-input"
                className="w-full px-3 py-2 text-sm bg-white border border-[#D5DFE3] rounded-[6px] text-[#172A35] focus:outline-none focus:ring-2 focus:ring-[#14566B] min-h-[44px]"
              />
            </div>
          )}
        </div>

        {/* Section 2: Initial Client Selection (Create Mode only) */}
        {!isEdit && (
          <div className="bg-white rounded-[6px] border border-[#D5DFE3] p-5 sm:p-6 shadow-xs space-y-4">
            <div className="flex items-center justify-between pb-2 border-b border-[#E8EEF1]">
              <h2 className="text-base font-bold text-[#172A35]">
                الموكل الأساسي (اختياري عند الفتح)
              </h2>
              <span className="text-xs text-[#4D606A]">
                {selectedClientId ? 'سيتم فتح الملف كملف نشط' : 'سيتم فتح الملف كمسودة'}
              </span>
            </div>

            <p className="text-xs text-[#4D606A] leading-relaxed">
              يمكنك فتح الملف الآن كمسودة بدون موكل، ولكن لتنشيط الملف وبدء ربط التوكيلات والقيود القضائية يجب ربط موكل واحد على الأقل.
            </p>

            {selectedClient ? (
              <div
                data-testid="selected-client-card"
                className="flex items-center justify-between p-3 bg-emerald-50 border border-emerald-200 rounded-[6px]"
              >
                <div className="flex items-center gap-2">
                  <span className="text-lg">👤</span>
                  <div>
                    <span className="text-sm font-bold text-emerald-900 block">
                      {selectedClient.name}
                    </span>
                    {selectedClient.primaryPhone && (
                      <bdi dir="ltr" className="text-xs text-emerald-700 font-mono">
                        {selectedClient.primaryPhone}
                      </bdi>
                    )}
                  </div>
                </div>

                <button
                  type="button"
                  data-testid="remove-selected-client-button"
                  onClick={() => setSelectedClientId('')}
                  className="text-xs font-semibold text-red-700 hover:text-red-900 p-1 rounded"
                >
                  إزالة واختيار موكل آخر
                </button>
              </div>
            ) : (
              <div className="space-y-3">
                <input
                  type="text"
                  value={clientSearchQuery}
                  onChange={(e) => setClientSearchQuery(e.target.value)}
                  placeholder="ابحث عن موكل بالاسم..."
                  aria-label="البحث عن موكل في دليل الأطراف"
                  data-testid="client-search-input"
                  className="w-full px-3 py-2 text-sm bg-white border border-[#D5DFE3] rounded-[6px] text-[#172A35] placeholder-[#4D606A] focus:outline-none focus:ring-2 focus:ring-[#14566B] min-h-[44px]"
                />

                {parties.length === 0 ? (
                  <p className="text-xs text-[#4D606A] italic">
                    لا يوجد أطراف مسجلة بدليل الأطراف حتى الآن. يمكنك حفظ الملف كمسودة أو{' '}
                    <Link href="/parties/new" className="text-[#14566B] underline font-bold">
                      إضافة طرف جديد أولاً
                    </Link>.
                  </p>
                ) : filteredParties.length === 0 ? (
                  <p className="text-xs text-[#4D606A] italic">لم يتم العثور على أطراف مطابقة للبحث.</p>
                ) : (
                  <div className="max-h-48 overflow-y-auto divide-y divide-[#E8EEF1] border border-[#D5DFE3] rounded-[6px]">
                    {filteredParties.map((p) => (
                      <button
                        key={p.id}
                        type="button"
                        data-testid={`select-client-option-${p.id}`}
                        onClick={() => setSelectedClientId(p.id)}
                        className="w-full text-right p-2.5 text-xs hover:bg-[#F4F6F7] flex items-center justify-between transition-colors min-h-[40px]"
                      >
                        <span className="font-bold text-[#172A35]">{p.name}</span>
                        {p.primaryPhone ? (
                          <bdi dir="ltr" className="font-mono text-[#4D606A]">
                            {p.primaryPhone}
                          </bdi>
                        ) : (
                          <span className="text-[#4D606A]">بدون هاتف</span>
                        )}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {/* Section 3: Paper Location & Summary */}
        <div className="bg-white rounded-[6px] border border-[#D5DFE3] p-5 sm:p-6 shadow-xs space-y-4">
          <h2 className="text-base font-bold text-[#172A35] pb-2 border-b border-[#E8EEF1]">
            مكان الحفظ الورقي وملاحظات الملف
          </h2>

          {/* Paper Location */}
          <div className="space-y-1">
            <label htmlFor={`${formId}-paperLocation`} className="block text-xs font-bold text-[#172A35]">
              مكان الحفظ الورقي بالمكتب (اختياري)
            </label>
            <select
              id={`${formId}-paperLocation`}
              value={paperLocationId}
              onChange={(e) => setPaperLocationId(e.target.value)}
              data-testid="matter-paper-location-select"
              className="w-full px-3 py-2 text-sm bg-white border border-[#D5DFE3] rounded-[6px] text-[#172A35] focus:outline-none focus:ring-2 focus:ring-[#14566B] min-h-[44px]"
            >
              <option value="">— غير محدد —</option>
              {storageLocations.map((loc) => (
                <option key={loc.id} value={loc.id}>
                  {loc.name}
                </option>
              ))}
            </select>
            {!paperLocationId && (
              <p className="text-xs text-amber-700 bg-amber-50 p-2 rounded border border-amber-200 mt-1">
                ⚠️ ترك مكان الحفظ فارغاً مسموح به، ولكن يفضل تحديده لتسهيل الرجوع للأوراق والمستندات الورقية في المكتب.
              </p>
            )}
          </div>

          {/* Summary */}
          <div className="space-y-1">
            <label htmlFor={`${formId}-summary`} className="block text-xs font-bold text-[#172A35]">
              ملخص وقائع وموضوع الملف (اختياري)
            </label>
            <textarea
              id={`${formId}-summary`}
              rows={3}
              maxLength={2000}
              value={summary}
              onChange={(e) => setSummary(e.target.value)}
              placeholder="اكتب نبذة مختصرة عن موضوع النزاع أو الاستشارة القانونية..."
              data-testid="matter-summary-textarea"
              className="w-full px-3 py-2 text-sm bg-white border border-[#D5DFE3] rounded-[6px] text-[#172A35] placeholder-[#4D606A] focus:outline-none focus:ring-2 focus:ring-[#14566B] leading-relaxed"
            />
          </div>

          {/* Notes */}
          <div className="space-y-1">
            <label htmlFor={`${formId}-notes`} className="block text-xs font-bold text-[#172A35]">
              ملاحظات وتوجيهات داخلية (اختياري)
            </label>
            <textarea
              id={`${formId}-notes`}
              rows={2}
              maxLength={5000}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="ملاحظات خاصة بمكتب المحاماة..."
              data-testid="matter-notes-textarea"
              className="w-full px-3 py-2 text-sm bg-white border border-[#D5DFE3] rounded-[6px] text-[#172A35] placeholder-[#4D606A] focus:outline-none focus:ring-2 focus:ring-[#14566B] leading-relaxed"
            />
          </div>
        </div>

        {/* Submit Actions */}
        <div className="flex flex-col sm:flex-row items-center justify-between gap-3 pt-2">
          <Link
            href={isEdit && initialMatter ? `/matters/${initialMatter.id}` : '/matters'}
            className="w-full sm:w-auto px-5 py-2.5 bg-[#F4F6F7] hover:bg-[#E8EEF1] text-[#172A35] text-sm font-semibold rounded-[6px] border border-[#D5DFE3] text-center min-h-[44px] flex items-center justify-center transition-colors"
          >
            إلغاء والعودة
          </Link>

          <button
            type="submit"
            disabled={isSaving}
            data-testid="matter-submit-button"
            className="w-full sm:w-auto px-8 py-2.5 bg-[#14566B] hover:bg-[#0F4354] disabled:opacity-50 text-white text-sm font-bold rounded-[6px] shadow-xs min-h-[44px] flex items-center justify-center gap-2 transition-colors focus:outline-none focus:ring-2 focus:ring-[#14566B] focus:ring-offset-2"
          >
            {isSaving ? (
              <span>جارٍ الحفظ...</span>
            ) : isEdit ? (
              <span>حفظ التعديلات</span>
            ) : selectedClientId ? (
              <span>فتح الملف (نشط)</span>
            ) : (
              <span>حفظ كمسودة</span>
            )}
          </button>
        </div>
      </form>
    </div>
  );
}

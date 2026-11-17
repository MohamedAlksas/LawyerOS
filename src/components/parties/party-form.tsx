'use client';

import React, { useState, useRef } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { savePartyAction } from '@/modules/parties/actions';
import {
  PartyKind,
  IdentificationType,
  ClientProfileDTO,
  SavePartyInput,
  DuplicateWarningDTO,
} from '@/modules/parties/types';
import {
  PARTY_KIND_LABELS,
  IDENTIFICATION_TYPE_LABELS,
} from './party-types';

interface PartyFormProps {
  party?: ClientProfileDTO;
}

export function PartyForm({ party }: PartyFormProps) {
  const router = useRouter();
  const isEdit = Boolean(party);

  // Form inputs kept strictly in component state (page memory)
  const [kind, setKind] = useState<PartyKind>(party?.kind ?? 'PERSON');
  const [name, setName] = useState(party?.name ?? '');
  const [primaryPhone, setPrimaryPhone] = useState(party?.primaryPhone ?? '');
  const [additionalPhones, setAdditionalPhones] = useState(
    party?.additionalPhones?.join(', ') ?? ''
  );
  const [email, setEmail] = useState(party?.email ?? '');
  const [address, setAddress] = useState(party?.address ?? '');
  const [notes, setNotes] = useState(party?.notes ?? '');

  // Identity is optional, only editable during creation or if explicitly entered
  const [hasIdentity, setHasIdentity] = useState(false);
  const [identificationType, setIdentificationType] =
    useState<IdentificationType>('NATIONAL_ID');
  const [identityNumber, setIdentityNumber] = useState('');

  // Status and feedback states
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [generalError, setGeneralError] = useState<string | null>(null);

  // Concurrency conflict state
  const [hasConcurrencyConflict, setHasConcurrencyConflict] = useState(false);

  // Duplicate warning advisory state
  const [duplicateWarnings, setDuplicateWarnings] = useState<DuplicateWarningDTO[]>([]);
  const [savedPartyId, setSavedPartyId] = useState<string | null>(null);

  // Idempotency key preserved across retries for the same form state
  const idempotencyKeyRef = useRef<string | null>(null);

  const getIdempotencyKey = (): string => {
    if (!idempotencyKeyRef.current) {
      idempotencyKeyRef.current =
        typeof crypto !== 'undefined' && crypto.randomUUID
          ? crypto.randomUUID()
          : `idemp-${Date.now()}`;
    }
    return idempotencyKeyRef.current;
  };

  const validateClientSide = (): boolean => {
    const errors: Record<string, string> = {};

    if (!name.trim()) {
      errors.name = 'اسم الطرف مطلوب ولا يمكن تركه فارغاً.';
    } else if (name.trim().length > 200) {
      errors.name = 'الاسم طويل جداً (الحد الأقصى 200 حرف).';
    }

    if (primaryPhone.trim() && (primaryPhone.trim().length < 7 || primaryPhone.trim().length > 25)) {
      errors.primaryPhone = 'رقم الهاتف الأساسي يجب أن يتراوح بين 7 و 25 حرفاً/رقماً.';
    }

    if (email.trim()) {
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRegex.test(email.trim())) {
        errors.email = 'صيغة البريد الإلكتروني غير صحيحة.';
      } else if (email.trim().length > 254) {
        errors.email = 'البريد الإلكتروني طويل جداً.';
      }
    }

    if (address.trim() && address.trim().length > 500) {
      errors.address = 'العنوان طويل جداً (الحد الأقصى 500 حرف).';
    }

    if (notes.trim() && notes.trim().length > 2000) {
      errors.notes = 'الملاحظات طويلة جداً (الحد الأقصى 2000 حرف).';
    }

    if (!isEdit && hasIdentity && identityNumber.trim()) {
      if (identityNumber.trim().length > 50) {
        errors.identityNumber = 'رقم وثيقة الهوية لا يجب أن يتجاوز 50 حرفاً.';
      }
    }

    setFieldErrors(errors);
    return Object.keys(errors).length === 0;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setGeneralError(null);
    setHasConcurrencyConflict(false);

    if (!validateClientSide()) {
      // Focus first error field for accessibility
      const firstErrorKey = Object.keys(fieldErrors)[0] || 'name';
      const el = document.getElementById(firstErrorKey);
      el?.focus();
      return;
    }

    setIsSubmitting(true);

    const parsedAdditionalPhones = additionalPhones
      .split(',')
      .map((p) => p.trim())
      .filter(Boolean);

    const payload: SavePartyInput = {
      id: party?.id,
      kind,
      name: name.trim(),
      primaryPhone: primaryPhone.trim() || null,
      additionalPhones: parsedAdditionalPhones,
      email: email.trim() || null,
      address: address.trim() || null,
      notes: notes.trim() || null,
      expectedVersion: party ? party.version : undefined,
      idempotencyKey: getIdempotencyKey(),
    };

    if (!isEdit && hasIdentity && identityNumber.trim()) {
      payload.identity = {
        identificationType,
        number: identityNumber.trim(),
      };
    }

    try {
      const result = await savePartyAction(payload);

      if (!result.success) {
        if (result.code === 'CONCURRENCY_CONFLICT') {
          setHasConcurrencyConflict(true);
          setGeneralError(
            'تم تعديل بيانات هذا الطرف من شاشة أو جلسة أخرى بعد فتحك لهذه الصفحة. لتجنب فقدان البيانات، يرجى مراجعة التعديلات وإعادة تحميل الصفحة.'
          );
        } else if (result.code === 'VALIDATION_ERROR' && result.fieldErrors) {
          setFieldErrors(result.fieldErrors);
          setGeneralError('يرجى مراجعة الأخطاء الموضحة أدناه.');
        } else {
          setGeneralError(result.error || 'تعذر حفظ بيانات الطرف.');
        }
        setIsSubmitting(false);
        return;
      }

      const savedParty = result.data.party;

      // Handle duplicate warnings in create mode
      if (!isEdit && result.data.duplicateWarnings && result.data.duplicateWarnings.length > 0) {
        setDuplicateWarnings(result.data.duplicateWarnings);
        setSavedPartyId(savedParty.id);
        setIsSubmitting(false);
        return;
      }

      // If no duplicate warnings or in edit mode, proceed directly to profile
      router.push(`/parties/${savedParty.id}`);
      router.refresh();
    } catch {
      setGeneralError('حدث خطأ في الاتصال بالخادم. يمكنك إعادة المحاولة.');
      setIsSubmitting(false);
    }
  };

  const handleConfirmDuplicate = () => {
    if (savedPartyId) {
      router.push(`/parties/${savedPartyId}`);
      router.refresh();
    }
  };

  const handleReloadLatest = () => {
    window.location.reload();
  };

  return (
    <form
      onSubmit={handleSubmit}
      data-testid="party-form"
      noValidate
      className="space-y-6 max-w-3xl"
    >
      {/* 1. Concurrency Conflict Banner (R05-03) */}
      {hasConcurrencyConflict && (
        <div
          role="alert"
          data-testid="concurrency-conflict-banner"
          className="p-4 bg-rose-50 border-2 border-rose-300 rounded-[6px] space-y-3 shadow-xs"
        >
          <div className="flex items-start gap-3">
            <span className="text-xl" aria-hidden="true">
              ⚠️
            </span>
            <div>
              <h3 className="text-sm font-bold text-rose-900">
                البيانات اتعدلت من شاشة تانية
              </h3>
              <p className="text-xs text-rose-800 mt-1 leading-relaxed">
                قام مستخدم آخر أو شاشة أخرى بتحديث بيانات هذا الطرف أثناء تحريرك لها.
                تم الاحتفاظ بتعديلاتك الحالية في الصفحة حتى لا تفقدها، ولكن لا يمكن الحفظ
                فوق النسخة الأحدث مباشرة لتجنب التضارب.
              </p>
            </div>
          </div>

          <div className="pt-1 flex gap-3">
            <button
              type="button"
              data-testid="reload-latest-button"
              onClick={handleReloadLatest}
              className="px-4 py-2 bg-rose-700 hover:bg-rose-800 text-white text-xs font-semibold rounded-[6px] transition-colors min-h-[44px]"
            >
              تحديث الصفحة واستعراض النسخة الأحدث
            </button>
          </div>
        </div>
      )}

      {/* 2. Duplicate Advisory Warning Banner (R05-02) */}
      {duplicateWarnings.length > 0 && (
        <div
          role="alert"
          data-testid="duplicate-advisory-banner"
          className="p-4 bg-amber-50 border-2 border-amber-300 rounded-[6px] space-y-3 shadow-xs"
        >
          <div className="flex items-start gap-3">
            <span className="text-xl" aria-hidden="true">
              💡
            </span>
            <div>
              <h3 className="text-sm font-bold text-amber-900">
                تنبيه استرشادي: يوجد أطراف مسجلة مسبقاً ببيانات مشابهة
              </h3>
              <p className="text-xs text-amber-800 mt-1 leading-relaxed">
                تم حفظ الطرف الجديد بنجاح في قاعدة البيانات، ولكن نلفت انتباهك لوجود طرف أو أكثر يتشابه
                في الاسم أو رقم الهاتف:
              </p>

              <ul className="mt-2 space-y-1.5 text-xs text-amber-900 bg-white/70 p-2.5 rounded border border-amber-200">
                {duplicateWarnings.map((dup) => (
                  <li
                    key={dup.id}
                    data-testid="duplicate-warning-item"
                    className="flex flex-wrap items-center justify-between gap-2"
                  >
                    <div>
                      <span className="font-bold">{dup.name}</span>
                      {dup.primaryPhone && (
                        <span className="mr-2 text-amber-800 font-mono">
                          (هاتف: <bdi dir="ltr">{dup.primaryPhone}</bdi>)
                        </span>
                      )}
                    </div>
                    <Link
                      href={`/parties/${dup.id}`}
                      target="_blank"
                      data-testid={`view-existing-duplicate-${dup.id}`}
                      className="text-amber-900 underline font-semibold hover:text-amber-950 text-xs"
                    >
                      فتح الملف المسجل مسبقاً ↗
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          </div>

          <div className="pt-2 flex flex-wrap gap-3">
            <button
              type="button"
              data-testid="confirm-duplicate-button"
              onClick={handleConfirmDuplicate}
              className="px-4 py-2 bg-amber-700 hover:bg-amber-800 text-white text-xs font-semibold rounded-[6px] transition-colors min-h-[44px]"
            >
              متابعة إلى ملف الطرف الجديد المنفصل
            </button>
            <Link
              href="/parties"
              className="px-4 py-2 bg-white text-amber-900 border border-amber-300 hover:bg-amber-100 text-xs font-semibold rounded-[6px] transition-colors flex items-center justify-center min-h-[44px]"
            >
              العودة لدليل الأطراف
            </Link>
          </div>
        </div>
      )}

      {/* 3. General / Validation Error Summary */}
      {generalError && (
        <div
          role="alert"
          data-testid="form-error-summary"
          className="p-3 bg-red-50 border border-red-200 rounded-[6px] text-xs text-[#A4262C] space-y-1"
        >
          <div className="font-bold">{generalError}</div>
          {Object.keys(fieldErrors).length > 0 && (
            <ul className="list-disc list-inside space-y-0.5 pt-1">
              {Object.entries(fieldErrors).map(([field, msg]) => (
                <li key={field}>{msg}</li>
              ))}
            </ul>
          )}
        </div>
      )}

      {/* 4. Form Fields Card */}
      <div className="bg-white p-5 sm:p-6 rounded-[6px] border border-[#D5DFE3] space-y-6 shadow-xs">
        {/* Kind Radio Selection */}
        <fieldset>
          <legend className="text-sm font-bold text-[#172A35] mb-2">
            نوع الطرف <span className="text-red-600">*</span>
          </legend>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <label
              className={`flex items-center gap-3 p-3 rounded-[6px] border cursor-pointer transition-colors min-h-[44px] ${
                kind === 'PERSON'
                  ? 'border-[#14566B] bg-[#E8EEF1]'
                  : 'border-[#D5DFE3] hover:bg-[#F9FBFC]'
              }`}
            >
              <input
                type="radio"
                name="party-kind"
                data-testid="kind-person"
                value="PERSON"
                checked={kind === 'PERSON'}
                onChange={() => setKind('PERSON')}
                className="w-4 h-4 text-[#14566B] focus:ring-[#14566B]"
              />
              <span className="text-sm font-medium text-[#172A35]">
                {PARTY_KIND_LABELS.PERSON}
              </span>
            </label>

            <label
              className={`flex items-center gap-3 p-3 rounded-[6px] border cursor-pointer transition-colors min-h-[44px] ${
                kind === 'ORGANIZATION'
                  ? 'border-[#14566B] bg-[#E8EEF1]'
                  : 'border-[#D5DFE3] hover:bg-[#F9FBFC]'
              }`}
            >
              <input
                type="radio"
                name="party-kind"
                data-testid="kind-organization"
                value="ORGANIZATION"
                checked={kind === 'ORGANIZATION'}
                onChange={() => setKind('ORGANIZATION')}
                className="w-4 h-4 text-[#14566B] focus:ring-[#14566B]"
              />
              <span className="text-sm font-medium text-[#172A35]">
                {PARTY_KIND_LABELS.ORGANIZATION}
              </span>
            </label>
          </div>
        </fieldset>

        {/* Name Input */}
        <div>
          <label htmlFor="name" className="block text-sm font-bold text-[#172A35] mb-1.5">
            الاسم الكامل / اسم المنشأة <span className="text-red-600">*</span>
          </label>
          <input
            id="name"
            data-testid="party-name-input"
            type="text"
            required
            maxLength={200}
            value={name}
            onChange={(e) => {
              setName(e.target.value);
              if (fieldErrors.name) {
                setFieldErrors((prev) => {
                  const n = { ...prev };
                  delete n.name;
                  return n;
                });
              }
            }}
            aria-invalid={Boolean(fieldErrors.name)}
            aria-describedby={fieldErrors.name ? 'name-error' : undefined}
            placeholder={
              kind === 'PERSON'
                ? 'مثال: محمد أحمد إبراهيم السيد'
                : 'مثال: شركة النيل للتجارة والمقاولات ش.م.م'
            }
            className={`w-full px-3.5 py-2.5 rounded-[6px] border text-sm text-[#172A35] placeholder-[#4D606A] focus:outline-none focus:ring-2 focus:ring-[#14566B] min-h-[44px] ${
              fieldErrors.name ? 'border-red-500 bg-red-50/20' : 'border-[#A7B9C1]'
            }`}
          />
          {fieldErrors.name && (
            <p id="name-error" className="text-xs text-[#A4262C] mt-1 font-medium">
              {fieldErrors.name}
            </p>
          )}
        </div>

        {/* Primary Phone & Additional Phones */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label htmlFor="primaryPhone" className="block text-sm font-medium text-[#172A35] mb-1.5">
              رقم الهاتف الأساسي (اختياري)
            </label>
            <input
              id="primaryPhone"
              data-testid="party-phone-input"
              type="tel"
              value={primaryPhone}
              onChange={(e) => {
                setPrimaryPhone(e.target.value);
                if (fieldErrors.primaryPhone) {
                  setFieldErrors((prev) => {
                    const n = { ...prev };
                    delete n.primaryPhone;
                    return n;
                  });
                }
              }}
              dir="ltr"
              placeholder="01012345678"
              aria-invalid={Boolean(fieldErrors.primaryPhone)}
              aria-describedby={fieldErrors.primaryPhone ? 'phone-error' : undefined}
              className={`w-full px-3.5 py-2.5 rounded-[6px] border text-sm text-[#172A35] placeholder-[#4D606A] focus:outline-none focus:ring-2 focus:ring-[#14566B] min-h-[44px] text-right ${
                fieldErrors.primaryPhone ? 'border-red-500 bg-red-50/20' : 'border-[#A7B9C1]'
              }`}
            />
            {fieldErrors.primaryPhone && (
              <p id="phone-error" className="text-xs text-[#A4262C] mt-1 font-medium">
                {fieldErrors.primaryPhone}
              </p>
            )}
          </div>

          <div>
            <label htmlFor="additionalPhones" className="block text-sm font-medium text-[#172A35] mb-1.5">
              أرقام هواتف إضافية (مفصولة بفاصلة)
            </label>
            <input
              id="additionalPhones"
              data-testid="party-phones-input"
              type="text"
              value={additionalPhones}
              onChange={(e) => setAdditionalPhones(e.target.value)}
              dir="ltr"
              placeholder="0123456789, 0233445566"
              className="w-full px-3.5 py-2.5 rounded-[6px] border border-[#A7B9C1] text-sm text-[#172A35] placeholder-[#4D606A] focus:outline-none focus:ring-2 focus:ring-[#14566B] min-h-[44px] text-right"
            />
          </div>
        </div>

        {/* Email & Address */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label htmlFor="email" className="block text-sm font-medium text-[#172A35] mb-1.5">
              البريد الإلكتروني (اختياري)
            </label>
            <input
              id="email"
              data-testid="party-email-input"
              type="email"
              value={email}
              onChange={(e) => {
                setEmail(e.target.value);
                if (fieldErrors.email) {
                  setFieldErrors((prev) => {
                    const n = { ...prev };
                    delete n.email;
                    return n;
                  });
                }
              }}
              dir="ltr"
              placeholder="client@example.com"
              aria-invalid={Boolean(fieldErrors.email)}
              aria-describedby={fieldErrors.email ? 'email-error' : undefined}
              className={`w-full px-3.5 py-2.5 rounded-[6px] border text-sm text-[#172A35] placeholder-[#4D606A] focus:outline-none focus:ring-2 focus:ring-[#14566B] min-h-[44px] text-right ${
                fieldErrors.email ? 'border-red-500 bg-red-50/20' : 'border-[#A7B9C1]'
              }`}
            />
            {fieldErrors.email && (
              <p id="email-error" className="text-xs text-[#A4262C] mt-1 font-medium">
                {fieldErrors.email}
              </p>
            )}
          </div>

          <div>
            <label htmlFor="address" className="block text-sm font-medium text-[#172A35] mb-1.5">
              العنوان الوطني / المختار (اختياري)
            </label>
            <input
              id="address"
              data-testid="party-address-input"
              type="text"
              value={address}
              onChange={(e) => setAddress(e.target.value)}
              placeholder="مثال: 15 شارع قصر النيل، القاهرة"
              className="w-full px-3.5 py-2.5 rounded-[6px] border border-[#A7B9C1] text-sm text-[#172A35] placeholder-[#4D606A] focus:outline-none focus:ring-2 focus:ring-[#14566B] min-h-[44px]"
            />
          </div>
        </div>

        {/* Identity Details (Only in Create Mode) */}
        {!isEdit && (
          <div className="pt-4 border-t border-[#E8EEF1] space-y-3">
            <div className="flex items-center justify-between">
              <div>
                <span className="text-sm font-bold text-[#172A35]">
                  وثيقة إثبات الهوية (اختياري)
                </span>
                <p className="text-xs text-[#4D606A] mt-0.5">
                  تُشفر بيانات الهوية الحساسة خادمياً بخوارزمية AES-256-GCM ولا تُخزن نصاً صريحاً.
                </p>
              </div>

              <button
                type="button"
                data-testid="toggle-identity-fields"
                onClick={() => setHasIdentity((prev) => !prev)}
                className="text-xs font-semibold text-[#14566B] hover:underline min-h-[44px] px-2 flex items-center"
              >
                {hasIdentity ? 'إلغاء تسجيل الهوية' : '＋ إضافة وثيقة هوية'}
              </button>
            </div>

            {hasIdentity && (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 p-3 bg-[#F4F6F7] rounded-[6px] border border-[#D5DFE3]">
                <div>
                  <label
                    htmlFor="identificationType"
                    className="block text-xs font-semibold text-[#172A35] mb-1"
                  >
                    نوع الوثيقة
                  </label>
                  <select
                    id="identificationType"
                    data-testid="identity-type-select"
                    value={identificationType}
                    onChange={(e) =>
                      setIdentificationType(e.target.value as IdentificationType)
                    }
                    className="w-full px-3 py-2 rounded-[6px] border border-[#A7B9C1] text-sm bg-white text-[#172A35] focus:outline-none focus:ring-2 focus:ring-[#14566B] min-h-[44px]"
                  >
                    <option value="NATIONAL_ID">{IDENTIFICATION_TYPE_LABELS.NATIONAL_ID}</option>
                    <option value="PASSPORT">{IDENTIFICATION_TYPE_LABELS.PASSPORT}</option>
                    <option value="COMMERCIAL_REG">{IDENTIFICATION_TYPE_LABELS.COMMERCIAL_REG}</option>
                    <option value="TAX_CARD">{IDENTIFICATION_TYPE_LABELS.TAX_CARD}</option>
                    <option value="OTHER">{IDENTIFICATION_TYPE_LABELS.OTHER}</option>
                  </select>
                </div>

                <div>
                  <label
                    htmlFor="identityNumber"
                    className="block text-xs font-semibold text-[#172A35] mb-1"
                  >
                    رقم الوثيقة
                  </label>
                  <input
                    id="identityNumber"
                    data-testid="identity-number-input"
                    type="text"
                    value={identityNumber}
                    onChange={(e) => setIdentityNumber(e.target.value)}
                    dir="ltr"
                    placeholder="29001011234567"
                    className="w-full px-3 py-2 rounded-[6px] border border-[#A7B9C1] text-sm bg-white text-[#172A35] focus:outline-none focus:ring-2 focus:ring-[#14566B] min-h-[44px] text-right font-mono"
                  />
                </div>
              </div>
            )}
          </div>
        )}

        {/* Notes */}
        <div>
          <label htmlFor="notes" className="block text-sm font-medium text-[#172A35] mb-1.5">
            ملاحظات عامة (اختياري)
          </label>
          <textarea
            id="notes"
            data-testid="party-notes-input"
            rows={3}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="أية ملاحظات إضافية تخص الطرف أو صفته أو التوجيهات الخاصة به..."
            className="w-full px-3.5 py-2.5 rounded-[6px] border border-[#A7B9C1] text-sm text-[#172A35] placeholder-[#4D606A] focus:outline-none focus:ring-2 focus:ring-[#14566B]"
          />
        </div>
      </div>

      {/* 5. Actions Footer */}
      <div className="flex items-center justify-between gap-4 pt-2">
        <Link
          href={party ? `/parties/${party.id}` : '/parties'}
          data-testid="cancel-party-button"
          className="px-5 py-2.5 text-sm font-medium text-[#4D606A] hover:text-[#172A35] hover:bg-slate-200 rounded-[6px] transition-colors min-h-[44px] flex items-center justify-center"
        >
          إلغاء
        </Link>

        <button
          type="submit"
          data-testid="submit-party-button"
          disabled={isSubmitting || hasConcurrencyConflict}
          className="inline-flex items-center justify-center gap-2 px-6 py-2.5 bg-[#14566B] hover:bg-[#0F4354] disabled:opacity-50 text-white font-medium text-sm rounded-[6px] shadow-xs transition-colors focus:outline-none focus:ring-2 focus:ring-[#14566B] focus:ring-offset-2 min-h-[44px]"
        >
          {isSubmitting ? (
            <>
              <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
              <span>جارٍ الحفظ...</span>
            </>
          ) : (
            <span>{isEdit ? 'حفظ التعديلات' : 'تسجيل الطرف'}</span>
          )}
        </button>
      </div>
    </form>
  );
}

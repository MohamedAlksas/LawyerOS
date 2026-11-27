'use client';

import React, { useLayoutEffect, useState, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { GuardedLink as Link, useFormDraft, useLeaveGuard } from '@/components/navigation-guard';
import { generateClientRequestId, isAuthRecoveryCode } from '@/components/matters/matter-ui-types';
import { savePartyAction, checkPartyDuplicatesAction } from '@/modules/parties/actions';
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
  ownerId: string;
  party?: ClientProfileDTO;
}

export function PartyForm({ ownerId, party }: PartyFormProps) {
  const router = useRouter();
  const isEdit = Boolean(party);
  const draft = useFormDraft<SavePartyInput>(ownerId, party ? `/parties/${party.id}/edit` : '/parties/new');
  const editable = useFormDraft<SavePartyInput>(`${ownerId}:party-editable`, party ? `/parties/${party.id}/edit` : '/parties/new');
  const restored = draft.restored ?? editable.restored;
  const [pending, setPending] = useState<SavePartyInput | null>(draft.restored ?? null);

  // Form inputs kept strictly in component state (page memory)
  const [kind, setKind] = useState<PartyKind>((restored ?? party)?.kind ?? 'PERSON');
  const [name, setName] = useState((restored ?? party)?.name ?? '');
  const [primaryPhone, setPrimaryPhone] = useState((restored ?? party)?.primaryPhone ?? '');
  const [additionalPhones, setAdditionalPhones] = useState(
    (restored ?? party)?.additionalPhones?.join(', ') ?? ''
  );
  const [email, setEmail] = useState((restored ?? party)?.email ?? '');
  const [address, setAddress] = useState((restored ?? party)?.address ?? '');
  const [notes, setNotes] = useState((restored ?? party)?.notes ?? '');

  // Identity is optional, only editable during creation or if explicitly entered
  const [hasIdentity, setHasIdentity] = useState(Boolean(restored?.identity));
  const [identificationType, setIdentificationType] =
    useState<IdentificationType>(restored?.identity?.identificationType ?? 'NATIONAL_ID');
  const [identityNumber, setIdentityNumber] = useState(restored?.identity?.number ?? '');

  // Status and feedback states
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [generalError, setGeneralError] = useState<string | null>(null);
  const [sessionExpired, setSessionExpired] = useState(false);

  // Concurrency conflict state
  const [hasConcurrencyConflict, setHasConcurrencyConflict] = useState(false);

  // Duplicate warning advisory state
  const [duplicateWarnings, setDuplicateWarnings] = useState<DuplicateWarningDTO[]>([]);
  const [acknowledgedDuplicates, setAcknowledgedDuplicates] = useState(false);

  const savingRef = useRef(false);
  const savedRef = useRef(false);
  const identityNumberError = fieldErrors.identityNumber ?? fieldErrors['identity.number'];
  const additionalPhonesError =
    fieldErrors.additionalPhones ??
    Object.entries(fieldErrors).find(([key]) => key.startsWith('additionalPhones.'))?.[1];
  const dirty = name !== (party?.name ?? '') || kind !== (party?.kind ?? 'PERSON') ||
    primaryPhone !== (party?.primaryPhone ?? '') || additionalPhones !== (party?.additionalPhones?.join(', ') ?? '') ||
    email !== (party?.email ?? '') || address !== (party?.address ?? '') || notes !== (party?.notes ?? '') || hasIdentity;
  useLeaveGuard((dirty && duplicateWarnings.length === 0) || Boolean(pending), isSubmitting);
  useLayoutEffect(() => {
    if (!draft.isCurrent()) return;
    if (savedRef.current || !dirty) editable.clear();
    else if (!pending) editable.keep({
      id: party?.id, expectedVersion: editable.restored?.expectedVersion ?? party?.version,
      kind, name, primaryPhone, additionalPhones: additionalPhones.split(',').map((phone) => phone.trim()), email, address, notes,
      ...(hasIdentity ? { identity: { identificationType, number: identityNumber } } : {}), idempotencyKey: '',
    });
  });

  const validateClientSide = (): Record<string, string> => {
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
    return errors;
  };

  const doSaveParty = async () => {
    if (savingRef.current || !draft.isCurrent()) return;
    savingRef.current = true;
    setIsSubmitting(true);
    setGeneralError(null);
    setSessionExpired(false);
    setHasConcurrencyConflict(false);

    const payload: SavePartyInput = pending ?? {
      id: party?.id,
      kind,
      name: name.trim(),
      primaryPhone: primaryPhone.trim() || null,
      additionalPhones: additionalPhones.split(',').map((phone) => phone.trim()).filter(Boolean),
      email: email.trim() || null,
      address: address.trim() || null,
      notes: notes.trim() || null,
      expectedVersion: editable.restored?.expectedVersion ?? party?.version,
      idempotencyKey: generateClientRequestId('party'),
      ...(!isEdit && hasIdentity && identityNumber.trim()
        ? { identity: { identificationType, number: identityNumber.trim() } }
        : {}),
    };

    setPending(payload);
    draft.keep(payload);

    try {
      const result = await savePartyAction(payload);
      if (!draft.isCurrent()) return;

      if (!result.success) {
        if (['VALIDATION_ERROR', 'CONCURRENCY_CONFLICT', 'NOT_FOUND', 'FORBIDDEN', 'IDEMPOTENCY_PAYLOAD_MISMATCH'].includes(result.code ?? '')) {
          setPending(null);
          draft.clear();
        }
        if (result.code === 'CONCURRENCY_CONFLICT') {
          setHasConcurrencyConflict(true);
          setGeneralError(
            'تم تعديل بيانات هذا الطرف من شاشة أو جلسة أخرى بعد فتحك لهذه الصفحة. لتجنب فقدان البيانات، يرجى مراجعة التعديلات وإعادة تحميل الصفحة.'
          );
        } else if (result.code === 'VALIDATION_ERROR' && result.fieldErrors) {
          setFieldErrors(result.fieldErrors);
          setGeneralError('يرجى مراجعة الأخطاء الموضحة أدناه.');
        } else if (isAuthRecoveryCode(result.code)) {
          setSessionExpired(true);
          setGeneralError('انتهت الجلسة أو يلزم استكمال التحقق. سجّل الدخول في نافذة جديدة ثم أعد محاولة الحفظ الأصلي.');
        } else {
          setGeneralError(result.error || 'تعذر حفظ بيانات الطرف.');
        }
        return;
      }

      savedRef.current = true;
      draft.clear();
      editable.clear();
      setPending(null);
      const savedParty = result.data.party;
      router.push(`/parties/${savedParty.id}`);
      router.refresh();
    } catch {
      if (draft.isCurrent()) setGeneralError('تعذر تأكيد الحفظ. يمكنك إعادة محاولة الحفظ الأصلي.');
    } finally {
      savingRef.current = false;
      if (draft.isCurrent()) setIsSubmitting(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isSubmitting) return;
    if (pending) {
      await doSaveParty();
      return;
    }
    setGeneralError(null);
    setHasConcurrencyConflict(false);

    const clientErrors = validateClientSide();
    const firstErrorKey = Object.keys(clientErrors)[0];
    if (firstErrorKey) {
      // Focus first error field for accessibility
      document.getElementById(firstErrorKey)?.focus();
      return;
    }

    // In create mode: if duplicates haven't been acknowledged, perform pre-save duplicate check
    if (!isEdit && !acknowledgedDuplicates) {
      setIsSubmitting(true);
      try {
        const dupRes = await checkPartyDuplicatesAction(
          name.trim(),
          primaryPhone.trim() || null
        );
        if (dupRes.success && dupRes.data.length > 0) {
          setDuplicateWarnings(dupRes.data);
          setIsSubmitting(false);
          return;
        }
      } catch {
        // Continue to save if duplicate check fails
      }
    }

    await doSaveParty();
  };

  const handleConfirmDuplicate = async () => {
    setAcknowledgedDuplicates(true);
    setDuplicateWarnings([]);
    await doSaveParty();
  };

  const handleReloadLatest = () => {
    editable.clear();
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
            <div>
              <h3 className="text-sm font-bold text-rose-900">
                تم تعديل البيانات من شاشة أخرى
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
            <div>
              <h3 className="text-sm font-bold text-amber-900">
                تنبيه استرشادي: يوجد أطراف مسجلة مسبقاً ببيانات مشابهة
              </h3>
              <p className="text-xs text-amber-800 mt-1 leading-relaxed">
                يوجد طرف أو أكثر مسجل مسبقاً يتشابه في الاسم أو رقم الهاتف المدخل. لم يتم إنشاء أي طرف جديد حتى الآن. يمكنك استعراض الملف المسجل مسبقاً دون إنشاء تكرار، أو تأكيد الحفظ كطرف مستقل:
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
                      data-testid={`view-existing-duplicate-${dup.id}`}
                      className="text-amber-900 underline font-semibold hover:text-amber-950 text-xs inline-flex items-center gap-1 min-h-[44px]"
                    >
                      <span>فتح الملف الموجود</span>
                      <span aria-hidden="true">↗</span>
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
              disabled={isSubmitting}
              className="px-4 py-2 bg-amber-700 hover:bg-amber-800 text-white text-xs font-semibold rounded-[6px] transition-colors min-h-[44px]"
            >
              {isSubmitting ? 'جارٍ الحفظ...' : 'حفظ كطرف مستقل'}
            </button>
            <Link
              href="/parties"
              className="px-4 py-2 bg-white text-amber-900 border border-amber-300 hover:bg-amber-100 text-xs font-semibold rounded-[6px] transition-colors flex items-center justify-center min-h-[44px]"
            >
              إلغاء والعودة لدليل الأطراف
            </Link>
          </div>
        </div>
      )}

      {/* 3. General / Validation Error Summary */}
      {(generalError || Object.keys(fieldErrors).length > 0) && (
        <div
          role="alert"
          data-testid="form-error-summary"
          className="p-3 bg-red-50 border border-red-200 rounded-[6px] text-xs text-[#A4262C] space-y-2"
        >
          <div className="font-bold">{generalError || 'يرجى مراجعة الأخطاء الموضحة أدناه.'}</div>
          {sessionExpired && (
            <div>
              <a
                href="/login"
                target="_blank"
                rel="noopener noreferrer"
                data-testid="party-session-login-link"
                className="inline-flex items-center px-3 py-1.5 bg-[#14566B] text-white text-xs font-semibold rounded-[6px] hover:bg-[#114252] min-h-[44px]"
              >
                فتح شاشة تسجيل الدخول في نافذة جديدة ↗
              </a>
            </div>
          )}
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
      <fieldset disabled={isSubmitting || Boolean(pending)} className="min-w-0 bg-white p-5 sm:p-6 rounded-[6px] border border-[#D5DFE3] space-y-6 shadow-xs">
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
              setAcknowledgedDuplicates(false);
              setDuplicateWarnings([]);
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
                setAcknowledgedDuplicates(false);
                setDuplicateWarnings([]);
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
              onChange={(e) => {
                setAdditionalPhones(e.target.value);
                setFieldErrors((prev) => {
                  const hasAdditionalPhoneError = Object.keys(prev).some(
                    (key) => key === 'additionalPhones' || key.startsWith('additionalPhones.')
                  );
                  if (!hasAdditionalPhoneError) return prev;
                  const n = { ...prev };
                  for (const key of Object.keys(n)) {
                    if (key === 'additionalPhones' || key.startsWith('additionalPhones.')) {
                      delete n[key];
                    }
                  }
                  return n;
                });
              }}
              dir="ltr"
              placeholder="0123456789, 0233445566"
              aria-invalid={Boolean(additionalPhonesError)}
              aria-describedby={additionalPhonesError ? 'additionalPhones-error' : undefined}
              className={`w-full px-3.5 py-2.5 rounded-[6px] border text-sm text-[#172A35] placeholder-[#4D606A] focus:outline-none focus:ring-2 focus:ring-[#14566B] min-h-[44px] text-right ${
                additionalPhonesError ? 'border-red-500 bg-red-50/20' : 'border-[#A7B9C1]'
              }`}
            />
            {additionalPhonesError && (
              <p id="additionalPhones-error" className="text-xs text-[#A4262C] mt-1 font-medium">
                {additionalPhonesError}
              </p>
            )}
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
              onChange={(e) => {
                setAddress(e.target.value);
                if (fieldErrors.address) {
                  setFieldErrors((prev) => {
                    const n = { ...prev };
                    delete n.address;
                    return n;
                  });
                }
              }}
              aria-invalid={Boolean(fieldErrors.address)}
              aria-describedby={fieldErrors.address ? 'address-error' : undefined}
              placeholder="مثال: 15 شارع قصر النيل، القاهرة"
              className={`w-full px-3.5 py-2.5 rounded-[6px] border text-sm text-[#172A35] placeholder-[#4D606A] focus:outline-none focus:ring-2 focus:ring-[#14566B] min-h-[44px] ${
                fieldErrors.address ? 'border-red-500 bg-red-50/20' : 'border-[#A7B9C1]'
              }`}
            />
            {fieldErrors.address && (
              <p id="address-error" className="text-xs text-[#A4262C] mt-1 font-medium">
                {fieldErrors.address}
              </p>
            )}
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
                onClick={() => {
                  const next = !hasIdentity;
                  setHasIdentity(next);
                  if (!next) {
                    setFieldErrors((prev) => {
                      if (
                        !prev.identityNumber &&
                        !prev['identity.number'] &&
                        !prev.identity &&
                        !prev['identity.identificationType']
                      ) {
                        return prev;
                      }
                      const n = { ...prev };
                      delete n.identityNumber;
                      delete n['identity.number'];
                      delete n.identity;
                      delete n['identity.identificationType'];
                      return n;
                    });
                  }
                }}
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
                    onChange={(e) => {
                      setIdentityNumber(e.target.value);
                      if (fieldErrors.identityNumber || fieldErrors['identity.number']) {
                        setFieldErrors((prev) => {
                          const n = { ...prev };
                          delete n.identityNumber;
                          delete n['identity.number'];
                          return n;
                        });
                      }
                    }}
                    dir="ltr"
                    placeholder="29001011234567"
                    aria-invalid={Boolean(identityNumberError)}
                    aria-describedby={identityNumberError ? 'identityNumber-error' : undefined}
                    className={`w-full px-3 py-2 rounded-[6px] border text-sm bg-white text-[#172A35] focus:outline-none focus:ring-2 focus:ring-[#14566B] min-h-[44px] text-right font-mono ${
                      identityNumberError ? 'border-red-500 bg-red-50/20' : 'border-[#A7B9C1]'
                    }`}
                  />
                  {identityNumberError && (
                    <p id="identityNumber-error" className="text-xs text-[#A4262C] mt-1 font-medium">
                      {identityNumberError}
                    </p>
                  )}
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
            onChange={(e) => {
              setNotes(e.target.value);
              if (fieldErrors.notes) {
                setFieldErrors((prev) => {
                  const n = { ...prev };
                  delete n.notes;
                  return n;
                });
              }
            }}
            aria-invalid={Boolean(fieldErrors.notes)}
            aria-describedby={fieldErrors.notes ? 'notes-error' : undefined}
            placeholder="أية ملاحظات إضافية تخص الطرف أو صفته أو التوجيهات الخاصة به..."
            className={`w-full px-3.5 py-2.5 rounded-[6px] border text-sm text-[#172A35] placeholder-[#4D606A] focus:outline-none focus:ring-2 focus:ring-[#14566B] ${
              fieldErrors.notes ? 'border-red-500 bg-red-50/20' : 'border-[#A7B9C1]'
            }`}
          />
          {fieldErrors.notes && (
            <p id="notes-error" className="text-xs text-[#A4262C] mt-1 font-medium">
              {fieldErrors.notes}
            </p>
          )}
        </div>
      </fieldset>

      {/* 5. Actions Footer */}
      {pending && !isSubmitting && (
        <p role="status" className="text-sm text-[#14566B]">البيانات الأصلية محفوظة في هذه الجلسة حتى يتأكد الحفظ.</p>
      )}
      <div className="flex items-center justify-between gap-4 pt-2">
        <Link
          href={party ? `/parties/${party.id}` : '/parties'}
          onNavigate={editable.clear}
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
              <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin motion-reduce:animate-none" />
              <span>جارٍ الحفظ...</span>
            </>
          ) : (
            <span>{pending ? 'إعادة محاولة الحفظ الأصلي' : isEdit ? 'حفظ التعديلات' : 'تسجيل الطرف'}</span>
          )}
        </button>
      </div>
    </form>
  );
}

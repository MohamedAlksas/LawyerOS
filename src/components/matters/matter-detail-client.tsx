'use client';

import React, { useState, useRef } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  MatterDTO,
  MatterPartyRole,
  MatterPartySummaryDTO,
  MatterAuthorizationSummaryDTO,
} from '@/modules/matters/matter-types';
import {
  linkMatterPartyAction,
  updateMatterPartyAction,
  unlinkMatterPartyAction,
  linkMatterAuthorizationAction,
  unlinkMatterAuthorizationAction,
} from '@/modules/matters/matter-actions';
import { searchPartiesAction, getClientProfileAction } from '@/modules/parties/actions';
import {
  MATTER_KIND_LABELS,
  MATTER_STATUS_LABELS,
  MATTER_STATUS_CLASSES,
  MATTER_PARTY_ROLE_LABELS,
  PROCEEDING_INSTANCE_LABELS,
  PROCEEDING_STATUS_LABELS,
  PROCEEDING_STATUS_CLASSES,
  PROCEEDING_LEGAL_CAPACITY_LABELS,
  POA_REVIEW_STATUS_LABELS,
  POA_REVIEW_STATUS_CLASSES,
  formatCairoDateOnly,
  generateClientRequestId,
} from './matter-ui-types';

interface MatterDetailClientProps {
  initialMatter: MatterDTO;
}

export function MatterDetailClient({ initialMatter }: MatterDetailClientProps) {
  const router = useRouter();
  const [matter, setMatter] = useState<MatterDTO>(initialMatter);
  const [activeTab, setActiveTab] = useState<'parties' | 'proceedings' | 'authorizations' | 'summary' | 'audit'>('parties');

  // Party Linking Modal / Form State (C11 guarded async lifecycle)
  const [showAddPartyModal, setShowAddPartyModal] = useState(false);
  const [partySearchQuery, setPartySearchQuery] = useState('');
  const [searchedParties, setSearchedParties] = useState<{ id: string; name: string }[]>([]);
  const [isSearchingParty, setIsSearchingParty] = useState(false);
  const [partySearchError, setPartySearchError] = useState<string | null>(null);
  const partySearchGenRef = useRef(0);

  const [selectedPartyId, setSelectedPartyId] = useState('');
  const [selectedPartyRole, setSelectedPartyRole] = useState<MatterPartyRole>('CLIENT');
  const [isPrimaryContact, setIsPrimaryContact] = useState(false);
  const [partyNotes, setPartyNotes] = useState('');
  const [isSubmittingParty, setIsSubmittingParty] = useState(false);
  const [partyActionError, setPartyActionError] = useState<string | null>(null);

  // POA Linking State
  const [showAddPoaModal, setShowAddPoaModal] = useState(false);
  const [availablePoas, setAvailablePoas] = useState<
    { id: string; poaNumberText: string; poaYearLabel: string; notarizationOffice: string; partyName: string }[]
  >([]);
  const [selectedPoaId, setSelectedPoaId] = useState('');
  const [isLoadingPoas, setIsLoadingPoas] = useState(false);
  const [isSubmittingPoa, setIsSubmittingPoa] = useState(false);
  const [poaActionError, setPoaActionError] = useState<string | null>(null);

  // General Notification / Error
  const [actionMessage, setActionMessage] = useState<string | null>(null);

  const parties = matter.parties || [];
  const proceedings = matter.proceedings || [];
  const authorizations = matter.authorizations || [];

  const clients = parties.filter((p) => p.role === 'CLIENT');
  const opponents = parties.filter((p) => p.role === 'OPPONENT');
  const otherParties = parties.filter((p) => p.role === 'OTHER');

  const hasMissingPaperLocation = !matter.paperLocationId && matter.status === 'ACTIVE';

  const handleOpenPartyModal = () => {
    setActionMessage(null);
    setPartyActionError(null);
    setPartySearchError(null);
    setShowAddPartyModal(true);
  };

  // Search Parties for Linking (C11: separate query from selection, clear selection on text change, guard generation)
  const handleSearchParties = async (q: string) => {
    setPartySearchQuery(q);
    setSelectedPartyId(''); // Clear selection immediately upon query modification
    const gen = ++partySearchGenRef.current;

    if (!q.trim()) {
      setSearchedParties([]);
      setIsSearchingParty(false);
      setPartySearchError(null);
      return;
    }

    setIsSearchingParty(true);
    setPartySearchError(null);

    try {
      const res = await searchPartiesAction({ query: q.trim(), limit: 10 });
      if (gen !== partySearchGenRef.current) return; // Stale delayed response, discard
      if (res.success) {
        setSearchedParties(res.data.parties.map((p) => ({ id: p.id, name: p.name })));
      } else {
        setPartySearchError(res.error || 'تعذر البحث عن الأطراف.');
      }
    } catch {
      if (gen === partySearchGenRef.current) {
        setPartySearchError('حدث خطأ في الاتصال أثناء البحث.');
      }
    } finally {
      if (gen === partySearchGenRef.current) {
        setIsSearchingParty(false);
      }
    }
  };

  // Submit Link Party
  const handleLinkParty = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedPartyId) return;
    setIsSubmittingParty(true);
    setPartyActionError(null);

    const idempotencyKey = generateClientRequestId('lp');

    try {
      const res = await linkMatterPartyAction({
        matterId: matter.id,
        partyId: selectedPartyId,
        role: selectedPartyRole,
        isPrimaryContact,
        billingEnabled: false,
        notes: partyNotes.trim() || null,
        idempotencyKey,
      });

      if (!res.success) {
        setPartyActionError(res.error || 'تعذر ربط الطرف بالملف.');
        setIsSubmittingParty(false);
        return;
      }

      setShowAddPartyModal(false);
      setSelectedPartyId('');
      setPartySearchQuery('');
      setPartyNotes('');
      setIsPrimaryContact(false);
      setIsSubmittingParty(false);
      router.refresh();
      setMatter((prev) => ({
        ...prev,
        parties: [...(prev.parties || []), res.data],
      }));
      setActionMessage('تم ربط الطرف بالملف بنجاح.');
    } catch (err: unknown) {
      setPartyActionError(err instanceof Error ? err.message : 'حدث خطأ في الاتصال.');
      setIsSubmittingParty(false);
    }
  };

  // Unlink Party
  const handleUnlinkParty = async (partyLink: MatterPartySummaryDTO) => {
    if (!confirm(`هل أنت متأكد من إزالة الطرف "${partyLink.partyName}" من هذا الملف؟`)) {
      return;
    }
    setPartyActionError(null);
    const idempotencyKey = generateClientRequestId('up');

    try {
      const res = await unlinkMatterPartyAction({
        id: partyLink.id,
        matterId: matter.id,
        expectedVersion: partyLink.version,
        idempotencyKey,
      });

      if (!res.success) {
        setPartyActionError(res.error || 'تعذر إزالة الطرف.');
        return;
      }

      setMatter((prev) => ({
        ...prev,
        parties: prev.parties?.filter((p) => p.id !== partyLink.id),
      }));
      router.refresh();
      setActionMessage('تمت إزالة الطرف من الملف بنجاح.');
    } catch (err: unknown) {
      setPartyActionError(err instanceof Error ? err.message : 'حدث خطأ في الاتصال.');
    }
  };

  // Toggle Primary Contact
  const handleTogglePrimary = async (partyLink: MatterPartySummaryDTO) => {
    setPartyActionError(null);
    const idempotencyKey = generateClientRequestId('tp');

    try {
      const res = await updateMatterPartyAction({
        id: partyLink.id,
        matterId: matter.id,
        expectedVersion: partyLink.version,
        role: partyLink.role,
        isPrimaryContact: !partyLink.isPrimaryContact,
        notes: partyLink.notes,
        idempotencyKey,
      });

      if (!res.success) {
        setPartyActionError(res.error || 'تعذر تعديل جهة الاتصال الأساسية.');
        return;
      }

      setMatter((prev) => ({
        ...prev,
        parties: prev.parties?.map((p) => {
          if (p.id === partyLink.id) {
            return { ...p, isPrimaryContact: !p.isPrimaryContact, version: p.version + 1 };
          }
          if (!partyLink.isPrimaryContact && p.isPrimaryContact) {
            return { ...p, isPrimaryContact: false };
          }
          return p;
        }),
      }));
      router.refresh();
      setActionMessage('تم تحديث جهة الاتصال الأساسية بنجاح.');
    } catch (err: unknown) {
      setPartyActionError(err instanceof Error ? err.message : 'حدث خطأ في الاتصال.');
    }
  };

  // Load POAs for linking
  const handleOpenPoaModal = async () => {
    setActionMessage(null);
    setShowAddPoaModal(true);
    setIsLoadingPoas(true);
    setPoaActionError(null);
    const poaList: { id: string; poaNumberText: string; poaYearLabel: string; notarizationOffice: string; partyName: string }[] = [];

    try {
      let anyFailed = false;
      for (const client of clients) {
        const res = await getClientProfileAction(client.partyId);
        if (res.success && res.data.powersOfAttorney) {
          for (const poa of res.data.powersOfAttorney) {
            if (!authorizations.some((a) => a.powerOfAttorneyId === poa.id)) {
              poaList.push({
                id: poa.id,
                poaNumberText: poa.poaNumberText,
                poaYearLabel: poa.poaYearLabel,
                notarizationOffice: poa.notarizationOffice,
                partyName: client.partyName,
              });
            }
          }
        } else if (!res.success) {
          anyFailed = true;
        }
      }
      setAvailablePoas(poaList);
      if (anyFailed && poaList.length === 0) {
        setPoaActionError('تعذر تحميل بيانات التوكيلات لبعض الموكلين من الخادم.');
      }
      setIsLoadingPoas(false);
    } catch {
      setPoaActionError('حدث خطأ في الاتصال أثناء جلب التوكيلات.');
      setIsLoadingPoas(false);
    }
  };

  // Link POA
  const handleLinkPoa = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedPoaId) return;
    setIsSubmittingPoa(true);
    setPoaActionError(null);

    const idempotencyKey = generateClientRequestId('lpoa');

    try {
      const res = await linkMatterAuthorizationAction({
        matterId: matter.id,
        powerOfAttorneyId: selectedPoaId,
        idempotencyKey,
      });

      if (!res.success) {
        setPoaActionError(res.error || 'تعذر ربط التوكيل بالملف.');
        setIsSubmittingPoa(false);
        return;
      }

      setShowAddPoaModal(false);
      setSelectedPoaId('');
      setIsSubmittingPoa(false);
      router.refresh();
      setMatter((prev) => ({
        ...prev,
        authorizations: [...(prev.authorizations || []), res.data],
      }));
      setActionMessage('تم ربط التوكيل بالملف بنجاح.');
    } catch (err: unknown) {
      setPoaActionError(err instanceof Error ? err.message : 'حدث خطأ في الاتصال.');
      setIsSubmittingPoa(false);
    }
  };

  // Unlink POA
  const handleUnlinkPoa = async (auth: MatterAuthorizationSummaryDTO) => {
    if (!confirm('هل ترغب في إلغاء ربط هذا التوكيل من هذا الملف؟')) return;
    const idempotencyKey = generateClientRequestId('upoa');

    try {
      const res = await unlinkMatterAuthorizationAction({
        id: auth.id,
        matterId: matter.id,
        idempotencyKey,
      });

      if (!res.success) {
        setActionMessage(`تعذر إلغاء الربط: ${res.error}`);
        return;
      }

      setMatter((prev) => ({
        ...prev,
        authorizations: prev.authorizations?.filter((a) => a.id !== auth.id),
      }));
      router.refresh();
      setActionMessage('تم إلغاء ربط التوكيل بنجاح.');
    } catch {
      setActionMessage('حدث خطأ أثناء إلغاء الربط.');
    }
  };

  return (
    <div className="space-y-6 max-w-5xl mx-auto">
      {/* 1. Header & Breadcrumbs */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 pb-4 border-b border-[#D5DFE3]">
        <div className="space-y-1">
          <nav aria-label="مسار التنقل" className="text-xs text-[#4D606A] flex items-center gap-1.5">
            <Link href="/matters" className="hover:text-[#14566B] hover:underline">
              ملفات القضايا
            </Link>
            <span aria-hidden="true">&gt;</span>
            <bdi dir="ltr" className="font-mono text-[#14566B] font-bold">
              {matter.fileCode}
            </bdi>
          </nav>
          <div className="flex flex-wrap items-center gap-2 sm:gap-3">
            <h1 className="text-2xl font-bold text-[#172A35] tracking-tight">
              {matter.title}
            </h1>
            <span
              data-testid="matter-status-badge"
              className={`inline-flex items-center px-2.5 py-0.5 rounded text-xs font-bold border ${
                MATTER_STATUS_CLASSES[matter.status]
              }`}
            >
              {MATTER_STATUS_LABELS[matter.status]}
            </span>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Link
            href={`/matters/${matter.id}/edit`}
            data-testid="edit-matter-button"
            className="inline-flex items-center justify-center gap-1.5 px-3.5 py-2 bg-[#F4F6F7] hover:bg-[#E8EEF1] text-[#172A35] text-xs font-bold rounded-[6px] border border-[#D5DFE3] transition-colors min-h-[44px]"
          >
            <span>✏️</span>
            <span>تعديل بيانات الملف</span>
          </Link>
          <Link
            href={`/matters/${matter.id}/proceedings/new`}
            data-testid="add-proceeding-button"
            className="inline-flex items-center justify-center gap-1.5 px-4 py-2 bg-[#14566B] hover:bg-[#0F4354] text-white text-xs font-bold rounded-[6px] transition-colors shadow-xs min-h-[44px]"
          >
            <span>⚖️</span>
            <span>+ إضافة قيد قضائي</span>
          </Link>
        </div>
      </div>

      {/* Notifications */}
      {actionMessage && (
        <div
          role="status"
          data-testid="detail-action-message"
          className="p-3 bg-emerald-50 border border-emerald-200 text-emerald-900 rounded-[6px] text-xs flex items-center justify-between"
        >
          <span>✓ {actionMessage}</span>
          <button
            type="button"
            onClick={() => setActionMessage(null)}
            className="text-emerald-700 hover:text-emerald-900 font-bold px-2 py-0.5"
          >
            ✕
          </button>
        </div>
      )}

      {partyActionError && (
        <div
          role="alert"
          data-testid="party-action-error"
          className="p-3 bg-red-50 border border-red-200 text-[#A4262C] rounded-[6px] text-xs flex items-center justify-between"
        >
          <span>⚠️ {partyActionError}</span>
          <button
            type="button"
            onClick={() => setPartyActionError(null)}
            className="text-red-700 hover:text-red-900 font-bold px-2 py-0.5"
          >
            ✕
          </button>
        </div>
      )}

      {/* 2. Paper Location Banner / Missing Location Warning */}
      {hasMissingPaperLocation ? (
        <div
          role="alert"
          data-testid="missing-paper-location-warning"
          className="bg-amber-50 border border-amber-300 rounded-[6px] p-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 text-amber-900 shadow-xs"
        >
          <div className="flex items-start sm:items-center gap-2.5">
            <span className="text-xl select-none" aria-hidden="true">⚠️</span>
            <div className="text-xs leading-relaxed">
              <span className="font-bold block text-sm mb-0.5">الملف نشط بدون مكان حفظ ورقي محدد</span>
              <span>
                لم يتم تحديد دولاب أو رف الحفظ الورقي لهذا الملف بعد. يرجى تحديد مكان الحفظ لتجنب ضياع أو تأخر الأوراق والمستندات.
              </span>
            </div>
          </div>
          <Link
            href={`/matters/${matter.id}/edit`}
            className="px-3.5 py-1.5 bg-amber-700 hover:bg-amber-800 text-white text-xs font-semibold rounded-[6px] shrink-0 self-start sm:self-center transition-colors min-h-[36px] flex items-center justify-center"
          >
            تحديد مكان الحفظ
          </Link>
        </div>
      ) : matter.paperLocationName ? (
        <div
          data-testid="paper-location-card"
          className="bg-white rounded-[6px] border border-[#D5DFE3] px-4 py-3 flex items-center justify-between text-xs text-[#172A35]"
        >
          <div className="flex items-center gap-2">
            <span className="text-base">📁</span>
            <span className="font-semibold text-[#4D606A]">مكان الحفظ الورقي بالمكتب:</span>
            <span className="font-bold text-[#14566B]">{matter.paperLocationName}</span>
          </div>
          <Link
            href={`/matters/${matter.id}/edit`}
            className="text-[#14566B] hover:underline font-medium"
          >
            تغيير
          </Link>
        </div>
      ) : null}

      {/* 3. Core Meta Summary Card */}
      <div className="bg-white rounded-[6px] border border-[#D5DFE3] p-5 shadow-xs grid grid-cols-2 sm:grid-cols-4 gap-4 text-xs">
        <div>
          <span className="block text-[#4D606A] mb-1 font-medium">كود الملف الداخلي:</span>
          <bdi dir="ltr" className="font-mono text-sm font-bold text-[#14566B] bg-slate-50 px-2 py-0.5 rounded border border-slate-200 inline-block">
            {matter.fileCode}
          </bdi>
        </div>

        <div>
          <span className="block text-[#4D606A] mb-1 font-medium">طبيعة العمل:</span>
          <span className="font-bold text-[#172A35] text-sm">
            {MATTER_KIND_LABELS[matter.kind]}
          </span>
        </div>

        <div>
          <span className="block text-[#4D606A] mb-1 font-medium">دائرة التخصص:</span>
          <span className="font-bold text-[#172A35] text-sm">
            {matter.practiceAreaName || '—'}
          </span>
        </div>

        <div>
          <span className="block text-[#4D606A] mb-1 font-medium">تاريخ الفتح:</span>
          <span className="font-bold text-[#172A35] text-sm">
            {formatCairoDateOnly(matter.openingDate)}
          </span>
        </div>
      </div>

      {/* 4. Navigation Tabs */}
      <div className="border-b border-[#D5DFE3]">
        <nav className="flex space-x-1 sm:space-x-4 space-x-reverse" aria-label="أقسام ملف القضية">
          <button
            type="button"
            data-testid="tab-parties"
            onClick={() => setActiveTab('parties')}
            className={`py-3 px-3 text-xs sm:text-sm font-bold border-b-2 transition-colors min-h-[44px] ${
              activeTab === 'parties'
                ? 'border-[#14566B] text-[#14566B]'
                : 'border-transparent text-[#4D606A] hover:text-[#172A35] hover:border-gray-300'
            }`}
          >
            👥 الأطراف والصفات ({parties.length})
          </button>

          <button
            type="button"
            data-testid="tab-proceedings"
            onClick={() => setActiveTab('proceedings')}
            className={`py-3 px-3 text-xs sm:text-sm font-bold border-b-2 transition-colors min-h-[44px] ${
              activeTab === 'proceedings'
                ? 'border-[#14566B] text-[#14566B]'
                : 'border-transparent text-[#4D606A] hover:text-[#172A35] hover:border-gray-300'
            }`}
          >
            ⚖️ القيود والدعاوى القضائية ({proceedings.length})
          </button>

          <button
            type="button"
            data-testid="tab-authorizations"
            onClick={() => setActiveTab('authorizations')}
            className={`py-3 px-3 text-xs sm:text-sm font-bold border-b-2 transition-colors min-h-[44px] ${
              activeTab === 'authorizations'
                ? 'border-[#14566B] text-[#14566B]'
                : 'border-transparent text-[#4D606A] hover:text-[#172A35] hover:border-gray-300'
            }`}
          >
            📜 سندات الوكالة والتوكيلات ({authorizations.length})
          </button>

          <button
            type="button"
            data-testid="tab-summary"
            onClick={() => setActiveTab('summary')}
            className={`py-3 px-3 text-xs sm:text-sm font-bold border-b-2 transition-colors min-h-[44px] ${
              activeTab === 'summary'
                ? 'border-[#14566B] text-[#14566B]'
                : 'border-transparent text-[#4D606A] hover:text-[#172A35] hover:border-gray-300'
            }`}
          >
            📝 الملخص والملاحظات
          </button>
        </nav>
      </div>

      {/* Tab 1: Parties Section */}
      {activeTab === 'parties' && (
        <div className="space-y-6">
          <div className="flex items-center justify-between">
            <h2 className="text-base font-bold text-[#172A35]">
              أطراف الملف (الموكلون والخصوم)
            </h2>
            <button
              type="button"
              data-testid="open-add-party-modal"
              onClick={handleOpenPartyModal}
              className="px-3.5 py-2 bg-[#14566B] hover:bg-[#0F4354] text-white text-xs font-bold rounded-[6px] min-h-[40px] flex items-center gap-1.5 transition-colors"
            >
              <span>+</span>
              <span>ربط طرف جديد بالملف</span>
            </button>
          </div>

          {/* Add Party Modal / Panel */}
          {showAddPartyModal && (
            <div
              data-testid="add-party-panel"
              className="bg-white rounded-[6px] border-2 border-[#14566B] p-5 shadow-md space-y-4"
            >
              <div className="flex items-center justify-between pb-2 border-b border-[#E8EEF1]">
                <h3 className="text-sm font-bold text-[#172A35]">
                  ربط طرف من دليل الأطراف بهذا الملف
                </h3>
                <button
                  type="button"
                  onClick={() => setShowAddPartyModal(false)}
                  className="text-xs text-[#4D606A] hover:text-[#172A35] p-1"
                >
                  ✕ إغلاق
                </button>
              </div>

              <form onSubmit={handleLinkParty} className="space-y-4 text-xs">
                {/* Search / Select Party */}
                <div className="space-y-1">
                  <label htmlFor="link-party-search-input" className="block font-bold text-[#172A35]">
                    اختر الطرف من دليل الأطراف <span className="text-red-600">*</span>
                  </label>
                  <input
                    id="link-party-search-input"
                    type="text"
                    value={partySearchQuery}
                    onChange={(e) => handleSearchParties(e.target.value)}
                    placeholder="اكتب اسم الطرف للبحث..."
                    data-testid="party-search-input"
                    className="w-full px-3 py-2 text-sm border border-[#D5DFE3] rounded-[6px] min-h-[44px]"
                  />

                  {isSearchingParty && (
                    <p className="text-xs text-[#4D606A] italic pt-1">جارٍ البحث في دليل الأطراف...</p>
                  )}
                  {partySearchError && (
                    <p className="text-xs text-red-600 font-medium pt-1">{partySearchError}</p>
                  )}
                  {!isSearchingParty && !partySearchError && partySearchQuery.trim() && searchedParties.length === 0 && (
                    <p className="text-xs text-[#4D606A] italic pt-1">لم يتم العثور على أطراف مطابقة.</p>
                  )}

                  {searchedParties.length > 0 && (
                    <div className="max-h-36 overflow-y-auto border border-[#D5DFE3] rounded-[6px] divide-y divide-[#E8EEF1] mt-1 bg-white">
                      {searchedParties.map((p) => (
                        <button
                          key={p.id}
                          type="button"
                          data-testid={`select-party-${p.id}`}
                          onClick={() => {
                            setSelectedPartyId(p.id);
                            setPartySearchQuery(p.name);
                            setSearchedParties([]);
                          }}
                          className={`w-full text-right p-2 hover:bg-[#F4F6F7] text-xs font-medium ${
                            selectedPartyId === p.id ? 'bg-[#E8EEF1] font-bold text-[#14566B]' : ''
                          }`}
                        >
                          {p.name}
                        </button>
                      ))}
                    </div>
                  )}
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  {/* Role */}
                  <div className="space-y-1">
                    <label htmlFor="link-party-role-select" className="block font-bold text-[#172A35]">
                      صفة الطرف في هذا الملف <span className="text-red-600">*</span>
                    </label>
                    <select
                      id="link-party-role-select"
                      value={selectedPartyRole}
                      onChange={(e) => setSelectedPartyRole(e.target.value as MatterPartyRole)}
                      data-testid="party-role-select"
                      className="w-full px-3 py-2 text-sm border border-[#D5DFE3] rounded-[6px] min-h-[44px]"
                    >
                      <option value="CLIENT">{MATTER_PARTY_ROLE_LABELS.CLIENT}</option>
                      <option value="OPPONENT">{MATTER_PARTY_ROLE_LABELS.OPPONENT}</option>
                      <option value="OTHER">{MATTER_PARTY_ROLE_LABELS.OTHER}</option>
                    </select>
                  </div>

                  {/* Primary Contact Toggle */}
                  {selectedPartyRole === 'CLIENT' && (
                    <div className="space-y-1 flex items-center pt-5">
                      <label className="inline-flex items-center gap-2 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={isPrimaryContact}
                          onChange={(e) => setIsPrimaryContact(e.target.checked)}
                          data-testid="primary-contact-checkbox"
                          className="w-4 h-4 text-[#14566B] rounded border-[#D5DFE3]"
                        />
                        <span className="font-bold text-[#172A35]">
                          تعيين كجهة اتصال أساسية لهذا الملف ⭐
                        </span>
                      </label>
                    </div>
                  )}
                </div>

                {/* Notes */}
                <div className="space-y-1">
                  <label htmlFor="link-party-notes-input" className="block font-bold text-[#172A35]">
                    ملاحظات الطرف بالملف (اختياري)
                  </label>
                  <input
                    id="link-party-notes-input"
                    type="text"
                    value={partyNotes}
                    onChange={(e) => setPartyNotes(e.target.value)}
                    placeholder="مثال: يتابع الملف بالنيابة عن باقي الورثة"
                    className="w-full px-3 py-2 text-sm border border-[#D5DFE3] rounded-[6px]"
                  />
                </div>

                <div className="flex justify-end gap-2 pt-2">
                  <button
                    type="button"
                    onClick={() => setShowAddPartyModal(false)}
                    className="px-4 py-2 bg-[#F4F6F7] text-[#172A35] font-semibold rounded-[6px] border border-[#D5DFE3]"
                  >
                    إلغاء
                  </button>
                  <button
                    type="submit"
                    disabled={isSubmittingParty || !selectedPartyId}
                    data-testid="submit-link-party"
                    className="px-5 py-2 bg-[#14566B] text-white font-bold rounded-[6px] disabled:opacity-50 min-h-[44px]"
                  >
                    {isSubmittingParty ? 'جارٍ الربط...' : 'ربط الطرف'}
                  </button>
                </div>
              </form>
            </div>
          )}

          {/* Clients Section */}
          <div className="space-y-3">
            <h3 className="text-sm font-bold text-emerald-900 bg-emerald-50/70 p-2.5 rounded-[6px] border border-emerald-200 flex items-center justify-between">
              <span>الموكلون وأصحاب الشأن ({clients.length})</span>
              <span className="text-[11px] text-emerald-700 font-normal">
                {matter.status === 'ACTIVE' ? 'الملف نشط ويتطلب موكلاً واحداً على الأقل دائماً' : 'مسودة'}
              </span>
            </h3>

            {clients.length === 0 ? (
              <p className="text-xs text-[#4D606A] italic p-4 bg-white rounded border border-[#D5DFE3]">
                لا يوجد موكلون مرتبطون بهذا الملف. (مسموح به كمسودة فقط).
              </p>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {clients.map((c) => (
                  <div
                    key={c.id}
                    data-testid={`client-card-${c.id}`}
                    className="bg-white rounded-[6px] border border-[#D5DFE3] p-4 shadow-xs space-y-2 relative"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="space-y-0.5">
                        <Link
                          href={`/parties/${c.partyId}`}
                          className="font-bold text-sm text-[#14566B] hover:underline"
                        >
                          {c.partyName}
                        </Link>
                        {c.isPrimaryContact && (
                          <span
                            data-testid={`primary-badge-${c.id}`}
                            className="inline-flex items-center gap-1 text-[11px] font-bold text-amber-800 bg-amber-50 px-2 py-0.5 rounded border border-amber-200"
                          >
                            <span>⭐</span>
                            <span>جهة الاتصال الأساسية</span>
                          </span>
                        )}
                      </div>

                      <div className="flex items-center gap-1">
                        <button
                          type="button"
                          data-testid={`toggle-primary-${c.id}`}
                          onClick={() => handleTogglePrimary(c)}
                          title={c.isPrimaryContact ? 'إلغاء التعيين كأساسي' : 'تعيين كأساسي'}
                          className="text-xs text-[#4D606A] hover:text-amber-700 p-1 rounded"
                        >
                          {c.isPrimaryContact ? '⭐' : '☆'}
                        </button>
                        <button
                          type="button"
                          data-testid={`unlink-party-${c.id}`}
                          onClick={() => handleUnlinkParty(c)}
                          className="text-xs text-red-600 hover:text-red-800 p-1 rounded"
                          title="إزالة الطرف من الملف"
                        >
                          ✕
                        </button>
                      </div>
                    </div>

                    {c.notes && (
                      <p className="text-xs text-[#4D606A] leading-relaxed pt-1 border-t border-[#E8EEF1]">
                        {c.notes}
                      </p>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Opponents Section */}
          <div className="space-y-3 pt-2">
            <h3 className="text-sm font-bold text-rose-900 bg-rose-50/70 p-2.5 rounded-[6px] border border-rose-200">
              الخصوم في النزاع ({opponents.length})
            </h3>

            {opponents.length === 0 ? (
              <p className="text-xs text-[#4D606A] italic p-4 bg-white rounded border border-[#D5DFE3]">
                لم يتم تسجيل خصوم في هذا الملف حتى الآن.
              </p>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {opponents.map((op) => (
                  <div
                    key={op.id}
                    data-testid={`opponent-card-${op.id}`}
                    className="bg-white rounded-[6px] border border-[#D5DFE3] p-4 shadow-xs space-y-2"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <Link
                        href={`/parties/${op.partyId}`}
                        className="font-bold text-sm text-[#172A35] hover:text-[#14566B] hover:underline"
                      >
                        {op.partyName}
                      </Link>
                      <button
                        type="button"
                        data-testid={`unlink-opponent-${op.id}`}
                        onClick={() => handleUnlinkParty(op)}
                        className="text-xs text-red-600 hover:text-red-800 p-1 rounded"
                        title="إزالة الخصم"
                      >
                        ✕
                      </button>
                    </div>
                    {op.notes && (
                      <p className="text-xs text-[#4D606A] leading-relaxed pt-1 border-t border-[#E8EEF1]">
                        {op.notes}
                      </p>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Other Parties */}
          {otherParties.length > 0 && (
            <div className="space-y-3 pt-2">
              <h3 className="text-sm font-bold text-slate-800 bg-slate-50 p-2.5 rounded-[6px] border border-slate-200">
                أطراف أخرى ({otherParties.length})
              </h3>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {otherParties.map((oth) => (
                  <div
                    key={oth.id}
                    className="bg-white rounded-[6px] border border-[#D5DFE3] p-4 shadow-xs space-y-1"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <span className="font-bold text-sm text-[#172A35]">{oth.partyName}</span>
                      <button
                        type="button"
                        onClick={() => handleUnlinkParty(oth)}
                        className="text-xs text-red-600 hover:text-red-800 p-1"
                      >
                        ✕
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Tab 2: Court Proceedings */}
      {activeTab === 'proceedings' && (
        <div className="space-y-6">
          <div className="flex items-center justify-between">
            <h2 className="text-base font-bold text-[#172A35]">
              القيود والدعاوى القضائية المسجلة
            </h2>
            <Link
              href={`/matters/${matter.id}/proceedings/new`}
              data-testid="add-proceeding-tab-button"
              className="px-3.5 py-2 bg-[#14566B] hover:bg-[#0F4354] text-white text-xs font-bold rounded-[6px] min-h-[40px] flex items-center gap-1.5 transition-colors"
            >
              <span>⚖️</span>
              <span>+ تسجيل قيد قضائي جديد</span>
            </Link>
          </div>

          {proceedings.length === 0 ? (
            <div
              data-testid="empty-proceedings-container"
              className="bg-white rounded-[6px] border border-[#D5DFE3] p-8 text-center space-y-3 shadow-xs"
            >
              <div className="text-3xl">⚖️</div>
              <h3 className="text-base font-bold text-[#172A35]">لا توجد قيود قضائية مسجلة</h3>
              <p className="text-xs text-[#4D606A] max-w-md mx-auto leading-relaxed">
                لم يتم قيد أي دعوى أو استئناف في المحاكم لهذا الملف حتى الآن. يمكنك تسجيل أول قيد قضائي بالمحكمة لتنظيم الجلسات.
              </p>
              <div className="pt-2">
                <Link
                  href={`/matters/${matter.id}/proceedings/new`}
                  className="inline-flex items-center gap-2 px-4 py-2 bg-[#14566B] text-white text-xs font-bold rounded-[6px] min-h-[44px]"
                >
                  <span>تسجيل أول قيد قضائي</span>
                </Link>
              </div>
            </div>
          ) : (
            <div className="space-y-4">
              {proceedings.map((proc) => {
                const isDraft = proc.status === 'DRAFT' || !proc.numberText || !proc.yearLabel;

                return (
                  <div
                    key={proc.id}
                    data-testid={`proceeding-card-${proc.id}`}
                    className="bg-white rounded-[6px] border border-[#D5DFE3] p-5 shadow-xs space-y-4 hover:border-[#14566B]/50 transition-colors"
                  >
                    <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3 pb-3 border-b border-[#E8EEF1]">
                      <div className="space-y-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-bold text-base text-[#172A35]">
                            {proc.courtName}
                          </span>
                          <span className="text-xs font-semibold px-2 py-0.5 rounded bg-[#E8EEF1] text-[#14566B]">
                            {PROCEEDING_INSTANCE_LABELS[proc.instance]}
                          </span>
                          {isDraft ? (
                            <span
                              data-testid="proceeding-draft-badge"
                              className="text-xs font-bold px-2 py-0.5 rounded bg-amber-50 text-amber-800 border border-amber-300 inline-flex items-center gap-1"
                            >
                              <span>⚠️</span>
                              <span>الرقم غير مستكمل (مسودة قيد)</span>
                            </span>
                          ) : (
                            <span className="text-xs font-semibold px-2 py-0.5 rounded bg-emerald-50 text-emerald-800 border border-emerald-200">
                              {PROCEEDING_STATUS_LABELS[proc.status]}
                            </span>
                          )}
                        </div>

                        {/* Docket identification */}
                        <div className="text-xs text-[#4D606A] flex flex-wrap items-center gap-2 pt-1">
                          {proc.numberText && proc.yearLabel ? (
                            <div className="flex items-center gap-1">
                              <span className="font-semibold text-[#172A35]">رقم الدعوى:</span>
                              <bdi dir="ltr" className="font-mono text-sm font-bold text-[#14566B] bg-slate-50 px-2 py-0.5 rounded border border-slate-200">
                                {proc.numberText} لسنة {proc.yearLabel}
                              </bdi>
                              {proc.registerType && <span>({proc.registerType})</span>}
                            </div>
                          ) : (
                            <span className="text-amber-800 font-semibold italic">
                              لم يقيد برقم رسمي بعد بالمحكمة
                            </span>
                          )}

                          {proc.circuit && (
                            <span className="text-slate-700 bg-slate-100 px-2 py-0.5 rounded text-[11px]">
                              {proc.circuit}
                            </span>
                          )}
                        </div>
                      </div>

                      <div className="flex items-center gap-2 shrink-0">
                        <Link
                          href={`/matters/${matter.id}/proceedings/${proc.id}`}
                          data-testid={`view-proceeding-${proc.id}`}
                          className="px-3 py-1.5 bg-white hover:bg-[#F4F6F7] text-[#14566B] text-xs font-bold rounded-[6px] border border-[#14566B]/30 transition-colors min-h-[36px] flex items-center"
                        >
                          عرض تفاصيل القيد
                        </Link>
                        <Link
                          href={`/matters/${matter.id}/proceedings/${proc.id}/edit`}
                          data-testid={`edit-proceeding-${proc.id}`}
                          className="px-3 py-1.5 bg-[#F4F6F7] hover:bg-[#E8EEF1] text-[#14566B] text-xs font-bold rounded-[6px] border border-[#D5DFE3] transition-colors min-h-[36px] flex items-center"
                        >
                          تعديل القيد
                        </Link>
                      </div>
                    </div>

                    {/* Parent Proceeding linkage (Appeal -> First instance) */}
                    {proc.parentProceedingSummary && (
                      <div
                        data-testid="parent-proceeding-link"
                        className="p-2.5 bg-blue-50/60 border border-blue-200 rounded-[6px] text-xs text-blue-900 flex items-center gap-2"
                      >
                        <span aria-hidden="true">🔗</span>
                        <span className="font-semibold">مرتبط بالدعوى السابقة:</span>
                        <span>{proc.parentProceedingSummary}</span>
                      </div>
                    )}

                    {/* Parties Legal Capacities in this proceeding */}
                    <div className="space-y-2 pt-1">
                      <span className="text-xs font-bold text-[#4D606A] block">
                        الصفات القانونية لأطراف النزاع في هذا القيد:
                      </span>
                      {proc.parties && proc.parties.length > 0 ? (
                        <div className="flex flex-wrap gap-2">
                          {proc.parties.map((pp) => (
                            <span
                              key={pp.id}
                              data-testid={`proceeding-party-capacity-${pp.id}`}
                              className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded bg-[#F4F6F7] text-xs border border-[#D5DFE3]"
                            >
                              <span className="font-bold text-[#172A35]">{pp.partyName}:</span>
                              <span className="font-semibold text-[#14566B]">
                                {pp.capacityText || (pp.legalCapacity ? PROCEEDING_LEGAL_CAPACITY_LABELS[pp.legalCapacity] : '')}
                              </span>
                            </span>
                          ))}
                        </div>
                      ) : (
                        <p className="text-xs text-[#4D606A] italic">
                          لم يتم تحديد صفات قانونية مخصصة لهذا القيد بعد (يمكن إضافتها عند تعديل القيد).
                        </p>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* Tab 3: Authorizations / POAs */}
      {activeTab === 'authorizations' && (
        <div className="space-y-6">
          <div className="flex items-center justify-between">
            <div className="space-y-0.5">
              <h2 className="text-base font-bold text-[#172A35]">
                سندات الوكالة والتوكيلات المرتبطة بالملف
              </h2>
              <p className="text-xs text-[#4D606A]">
                يجب أن يكون صاحب التوكيل موكلاً حالياً في هذا الملف لإثبات الصفة القانونية للتقاضي.
              </p>
            </div>

            <button
              type="button"
              data-testid="open-add-poa-modal"
              onClick={handleOpenPoaModal}
              className="px-3.5 py-2 bg-[#14566B] hover:bg-[#0F4354] text-white text-xs font-bold rounded-[6px] min-h-[40px] flex items-center gap-1.5 transition-colors"
            >
              <span>+</span>
              <span>ربط توكيل بالملف</span>
            </button>
          </div>

          {/* Add POA Modal */}
          {showAddPoaModal && (
            <div
              data-testid="add-poa-panel"
              className="bg-white rounded-[6px] border-2 border-[#14566B] p-5 shadow-md space-y-4"
            >
              <div className="flex items-center justify-between pb-2 border-b border-[#E8EEF1]">
                <h3 className="text-sm font-bold text-[#172A35]">
                  ربط سند وكالة من توكيلات الموكلين المسجلين
                </h3>
                <button
                  type="button"
                  onClick={() => setShowAddPoaModal(false)}
                  className="text-xs text-[#4D606A] hover:text-[#172A35] p-1"
                >
                  ✕ إغلاق
                </button>
              </div>

              {poaActionError && (
                <p className="text-xs text-red-600 font-bold bg-red-50 p-2 rounded">
                  ⚠️ {poaActionError}
                </p>
              )}

              <form onSubmit={handleLinkPoa} className="space-y-4 text-xs">
                {isLoadingPoas ? (
                  <p className="text-[#4D606A]">جارٍ تحميل التوكيلات المتاحة للموكلين...</p>
                ) : availablePoas.length === 0 ? (
                  <div className="p-3 bg-amber-50 rounded border border-amber-200 text-amber-900 space-y-1">
                    <p className="font-bold">لا توجد توكيلات متاحة لربطها حالياً.</p>
                    <p>
                      تأكد من إضافة موكل للملف أولاً، ثم تسجيل سند وكالة في صفحة ملف الموكل بدليل الأطراف.
                    </p>
                  </div>
                ) : (
                  <div className="space-y-1">
                    <label htmlFor="poa-select-input" className="block font-bold text-[#172A35]">
                      اختر التوكيل <span className="text-red-600">*</span>
                    </label>
                    <select
                      id="poa-select-input"
                      value={selectedPoaId}
                      onChange={(e) => setSelectedPoaId(e.target.value)}
                      data-testid="poa-select"
                      className="w-full px-3 py-2 text-sm border border-[#D5DFE3] rounded-[6px] min-h-[44px]"
                    >
                      <option value="">— اختر التوكيل —</option>
                      {availablePoas.map((poa) => (
                        <option key={poa.id} value={poa.id}>
                          {poa.partyName} — رقم {poa.poaNumberText} لسنة {poa.poaYearLabel} ({poa.notarizationOffice})
                        </option>
                      ))}
                    </select>
                  </div>
                )}

                <div className="flex justify-end gap-2 pt-2">
                  <button
                    type="button"
                    onClick={() => setShowAddPoaModal(false)}
                    className="px-4 py-2 bg-[#F4F6F7] text-[#172A35] font-semibold rounded-[6px] border border-[#D5DFE3]"
                  >
                    إلغاء
                  </button>
                  <button
                    type="submit"
                    disabled={isSubmittingPoa || !selectedPoaId}
                    data-testid="submit-link-poa"
                    className="px-5 py-2 bg-[#14566B] text-white font-bold rounded-[6px] disabled:opacity-50 min-h-[44px]"
                  >
                    {isSubmittingPoa ? 'جارٍ الربط...' : 'ربط التوكيل'}
                  </button>
                </div>
              </form>
            </div>
          )}

          {authorizations.length === 0 ? (
            <div
              data-testid="empty-authorizations-container"
              className="bg-white rounded-[6px] border border-[#D5DFE3] p-8 text-center space-y-3 shadow-xs"
            >
              <div className="text-3xl">📜</div>
              <h3 className="text-base font-bold text-[#172A35]">لا توجد توكيلات مرتبطة بهذا الملف</h3>
              <p className="text-xs text-[#4D606A] max-w-md mx-auto leading-relaxed">
                لم يتم إسناد أي توكيل رسمي لهذا الملف بعد. يمكنك ربط توكيل موثق صادر من أحد الموكلين بالملف.
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {authorizations.map((auth) => (
                <div
                  key={auth.id}
                  data-testid={`authorization-card-${auth.id}`}
                  className="bg-white rounded-[6px] border border-[#D5DFE3] p-4 shadow-xs space-y-3"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="space-y-1">
                      <span className="font-bold text-sm text-[#172A35] block">
                        الموكل: {auth.partyName}
                      </span>
                      <div className="flex items-center gap-1 text-xs text-[#4D606A]">
                        <span>رقم التوكيل:</span>
                        <bdi dir="ltr" className="font-mono font-bold text-[#14566B]">
                          {auth.poaNumberText} لسنة {auth.poaYearLabel}
                        </bdi>
                      </div>
                    </div>

                    <button
                      type="button"
                      data-testid={`unlink-poa-${auth.id}`}
                      onClick={() => handleUnlinkPoa(auth)}
                      className="text-xs text-red-600 hover:text-red-800 p-1"
                      title="إلغاء ربط التوكيل"
                    >
                      ✕ إلغاء الربط
                    </button>
                  </div>

                  <div className="pt-2 border-t border-[#E8EEF1] flex items-center justify-between text-xs">
                    <span className="text-[#4D606A]">مكتب التوثيق: {auth.notarizationOffice}</span>
                    <span
                      data-testid="poa-review-badge"
                      className={`px-2 py-0.5 rounded text-[11px] font-bold border ${
                        POA_REVIEW_STATUS_CLASSES[auth.humanReviewStatus] || 'bg-amber-50 text-amber-800 border-amber-200'
                      }`}
                    >
                      {POA_REVIEW_STATUS_LABELS[auth.humanReviewStatus] || auth.humanReviewStatus}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Tab 4: Summary & Notes */}
      {activeTab === 'summary' && (
        <div className="bg-white rounded-[6px] border border-[#D5DFE3] p-6 space-y-6 shadow-xs">
          <div>
            <h3 className="text-sm font-bold text-[#172A35] mb-2 pb-1 border-b border-[#E8EEF1]">
              ملخص وقائع وموضوع الملف
            </h3>
            {matter.summary ? (
              <p className="text-xs text-[#172A35] whitespace-pre-wrap leading-relaxed">
                {matter.summary}
              </p>
            ) : (
              <p className="text-xs text-[#4D606A] italic">لا يوجد ملخص مسجل لهذا الملف.</p>
            )}
          </div>

          <div>
            <h3 className="text-sm font-bold text-[#172A35] mb-2 pb-1 border-b border-[#E8EEF1]">
              ملاحظات وتوجيهات داخلية للمكتب
            </h3>
            {matter.notes ? (
              <p className="text-xs text-[#172A35] whitespace-pre-wrap leading-relaxed bg-[#F9FBFC] p-3 rounded border border-[#E8EEF1]">
                {matter.notes}
              </p>
            ) : (
              <p className="text-xs text-[#4D606A] italic">لا توجد ملاحظات داخلية مدونة.</p>
            )}
          </div>
        </div>
      )}

      {/* Future Modules Notice */}
      <div className="p-4 bg-[#F4F6F7] rounded-[6px] border border-dashed border-[#D5DFE3] text-xs text-[#4D606A] space-y-1">
        <span className="font-bold text-[#172A35] block">
          📅 الجلسات والأجندة والمستندات والحسابات
        </span>
        <p>
          وحدات إدارة الجلسات وقرارات المحكمة (T08) وحفظ المستندات الرقمية (T11) وحسابات الأتعاب والمصروفات (T09/T10)
          سيتم ربطها تلقائياً بهذا الملف فور إطلاقها في المراحل القادمة.
        </p>
      </div>
    </div>
  );
}


'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  OfficeSettingsDTO,
  ReferenceItemDTO,
  ReferenceItemType,
} from '@/modules/settings/reference-types';
import {
  updateOfficeSettingsAction,
  createReferenceItemAction,
  updateReferenceItemAction,
} from '@/modules/settings/reference-actions';
import { generateClientRequestId } from '@/components/matters/matter-ui-types';

interface ReferenceSettingsClientProps {
  initialOfficeSettings: OfficeSettingsDTO;
  initialCourts: ReferenceItemDTO[];
  initialPracticeAreas: ReferenceItemDTO[];
  initialStorageLocations: ReferenceItemDTO[];
}

export function ReferenceSettingsClient({
  initialOfficeSettings,
  initialCourts,
  initialPracticeAreas,
  initialStorageLocations,
}: ReferenceSettingsClientProps) {
  const router = useRouter();
  const [activeTab, setActiveTab] = useState<'office' | 'courts' | 'practice_areas' | 'storage_locations'>('office');

  // Office Settings State
  const [officeSettings, setOfficeSettings] = useState<OfficeSettingsDTO>(initialOfficeSettings);
  const [officeName, setOfficeName] = useState(officeSettings.officeName);
  const [lawyerName, setLawyerName] = useState(officeSettings.lawyerName || '');
  const [phone, setPhone] = useState(officeSettings.phone || '');
  const [email, setEmail] = useState(officeSettings.email || '');
  const [address, setAddress] = useState(officeSettings.address || '');
  const [taxNumber, setTaxNumber] = useState(officeSettings.taxNumber || '');
  const [isSavingOffice, setIsSavingOffice] = useState(false);
  const [officeMessage, setOfficeMessage] = useState<string | null>(null);
  const [officeError, setOfficeError] = useState<string | null>(null);

  // Reference Items Lists
  const [courts, setCourts] = useState<ReferenceItemDTO[]>(initialCourts);
  const [practiceAreas, setPracticeAreas] = useState<ReferenceItemDTO[]>(initialPracticeAreas);
  const [storageLocations, setStorageLocations] = useState<ReferenceItemDTO[]>(initialStorageLocations);

  // New Item Form State
  const [isCreatingItem, setIsCreatingItem] = useState(false);
  const [newItemName, setNewItemName] = useState('');
  const [newItemCode, setNewItemCode] = useState('');
  const [newItemNotes, setNewItemNotes] = useState('');
  const [itemError, setItemError] = useState<string | null>(null);
  const [itemSuccessMessage, setItemSuccessMessage] = useState<string | null>(null);

  // Filter for Reference Items
  const [filterActiveOnly, setFilterActiveOnly] = useState(false);

  // Handle Office Settings Save
  const handleSaveOffice = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSavingOffice(true);
    setOfficeMessage(null);
    setOfficeError(null);

    const idempotencyKey = generateClientRequestId('off');

    try {
      const res = await updateOfficeSettingsAction({
        officeName: officeName.trim(),
        lawyerName: lawyerName.trim() || null,
        phone: phone.trim() || null,
        email: email.trim() || null,
        address: address.trim() || null,
        taxNumber: taxNumber.trim() || null,
        expectedVersion: officeSettings.version,
        idempotencyKey,
      });

      if (!res.success) {
        setOfficeError(res.error || 'تعذر حفظ بيانات المكتب.');
        setIsSavingOffice(false);
        return;
      }

      setOfficeSettings(res.data);
      setOfficeMessage('تم حفظ بيانات المكتب بنجاح.');
      setIsSavingOffice(false);
      router.refresh();
    } catch (err: unknown) {
      setOfficeError(err instanceof Error ? err.message : 'حدث خطأ في الاتصال.');
      setIsSavingOffice(false);
    }
  };

  // Handle Create Reference Item
  const handleCreateItem = async (type: ReferenceItemType) => {
    if (!newItemName.trim()) return;
    setIsCreatingItem(true);
    setItemError(null);
    setItemSuccessMessage(null);

    const idempotencyKey = generateClientRequestId('ritem');

    try {
      const res = await createReferenceItemAction({
        type,
        name: newItemName.trim(),
        code: newItemCode.trim() || null,
        notes: newItemNotes.trim() || null,
        idempotencyKey,
      });

      if (!res.success) {
        setItemError(res.error || 'تعذر إضافة العنصر المرجعي.');
        setIsCreatingItem(false);
        return;
      }

      if (type === 'COURT') {
        setCourts((prev) => [...prev, res.data]);
      } else if (type === 'PRACTICE_AREA') {
        setPracticeAreas((prev) => [...prev, res.data]);
      } else if (type === 'STORAGE_LOCATION') {
        setStorageLocations((prev) => [...prev, res.data]);
      }

      setNewItemName('');
      setNewItemCode('');
      setNewItemNotes('');
      setItemSuccessMessage('تمت إضافة العنصر المرجعي بنجاح.');
      setIsCreatingItem(false);
      router.refresh();
    } catch (err: unknown) {
      setItemError(err instanceof Error ? err.message : 'حدث خطأ في الاتصال.');
      setIsCreatingItem(false);
    }
  };

  // Handle Toggle Active/Inactive
  const handleToggleActive = async (item: ReferenceItemDTO) => {
    setItemError(null);
    setItemSuccessMessage(null);

    const idempotencyKey = generateClientRequestId('tog');

    try {
      const res = await updateReferenceItemAction({
        id: item.id,
        type: item.type,
        expectedVersion: item.version,
        name: item.name,
        code: item.code,
        notes: item.notes,
        isActive: !item.isActive,
        idempotencyKey,
      });

      if (!res.success) {
        setItemError(res.error || 'تعذر تعديل حالة العنصر.');
        return;
      }

      const updater = (prev: ReferenceItemDTO[]) =>
        prev.map((i) => (i.id === item.id ? res.data : i));

      if (item.type === 'COURT') setCourts(updater);
      else if (item.type === 'PRACTICE_AREA') setPracticeAreas(updater);
      else if (item.type === 'STORAGE_LOCATION') setStorageLocations(updater);

      setItemSuccessMessage(
        res.data.isActive ? 'تم تفعيل العنصر المرجعي بنجاح.' : 'تم تعطيل العنصر المرجعي (لن يتاح للاختيار الجديد).'
      );
      router.refresh();
    } catch (err: unknown) {
      setItemError(err instanceof Error ? err.message : 'حدث خطأ في الاتصال.');
    }
  };

  return (
    <div className="space-y-6 max-w-4xl mx-auto">
      {/* Page Header */}
      <div className="pb-4 border-b border-[#D5DFE3] flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <nav aria-label="مسار التنقل" className="text-xs text-[#4D606A] mb-1">
            <Link href="/" className="hover:text-[#14566B] hover:underline">
              الرئيسية
            </Link>
            <span aria-hidden="true" className="mx-1.5">/</span>
            <span>إعدادات المكتب والمراجع</span>
          </nav>
          <h1 className="text-2xl font-bold text-[#172A35]">
            إعدادات الجداول المرجعية وبيانات المكتب
          </h1>
          <p className="text-xs text-[#4D606A] mt-1">
            إدارة بيانات المكتب، المحاكم والجهات القضائية، دوائر التخصص، وأماكن الحفظ الورقي.
          </p>
        </div>

        <Link
          href="/settings/security"
          className="text-xs font-semibold text-[#14566B] hover:underline flex items-center gap-1"
        >
          <span>🛡️</span>
          <span>الانتقال لإعدادات الأمان والجلسات</span>
        </Link>
      </div>

      {/* Tabs */}
      <div className="border-b border-[#D5DFE3]">
        <nav className="flex space-x-2 sm:space-x-4 space-x-reverse" aria-label="أقسام الإعدادات">
          <button
            type="button"
            data-testid="tab-office-profile"
            onClick={() => setActiveTab('office')}
            className={`py-3 px-3 text-xs sm:text-sm font-bold border-b-2 transition-colors min-h-[44px] ${
              activeTab === 'office'
                ? 'border-[#14566B] text-[#14566B]'
                : 'border-transparent text-[#4D606A] hover:text-[#172A35]'
            }`}
          >
            🏢 بيانات المكتب
          </button>

          <button
            type="button"
            data-testid="tab-courts"
            onClick={() => setActiveTab('courts')}
            className={`py-3 px-3 text-xs sm:text-sm font-bold border-b-2 transition-colors min-h-[44px] ${
              activeTab === 'courts'
                ? 'border-[#14566B] text-[#14566B]'
                : 'border-transparent text-[#4D606A] hover:text-[#172A35]'
            }`}
          >
            ⚖️ المحاكم والجهات ({courts.length})
          </button>

          <button
            type="button"
            data-testid="tab-practice-areas"
            onClick={() => setActiveTab('practice_areas')}
            className={`py-3 px-3 text-xs sm:text-sm font-bold border-b-2 transition-colors min-h-[44px] ${
              activeTab === 'practice_areas'
                ? 'border-[#14566B] text-[#14566B]'
                : 'border-transparent text-[#4D606A] hover:text-[#172A35]'
            }`}
          >
            📂 دوائر التخصص ({practiceAreas.length})
          </button>

          <button
            type="button"
            data-testid="tab-storage-locations"
            onClick={() => setActiveTab('storage_locations')}
            className={`py-3 px-3 text-xs sm:text-sm font-bold border-b-2 transition-colors min-h-[44px] ${
              activeTab === 'storage_locations'
                ? 'border-[#14566B] text-[#14566B]'
                : 'border-transparent text-[#4D606A] hover:text-[#172A35]'
            }`}
          >
            📁 أماكن الحفظ الورقي ({storageLocations.length})
          </button>
        </nav>
      </div>

      {/* Tab 1: Office Profile */}
      {activeTab === 'office' && (
        <div className="space-y-6">
          {officeMessage && (
            <div
              role="status"
              data-testid="office-success-banner"
              className="p-3 bg-emerald-50 border border-emerald-200 text-emerald-900 rounded-[6px] text-xs font-semibold"
            >
              ✓ {officeMessage}
            </div>
          )}

          {officeError && (
            <div
              role="alert"
              data-testid="office-error-banner"
              className="p-3 bg-red-50 border border-red-200 text-[#A4262C] rounded-[6px] text-xs font-semibold"
            >
              ⚠️ {officeError}
            </div>
          )}

          <form onSubmit={handleSaveOffice} className="bg-white rounded-[6px] border border-[#D5DFE3] p-5 sm:p-6 shadow-xs space-y-4">
            <h2 className="text-base font-bold text-[#172A35] pb-2 border-b border-[#E8EEF1]">
              الملف التعريفي للمكتب
            </h2>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-1">
                <label className="block text-xs font-bold text-[#172A35]">
                  اسم المكتب / المنشأة القانونية <span className="text-red-600">*</span>
                </label>
                <input
                  type="text"
                  required
                  value={officeName}
                  onChange={(e) => setOfficeName(e.target.value)}
                  placeholder="مثال: مكتب الأستاذ / محمد عادل المحامي"
                  data-testid="office-name-input"
                  className="w-full px-3 py-2 text-sm border border-[#D5DFE3] rounded-[6px] min-h-[44px]"
                />
              </div>

              <div className="space-y-1">
                <label className="block text-xs font-bold text-[#172A35]">اسم المحامي المسؤول</label>
                <input
                  type="text"
                  value={lawyerName}
                  onChange={(e) => setLawyerName(e.target.value)}
                  placeholder="اسم المحامي بالنقض أو الاستئناف"
                  data-testid="lawyer-name-input"
                  className="w-full px-3 py-2 text-sm border border-[#D5DFE3] rounded-[6px] min-h-[44px]"
                />
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-1">
                <label className="block text-xs font-bold text-[#172A35]">هاتف المكتب</label>
                <input
                  type="text"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  placeholder="010XXXXXXXX"
                  data-testid="office-phone-input"
                  className="w-full px-3 py-2 text-sm border border-[#D5DFE3] rounded-[6px] min-h-[44px] font-mono text-left"
                  dir="ltr"
                />
              </div>

              <div className="space-y-1">
                <label className="block text-xs font-bold text-[#172A35]">البريد الإلكتروني</label>
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="lawyer@example.com"
                  data-testid="office-email-input"
                  className="w-full px-3 py-2 text-sm border border-[#D5DFE3] rounded-[6px] min-h-[44px] font-mono text-left"
                  dir="ltr"
                />
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-1">
                <label className="block text-xs font-bold text-[#172A35]">عنوان المقر</label>
                <input
                  type="text"
                  value={address}
                  onChange={(e) => setAddress(e.target.value)}
                  placeholder="العنوان ومقر المكتب"
                  data-testid="office-address-input"
                  className="w-full px-3 py-2 text-sm border border-[#D5DFE3] rounded-[6px] min-h-[44px]"
                />
              </div>

              <div className="space-y-1">
                <label className="block text-xs font-bold text-[#172A35]">الرقم الضريبي / القيد بالنقابة</label>
                <input
                  type="text"
                  value={taxNumber}
                  onChange={(e) => setTaxNumber(e.target.value)}
                  placeholder="الرقم الضريبي"
                  data-testid="office-tax-input"
                  className="w-full px-3 py-2 text-sm border border-[#D5DFE3] rounded-[6px] min-h-[44px]"
                />
              </div>
            </div>

            {/* Display-only System Defaults */}
            <div className="p-3 bg-slate-50 border border-slate-200 rounded-[6px] text-xs text-[#4D606A] flex flex-wrap gap-4">
              <div>
                <span className="font-semibold text-[#172A35]">العملة المعتمدة: </span>
                <span>الجنيه المصري (ج.م)</span>
              </div>
              <div>
                <span className="font-semibold text-[#172A35]">النطاق الزمني: </span>
                <span>توقيت القاهرة (Africa/Cairo)</span>
              </div>
            </div>

            <div className="flex justify-end pt-2">
              <button
                type="submit"
                disabled={isSavingOffice}
                data-testid="save-office-button"
                className="px-6 py-2.5 bg-[#14566B] hover:bg-[#0F4354] disabled:opacity-50 text-white font-bold text-sm rounded-[6px] min-h-[44px] shadow-xs"
              >
                {isSavingOffice ? 'جارٍ الحفظ...' : 'حفظ بيانات المكتب'}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Tabs 2, 3, 4: Generic Reference Items Section */}
      {activeTab !== 'office' && (
        <div className="space-y-6">
          {itemSuccessMessage && (
            <div
              role="status"
              data-testid="reference-success-banner"
              className="p-3 bg-emerald-50 border border-emerald-200 text-emerald-900 rounded-[6px] text-xs font-semibold"
            >
              ✓ {itemSuccessMessage}
            </div>
          )}

          {itemError && (
            <div
              role="alert"
              data-testid="reference-error-banner"
              className="p-3 bg-red-50 border border-red-200 text-[#A4262C] rounded-[6px] text-xs font-semibold"
            >
              ⚠️ {itemError}
            </div>
          )}

          {/* Add Item Form */}
          <div className="bg-white rounded-[6px] border border-[#D5DFE3] p-5 shadow-xs space-y-4">
            <h3 className="text-sm font-bold text-[#172A35] pb-2 border-b border-[#E8EEF1]">
              {activeTab === 'courts'
                ? '+ إضافة محكمة أو جهة قضائية جديدة'
                : activeTab === 'practice_areas'
                ? '+ إضافة دائرة تخصص قانوني جديدة'
                : '+ إضافة مكان حفظ ورقي جديد'}
            </h3>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div className="space-y-1 sm:col-span-2">
                <label className="block text-xs font-bold text-[#172A35]">
                  الاسم <span className="text-red-600">*</span>
                </label>
                <input
                  type="text"
                  required
                  value={newItemName}
                  onChange={(e) => setNewItemName(e.target.value)}
                  placeholder={
                    activeTab === 'courts'
                      ? 'مثال: محكمة جنوب الجيزة الابتدائية'
                      : activeTab === 'practice_areas'
                      ? 'مثال: تعويضات ومدني كلي'
                      : 'مثال: دولاب أ - رف 3'
                  }
                  data-testid="reference-item-name-input"
                  className="w-full px-3 py-2 text-sm border border-[#D5DFE3] rounded-[6px] min-h-[44px]"
                />
              </div>

              <div className="space-y-1">
                <label className="block text-xs font-bold text-[#172A35]">كود مرجعي (اختياري)</label>
                <input
                  type="text"
                  value={newItemCode}
                  onChange={(e) => setNewItemCode(e.target.value)}
                  placeholder="مثال: CRT-GIZA-01"
                  data-testid="reference-item-code-input"
                  className="w-full px-3 py-2 text-sm border border-[#D5DFE3] rounded-[6px] min-h-[44px]"
                />
              </div>
            </div>

            <div className="flex justify-end pt-1">
              <button
                type="button"
                disabled={isCreatingItem || !newItemName.trim()}
                data-testid="add-reference-item-button"
                onClick={() => {
                  const type: ReferenceItemType =
                    activeTab === 'courts'
                      ? 'COURT'
                      : activeTab === 'practice_areas'
                      ? 'PRACTICE_AREA'
                      : 'STORAGE_LOCATION';
                  handleCreateItem(type);
                }}
                className="px-5 py-2 bg-[#14566B] hover:bg-[#0F4354] disabled:opacity-50 text-white font-bold text-xs rounded-[6px] min-h-[40px]"
              >
                {isCreatingItem ? 'جارٍ الإضافة...' : 'إضافة للقائمة المرجعية'}
              </button>
            </div>
          </div>

          {/* List of Items */}
          <div className="bg-white rounded-[6px] border border-[#D5DFE3] overflow-hidden shadow-xs space-y-3 p-4">
            <div className="flex items-center justify-between pb-2 border-b border-[#E8EEF1]">
              <span className="text-xs font-bold text-[#172A35]">
                العناصر المسجلة (
                {activeTab === 'courts'
                  ? courts.length
                  : activeTab === 'practice_areas'
                  ? practiceAreas.length
                  : storageLocations.length}
                )
              </span>

              <label className="inline-flex items-center gap-1.5 text-xs text-[#4D606A] cursor-pointer">
                <input
                  type="checkbox"
                  checked={filterActiveOnly}
                  onChange={(e) => setFilterActiveOnly(e.target.checked)}
                  data-testid="filter-active-only-checkbox"
                  className="w-4 h-4 text-[#14566B] rounded border-[#D5DFE3]"
                />
                <span>عرض النشطة فقط</span>
              </label>
            </div>

            {(() => {
              const currentList =
                activeTab === 'courts'
                  ? courts
                  : activeTab === 'practice_areas'
                  ? practiceAreas
                  : storageLocations;

              const filteredList = filterActiveOnly
                ? currentList.filter((item) => item.isActive)
                : currentList;

              if (filteredList.length === 0) {
                return (
                  <p className="text-xs text-[#4D606A] italic py-4 text-center">
                    لا توجد عناصر مسجلة في هذا القسم حالياً.
                  </p>
                );
              }

              return (
                <div className="divide-y divide-[#E8EEF1]">
                  {filteredList.map((item) => (
                    <div
                      key={item.id}
                      data-testid={`reference-item-row-${item.id}`}
                      className="py-3 flex items-center justify-between gap-3 text-xs"
                    >
                      <div className="space-y-0.5">
                        <div className="flex items-center gap-2">
                          <span className="font-bold text-sm text-[#172A35]">{item.name}</span>
                          {item.code && (
                            <bdi dir="ltr" className="text-[10px] font-mono text-[#4D606A] bg-slate-100 px-1.5 py-0.5 rounded border border-slate-200">
                              {item.code}
                            </bdi>
                          )}
                          <span
                            className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                              item.isActive
                                ? 'bg-emerald-50 text-emerald-800 border border-emerald-200'
                                : 'bg-gray-100 text-gray-600 border border-gray-300'
                            }`}
                          >
                            {item.isActive ? 'نشط' : 'معطل'}
                          </span>
                        </div>
                      </div>

                      <div>
                        <button
                          type="button"
                          data-testid={`toggle-active-${item.id}`}
                          onClick={() => handleToggleActive(item)}
                          className={`px-3 py-1.5 text-xs font-semibold rounded-[6px] border min-h-[36px] transition-colors ${
                            item.isActive
                              ? 'text-red-700 bg-red-50 hover:bg-red-100 border-red-200'
                              : 'text-emerald-700 bg-emerald-50 hover:bg-emerald-100 border-emerald-200'
                          }`}
                        >
                          {item.isActive ? 'تعطيل العنصر' : 'إعادة التفعيل'}
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              );
            })()}
          </div>
        </div>
      )}
    </div>
  );
}


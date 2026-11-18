import React from 'react';
import { redirect } from 'next/navigation';
import { requireActor } from '@/modules/identity/require-actor';
import { AuthenticationError, AuthorizationError } from '@/modules/identity/types';
import {
  getOfficeSettings,
  listReferenceItems,
} from '@/modules/settings/reference-service';
import { ReferenceSettingsClient } from '@/components/settings/reference-settings-client';

export const metadata = {
  title: 'إعدادات الجداول المرجعية وبيانات المكتب — LawOffice OS',
};

export default async function ReferenceSettingsPage() {
  let actor;
  try {
    actor = await requireActor();
  } catch (error) {
    if (error instanceof AuthenticationError) {
      if (error.code === 'MFA_REQUIRED') {
        redirect('/verify?returnTo=' + encodeURIComponent('/settings/reference'));
      }
      redirect('/login?error=session_expired&returnTo=' + encodeURIComponent('/settings/reference'));
    }
    if (error instanceof AuthorizationError) {
      return (
        <div className="max-w-4xl mx-auto p-6 bg-white rounded border border-red-200 text-[#A4262C]">
          <h1 className="text-xl font-bold mb-2">وصول مرفوض</h1>
          <p>لا تمتلك الصلاحيات الكافية للوصول إلى إعدادات المراجع.</p>
        </div>
      );
    }
    throw error;
  }

  const [officeSettings, courts, practiceAreas, storageLocations] = await Promise.all([
    getOfficeSettings(actor),
    listReferenceItems('COURT', true, actor).catch(() => []),
    listReferenceItems('PRACTICE_AREA', true, actor).catch(() => []),
    listReferenceItems('STORAGE_LOCATION', true, actor).catch(() => []),
  ]);

  return (
    <div className="py-2">
      <ReferenceSettingsClient
        initialOfficeSettings={officeSettings}
        initialCourts={courts}
        initialPracticeAreas={practiceAreas}
        initialStorageLocations={storageLocations}
      />
    </div>
  );
}


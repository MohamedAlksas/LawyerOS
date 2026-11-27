import React from 'react';
import { requireActor } from '@/modules/identity/require-actor';
import { redirectOnAuthError } from '@/modules/identity/auth-redirect';
import { AuthenticationError, AuthorizationError } from '@/modules/identity/types';
import { authorize } from '@/modules/identity/authorize';
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
    actor = await requireActor({ requiredPermission: 'READ_CLIENT_DATA' });
  } catch (error) {
    if (error instanceof AuthenticationError) {
      await redirectOnAuthError(error, '/settings/reference');
    }
    if (error instanceof AuthorizationError) {
      return (
        <div role="alert" className="max-w-4xl mx-auto p-6 bg-white rounded border border-red-200 text-[#A4262C]">
          <h1 className="text-xl font-bold mb-2">وصول مرفوض</h1>
          <p>لا تمتلك الصلاحيات الكافية للوصول إلى إعدادات المراجع.</p>
        </div>
      );
    }
    throw error;
  }

  const officeSettings = await getOfficeSettings(actor);

  let courts: Awaited<ReturnType<typeof listReferenceItems>> = [];
  let practiceAreas: Awaited<ReturnType<typeof listReferenceItems>> = [];
  let storageLocations: Awaited<ReturnType<typeof listReferenceItems>> = [];
  let initialLookupError = false;

  try {
    const [cRes, paRes, slRes] = await Promise.all([
      listReferenceItems('COURT', true, actor),
      listReferenceItems('PRACTICE_AREA', true, actor),
      listReferenceItems('STORAGE_LOCATION', true, actor),
    ]);
    courts = cRes;
    practiceAreas = paRes;
    storageLocations = slRes;
  } catch {
    initialLookupError = true;
  }

  const canWriteSettings = authorize(actor, 'WRITE_CLIENT_DATA') || actor.role === 'OWNER';

  return (
    <div className="py-2">
      <ReferenceSettingsClient
        key={actor.id}
        ownerId={actor.id}
        canWriteSettings={canWriteSettings}
        initialOfficeSettings={officeSettings}
        initialCourts={courts}
        initialPracticeAreas={practiceAreas}
        initialStorageLocations={storageLocations}
        initialLookupError={initialLookupError}
      />
    </div>
  );
}


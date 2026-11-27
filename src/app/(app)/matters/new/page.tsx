import React from 'react';
import { requireActor } from '@/modules/identity/require-actor';
import { redirectOnAuthError } from '@/modules/identity/auth-redirect';
import { AuthenticationError, AuthorizationError } from '@/modules/identity/types';
import { listReferenceItems } from '@/modules/settings/reference-service';
import { searchParties } from '@/modules/parties/service';
import { MatterForm } from '@/components/matters/matter-form';

export const metadata = {
  title: 'فتح ملف قضية جديد — LawOffice OS',
};

export default async function NewMatterPage() {
  let actor;
  try {
    actor = await requireActor({ requiredPermission: 'WRITE_CLIENT_DATA' });
  } catch (error) {
    if (error instanceof AuthenticationError) {
      await redirectOnAuthError(error, '/matters/new');
    }
    if (error instanceof AuthorizationError) {
      return (
        <div role="alert" className="max-w-4xl mx-auto p-6 bg-white rounded border border-red-200 text-[#A4262C]">
          <h1 className="text-xl font-bold mb-2">وصول مرفوض</h1>
          <p>لا تمتلك الصلاحيات الكافية لفتح ملف قضية جديد.</p>
        </div>
      );
    }
    throw error;
  }

  let practiceAreas: Awaited<ReturnType<typeof listReferenceItems>> = [];
  let storageLocations: Awaited<ReturnType<typeof listReferenceItems>> = [];
  let partiesResult: Awaited<ReturnType<typeof searchParties>> = { parties: [], totalCount: 0, page: 1, totalPages: 0 };
  let lookupError = false;

  try {
    const [paRes, slRes, pRes] = await Promise.all([
      listReferenceItems('PRACTICE_AREA', false, actor),
      listReferenceItems('STORAGE_LOCATION', false, actor),
      searchParties(actor, { limit: 50 }),
    ]);
    practiceAreas = paRes;
    storageLocations = slRes;
    partiesResult = pRes;
  } catch {
    lookupError = true;
  }

  return (
    <div className="py-2">
      <MatterForm
        key={actor.id}
        ownerId={actor.id}
        practiceAreas={practiceAreas.map((pa) => ({ id: pa.id, name: pa.name, isActive: pa.isActive }))}
        storageLocations={storageLocations.map((sl) => ({ id: sl.id, name: sl.name, isActive: sl.isActive }))}
        parties={partiesResult.parties.map((p) => ({
          id: p.id,
          name: p.name,
          primaryPhone: p.primaryPhone,
        }))}
        lookupError={lookupError}
      />
    </div>
  );
}


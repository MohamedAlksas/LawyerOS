import React from 'react';
import { requireActor } from '@/modules/identity/require-actor';
import { redirectOnAuthError } from '@/modules/identity/auth-redirect';
import { AuthenticationError, AuthorizationError } from '@/modules/identity/types';
import { getTodayOverview, ProductivityValidationError } from '@/modules/productivity';
import type { TodayOverviewDTO } from '@/modules/productivity/productivity-types';
import { TodayView } from '@/components/productivity/today-view';

export const metadata = {
  title: 'اليوم — LawOffice OS',
};

export default async function TodayPage() {
  let actor;
  try {
    actor = await requireActor({ requiredPermission: 'READ_CLIENT_DATA' });
  } catch (error) {
    if (error instanceof AuthenticationError) {
      await redirectOnAuthError(error, '/today');
    }
    if (error instanceof AuthorizationError) {
      return (
        <div role="alert" className="max-w-4xl mx-auto p-6 bg-white rounded-[6px] border border-red-200 text-[#A4262C]">
          <h1 className="text-xl font-bold mb-2">وصول مرفوض</h1>
          <p>لا تمتلك الصلاحيات الكافية لاستعراض صفحة اليوم.</p>
        </div>
      );
    }
    throw error;
  }

  let initialOverview: TodayOverviewDTO | null = null;
  let initialError: string | undefined;
  try {
    initialOverview = await getTodayOverview(actor);
  } catch (error) {
    if (error instanceof ProductivityValidationError) {
      initialError = error.message;
    } else {
      console.error('[Today page] Failed to load today overview');
      initialError = 'تعذر تحميل ملخص اليوم من الخادم.';
    }
  }

  return (
    <TodayView
      key={actor.sessionId}
      initialOverview={initialOverview}
      initialError={initialError}
    />
  );
}

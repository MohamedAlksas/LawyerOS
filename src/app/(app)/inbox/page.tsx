import React from 'react';
import { requireActor } from '@/modules/identity/require-actor';
import { redirectOnAuthError } from '@/modules/identity/auth-redirect';
import { AuthenticationError, AuthorizationError } from '@/modules/identity/types';
import { listInbox, ReminderValidationError } from '@/modules/reminders';
import type { InboxOverviewDTO } from '@/modules/reminders/reminder-types';
import { InboxView } from '@/components/reminders/inbox-view';

export const metadata = {
  title: 'صندوق التنبيهات — LawOffice OS',
};

export default async function InboxPage() {
  let actor;
  try {
    actor = await requireActor({ requiredPermission: 'READ_CLIENT_DATA' });
  } catch (error) {
    if (error instanceof AuthenticationError) {
      await redirectOnAuthError(error, '/inbox');
    }
    if (error instanceof AuthorizationError) {
      return (
        <div role="alert" className="max-w-4xl mx-auto p-6 bg-white rounded-[6px] border border-red-200 text-[#A4262C]">
          <h1 className="text-xl font-bold mb-2">وصول مرفوض</h1>
          <p>لا تمتلك الصلاحيات الكافية لاستعراض صندوق التنبيهات.</p>
        </div>
      );
    }
    throw error;
  }

  let initialOverview: InboxOverviewDTO | null = null;
  let initialError: string | undefined;
  try {
    initialOverview = await listInbox(actor);
  } catch (error) {
    if (error instanceof ReminderValidationError) {
      initialError = error.message;
    } else {
      console.error('[Inbox page] Failed to load inbox');
      initialError = 'تعذر تحميل صندوق التنبيهات من الخادم.';
    }
  }

  return (
    <InboxView
      key={actor.id}
      initialOverview={initialOverview}
      initialError={initialError}
    />
  );
}

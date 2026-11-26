import React from 'react';
import { requireActor } from '@/modules/identity/require-actor';
import { redirectOnAuthError } from '@/modules/identity/auth-redirect';
import { AuthenticationError, AuthorizationError } from '@/modules/identity/types';
import { listAgenda, ProductivityValidationError } from '@/modules/productivity';
import type { AgendaDTO, AgendaItemType, AgendaView as AgendaViewMode } from '@/modules/productivity/productivity-types';
import { getCairoTodayDateString } from '@/lib/cairo-date';
import { readParam } from '@/lib/search-params';
import { AgendaView } from '@/components/productivity/agenda-view';

export const metadata = {
  title: 'الأجندة — LawOffice OS',
};

interface AgendaPageProps {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}

const VALID_VIEWS: readonly AgendaViewMode[] = ['list', 'day', 'week', 'month', 'today'];
const VALID_TYPES: readonly AgendaItemType[] = ['HEARING', 'DEADLINE', 'TASK'];

export default async function AgendaPage({ searchParams }: AgendaPageProps) {
  const params = searchParams ? await searchParams : {};
  let actor;
  try {
    actor = await requireActor({ requiredPermission: 'READ_CLIENT_DATA' });
  } catch (error) {
    if (error instanceof AuthenticationError) {
      await redirectOnAuthError(error, '/agenda');
    }
    if (error instanceof AuthorizationError) {
      return (
        <div role="alert" className="max-w-4xl mx-auto p-6 bg-white rounded-[6px] border border-red-200 text-[#A4262C]">
          <h1 className="text-xl font-bold mb-2">وصول مرفوض</h1>
          <p>لا تمتلك الصلاحيات الكافية لاستعراض الأجندة.</p>
        </div>
      );
    }
    throw error;
  }

  const rawView = readParam(params, 'view');
  const view: AgendaViewMode =
    rawView && (VALID_VIEWS as readonly string[]).includes(rawView)
      ? (rawView as AgendaViewMode)
      : 'list';
  const anchorDate = readParam(params, 'anchorDate') || getCairoTodayDateString();
  const courtId = readParam(params, 'courtId') || '';
  const rawType = readParam(params, 'type') || readParam(params, 'types') || '';
  const itemType: 'ALL' | AgendaItemType =
    rawType && (VALID_TYPES as readonly string[]).includes(rawType)
      ? (rawType as AgendaItemType)
      : 'ALL';
  const includeCompleted = readParam(params, 'includeCompleted') === 'true';

  let initialAgenda: AgendaDTO | null = null;
  let initialError: string | undefined;
  try {
    initialAgenda = await listAgenda(actor, {
      view,
      anchorDate,
      ...(courtId ? { courtId } : {}),
      ...(itemType !== 'ALL' ? { types: [itemType] } : {}),
      includeCompleted,
    });
  } catch (error) {
    if (error instanceof ProductivityValidationError) {
      initialError = error.message;
    } else {
      console.error('[Agenda page] Failed to load agenda');
      initialError = 'تعذر تحميل بيانات الأجندة من الخادم.';
    }
  }

  return (
    <AgendaView
      key={actor.sessionId}
      initialAgenda={initialAgenda}
      initialError={initialError}
      initialGeneratedAtIso={new Date().toISOString()}
      initialFilters={{
        view,
        anchorDate,
        courtId,
        itemType,
        includeCompleted,
      }}
    />
  );
}

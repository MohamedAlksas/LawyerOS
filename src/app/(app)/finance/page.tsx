import React from 'react';
import { requireActor } from '@/modules/identity/require-actor';
import { redirectOnAuthError } from '@/modules/identity/auth-redirect';
import { authorize } from '@/modules/identity/authorize';
import { AuthenticationError, AuthorizationError } from '@/modules/identity/types';
import { listFinanceOverview } from '@/modules/finance/finance-service';
import { readParam } from '@/lib/search-params';
import { FinanceWorkspace } from '@/components/finance/finance-workspace';

export const metadata = {
  title: 'الحسابات والأتعاب — LawOffice OS',
};

const UUID_REGEX = /^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i;

interface FinancePageProps {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}

export default async function FinancePage({ searchParams }: FinancePageProps) {
  const params = searchParams ? await searchParams : {};
  let actor;
  try {
    actor = await requireActor({ requiredPermission: 'READ_FINANCE' });
  } catch (error) {
    if (error instanceof AuthenticationError) {
      await redirectOnAuthError(error, '/finance');
    }
    if (error instanceof AuthorizationError) {
      return (
        <div
          role="alert"
          data-testid="finance-forbidden"
          className="max-w-4xl mx-auto p-6 bg-white rounded-[6px] border border-red-200 text-[#A4262C]"
        >
          <h1 className="text-xl font-bold mb-2">وصول مرفوض</h1>
          <p>لا تمتلك الصلاحيات الكافية لاستعراض الحسابات المالية للمكتب.</p>
        </div>
      );
    }
    throw error;
  }

  const rawMatterId = readParam(params, 'matterId')?.trim();
  const matterId = rawMatterId && UUID_REGEX.test(rawMatterId) ? rawMatterId : undefined;
  const overview = await listFinanceOverview(actor, { matterId });
  const canWriteFinance = authorize(actor, 'WRITE_FINANCE');

  return (
    <div className="space-y-6" dir="rtl" lang="ar-EG">
      <div className="flex flex-wrap items-center justify-between gap-2 pb-3 border-b border-[#D5DFE3]">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold text-[#172A35]">
            الحسابات المالية — الأتعاب والتحصيل
          </h1>
          <p className="text-xs sm:text-sm text-[#4D606A] mt-1">
            اتفاقات الأتعاب، القيود المتوازنة بالجنيه المصري، إيصالات القبض الإدارية، وكشوف حساب الموكلين.
          </p>
        </div>
      </div>

      <FinanceWorkspace
        initialOverview={overview}
        canWriteFinance={canWriteFinance}
        headingLevel="h2"
      />
    </div>
  );
}

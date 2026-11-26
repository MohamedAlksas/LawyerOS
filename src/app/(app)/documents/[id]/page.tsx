import React from 'react';
import Link from 'next/link';
import { requireActor } from '@/modules/identity/require-actor';
import { redirectOnAuthError } from '@/modules/identity/auth-redirect';
import { AuthenticationError, AuthorizationError } from '@/modules/identity/types';
import { getDocument } from '@/modules/documents/document-service';
import {
  DocumentNotFoundError,
  DocumentValidationError,
} from '@/modules/documents/document-types';
import { EmptyStateContainer } from '@/components/presentation-state';
import { DocumentDetailView } from '@/components/documents/document-detail-view';

export const metadata = {
  title: 'تفاصيل المستند — LawOffice OS',
};

interface DocumentDetailPageProps {
  params: Promise<{ id: string }>;
}

export default async function DocumentDetailPage({ params }: DocumentDetailPageProps) {
  const { id } = await params;
  let actor;
  try {
    actor = await requireActor({ requiredPermission: 'READ_CLIENT_DATA' });
  } catch (error) {
    if (error instanceof AuthenticationError) {
      await redirectOnAuthError(error, `/documents/${id}`);
    }
    if (error instanceof AuthorizationError) {
      return (
        <div
          data-testid="document-detail-forbidden"
          className="max-w-4xl mx-auto p-6 bg-white rounded-[6px] border border-red-200 text-[#A4262C]"
        >
          <h1 className="text-xl font-bold mb-2">وصول مرفوض</h1>
          <p>لا تمتلك الصلاحيات الكافية لاستعراض هذا المستند.</p>
        </div>
      );
    }
    throw error;
  }

  let document;
  try {
    document = await getDocument(actor, id);
  } catch (error) {
    if (error instanceof DocumentNotFoundError || error instanceof DocumentValidationError) {
      return (
        <div className="max-w-3xl mx-auto py-8">
          <EmptyStateContainer
            testId="document-not-found"
            title="المستند غير موجود"
            description="لم يتم العثور على المستند المطلوب. قد يكون المعرف غير صحيح أو تم نقله."
            action={
              <Link
                href="/documents"
                className="inline-flex items-center justify-center px-5 py-2.5 bg-[#14566B] hover:bg-[#0F4354] text-white text-sm font-medium rounded-[6px] min-h-[44px] focus:outline-none focus:ring-2 focus:ring-[#14566B] focus:ring-offset-2"
              >
                العودة إلى أرشيف المستندات
              </Link>
            }
          />
        </div>
      );
    }
    throw error;
  }

  return (
    <div className="max-w-5xl mx-auto">
      <DocumentDetailView key={`${actor.id}:${document.id}`} document={document} />
    </div>
  );
}

'use client';

import React, { useEffect } from 'react';
import { ErrorContainer } from '@/components/presentation-state';

export default function ErrorBoundary({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // Log error to console without sensitive information
    if (process.env.NODE_ENV !== 'production') {
      console.error('Unhandled route error caught by boundary:', error);
    }
  }, [error]);

  return (
    <div className="max-w-4xl mx-auto py-12">
      <ErrorContainer
        title="حدث خطأ غير متوقع"
        message="تعذر إتمام العملية المطلوبة. يرجى المحاولة مجدداً."
        onRetry={reset}
      />
    </div>
  );
}

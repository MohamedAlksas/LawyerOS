'use client';

import React, { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { LoadingIndicator, ErrorContainer } from './presentation-state';

export interface DashboardStatusProps {
  actorEmail: string;
}

export function DashboardStatus({ actorEmail }: DashboardStatusProps) {
  const [status, setStatus] = useState<'loading' | 'error' | 'settled'>('loading');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const executeStatusCheck = useCallback(async () => {
    setStatus('loading');
    setErrorMessage(null);
    try {
      const res = await fetch('/api/health/ready', {
        headers: { 'Cache-Control': 'no-cache' },
      });
      if (!res.ok) {
        throw new Error('فشل الاتصال بخدمة جاهزية النظام');
      }
      setStatus('settled');
    } catch {
      setStatus('error');
      setErrorMessage('تعذر تحميل بيانات لوحة المتابعة. يرجى التحقق من الاتصال والمحاولة مجدداً.');
    }
  }, []);

  useEffect(() => {
    let isSubscribed = true;
    fetch('/api/health/ready', {
      headers: { 'Cache-Control': 'no-cache' },
    })
      .then((res) => {
        if (!res.ok) throw new Error('فشل الاتصال بخدمة جاهزية النظام');
        if (isSubscribed) {
          setStatus('settled');
        }
      })
      .catch(() => {
        if (isSubscribed) {
          setStatus('error');
          setErrorMessage('تعذر تحميل بيانات لوحة المتابعة. يرجى التحقق من الاتصال والمحاولة مجدداً.');
        }
      });

    return () => {
      isSubscribed = false;
    };
  }, []);

  if (status === 'loading') {
    return (
      <div className="bg-white rounded-[6px] border border-[#D5DFE3] p-12 text-center shadow-xs">
        <LoadingIndicator label="جارٍ التحميل..." />
      </div>
    );
  }

  if (status === 'error') {
    return (
      <ErrorContainer
        title="تعذر تحميل بيانات لوحة المتابعة"
        message={errorMessage || 'تعذر تحميل بيانات لوحة المتابعة. يرجى التحقق من الاتصال والمحاولة مجدداً.'}
        onRetry={executeStatusCheck}
      />
    );
  }

  return (
    <div
      data-testid="dashboard-empty-state"
      className="bg-white rounded-[6px] border border-[#D5DFE3] p-8 sm:p-12 text-center shadow-xs space-y-6"
    >
      <div
        className="w-16 h-16 mx-auto rounded-full bg-[#F4F6F7] border border-[#D5DFE3] flex items-center justify-center text-3xl select-none"
        aria-hidden="true"
      >
        📂
      </div>

      <div className="max-w-md mx-auto space-y-2">
        <h2 className="text-lg font-bold text-[#172A35]">
          لا توجد قضايا أو جلسات مسجلة حالياً
        </h2>
        <p className="text-sm text-[#4D606A] leading-relaxed">
          نظام إدارة المكتب في مرحلته التشغيلية الأولى (<bdi dir="ltr">M1</bdi>). سيتم تفعيل وحدات إدارة ملفات القضايا والجلسات ومواعيد المحاكم في المراحل التالية وفق خطة العمل المعتمدة.
        </p>
      </div>

      {/* Primary Action */}
      <div className="pt-2">
        <Link
          href="/settings/security"
          data-testid="empty-state-security-action"
          className="inline-flex items-center justify-center gap-2 px-5 py-2.5 bg-[#14566B] hover:bg-[#0F4354] text-white font-medium text-sm rounded-[6px] shadow-xs transition-colors focus:outline-none focus:ring-2 focus:ring-[#14566B] focus:ring-offset-2 min-h-[44px] min-w-[44px]"
        >
          <span aria-hidden="true">🛡️</span>
          <span>مراجعة إعدادات الأمان</span>
        </Link>
      </div>

      {/* Real Session Identity Note */}
      <div className="pt-4 border-t border-[#D5DFE3] text-xs text-[#4D606A] flex flex-wrap items-center justify-center gap-1 sm:gap-2">
        <span>الحساب التشغيلي:</span>
        <bdi dir="ltr" className="font-mono text-[#172A35] font-medium">
          {actorEmail}
        </bdi>
        <span className="text-slate-300">•</span>
        <span className="text-[#176449] font-medium">النظام متصل وجاهز</span>
      </div>
    </div>
  );
}

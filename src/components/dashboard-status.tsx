'use client';

import React, { useState, useEffect, useCallback, useRef } from 'react';
import Link from 'next/link';
import { LoadingIndicator, ErrorContainer } from './presentation-state';
import {
  IconCalendar,
  IconDeadline,
  IconDocument,
  IconFolder,
  IconShield,
  IconToday,
} from './stitch-icons';

export interface DashboardStatusProps {
  actorEmail: string;
}

async function probeHealthReady(signal: AbortSignal) {
  const res = await fetch('/api/health/ready', {
    headers: { 'Cache-Control': 'no-cache' },
    signal,
  });
  if (!res.ok) {
    throw new Error('فشل الاتصال بخدمة جاهزية النظام');
  }
}

export function DashboardStatus({ actorEmail }: DashboardStatusProps) {
  const [status, setStatus] = useState<'loading' | 'error' | 'settled'>('loading');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const executeStatusCheck = useCallback(async () => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    setStatus('loading');
    setErrorMessage(null);
    try {
      await probeHealthReady(controller.signal);
      if (!controller.signal.aborted && abortRef.current === controller) {
        setStatus('settled');
      }
    } catch {
      if (!controller.signal.aborted && abortRef.current === controller) {
        setStatus('error');
        setErrorMessage('تعذر تحميل بيانات لوحة المتابعة. يرجى التحقق من الاتصال والمحاولة مجدداً.');
      }
    } finally {
      if (abortRef.current === controller) {
        abortRef.current = null;
      }
    }
  }, []);

  useEffect(() => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    probeHealthReady(controller.signal)
      .then(() => {
        if (!controller.signal.aborted && abortRef.current === controller) {
          setStatus('settled');
        }
      })
      .catch(() => {
        if (!controller.signal.aborted && abortRef.current === controller) {
          setStatus('error');
          setErrorMessage('تعذر تحميل بيانات لوحة المتابعة. يرجى التحقق من الاتصال والمحاولة مجدداً.');
        }
      })
      .finally(() => {
        if (abortRef.current === controller) {
          abortRef.current = null;
        }
      });

    return () => {
      controller.abort();
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
        className="w-16 h-16 mx-auto rounded-[6px] bg-[#E9F2F5] border border-[#C2D9E2] flex items-center justify-center text-[#14566B] select-none"
        aria-hidden="true"
      >
        <IconFolder className="w-8 h-8" />
      </div>

      <div className="max-w-md mx-auto space-y-2">
        <h2 className="text-lg font-bold text-[#172A35]">
          مساحة عمل المكتب
        </h2>
        <p className="text-sm text-[#4D606A] leading-relaxed">
          استخدم قائمة التنقل للوصول إلى أقسام النظام المتاحة لحسابك.
        </p>
      </div>

      <div className="pt-2 flex flex-wrap items-center justify-center gap-2.5">
        <Link
          href="/today"
          className="inline-flex items-center justify-center gap-2 px-5 py-2.5 bg-[#14566B] hover:bg-[#0F4354] text-white font-medium text-sm rounded-[6px] shadow-xs transition-colors focus:outline-none focus:ring-2 focus:ring-[#14566B] focus:ring-offset-2 min-h-[44px]"
        >
          <IconToday className="w-4 h-4" />
          <span>أجندة اليوم</span>
        </Link>
        <Link
          href="/agenda"
          className="inline-flex items-center justify-center gap-2 px-4 py-2.5 bg-white hover:bg-[#F4F6F7] text-[#172A35] border border-[#D5DFE3] font-medium text-sm rounded-[6px] shadow-xs transition-colors focus:outline-none focus:ring-2 focus:ring-[#14566B] focus:ring-offset-2 min-h-[44px]"
        >
          <IconCalendar className="w-4 h-4 text-[#14566B]" />
          <span>جدول الجلسات والأجندة</span>
        </Link>
        <Link
          href="/matters"
          className="inline-flex items-center justify-center gap-2 px-4 py-2.5 bg-white hover:bg-[#F4F6F7] text-[#172A35] border border-[#D5DFE3] font-medium text-sm rounded-[6px] shadow-xs transition-colors focus:outline-none focus:ring-2 focus:ring-[#14566B] focus:ring-offset-2 min-h-[44px]"
        >
          <IconFolder className="w-4 h-4 text-[#14566B]" />
          <span>ملفات القضايا</span>
        </Link>
        <Link
          href="/deadlines"
          className="inline-flex items-center justify-center gap-2 px-4 py-2.5 bg-white hover:bg-[#F4F6F7] text-[#172A35] border border-[#D5DFE3] font-medium text-sm rounded-[6px] shadow-xs transition-colors focus:outline-none focus:ring-2 focus:ring-[#14566B] focus:ring-offset-2 min-h-[44px]"
        >
          <IconDeadline className="w-4 h-4 text-[#14566B]" />
          <span>المواعيد القانونية</span>
        </Link>
        <Link
          href="/documents"
          data-testid="dashboard-documents-link"
          className="inline-flex items-center justify-center gap-2 px-4 py-2.5 bg-white hover:bg-[#F4F6F7] text-[#172A35] border border-[#D5DFE3] font-medium text-sm rounded-[6px] shadow-xs transition-colors focus:outline-none focus:ring-2 focus:ring-[#14566B] focus:ring-offset-2 min-h-[44px]"
        >
          <IconDocument className="w-4 h-4 text-[#14566B]" />
          <span>أرشيف المستندات</span>
        </Link>
        <Link
          href="/settings/security"
          data-testid="empty-state-security-action"
          className="inline-flex items-center justify-center gap-2 px-4 py-2.5 bg-white hover:bg-[#F4F6F7] text-[#172A35] border border-[#D5DFE3] font-medium text-sm rounded-[6px] shadow-xs transition-colors focus:outline-none focus:ring-2 focus:ring-[#14566B] focus:ring-offset-2 min-h-[44px] min-w-[44px]"
        >
          <IconShield className="w-4 h-4 text-[#14566B]" />
          <span>مراجعة إعدادات الأمان</span>
        </Link>
      </div>

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

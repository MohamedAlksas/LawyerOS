'use client';

import React from 'react';

export interface LoadingIndicatorProps {
  label?: string;
  className?: string;
}

export function LoadingIndicator({
  label = 'جارٍ التحميل...',
  className = '',
}: LoadingIndicatorProps) {
  return (
    <div
      role="status"
      aria-busy="true"
      aria-label={label}
      data-testid="loading-indicator"
      className={`flex flex-col items-center justify-center p-8 text-center space-y-3 ${className}`}
    >
      <div
        className="w-8 h-8 rounded-full border-3 border-[#D5DFE3] border-t-[#14566B] animate-spin motion-reduce:animate-none"
        aria-hidden="true"
      />
      <span className="text-sm text-[#4D606A] font-medium">{label}</span>
    </div>
  );
}

export interface ErrorContainerProps {
  title?: string;
  message?: string;
  onRetry?: () => void;
  isRetrying?: boolean;
  className?: string;
}

export function ErrorContainer({
  title = 'تعذر تحميل البيانات',
  message = 'حدث خطأ أثناء الاتصال بالخادم. يرجى التحقق من اتصال الإنترنت والمحاولة مجدداً.',
  onRetry,
  isRetrying = false,
  className = '',
}: ErrorContainerProps) {
  return (
    <div
      role="alert"
      data-testid="error-container"
      className={`bg-white rounded-[6px] border border-red-200 p-6 sm:p-8 text-center space-y-4 shadow-xs ${className}`}
    >
      <div
        className="w-12 h-12 mx-auto rounded-full bg-red-50 border border-red-200 flex items-center justify-center text-xl text-[#A4262C] select-none"
        aria-hidden="true"
      >
        ⚠️
      </div>
      <div className="space-y-1">
        <h3 className="text-base font-bold text-[#172A35]">{title}</h3>
        <p className="text-sm text-[#4D606A] max-w-md mx-auto leading-relaxed">{message}</p>
      </div>
      {onRetry && (
        <div className="pt-2">
          <button
            type="button"
            data-testid="error-retry-button"
            onClick={onRetry}
            disabled={isRetrying}
            className="inline-flex items-center justify-center gap-2 px-5 py-2.5 bg-[#14566B] hover:bg-[#0F4354] disabled:opacity-50 text-white font-medium text-sm rounded-[6px] shadow-xs transition-colors focus:outline-none focus:ring-2 focus:ring-[#14566B] focus:ring-offset-2 min-h-[44px] min-w-[44px]"
          >
            {isRetrying ? 'جارٍ إعادة المحاولة...' : 'إعادة المحاولة'}
          </button>
        </div>
      )}
    </div>
  );
}

export interface EmptyStateContainerProps {
  icon?: string;
  title: string;
  description: string;
  action?: React.ReactNode;
  children?: React.ReactNode;
  className?: string;
  testId?: string;
}

export function EmptyStateContainer({
  icon = '📂',
  title,
  description,
  action,
  children,
  className = '',
  testId = 'empty-state-container',
}: EmptyStateContainerProps) {
  return (
    <div
      data-testid={testId}
      className={`bg-white rounded-[6px] border border-[#D5DFE3] p-8 sm:p-12 text-center shadow-xs space-y-6 ${className}`}
    >
      <div
        className="w-16 h-16 mx-auto rounded-full bg-[#F4F6F7] border border-[#D5DFE3] flex items-center justify-center text-3xl select-none"
        aria-hidden="true"
      >
        {icon}
      </div>
      <div className="max-w-md mx-auto space-y-2">
        <h2 className="text-lg font-bold text-[#172A35]">{title}</h2>
        <p className="text-sm text-[#4D606A] leading-relaxed">{description}</p>
      </div>
      {action && <div className="pt-2">{action}</div>}
      {children}
    </div>
  );
}

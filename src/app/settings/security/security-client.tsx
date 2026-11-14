'use client';

import React, { useState, useRef, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { signOut } from '@/lib/auth-client';
import {
  revokeSessionAction,
  revokeOtherSessionsAction,
  regenerateBackupCodesAction,
} from './actions';

interface SessionItem {
  id: string;
  ipAddress: string;
  userAgent: string;
  createdAt: string;
  updatedAt: string;
  isCurrent: boolean;
}

interface SecurityClientProps {
  initialSessions: SessionItem[];
  actor: {
    name: string;
    email: string;
    role: string;
    twoFactorVerified: boolean;
  };
}

function formatCairoDate(isoStr: string) {
  try {
    const d = new Date(isoStr);
    return new Intl.DateTimeFormat('ar-EG', {
      timeZone: 'Africa/Cairo',
      dateStyle: 'full',
      timeStyle: 'medium',
    }).format(d);
  } catch {
    return isoStr;
  }
}

export default function SecurityClient({ initialSessions, actor }: SecurityClientProps) {
  const router = useRouter();
  const [sessions, setSessions] = useState<SessionItem[]>(initialSessions);
  const [passwordForCodes, setPasswordForCodes] = useState('');
  const [showRegenModal, setShowRegenModal] = useState(false);
  const [newCodes, setNewCodes] = useState<string[] | null>(null);
  const [regenError, setRegenError] = useState<string | null>(null);
  const [actionSuccess, setActionSuccess] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);

  // Focus and accessibility refs
  const triggerButtonRef = useRef<HTMLButtonElement | null>(null);
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const passwordInputRef = useRef<HTMLInputElement | null>(null);
  const dismissCodesButtonRef = useRef<HTMLButtonElement | null>(null);

  const closeRegenModal = useCallback(() => {
    setShowRegenModal(false);
    setPasswordForCodes('');
    setNewCodes(null);
    setRegenError(null);
    // Restore focus to the trigger button
    setTimeout(() => {
      triggerButtonRef.current?.focus();
    }, 0);
  }, []);

  // Trap focus and handle Escape inside recovery modal
  useEffect(() => {
    if (!showRegenModal) return;

    // Focus initial interactive element
    const timer = setTimeout(() => {
      if (newCodes) {
        dismissCodesButtonRef.current?.focus();
      } else {
        passwordInputRef.current?.focus();
      }
    }, 50);

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        closeRegenModal();
        return;
      }

      if (e.key === 'Tab') {
        if (!dialogRef.current) return;
        const focusable = dialogRef.current.querySelectorAll<HTMLElement>(
          'button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])'
        );
        if (focusable.length === 0) return;

        const firstElement = focusable[0];
        const lastElement = focusable[focusable.length - 1];

        if (e.shiftKey) {
          if (document.activeElement === firstElement) {
            e.preventDefault();
            lastElement.focus();
          }
        } else {
          if (document.activeElement === lastElement) {
            e.preventDefault();
            firstElement.focus();
          }
        }
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => {
      clearTimeout(timer);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [showRegenModal, newCodes, closeRegenModal]);

  const handleLogoutCurrentSession = async () => {
    if (!confirm('هل ترغب في تسجيل الخروج من هذا الجهاز؟')) {
      return;
    }

    setIsProcessing(true);
    setActionError(null);
    setActionSuccess(null);

    try {
      const res = await signOut();
      if (res?.error) {
        setActionError(
          'فشل تسجيل الخروج من الخادم. جلستك الحالية ما زالت نشطة، يرجى التحقق من الاتصال والمحاولة مجدداً.'
        );
        setIsProcessing(false);
        return;
      }

      // Confirmed logout
      router.push('/login');
    } catch {
      setActionError(
        'تعذر الاتصال بالخادم لإتمام تسجيل الخروج. جلستك الحالية ما زالت نشطة، يرجى المحاولة مجدداً.'
      );
      setIsProcessing(false);
    }
  };

  const handleRevoke = async (sessionId: string) => {
    if (!confirm('هل أنت متأكد من رغبتك في إنهاء هذه الجلسة؟ سيتم تسجيل خروج الجهاز فوراً.')) {
      return;
    }

    setIsProcessing(true);
    setActionError(null);
    setActionSuccess(null);
    try {
      const res = await revokeSessionAction(sessionId);
      if (!res.success) {
        setActionError(res.message || 'فشل إنهاء الجلسة.');
        return;
      }
      setSessions((prev) => prev.filter((s) => s.id !== sessionId));
      setActionSuccess('تم إنهاء الجلسة بنجاح.');
      router.refresh();
    } catch {
      setActionError('تعذر الاتصال بالخادم لإنهاء الجلسة. يرجى المحاولة لاحقاً.');
    } finally {
      setIsProcessing(false);
    }
  };

  const handleRevokeOthers = async () => {
    if (!confirm('هل أنت متأكد من رغبتك في إنهاء جميع الجلسات الأخرى؟')) {
      return;
    }

    setIsProcessing(true);
    setActionError(null);
    setActionSuccess(null);
    try {
      const res = await revokeOtherSessionsAction();
      if (!res.success) {
        setActionError(res.message || 'فشل إنهاء الجلسات.');
        return;
      }
      setSessions((prev) => prev.filter((s) => s.isCurrent));
      setActionSuccess(`تم إنهاء ${res.count} جلسة أخرى بنجاح.`);
      router.refresh();
    } catch {
      setActionError('تعذر الاتصال بالخادم لإنهاء الجلسات. يرجى المحاولة لاحقاً.');
    } finally {
      setIsProcessing(false);
    }
  };

  const handleRegenerateCodes = async (e: React.FormEvent) => {
    e.preventDefault();
    setRegenError(null);
    setIsProcessing(true);

    try {
      const res = await regenerateBackupCodesAction(passwordForCodes);
      if (!res.success) {
        setRegenError(res.message || 'فشل إعادة توليد الرموز.');
        return;
      }
      setNewCodes(res.backupCodes);
      setPasswordForCodes('');
    } catch {
      setRegenError('حدث خطأ في الاتصال بالخادم. يرجى المحاولة مجدداً.');
    } finally {
      setIsProcessing(false);
    }
  };

  return (
    <>
      <div
        className="space-y-6"
        aria-hidden={showRegenModal ? true : undefined}
        inert={showRegenModal ? true : undefined}
      >
        {!actor.twoFactorVerified && (
          <div
            role="alert"
            className="p-4 bg-amber-50 border border-amber-200 text-[#7A4100] rounded-lg flex flex-wrap items-center justify-between gap-3 shadow-sm"
          >
            <div>
              <div className="font-bold text-sm">تنبيه أمني: إعداد المصادقة الثنائية غير مكتمل</div>
              <div className="text-xs text-[#7A4100]/80">
                حسابك في وضع الإعداد المعلق. يلزم إدخال رمز التحقق من تطبيق المصادقة لإتمام تأكيد الحيازة.
              </div>
            </div>
            <button
              type="button"
              onClick={() => router.push('/verify')}
              className="px-3.5 py-1.5 text-xs font-semibold text-white bg-[#7A4100] hover:bg-[#623400] rounded transition-colors focus:outline-none focus:ring-2 focus:ring-[#7A4100]"
            >
              استكمال التحقق الآن
            </button>
          </div>
        )}

        {actionSuccess && (
          <div
            role="status"
            aria-live="polite"
            className="p-3 bg-green-50 border border-green-200 text-[#176449] text-sm rounded flex items-center justify-between"
          >
            <span>{actionSuccess}</span>
            <button
              type="button"
              onClick={() => setActionSuccess(null)}
              className="text-xs text-[#176449] hover:underline focus:outline-none focus:ring-1 focus:ring-[#176449] px-1"
            >
              إغلاق
            </button>
          </div>
        )}

        {actionError && (
          <div
            role="alert"
            aria-live="assertive"
            className="p-3 bg-red-50 border border-red-200 text-[#A4262C] text-sm rounded flex items-center justify-between"
          >
            <div className="flex items-center gap-2">
              <span aria-hidden="true">⚠️</span>
              <span>{actionError}</span>
            </div>
            <button
              type="button"
              onClick={() => setActionError(null)}
              className="text-xs text-[#A4262C] hover:underline focus:outline-none focus:ring-1 focus:ring-[#A4262C] px-1"
            >
              إغلاق
            </button>
          </div>
        )}

        {/* MFA Management Section */}
        <section className="bg-white rounded-lg border border-[#D5DFE3] p-5 sm:p-6 shadow-sm">
          <h2 className="text-lg font-bold text-[#172A35] mb-2">المصادقة الثنائية (MFA / 2FA)</h2>
          <p className="text-sm text-[#4D606A] mb-4">
            حساب المالك محمي بواسطة تطبيق المصادقة الثنائية (TOTP). يلزم إدخال رمز التحقق عند كل عملية تسجيل دخول جديدة.
          </p>

          <div className="flex flex-wrap items-center justify-between gap-4 p-4 bg-[#F4F6F7] rounded border border-[#D5DFE3]">
            <div className="flex items-center gap-3">
              <span
                className={`inline-flex items-center justify-center w-8 h-8 rounded-full ${
                  actor.twoFactorVerified
                    ? 'bg-green-100 text-[#176449]'
                    : 'bg-amber-100 text-[#7A4100]'
                }`}
              >
                {actor.twoFactorVerified ? '✓' : '!'}
              </span>
              <div>
                <div className="text-sm font-semibold text-[#172A35]">
                  {actor.twoFactorVerified
                    ? `حالة الحماية: مفعلة ومحمية (${actor.name})`
                    : `حالة الحماية: قيد الإعداد (${actor.name})`}
                </div>
                <div className="text-xs text-[#4D606A]">
                  الحساب: <bdi dir="ltr">{actor.email}</bdi> • تطبيق المصادقة (TOTP) + رموز الاسترداد
                </div>
              </div>
            </div>

            <button
              ref={triggerButtonRef}
              type="button"
              onClick={() => {
                setActionError(null);
                setActionSuccess(null);
                setNewCodes(null);
                setRegenError(null);
                setPasswordForCodes('');
                setShowRegenModal(true);
              }}
              className="px-4 py-2 text-sm font-medium text-[#14566B] bg-white border border-[#14566B] hover:bg-slate-50 rounded transition-colors focus:outline-none focus:ring-2 focus:ring-[#14566B]"
            >
              إعادة توليد رموز الاسترداد
            </button>
          </div>
        </section>

        {/* Active Sessions Section */}
        <section className="bg-white rounded-lg border border-[#D5DFE3] p-5 sm:p-6 shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
            <div>
              <h2 className="text-lg font-bold text-[#172A35]">الأجهزة والجلسات النشطة</h2>
              <p className="text-sm text-[#4D606A]">
                قائمة بجميع الأجهزة والمتصفحات التي تمتلك جلسة دخول سارية لحسابك.
              </p>
            </div>

            {sessions.filter((s) => !s.isCurrent).length > 0 && (
              <button
                type="button"
                disabled={isProcessing}
                onClick={handleRevokeOthers}
                className="px-3.5 py-1.5 text-sm font-medium text-[#A4262C] bg-red-50 hover:bg-red-100 border border-red-200 rounded transition-colors focus:outline-none focus:ring-2 focus:ring-[#A4262C]"
              >
                إنهاء جميع الجلسات الأخرى
              </button>
            )}
          </div>

          <div className="divide-y divide-[#D5DFE3] border border-[#D5DFE3] rounded overflow-hidden">
            {sessions.map((session) => (
              <div
                key={session.id}
                className={`p-4 flex flex-wrap items-center justify-between gap-4 ${
                  session.isCurrent ? 'bg-blue-50/40' : 'bg-white'
                }`}
              >
                <div className="space-y-1">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-semibold text-[#172A35]">
                      {session.isCurrent ? 'الجلسة الحالية' : 'جلسة متصلة'}
                    </span>
                    {session.isCurrent && (
                      <span className="text-xs px-2 py-0.5 bg-[#14566B] text-white rounded font-medium">
                        هذا الجهاز
                      </span>
                    )}
                  </div>

                  <div className="text-xs text-[#4D606A] flex flex-wrap gap-x-4 gap-y-1">
                    <span>
                      المتصفح: <bdi dir="ltr">{session.userAgent}</bdi>
                    </span>
                    <span>
                      عنوان IP: <bdi dir="ltr">{session.ipAddress}</bdi>
                    </span>
                    <span>
                      آخر نشاط (توقيت القاهرة): {formatCairoDate(session.updatedAt)}
                    </span>
                  </div>
                </div>

                {session.isCurrent ? (
                  <button
                    type="button"
                    disabled={isProcessing}
                    onClick={handleLogoutCurrentSession}
                    className="px-3 py-1.5 text-xs font-medium text-[#A4262C] hover:bg-red-50 border border-[#D5DFE3] hover:border-red-300 rounded transition-colors focus:outline-none focus:ring-2 focus:ring-[#A4262C]"
                  >
                    تسجيل الخروج
                  </button>
                ) : (
                  <button
                    type="button"
                    disabled={isProcessing}
                    onClick={() => handleRevoke(session.id)}
                    className="px-3 py-1.5 text-xs font-medium text-[#A4262C] hover:bg-red-50 border border-[#D5DFE3] hover:border-red-300 rounded transition-colors focus:outline-none focus:ring-2 focus:ring-[#A4262C]"
                  >
                    إنهاء الجلسة
                  </button>
                )}
              </div>
            ))}

            {sessions.length === 0 && (
              <div className="p-4 text-center text-sm text-[#4D606A]">لا توجد جلسات نشطة حالياً.</div>
            )}
          </div>
        </section>
      </div>

      {/* Accessible Dialog for Regenerating Backup Codes */}
      {showRegenModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 overflow-y-auto"
          role="presentation"
          onClick={(e) => {
            if (e.target === e.currentTarget) {
              closeRegenModal();
            }
          }}
        >
          <div
            ref={dialogRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby="regen-dialog-title"
            aria-describedby="regen-dialog-desc"
            className="relative w-full max-w-md my-auto bg-white rounded-lg shadow-xl border border-[#D5DFE3] p-5 sm:p-6 space-y-4 max-h-[90vh] overflow-y-auto"
          >
            <div className="flex items-center justify-between pb-2 border-b border-[#D5DFE3]">
              <h3 id="regen-dialog-title" className="text-lg font-bold text-[#172A35]">
                إعادة توليد رموز الاسترداد
              </h3>
              <button
                type="button"
                onClick={closeRegenModal}
                aria-label="إغلاق النافذة"
                className="text-gray-400 hover:text-gray-600 rounded p-1 focus:outline-none focus:ring-2 focus:ring-[#14566B]"
              >
                ✕
              </button>
            </div>

            {regenError && (
              <div
                role="alert"
                aria-live="assertive"
                className="p-3 bg-red-50 border border-red-200 text-[#A4262C] text-sm rounded flex items-center gap-2"
              >
                <span aria-hidden="true">⚠️</span>
                <span>{regenError}</span>
              </div>
            )}

            {!newCodes ? (
              <form onSubmit={handleRegenerateCodes} className="space-y-4">
                <p id="regen-dialog-desc" className="text-sm text-[#4D606A]">
                  لأسباب أمنية، يلزم تأكيد كلمة المرور الحالية قبل إلغاء الرموز السابقة وإصدار رموز جديدة.
                </p>

                <div>
                  <label htmlFor="currentPassword" className="block text-sm font-medium text-[#172A35] mb-1">
                    كلمة المرور الحالية
                  </label>
                  <input
                    ref={passwordInputRef}
                    id="currentPassword"
                    type="password"
                    required
                    value={passwordForCodes}
                    onChange={(e) => setPasswordForCodes(e.target.value)}
                    className="w-full px-3 py-2 border border-[#D5DFE3] rounded text-[#172A35] focus:outline-none focus:ring-2 focus:ring-[#14566B]"
                  />
                </div>

                <div className="flex gap-2 justify-end pt-2">
                  <button
                    type="button"
                    onClick={closeRegenModal}
                    className="px-4 py-2 text-sm text-[#4D606A] hover:bg-slate-100 rounded focus:outline-none focus:ring-2 focus:ring-slate-400"
                  >
                    إلغاء
                  </button>
                  <button
                    type="submit"
                    disabled={isProcessing}
                    className="px-4 py-2 text-sm text-white bg-[#14566B] hover:bg-[#0f4354] disabled:opacity-50 font-medium rounded focus:outline-none focus:ring-2 focus:ring-[#14566B]"
                  >
                    {isProcessing ? 'جارٍ التحقق...' : 'توليد رموز جديدة'}
                  </button>
                </div>
              </form>
            ) : (
              <div className="space-y-4">
                <p id="regen-dialog-desc" className="text-sm text-[#176449] font-medium">
                  تم إلغاء الرموز القديمة وتوليد 10 رموز جديدة صالحة للاستخدام مرة واحدة:
                </p>

                <div
                  className="p-3 bg-slate-50 border border-[#D5DFE3] rounded font-mono text-xs grid grid-cols-2 gap-2 text-center"
                  dir="ltr"
                >
                  {newCodes.map((code, idx) => (
                    <div
                      key={idx}
                      className="p-1.5 bg-white border border-slate-200 rounded tracking-wider select-all font-semibold"
                    >
                      {code}
                    </div>
                  ))}
                </div>

                <div className="p-3 bg-red-50 border border-red-200 rounded text-xs text-[#A4262C] space-y-1">
                  <div className="font-bold">⚠️ تنبيه هام جداً:</div>
                  <p>
                    لن تظهر هذه الرموز مرة أخرى بعد إغلاق هذه النافذة! اطبعها أو احفظها في مكان آمن ومنفصل خارج هذا الجهاز.
                  </p>
                </div>

                <div className="flex justify-end pt-2">
                  <button
                    ref={dismissCodesButtonRef}
                    type="button"
                    onClick={closeRegenModal}
                    className="px-4 py-2 text-sm text-white bg-[#14566B] hover:bg-[#0f4354] rounded font-medium focus:outline-none focus:ring-2 focus:ring-[#14566B]"
                  >
                    تم الحفظ والإغلاق
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
}
'use client';

import React, { useState } from 'react';
import { useRouter } from 'next/navigation';
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
  const [actionMessage, setActionMessage] = useState<string | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);

  const handleRevoke = async (sessionId: string) => {
    if (!confirm('هل أنت متأكد من رغبتك في إنهاء هذه الجلسة؟ سيتم تسجيل خروج الجهاز فوراً.')) {
      return;
    }

    setIsProcessing(true);
    setActionMessage(null);
    try {
      await revokeSessionAction(sessionId);
      setSessions((prev) => prev.filter((s) => s.id !== sessionId));
      setActionMessage('تم إنهاء الجلسة بنجاح.');
      router.refresh();
    } catch (err: unknown) {
      setActionMessage(err instanceof Error ? err.message : 'فشل إنهاء الجلسة.');
    } finally {
      setIsProcessing(false);
    }
  };

  const handleRevokeOthers = async () => {
    if (!confirm('هل أنت متأكد من رغبتك في إنهاء جميع الجلسات الأخرى؟')) {
      return;
    }

    setIsProcessing(true);
    setActionMessage(null);
    try {
      const res = await revokeOtherSessionsAction();
      setSessions((prev) => prev.filter((s) => s.isCurrent));
      setActionMessage(`تم إنهاء ${res.count} جلسة أخرى بنجاح.`);
      router.refresh();
    } catch (err: unknown) {
      setActionMessage(err instanceof Error ? err.message : 'فشل إنهاء الجلسات.');
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
      setNewCodes(res.backupCodes);
      setPasswordForCodes('');
    } catch (err: unknown) {
      setRegenError(err instanceof Error ? err.message : 'فشل إعادة توليد الرموز.');
    } finally {
      setIsProcessing(false);
    }
  };

  return (
    <div className="space-y-6">
      {actionMessage && (
        <div
          role="status"
          className="p-3 bg-green-50 border border-green-200 text-[#176449] text-sm rounded flex items-center justify-between"
        >
          <span>{actionMessage}</span>
          <button
            type="button"
            onClick={() => setActionMessage(null)}
            className="text-xs text-[#176449] hover:underline"
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
            <span className="inline-flex items-center justify-center w-8 h-8 rounded-full bg-green-100 text-[#176449]">
              ✓
            </span>
            <div>
              <div className="text-sm font-semibold text-[#172A35]">حالة الحماية: مفعلة ومحمية ({actor.name})</div>
              <div className="text-xs text-[#4D606A]">
                الحساب: <bdi dir="ltr">{actor.email}</bdi> • تطبيق المصادقة (TOTP) + رموز الاسترداد
              </div>
            </div>
          </div>

          <button
            type="button"
            onClick={() => {
              setShowRegenModal(true);
              setNewCodes(null);
              setRegenError(null);
              setPasswordForCodes('');
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

              {!session.isCurrent && (
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

      {/* Modal for Regenerating Backup Codes */}
      {showRegenModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40">
          <div className="w-full max-w-md bg-white rounded-lg shadow-lg border border-[#D5DFE3] p-6 space-y-4">
            <h3 className="text-lg font-bold text-[#172A35]">إعادة توليد رموز الاسترداد</h3>

            {regenError && (
              <div className="p-3 bg-red-50 border border-red-200 text-[#A4262C] text-sm rounded">
                {regenError}
              </div>
            )}

            {!newCodes ? (
              <form onSubmit={handleRegenerateCodes} className="space-y-4">
                <p className="text-sm text-[#4D606A]">
                  لأسباب أمنية، يلزم تأكيد كلمة المرور الحالية قبل إلغاء الرموز السابقة وإصدار رموز جديدة.
                </p>

                <div>
                  <label htmlFor="currentPassword" className="block text-sm font-medium text-[#172A35] mb-1">
                    كلمة المرور الحالية
                  </label>
                  <input
                    id="currentPassword"
                    type="password"
                    required
                    autoFocus
                    value={passwordForCodes}
                    onChange={(e) => setPasswordForCodes(e.target.value)}
                    className="w-full px-3 py-2 border border-[#D5DFE3] rounded text-[#172A35] focus:outline-none focus:ring-2 focus:ring-[#14566B]"
                  />
                </div>

                <div className="flex gap-2 justify-end pt-2">
                  <button
                    type="button"
                    onClick={() => setShowRegenModal(false)}
                    className="px-4 py-2 text-sm text-[#4D606A] hover:bg-slate-100 rounded"
                  >
                    إلغاء
                  </button>
                  <button
                    type="submit"
                    disabled={isProcessing}
                    className="px-4 py-2 text-sm text-white bg-[#14566B] hover:bg-[#0f4354] disabled:opacity-50 font-medium rounded"
                  >
                    {isProcessing ? 'جارٍ التحقق...' : 'توليد رموز جديدة'}
                  </button>
                </div>
              </form>
            ) : (
              <div className="space-y-4">
                <p className="text-sm text-[#176449] font-medium">
                  تم إلغاء الرموز القديمة وتوليد 10 رموز جديدة صالحة للاستخدام مرة واحدة:
                </p>

                <div className="p-3 bg-slate-50 border border-[#D5DFE3] rounded font-mono text-xs space-y-1 text-center" dir="ltr">
                  {newCodes.map((code, idx) => (
                    <div key={idx} className="tracking-wider">
                      {code}
                    </div>
                  ))}
                </div>

                <p className="text-xs text-[#A4262C]">
                  تنبيه: لن تظهر هذه الرموز مرة أخرى! اطبعها أو احفظها في مكان آمن ومنفصل خارج الجهاز.
                </p>

                <div className="flex justify-end pt-2">
                  <button
                    type="button"
                    onClick={() => setShowRegenModal(false)}
                    className="px-4 py-2 text-sm text-white bg-[#14566B] hover:bg-[#0f4354] rounded font-medium"
                  >
                    تم الحفظ والإغلاق
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
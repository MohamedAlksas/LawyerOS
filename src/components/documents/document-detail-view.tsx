'use client';

import React from 'react';
import Link from 'next/link';
import type { DocumentDTO } from '@/modules/documents/document-types';
import { formatCairoDateArabic } from '@/lib/cairo-date';
import {
  IconDocument,
  IconDownload,
  IconWarning,
} from '@/components/stitch-icons';
import {
  DOCUMENT_TYPE_LABELS_AR,
  DOWNLOAD_DEVICE_RETENTION_NOTICE_AR,
  ORIGINAL_PRESENCE_LABELS,
  SCAN_STATUS_BADGE_CLASSES,
  SENSITIVITY_BADGE_CLASSES,
  SENSITIVITY_LABELS,
  UNSCANNED_POLICY_NOTICE_AR,
  formatCairoInstantArabic,
  formatFileSizeArabic,
} from './document-ui-helpers';

export interface DocumentDetailViewProps {
  document: DocumentDTO;
}

export function DocumentDetailView({ document }: DocumentDetailViewProps) {
  const version = document.currentVersion;
  const isImage =
    version?.detectedMime === 'image/jpeg' || version?.detectedMime === 'image/png';
  const isPdf = version?.detectedMime === 'application/pdf';
  const scanBadgeClass = version
    ? SCAN_STATUS_BADGE_CLASSES[version.scanStatus]
    : SCAN_STATUS_BADGE_CLASSES.PENDING;
  const scanStatusLabel = version?.scanStatusLabel ?? UNSCANNED_POLICY_NOTICE_AR;
  const downloadNotice = document.downloadDeviceNotice || DOWNLOAD_DEVICE_RETENTION_NOTICE_AR;

  const inlineUrl = version
    ? `/api/documents/${document.id}/content?disposition=inline&versionId=${version.id}`
    : null;
  const downloadUrl = version
    ? `/api/documents/${document.id}/content?disposition=attachment&versionId=${version.id}`
    : null;

  return (
    <div className="space-y-6 min-w-0 max-w-full" data-testid="document-detail-view">
      {/* Top Breadcrumb & Title Header */}
      <div className="bg-white rounded-[6px] border border-[#D5DFE3] p-4 sm:p-6 shadow-xs space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <Link
            href="/documents"
            data-testid="back-to-documents-link"
            className="inline-flex items-center justify-center px-3.5 py-2 bg-[#F4F6F7] hover:bg-[#E8EEF1] text-[#172A35] border border-[#D5DFE3] text-sm font-medium rounded-[6px] min-h-[44px] focus:outline-none focus:ring-2 focus:ring-[#14566B]"
          >
            العودة إلى أرشيف المستندات
          </Link>

          <div className="flex flex-wrap items-center gap-2">
            <span className="inline-flex items-center px-2.5 py-1 rounded-[4px] border text-xs font-semibold bg-[#E9F2F5] text-[#14566B] border-[#C2D9E2]">
              {DOCUMENT_TYPE_LABELS_AR[document.documentType]}
            </span>
            <span
              className={`inline-flex items-center px-2.5 py-1 rounded-[4px] border text-xs font-semibold ${SENSITIVITY_BADGE_CLASSES[document.sensitivity]}`}
            >
              {SENSITIVITY_LABELS[document.sensitivity]}
            </span>
            <span
              data-testid="detail-scan-status-badge"
              className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-[4px] border text-xs font-bold ${scanBadgeClass}`}
            >
              <IconWarning className="w-4 h-4 shrink-0" />
              <span>{scanStatusLabel}</span>
            </span>
          </div>
        </div>

        <div className="flex items-start gap-3 min-w-0">
          <IconDocument className="w-7 h-7 text-[#14566B] shrink-0 mt-1" />
          <div className="min-w-0 space-y-1">
            <h1
              data-testid="document-detail-title"
              className="text-xl sm:text-2xl font-bold text-[#172A35] break-words [overflow-wrap:anywhere]"
            >
              {document.title}
            </h1>
            {document.description && (
              <p className="text-sm text-[#4D606A] leading-relaxed break-words">
                {document.description}
              </p>
            )}
          </div>
        </div>

        {version?.scanStatus === 'NOT_SCANNED_POLICY' && (
          <div
            data-testid="detail-adr0003-notice"
            className="rounded-[6px] bg-[#FFF7E6] border border-[#E0B46A] p-3.5 text-sm text-[#7A4A00] flex items-start gap-2.5"
          >
            <IconWarning className="w-5 h-5 shrink-0 mt-0.5" />
            <div className="space-y-1">
              <p className="font-bold">{scanStatusLabel}</p>
              <p className="text-xs sm:text-sm leading-relaxed">
                تم اعتماد هذا المستند وفق سياسة المرحلة الأولى المؤجلة (ADR 0003) بعد التحقق من صيغة الملف وتوقيعه الرقمي وبصمته وحجمه، دون إجراء فحص فيروسات تلقائي.
              </p>
            </div>
          </div>
        )}
      </div>

      {/* Metadata Card */}
      <section
        aria-labelledby="document-metadata-heading"
        className="bg-white rounded-[6px] border border-[#D5DFE3] p-4 sm:p-6 shadow-xs space-y-4"
      >
        <h2 id="document-metadata-heading" className="text-lg font-bold text-[#172A35]">
          البيانات القانونية والتقنية للمستند
        </h2>

        <dl className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 text-sm min-w-0">
          <div className="min-w-0 p-3 rounded-[6px] bg-[#F8FAFB] border border-[#E5ECEE] space-y-1">
            <dt className="text-xs font-semibold text-[#4D606A]">الارتباط</dt>
            <dd className="font-medium text-[#172A35] break-words">
              {document.matterId ? (
                <Link href={`/matters/${document.matterId}`} className="text-[#14566B] hover:underline">
                  <bdi dir="ltr">{document.matterFileCode}</bdi> — {document.matterTitle}
                </Link>
              ) : document.partyId ? (
                <Link href={`/parties/${document.partyId}`} className="text-[#14566B] hover:underline">
                  {document.partyName}
                </Link>
              ) : (
                '—'
              )}
              {document.proceedingLabel && (
                <span className="block text-xs text-[#4D606A] mt-1">
                  القيد: {document.proceedingLabel}
                </span>
              )}
              {document.hearingDate && (
                <span className="block text-xs text-[#4D606A] mt-0.5">
                  الجلسة: {formatCairoDateArabic(document.hearingDate)}
                </span>
              )}
            </dd>
          </div>

          <div className="min-w-0 p-3 rounded-[6px] bg-[#F8FAFB] border border-[#E5ECEE] space-y-1">
            <dt className="text-xs font-semibold text-[#4D606A]">تاريخ المستند</dt>
            <dd className="font-medium text-[#172A35]">
              {document.documentDate ? formatCairoDateArabic(document.documentDate) : 'غير محدد'}
            </dd>
          </div>

          <div className="min-w-0 p-3 rounded-[6px] bg-[#F8FAFB] border border-[#E5ECEE] space-y-1">
            <dt className="text-xs font-semibold text-[#4D606A]">الأصل الورقي ومكانه</dt>
            <dd className="font-medium text-[#172A35] break-words">
              <span>{ORIGINAL_PRESENCE_LABELS[document.originalPresent]}</span>
              {document.originalLocation && (
                <span className="block text-xs text-[#4D606A] mt-1">
                  المكان: {document.originalLocation}
                </span>
              )}
            </dd>
          </div>

          {version && (
            <>
              <div className="min-w-0 p-3 rounded-[6px] bg-[#F8FAFB] border border-[#E5ECEE] space-y-1">
                <dt className="text-xs font-semibold text-[#4D606A]">اسم الملف والصيغة المعتمدة</dt>
                <dd className="font-medium text-[#172A35] break-all">
                  <bdi dir="ltr">{version.originalFilename}</bdi>
                  <span className="block text-xs text-[#4D606A] mt-1">
                    <bdi dir="ltr">{version.detectedMime ?? version.declaredMime ?? '—'}</bdi>
                    {' • '}
                    {formatFileSizeArabic(version.sizeBytes)}
                  </span>
                </dd>
              </div>

              <div className="min-w-0 p-3 rounded-[6px] bg-[#F8FAFB] border border-[#E5ECEE] space-y-1">
                <dt className="text-xs font-semibold text-[#4D606A]">سياسة التحقق والفحص</dt>
                <dd className="font-medium text-[#172A35]">
                  <span>{scanStatusLabel}</span>
                  {version.scanPolicyCode && (
                    <span className="block text-xs text-[#4D606A] mt-1">
                      <bdi dir="ltr">
                        {version.scanPolicyCode} ({version.scanPolicyVersion ?? '—'})
                      </bdi>
                    </span>
                  )}
                </dd>
              </div>

              <div className="min-w-0 p-3 rounded-[6px] bg-[#F8FAFB] border border-[#E5ECEE] space-y-1">
                <dt className="text-xs font-semibold text-[#4D606A]">تاريخ الرفع والاعتماد</dt>
                <dd className="font-medium text-[#172A35]">
                  {formatCairoInstantArabic(version.createdAt)}
                </dd>
              </div>

              <div className="sm:col-span-2 lg:col-span-3 min-w-0 p-3 rounded-[6px] bg-[#F8FAFB] border border-[#E5ECEE] space-y-1">
                <dt className="text-xs font-semibold text-[#4D606A]">
                  البصمة الرقمية للسلامة (SHA-256)
                </dt>
                <dd
                  data-testid="detail-sha256"
                  className="font-mono text-xs text-[#172A35] break-all select-all"
                >
                  <bdi dir="ltr">{version.sha256 ?? '—'}</bdi>
                </dd>
              </div>
            </>
          )}
        </dl>
      </section>

      {/* Authorized Preview & Download Section */}
      <section
        aria-labelledby="document-preview-heading"
        className="bg-white rounded-[6px] border border-[#D5DFE3] p-4 sm:p-6 shadow-xs space-y-4"
      >
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <h2 id="document-preview-heading" className="text-lg font-bold text-[#172A35]">
            المعاينة والتحميل المصرح به
          </h2>

          {version?.isReady && downloadUrl && (
            <a
              href={downloadUrl}
              download
              data-testid="document-download-link"
              className="inline-flex items-center justify-center gap-2 px-5 py-2.5 bg-[#14566B] hover:bg-[#0F4354] text-white text-sm font-semibold rounded-[6px] shadow-xs min-h-[44px] focus:outline-none focus:ring-2 focus:ring-[#14566B] focus:ring-offset-2"
            >
              <IconDownload className="w-4 h-4" />
              <span>تحميل النسخة الأصلية</span>
            </a>
          )}
        </div>

        <div
          role="note"
          data-testid="device-retention-notice"
          className="rounded-[6px] bg-[#F8FAFB] border border-[#D5DFE3] p-3 text-xs sm:text-sm text-[#4D606A]"
        >
          {downloadNotice}
        </div>

        {!version || !version.isReady || !inlineUrl ? (
          <div
            role="alert"
            className="p-4 rounded-[6px] bg-red-50 border border-red-200 text-sm text-[#A4262C]"
          >
            المستند غير جاهز للمعاينة أو التحميل حالياً.
          </div>
        ) : isImage ? (
          <div className="bg-[#F8FAFB] border border-[#D5DFE3] rounded-[6px] p-3 sm:p-4 flex justify-center">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={inlineUrl}
              alt={`معاينة المستند: ${document.title}`}
              data-testid="document-preview-image"
              className="max-w-full max-h-[540px] object-contain rounded-[4px]"
            />
          </div>
        ) : isPdf ? (
          <div className="space-y-2">
            <iframe
              src={inlineUrl}
              title={`معاينة مستند PDF: ${document.title}`}
              data-testid="document-preview-iframe"
              className="w-full h-[540px] border border-[#D5DFE3] rounded-[6px] bg-white"
            />
            <p className="text-xs text-[#4D606A]">
              إذا تعذّر عرض ملف PDF داخل المتصفح، يمكنك استخدام زر «تحميل النسخة الأصلية» أعلاه بعد التحقق من الجلسة.
            </p>
          </div>
        ) : (
          <p className="text-sm text-[#4D606A]">
            المعاينة المباشرة غير متاحة لهذه الصيغة، ويمكنك تنزيل النسخة الأصلية عبر الزر أعلاه.
          </p>
        )}
      </section>
    </div>
  );
}

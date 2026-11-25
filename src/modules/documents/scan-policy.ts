import {
  ADR_0003_POLICY_CODE,
  ADR_0003_POLICY_VERSION,
  DocumentScanPolicyUnavailableError,
  UNSCANNED_POLICY_DETAIL_AR,
} from './document-types';

export type ScanPolicyMode = 'INITIAL_DEFERRED' | 'REQUIRED';

export interface ScanPolicyEvaluation {
  scanStatus: 'NOT_SCANNED_POLICY';
  policyCode: string;
  policyVersion: string;
  checkedAt: Date;
  detailArabic: string;
}

/**
 * Evaluates ADR 0003 document scan policy.
 * - INITIAL_DEFERRED: explicitly records NOT_SCANNED_POLICY with ADR 0003 policy/version (never CLEAN).
 * - REQUIRED: fails closed when no active scanner integration exists, never falling back silently.
 */
export function evaluateDocumentScanPolicy(
  modeOverride?: ScanPolicyMode | string,
  now: Date = new Date()
): ScanPolicyEvaluation {
  const rawMode = (
    modeOverride ??
    process.env.DOCUMENT_SCAN_POLICY_MODE ??
    'INITIAL_DEFERRED'
  ).trim();

  if (rawMode === 'INITIAL_DEFERRED') {
    return {
      scanStatus: 'NOT_SCANNED_POLICY',
      policyCode: ADR_0003_POLICY_CODE,
      policyVersion: ADR_0003_POLICY_VERSION,
      checkedAt: now,
      detailArabic: UNSCANNED_POLICY_DETAIL_AR,
    };
  }

  if (rawMode === 'REQUIRED') {
    throw new DocumentScanPolicyUnavailableError(
      'فحص البرمجيات الخبيثة مفعل ومطلوب وفق السياسة الحالية، ولكن خدمة الفحص غير متاحة. تم رفض اعتماد المستند.'
    );
  }

  throw new DocumentScanPolicyUnavailableError(
    'سياسة فحص المستندات المكونة غير معروفة؛ تم إيقاف اعتماد المستند احترازياً.'
  );
}

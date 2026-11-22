export function hearingDraftOwner(actorId: string, command: 'cancel' | 'reschedule', hearingId: string) {
  return `${actorId}:${command}-hearing${hearingId}`;
}

export function isUncertainHearingOutcome(code?: string): boolean {
  return !code || ['INTERNAL_ERROR', 'UNAUTHENTICATED', 'MFA_REQUIRED', 'SESSION_EXPIRED', 'SESSION_INACTIVE', 'IDEMPOTENCY_CONCURRENT_CONFLICT'].includes(code);
}

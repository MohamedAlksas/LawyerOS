import crypto from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  confirmDeadlineSchema,
  createDeadlineSchema,
  updateDeadlineDraftSchema,
} from '@/modules/scheduling/deadline-types';

describe('T12 Unit Tests: Deadline Document Link Schemas', () => {
  it('validates sourceDocumentId (UUID, null, or omitted; rejects non-UUID) across create/update/confirm schemas', () => {
    const matterId = crypto.randomUUID();
    const deadlineId = crypto.randomUUID();
    const validDocId = crypto.randomUUID();

    // createDeadlineSchema
    expect(
      createDeadlineSchema.safeParse({
        matterId,
        title: 'ميعاد طعن بالاستئناف',
        sourceDocumentId: validDocId,
        idempotencyKey: 'dl-create-doc-1',
      }).success
    ).toBe(true);
    expect(
      createDeadlineSchema.safeParse({
        matterId,
        title: 'ميعاد بدون مستند',
        sourceDocumentId: null,
        idempotencyKey: 'dl-create-doc-2',
      }).success
    ).toBe(true);
    expect(
      createDeadlineSchema.safeParse({
        matterId,
        title: 'ميعاد بحقل مرفوض',
        sourceDocumentId: 'not-a-uuid',
        idempotencyKey: 'dl-create-doc-3',
      }).success
    ).toBe(false);

    // updateDeadlineDraftSchema
    expect(
      updateDeadlineDraftSchema.safeParse({
        deadlineId,
        expectedVersion: 1,
        sourceDocumentId: validDocId,
        idempotencyKey: 'dl-upd-doc-1',
      }).success
    ).toBe(true);
    expect(
      updateDeadlineDraftSchema.safeParse({
        deadlineId,
        expectedVersion: 1,
        sourceDocumentId: null,
        idempotencyKey: 'dl-upd-doc-2',
      }).success
    ).toBe(true);
    expect(
      updateDeadlineDraftSchema.safeParse({
        deadlineId,
        expectedVersion: 1,
        sourceDocumentId: 'invalid-uuid',
        idempotencyKey: 'dl-upd-doc-3',
      }).success
    ).toBe(false);

    // confirmDeadlineSchema
    const baseConfirm = {
      deadlineId,
      expectedVersion: 1,
      dueDate: '2027-07-15',
      source: 'محضر الجلسة',
      basisNotes: 'تم الاحتساب يدوياً من تاريخ النطق بالحكم',
      confirmationAccepted: true,
      idempotencyKey: 'dl-confirm-doc-1',
    };
    expect(confirmDeadlineSchema.safeParse({ ...baseConfirm, sourceDocumentId: validDocId }).success).toBe(true);
    expect(confirmDeadlineSchema.safeParse({ ...baseConfirm, sourceDocumentId: null }).success).toBe(true);
    expect(confirmDeadlineSchema.safeParse(baseConfirm).success).toBe(true);
    expect(confirmDeadlineSchema.safeParse({ ...baseConfirm, sourceDocumentId: 'bad-id' }).success).toBe(false);
    expect(
      confirmDeadlineSchema.safeParse({
        ...baseConfirm,
        sourceDocumentId: validDocId,
        confirmationAccepted: false,
        lawyerReviewed: false,
      }).success
    ).toBe(false);
  });
});

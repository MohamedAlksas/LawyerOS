import { describe, it, expect } from 'vitest';
import {
  savePartySchema,
  addCommunicationNoteSchema,
  savePowerOfAttorneySchema,
  validateInput,
  ValidationError,
} from '@/modules/parties/validation';

describe('T05-01: Party Validation Schemas (Unit)', () => {
  describe('savePartySchema - Creation Path', () => {
    it('accepts valid PERSON with minimal required fields (name only)', () => {
      const valid = validateInput(savePartySchema, {
        kind: 'PERSON',
        name: 'محمد أحمد علي',
        idempotencyKey: 'idemp-1',
      });
      expect(valid.kind).toBe('PERSON');
      expect(valid.name).toBe('محمد أحمد علي');
      expect(valid.primaryPhone).toBeFalsy();
      expect(valid.email).toBeFalsy();
      expect(valid.address).toBeFalsy();
      expect(valid.notes).toBeFalsy();
    });

    it('accepts valid ORGANIZATION with minimal required fields', () => {
      const valid = validateInput(savePartySchema, {
        kind: 'ORGANIZATION',
        name: 'شركة النيل للمقاولات والتجارة ش.م.م',
        idempotencyKey: 'idemp-2',
      });
      expect(valid.kind).toBe('ORGANIZATION');
      expect(valid.name).toBe('شركة النيل للمقاولات والتجارة ش.م.م');
    });

    it('accepts valid optional contact information and trims strings', () => {
      const valid = validateInput(savePartySchema, {
        kind: 'PERSON',
        name: ' سارة محمود ',
        primaryPhone: '01012345678',
        additionalPhones: ['01198765432', '+20 2 2345 6789'],
        email: 'sara@example.com',
        address: 'شارع قصر النيل، القاهرة',
        notes: 'عميل محال من طرف الأستاذ فلان',
        identity: {
          identificationType: 'NATIONAL_ID',
          number: '29001011234567',
        },
        idempotencyKey: 'idemp-3',
      });
      expect(valid.name).toBe('سارة محمود');
      expect(valid.primaryPhone).toBe('01012345678');
      expect(valid.additionalPhones).toHaveLength(2);
      expect(valid.email).toBe('sara@example.com');
      expect(valid.identity?.number).toBe('29001011234567');
    });

    it('accepts Arabic-Indic digits (٠١٠١٢٣٤٥٦٧٨) and preserves original characters', () => {
      const arabicPhone = '٠١٠١٢٣٤٥٦٧٨';
      const valid = validateInput(savePartySchema, {
        kind: 'PERSON',
        name: 'أحمد شوقي',
        primaryPhone: arabicPhone,
        additionalPhones: ['٠١١٩٨٧٦٥٤٣٢'],
        idempotencyKey: 'idemp-arabic-phone',
      });
      expect(valid.primaryPhone).toBe(arabicPhone);
      expect(valid.additionalPhones?.[0]).toBe('٠١١٩٨٧٦٥٤٣٢');
    });

    it('accepts Persian digits (۰۱۰۱۲۳۴۵۶۷۸)', () => {
      const valid = validateInput(savePartySchema, {
        kind: 'PERSON',
        name: 'فريد الأطرش',
        primaryPhone: '۰۱۰۱۲۳۴۵۶۷۸',
        idempotencyKey: 'idemp-persian-phone',
      });
      expect(valid.primaryPhone).toBe('۰۱۰۱۲۳۴۵۶۷۸');
    });

    it('rejects unsupported relationship fields (matterId, documentId, proceedingId)', () => {
      expect(() =>
        validateInput(savePartySchema, {
          kind: 'PERSON',
          name: 'عميل مع قضية غير مدعومة',
          matterId: '33333333-3333-4333-8333-333333333333',
          idempotencyKey: 'idemp-matter-fail',
        })
      ).toThrowError(ValidationError);

      expect(() =>
        validateInput(savePartySchema, {
          kind: 'PERSON',
          name: 'عميل مع مستند غير مدعوم',
          documentId: '44444444-4444-4444-8444-444444444444',
          idempotencyKey: 'idemp-doc-fail',
        })
      ).toThrowError(ValidationError);
    });

    it('rejects unrecognized extra fields due to strict schema', () => {
      expect(() =>
        validateInput(savePartySchema, {
          kind: 'PERSON',
          name: 'عميل بحقل غير معترف به',
          unknownCustomField: 'value',
          idempotencyKey: 'idemp-unknown-fail',
        })
      ).toThrowError(ValidationError);
    });

    it('rejects blank or whitespace-only names', () => {
      expect(() =>
        validateInput(savePartySchema, {
          kind: 'PERSON',
          name: '   ',
          idempotencyKey: 'idemp-4',
        })
      ).toThrowError(ValidationError);

      expect(() =>
        validateInput(savePartySchema, {
          kind: 'PERSON',
          name: '',
          idempotencyKey: 'idemp-4',
        })
      ).toThrowError(ValidationError);
    });

    it('rejects names exceeding 200 characters', () => {
      const longName = 'أ'.repeat(201);
      expect(() =>
        validateInput(savePartySchema, {
          kind: 'PERSON',
          name: longName,
          idempotencyKey: 'idemp-5',
        })
      ).toThrowError(ValidationError);
    });

    it('rejects invalid party kind', () => {
      expect(() =>
        validateInput(savePartySchema, {
          kind: 'COMPANY',
          name: 'شركة وهمية',
          idempotencyKey: 'idemp-6',
        })
      ).toThrowError(ValidationError);
    });

    it('rejects malformed email format', () => {
      expect(() =>
        validateInput(savePartySchema, {
          kind: 'PERSON',
          name: 'علي حسن',
          email: 'not-an-email',
          idempotencyKey: 'idemp-7',
        })
      ).toThrowError(ValidationError);
    });

    it('rejects malformed phone numbers', () => {
      expect(() =>
        validateInput(savePartySchema, {
          kind: 'PERSON',
          name: 'علي حسن',
          primaryPhone: '123', // less than 7 chars
          idempotencyKey: 'idemp-8',
        })
      ).toThrowError(ValidationError);
    });
  });

  describe('savePartySchema - Update Path', () => {
    it('requires expectedVersion when id is provided', () => {
      expect(() =>
        validateInput(savePartySchema, {
          id: '11111111-1111-4111-8111-111111111111',
          kind: 'PERSON',
          name: 'أحمد شاكر',
          idempotencyKey: 'idemp-up-1',
        })
      ).toThrowError(ValidationError);
    });

    it('accepts valid update payload with expectedVersion >= 1', () => {
      const valid = validateInput(savePartySchema, {
        id: '11111111-1111-4111-8111-111111111111',
        kind: 'PERSON',
        name: 'أحمد شاكر المعدل',
        expectedVersion: 1,
        idempotencyKey: 'idemp-up-2',
      });
      expect(valid.id).toBe('11111111-1111-4111-8111-111111111111');
      expect(valid.expectedVersion).toBe(1);
    });

    it('rejects non-positive expectedVersion', () => {
      expect(() =>
        validateInput(savePartySchema, {
          id: '11111111-1111-4111-8111-111111111111',
          kind: 'PERSON',
          name: 'أحمد شاكر',
          expectedVersion: 0,
          idempotencyKey: 'idemp-up-3',
        })
      ).toThrowError(ValidationError);
    });
  });

  describe('addCommunicationNoteSchema', () => {
    it('validates correct communication note payload', () => {
      const valid = validateInput(addCommunicationNoteSchema, {
        partyId: '11111111-1111-4111-8111-111111111111',
        communicationAt: '2026-11-17T10:30:00.000Z',
        channel: 'PHONE',
        summary: 'اتصال هاتفي لمناقشة أتعاب الاستئناف والمستندات المطلوبة.',
        followUpRequired: true,
        followUpDate: '2026-11-20',
        idempotencyKey: 'idemp-comm-1',
      });
      expect(valid.channel).toBe('PHONE');
      expect(valid.followUpRequired).toBe(true);
      expect(valid.followUpDate).toBe('2026-11-20');
    });

    it('rejects missing or empty summary', () => {
      expect(() =>
        validateInput(addCommunicationNoteSchema, {
          partyId: '11111111-1111-4111-8111-111111111111',
          communicationAt: '2026-11-17T10:30:00.000Z',
          channel: 'PHONE',
          summary: '   ',
          idempotencyKey: 'idemp-comm-2',
        })
      ).toThrowError(ValidationError);
    });

    it('rejects invalid date format for followUpDate', () => {
      expect(() =>
        validateInput(addCommunicationNoteSchema, {
          partyId: '11111111-1111-4111-8111-111111111111',
          communicationAt: '2026-11-17T10:30:00.000Z',
          channel: 'PHONE',
          summary: 'ملخص الاتصال',
          followUpDate: '20-11-2026', // must be YYYY-MM-DD
          idempotencyKey: 'idemp-comm-3',
        })
      ).toThrowError(ValidationError);
    });

    it('rejects impossible calendar dates for followUpDate (e.g. 2026-02-31, 2026-04-31)', () => {
      // 31st of February does not exist
      expect(() =>
        validateInput(addCommunicationNoteSchema, {
          partyId: '11111111-1111-4111-8111-111111111111',
          communicationAt: '2026-11-17T10:30:00.000Z',
          channel: 'PHONE',
          summary: 'ملخص الاتصال',
          followUpDate: '2026-02-31',
          idempotencyKey: 'idemp-comm-4',
        })
      ).toThrowError(ValidationError);

      // 31st of April does not exist (April has 30 days)
      expect(() =>
        validateInput(addCommunicationNoteSchema, {
          partyId: '11111111-1111-4111-8111-111111111111',
          communicationAt: '2026-11-17T10:30:00.000Z',
          channel: 'PHONE',
          summary: 'ملخص الاتصال',
          followUpDate: '2026-04-31',
          idempotencyKey: 'idemp-comm-5',
        })
      ).toThrowError(ValidationError);

      // 29th of February in non-leap year 2026
      expect(() =>
        validateInput(addCommunicationNoteSchema, {
          partyId: '11111111-1111-4111-8111-111111111111',
          communicationAt: '2026-11-17T10:30:00.000Z',
          channel: 'PHONE',
          summary: 'ملخص الاتصال',
          followUpDate: '2026-02-29',
          idempotencyKey: 'idemp-comm-6',
        })
      ).toThrowError(ValidationError);
    });

    it('accepts leap year 29th of February (2024-02-29)', () => {
      const valid = validateInput(addCommunicationNoteSchema, {
        partyId: '11111111-1111-4111-8111-111111111111',
        communicationAt: '2026-11-17T10:30:00.000Z',
        channel: 'PHONE',
        summary: 'ملخص الاتصال في سنة كبيسة',
        followUpDate: '2024-02-29',
        idempotencyKey: 'idemp-comm-7',
      });
      expect(valid.followUpDate).toBe('2024-02-29');
    });

    it('rejects unsupported relationship fields (matterId, documentId)', () => {
      expect(() =>
        validateInput(addCommunicationNoteSchema, {
          partyId: '11111111-1111-4111-8111-111111111111',
          matterId: '22222222-2222-4222-8222-222222222222',
          communicationAt: '2026-11-17T10:30:00.000Z',
          channel: 'PHONE',
          summary: 'ملخص اتصال مع معرف قضية غير مدعوم',
          idempotencyKey: 'idemp-comm-8',
        })
      ).toThrowError(ValidationError);

      expect(() =>
        validateInput(addCommunicationNoteSchema, {
          partyId: '11111111-1111-4111-8111-111111111111',
          documentId: '33333333-3333-4333-8333-333333333333',
          communicationAt: '2026-11-17T10:30:00.000Z',
          channel: 'PHONE',
          summary: 'ملخص اتصال مع مستند غير مدعوم',
          idempotencyKey: 'idemp-comm-9',
        })
      ).toThrowError(ValidationError);
    });
  });

  describe('savePowerOfAttorneySchema', () => {
    it('preserves leading zeros in poaNumberText', () => {
      const valid = validateInput(savePowerOfAttorneySchema, {
        partyId: '11111111-1111-4111-8111-111111111111',
        poaNumberText: '0045/ب',
        poaYearLabel: '2026',
        notarizationOffice: 'مكتب توثيق الأهرام النموذجي',
        poaType: 'GENERAL',
        idempotencyKey: 'idemp-poa-1',
      });
      expect(valid.poaNumberText).toBe('0045/ب');
      expect(valid.poaYearLabel).toBe('2026');
      expect(valid.humanReviewStatus).toBe('UNREVIEWED');
    });

    it('rejects impossible calendar dates for issueDate', () => {
      expect(() =>
        validateInput(savePowerOfAttorneySchema, {
          partyId: '11111111-1111-4111-8111-111111111111',
          poaNumberText: '123/أ',
          poaYearLabel: '2026',
          notarizationOffice: 'مكتب توثيق قصر النيل',
          poaType: 'GENERAL',
          issueDate: '2026-02-31', // impossible date
          idempotencyKey: 'idemp-poa-date-fail',
        })
      ).toThrowError(ValidationError);
    });

    it('accepts leap year issueDate (2024-02-29)', () => {
      const valid = validateInput(savePowerOfAttorneySchema, {
        partyId: '11111111-1111-4111-8111-111111111111',
        poaNumberText: '123/أ',
        poaYearLabel: '2024',
        notarizationOffice: 'مكتب توثيق قصر النيل',
        poaType: 'GENERAL',
        issueDate: '2024-02-29',
        idempotencyKey: 'idemp-poa-leap',
      });
      expect(valid.issueDate).toBe('2024-02-29');
    });

    it('rejects unsupported relationship fields (documentId, matterId)', () => {
      expect(() =>
        validateInput(savePowerOfAttorneySchema, {
          partyId: '11111111-1111-4111-8111-111111111111',
          documentId: '55555555-5555-4555-8555-555555555555',
          poaNumberText: '123/أ',
          poaYearLabel: '2026',
          notarizationOffice: 'مكتب توثيق قصر النيل',
          poaType: 'GENERAL',
          idempotencyKey: 'idemp-poa-doc-fail',
        })
      ).toThrowError(ValidationError);
    });

    it('requires expectedVersion on update', () => {
      expect(() =>
        validateInput(savePowerOfAttorneySchema, {
          id: '22222222-2222-4222-8222-222222222222',
          partyId: '11111111-1111-4111-8111-111111111111',
          poaNumberText: '0045/ب',
          poaYearLabel: '2026',
          notarizationOffice: 'مكتب توثيق الأهرام النموذجي',
          poaType: 'GENERAL',
          idempotencyKey: 'idemp-poa-2',
        })
      ).toThrowError(ValidationError);
    });
  });
});


import { describe, expect, it } from 'vitest';
import {
  CalendarValidationError,
  computeCairoReminderInstant,
  CAIRO_TIMEZONE,
} from '@/lib/cairo-date';
import { isWorkerDispatchDisabled, redactErrorMessage } from '@/lib/env';
import { computeRetryBackoffMs } from '@/worker/reminder-worker';

function formatCairoWall(date: Date): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: CAIRO_TIMEZONE,
    calendar: 'gregory',
    numberingSystem: 'latn',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '';
  return `${get('year')}-${get('month')}-${get('day')} ${get('hour')}:${get('minute')}`;
}

describe('T10 Unit Tests: Cairo Reminder Policy, Redaction, Restore Mode & Backoff', () => {
  it('computes exact Africa/Cairo wall-clock instants across winter, spring DST, autumn DST, and leap years (T10-TC-04)', () => {
    // Winter standard time (UTC+2)
    const winter = computeCairoReminderInstant('2027-02-15', 7, '09:00');
    expect(winter.toISOString()).toBe('2027-02-08T07:00:00.000Z');
    expect(formatCairoWall(winter)).toBe('2027-02-08 09:00');

    // Day before spring DST transition (2027-04-29 is UTC+2)
    const beforeSpringDst = computeCairoReminderInstant('2027-05-06', 7, '09:00');
    expect(beforeSpringDst.toISOString()).toBe('2027-04-29T07:00:00.000Z');
    expect(formatCairoWall(beforeSpringDst)).toBe('2027-04-29 09:00');

    // Spring DST day (2027-04-30 is UTC+3)
    const onSpringDst = computeCairoReminderInstant('2027-05-07', 7, '09:00');
    expect(onSpringDst.toISOString()).toBe('2027-04-30T06:00:00.000Z');
    expect(formatCairoWall(onSpringDst)).toBe('2027-04-30 09:00');

    // Autumn DST transition (2027-10-28 still UTC+3 at 09:00; 2027-10-29 back to UTC+2)
    const onAutumnDstDay = computeCairoReminderInstant('2027-10-29', 1, '09:00');
    expect(onAutumnDstDay.toISOString()).toBe('2027-10-28T06:00:00.000Z');
    expect(formatCairoWall(onAutumnDstDay)).toBe('2027-10-28 09:00');

    const afterAutumnDst = computeCairoReminderInstant('2027-10-29', 0, '09:00');
    expect(afterAutumnDst.toISOString()).toBe('2027-10-29T07:00:00.000Z');
    expect(formatCairoWall(afterAutumnDst)).toBe('2027-10-29 09:00');

    // Leap year boundary
    const leap = computeCairoReminderInstant('2028-03-01', 1, '10:30');
    expect(formatCairoWall(leap)).toBe('2028-02-29 10:30');
  });

  it('rejects invalid day offsets, dates, and reminder times fail-closed', () => {
    expect(() => computeCairoReminderInstant('2027-05-01', -1, '09:00')).toThrow(
      CalendarValidationError
    );
    expect(() => computeCairoReminderInstant('2027-05-01', 366, '09:00')).toThrow(
      CalendarValidationError
    );
    expect(() => computeCairoReminderInstant('2027-05-01', 1.5, '09:00')).toThrow(
      CalendarValidationError
    );
    expect(() => computeCairoReminderInstant('2027-02-29', 1, '09:00')).toThrow(
      CalendarValidationError
    );
    expect(() => computeCairoReminderInstant('2027-05-01', 1, '24:00')).toThrow(
      CalendarValidationError
    );
    expect(() => computeCairoReminderInstant('2027-05-01', 1, 'invalid')).toThrow(
      CalendarValidationError
    );
  });

  it('redacts connection strings, bearer tokens, JWTs, secrets, and raw blobs while bounding length', () => {
    const raw = new Error(
      'DB failed at postgresql://lawuser:TopSecret99@10.0.0.5:5432/lawoffice_prod ' +
        'with Authorization: Bearer sk_live_abcdef1234567890abcdef token=my_secret_value ' +
        'jwt=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.abc123def456 ' +
        'blob=' +
        'A'.repeat(120)
    );
    const redacted = redactErrorMessage(raw, 220);
    expect(redacted).not.toContain('TopSecret99');
    expect(redacted).not.toContain('sk_live_abcdef');
    expect(redacted).not.toContain('my_secret_value');
    expect(redacted).not.toContain('eyJhbGciOi');
    expect(redacted).not.toContain('A'.repeat(50));
    expect(redacted.length).toBeLessThanOrEqual(220);
  });

  it('evaluates RESTORE_MODE and REMINDER_DISPATCH_DISABLED flags accurately', () => {
    expect(isWorkerDispatchDisabled({})).toBe(false);
    expect(isWorkerDispatchDisabled({ RESTORE_MODE: 'false', REMINDER_DISPATCH_DISABLED: '0' })).toBe(false);
    expect(isWorkerDispatchDisabled({ RESTORE_MODE: 'true' })).toBe(true);
    expect(isWorkerDispatchDisabled({ RESTORE_MODE: '1' })).toBe(true);
    expect(isWorkerDispatchDisabled({ REMINDER_DISPATCH_DISABLED: 'true' })).toBe(true);
    expect(isWorkerDispatchDisabled({ REMINDER_DISPATCH_DISABLED: '1' })).toBe(true);
  });

  it('computes bounded exponential retry backoff delays', () => {
    expect(computeRetryBackoffMs(1, 30_000, 900_000)).toBe(30_000);
    expect(computeRetryBackoffMs(2, 30_000, 900_000)).toBe(60_000);
    expect(computeRetryBackoffMs(3, 30_000, 900_000)).toBe(120_000);
    expect(computeRetryBackoffMs(10, 30_000, 900_000)).toBe(900_000);
  });
});
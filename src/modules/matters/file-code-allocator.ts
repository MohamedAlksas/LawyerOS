import { Prisma } from '@prisma/client';

/**
 * Returns the current Gregorian year evaluated strictly in Africa/Cairo timezone.
 * Defends against client/server host time drift across year transitions.
 */
export function getCairoYear(date: Date = new Date()): number {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Africa/Cairo',
    year: 'numeric',
  });
  return parseInt(formatter.format(date), 10);
}

/**
 * Atomically allocates a sequential file code for the given year (format: YYYY/NNNN).
 * Serializes concurrent requests using SELECT ... FOR UPDATE on file_code_sequence.
 * Completely immune to COUNT(*) + 1 or MAX(id) + 1 write skew and race conditions.
 */
export async function allocateFileCode(
  tx: Prisma.TransactionClient,
  overrideYear?: number
): Promise<string> {
  const year = overrideYear ?? getCairoYear();

  // 1. Ensure sequence row exists for the year
  await tx.$executeRaw`
    INSERT INTO file_code_sequence (year, "nextVal", "updatedAt")
    VALUES (${year}, 1, NOW())
    ON CONFLICT (year) DO NOTHING
  `;

  // 2. Lock row exclusively for update
  const rows = await tx.$queryRaw<{ nextVal: number }[]>`
    SELECT "nextVal"
    FROM file_code_sequence
    WHERE year = ${year}
    FOR UPDATE
  `;

  if (!rows || rows.length === 0) {
    throw new Error(`Failed to acquire atomic sequence lock for year ${year}`);
  }

  const currentVal = Number(rows[0].nextVal);

  // 3. Increment sequence value
  await tx.$executeRaw`
    UPDATE file_code_sequence
    SET "nextVal" = "nextVal" + 1, "updatedAt" = NOW()
    WHERE year = ${year}
  `;

  // 4. Return formatted code: YYYY/NNNN
  return `${year}/${String(currentVal).padStart(4, '0')}`;
}
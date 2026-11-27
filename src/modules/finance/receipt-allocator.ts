import { Prisma } from '@prisma/client';
import { getCairoYear } from '@/modules/matters/file-code-allocator';

export interface AllocatedReceiptNumber {
  year: number;
  receiptNumber: string;
}

/**
 * Atomically allocates a sequential receipt number for the Cairo calendar year (format: RCP-YYYY-NNNN).
 * Serializes concurrent requests using SELECT ... FOR UPDATE on receipt_sequence inside the active transaction.
 * Rolls back automatically if the enclosing transaction aborts (no gaps or leaked numbers on failed audit/commit).
 */
export async function allocateReceiptNumber(
  tx: Prisma.TransactionClient,
  overrideYear?: number
): Promise<AllocatedReceiptNumber> {
  const year = overrideYear ?? getCairoYear();

  await tx.$executeRaw`
    INSERT INTO "receipt_sequence" ("year", "next_val", "updated_at")
    VALUES (${year}, 1, NOW())
    ON CONFLICT ("year") DO NOTHING
  `;

  const rows = await tx.$queryRaw<{ next_val: number }[]>`
    SELECT "next_val"
    FROM "receipt_sequence"
    WHERE "year" = ${year}
    FOR UPDATE
  `;

  if (!rows || rows.length === 0) {
    throw new Error(`Failed to acquire atomic receipt sequence lock for year ${year}`);
  }

  const currentVal = Number(rows[0].next_val);

  await tx.$executeRaw`
    UPDATE "receipt_sequence"
    SET "next_val" = "next_val" + 1, "updated_at" = NOW()
    WHERE "year" = ${year}
  `;

  return {
    year,
    receiptNumber: `RCP-${year}-${String(currentVal).padStart(4, '0')}`,
  };
}
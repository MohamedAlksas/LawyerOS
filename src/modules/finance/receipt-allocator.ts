import { Prisma } from '@prisma/client';
import { getCairoYear } from '@/modules/matters/file-code-allocator';

export interface AllocatedReceiptNumber {
  year: number;
  receiptNumber: string;
}

/**
 * Atomically allocates a sequential receipt number for the Cairo calendar year (format: RCP-YYYY-NNNN).
 * Uses a single atomic INSERT ... ON CONFLICT DO UPDATE ... RETURNING statement on receipt_sequence.
 * Rolls back automatically if the enclosing transaction aborts (no gaps or leaked numbers on failed audit/commit).
 */
export async function allocateReceiptNumber(
  tx: Prisma.TransactionClient,
  overrideYear?: number
): Promise<AllocatedReceiptNumber> {
  const year = overrideYear ?? getCairoYear();

  const rows = await tx.$queryRaw<Array<{ allocated_val: number }>>`
    INSERT INTO "receipt_sequence" ("year", "next_val", "updated_at")
    VALUES (${year}, 2, NOW())
    ON CONFLICT ("year") DO UPDATE
    SET "next_val" = "receipt_sequence"."next_val" + 1,
        "updated_at" = NOW()
    RETURNING ("next_val" - 1) AS allocated_val
  `;

  if (!rows || rows.length === 0) {
    throw new Error(`Failed to acquire atomic receipt sequence lock for year ${year}`);
  }

  const currentVal = Number(rows[0].allocated_val);

  return {
    year,
    receiptNumber: `RCP-${year}-${String(currentVal).padStart(4, '0')}`,
  };
}
-- AlterTable
ALTER TABLE "matter" ADD COLUMN "titleNormalized" TEXT;

-- Update existing records using canonical Arabic normalization matching normalizeArabicText
UPDATE "matter"
SET "titleNormalized" = trim(
  regexp_replace(
    regexp_replace(
      translate(
        lower("title"),
        '٠١٢٣٤٥٦٧٨٩۰۱۲۳۴۵۶۷۸۹أإآٱةىئؤ',
        '01234567890123456789ااااهييو'
      ),
      '[\x{064B}-\x{065F}\x{0670}\x{0640}]',
      '',
      'g'
    ),
    '\s+',
    ' ',
    'g'
  )
)
WHERE "title" IS NOT NULL;

-- CreateIndex
CREATE INDEX "matter_titleNormalized_idx" ON "matter"("titleNormalized");

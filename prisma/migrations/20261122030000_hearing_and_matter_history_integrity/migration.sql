BEGIN;

CREATE UNIQUE INDEX "hearing_result_hearing_id_revision_key" ON "hearing_result"("hearing_id", "revision");
DROP INDEX "hearing_result_hearing_id_revision_idx";

CREATE TABLE "matter_note_revision" (
    "id" TEXT NOT NULL,
    "matterId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "notes" TEXT,
    "changedById" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "matter_note_revision_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "matter_note_revision_matterId_fkey" FOREIGN KEY ("matterId") REFERENCES "matter"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "matter_note_revision_matterId_version_key" ON "matter_note_revision"("matterId", "version");

COMMIT;

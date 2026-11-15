-- AlterTable
ALTER TABLE "user" ADD COLUMN IF NOT EXISTS "credentialVersion" INTEGER NOT NULL DEFAULT 1;

-- AlterTable
ALTER TABLE "session" ADD COLUMN IF NOT EXISTS "credentialVersion" INTEGER NOT NULL DEFAULT 1;

-- CreateTriggerFunction for session credential version stamping
CREATE OR REPLACE FUNCTION trg_session_set_credential_version()
RETURNS TRIGGER AS $$
BEGIN
    NEW."credentialVersion" := COALESCE((SELECT "credentialVersion" FROM "user" WHERE "id" = NEW."userId"), 1);
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- CreateTrigger
DROP TRIGGER IF EXISTS trg_session_set_credential_version ON "session";
CREATE TRIGGER trg_session_set_credential_version
BEFORE INSERT ON "session"
FOR EACH ROW
EXECUTE FUNCTION trg_session_set_credential_version();

-- CreateTriggerFunction for password change credential invalidation
CREATE OR REPLACE FUNCTION trg_account_password_sync_credential_version()
RETURNS TRIGGER AS $$
DECLARE
    v_new_version INTEGER;
BEGIN
    IF OLD."password" IS DISTINCT FROM NEW."password" THEN
        UPDATE "user"
        SET "credentialVersion" = "credentialVersion" + 1
        WHERE "id" = NEW."userId"
        RETURNING "credentialVersion" INTO v_new_version;

        IF v_new_version IS NULL THEN
            RAISE EXCEPTION 'Failed to increment credentialVersion for user %: user record not found', NEW."userId";
        END IF;

        -- Revoke all existing sessions with older credentialVersion
        DELETE FROM "session"
        WHERE "userId" = NEW."userId"
          AND "credentialVersion" < v_new_version;

        -- Purge companion verification records matching 2fa-cred-ver-% for this user
        DELETE FROM "verification"
        WHERE "identifier" LIKE '2fa-cred-ver-' || NEW."userId" || '-%'
           OR "identifier" LIKE '2fa-cred-ver-%';
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- CreateTrigger
DROP TRIGGER IF EXISTS trg_account_password_sync_credential_version ON "account";
CREATE TRIGGER trg_account_password_sync_credential_version
AFTER UPDATE OF "password" ON "account"
FOR EACH ROW
EXECUTE FUNCTION trg_account_password_sync_credential_version();


-- AlterTable
ALTER TABLE public."user" ADD COLUMN IF NOT EXISTS "credentialVersion" INTEGER NOT NULL DEFAULT 1;

-- AlterTable
ALTER TABLE public."session" ADD COLUMN IF NOT EXISTS "credentialVersion" INTEGER NOT NULL DEFAULT 1;

-- CreateTriggerFunction for session credential version stamping
CREATE OR REPLACE FUNCTION public.trg_session_set_credential_version()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
BEGIN
    NEW."credentialVersion" := COALESCE((SELECT "credentialVersion" FROM public."user" WHERE "id" = NEW."userId"), 1);
    RETURN NEW;
END;
$$;

-- CreateTrigger
DROP TRIGGER IF EXISTS trg_session_set_credential_version ON public."session";
CREATE TRIGGER trg_session_set_credential_version
BEFORE INSERT ON public."session"
FOR EACH ROW
EXECUTE FUNCTION public.trg_session_set_credential_version();

-- CreateTriggerFunction for password change credential invalidation
CREATE OR REPLACE FUNCTION public.trg_account_password_sync_credential_version()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
    v_new_version INTEGER;
BEGIN
    IF OLD."password" IS DISTINCT FROM NEW."password" THEN
        UPDATE public."user"
        SET "credentialVersion" = "credentialVersion" + 1
        WHERE "id" = NEW."userId"
        RETURNING "credentialVersion" INTO v_new_version;

        IF v_new_version IS NULL THEN
            RAISE EXCEPTION 'Failed to increment credentialVersion for user %: user record not found', NEW."userId";
        END IF;

        -- Revoke all existing sessions with older credentialVersion
        DELETE FROM public."session"
        WHERE "userId" = NEW."userId"
          AND "credentialVersion" < v_new_version;

        -- Purge companion verification records matching 2fa-cred-ver-% for this user
        DELETE FROM public."verification"
        WHERE "identifier" LIKE '2fa-cred-ver-' || NEW."userId" || '-%'
           OR "identifier" LIKE '2fa-cred-ver-%';
    END IF;
    RETURN NEW;
END;
$$;

-- CreateTrigger
DROP TRIGGER IF EXISTS trg_account_password_sync_credential_version ON public."account";
CREATE TRIGGER trg_account_password_sync_credential_version
AFTER UPDATE OF "password" ON public."account"
FOR EACH ROW
EXECUTE FUNCTION public.trg_account_password_sync_credential_version();



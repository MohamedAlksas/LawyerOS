-- Record the credential change in the same transaction as password rotation and session revocation.
CREATE FUNCTION public.trg_audit_password_rotation()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    INSERT INTO public."audit_event" ("id", "userId", "action", "entityType", "entityId")
    VALUES (pg_catalog.gen_random_uuid()::text, NEW."userId", 'CHANGE_PASSWORD', 'User', NEW."userId");
    RETURN NEW;
END;
$$;

CREATE TRIGGER trg_audit_password_rotation
AFTER UPDATE OF "password" ON public."account"
FOR EACH ROW
WHEN (NEW."providerId" = 'credential' AND OLD."password" IS DISTINCT FROM NEW."password")
EXECUTE FUNCTION public.trg_audit_password_rotation();

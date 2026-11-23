BEGIN;
-- Fail installation if the versioned sync baseline is absent.
SELECT 'public.sync_write_v2(text,jsonb)'::regprocedure,
       'public.sync_manifest_v2(text,uuid,uuid,integer)'::regprocedure,
       'public.sync_rows_v2(text,uuid,uuid[])'::regprocedure;
CREATE FUNCTION public.vaporflow_protocol() RETURNS integer
LANGUAGE sql STABLE SECURITY INVOKER SET search_path='' AS $$ SELECT 2 $$;
REVOKE ALL ON FUNCTION public.vaporflow_protocol() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.vaporflow_protocol() TO anon, authenticated;
COMMIT;

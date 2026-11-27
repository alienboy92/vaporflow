BEGIN;
CREATE TABLE IF NOT EXISTS public.app_meta (
  key text PRIMARY KEY CHECK (key = 'schema_version'),
  value text NOT NULL
);
ALTER TABLE public.app_meta ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.app_meta FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.app_meta TO authenticated;
DROP POLICY IF EXISTS read_schema_version ON public.app_meta;
CREATE POLICY read_schema_version ON public.app_meta FOR SELECT TO authenticated USING (true);
INSERT INTO public.app_meta (key, value) VALUES ('schema_version', '4')
ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value
WHERE public.app_meta.value::bigint < EXCLUDED.value::bigint;
COMMIT;

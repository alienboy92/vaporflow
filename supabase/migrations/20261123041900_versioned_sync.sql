BEGIN;

CREATE FUNCTION private.sync_relation(t text) RETURNS regclass
LANGUAGE plpgsql STABLE SET search_path = '' AS $$
BEGIN
  IF t IS NULL OR t NOT IN ('shops','devices','categories','products','variants','expenses',
      'stock_movements','sales','sale_items','returns','return_items') THEN
    RAISE EXCEPTION 'Unknown sync table';
  END IF;
  RETURN format('public.%I',t)::regclass;
END $$;

CREATE FUNCTION private.stamp_revision() RETURNS trigger
LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  NEW.row_version := CASE WHEN TG_OP='INSERT' THEN 1 ELSE OLD.row_version+1 END;
  NEW.updated_at := clock_timestamp();
  NEW.server_updated_at := NEW.updated_at;
  RETURN NEW;
END $$;

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['shops','devices','categories','products','variants','expenses',
      'stock_movements','sales','sale_items','returns','return_items'] LOOP
    EXECUTE format('ALTER TABLE public.%I ADD COLUMN row_version bigint NOT NULL DEFAULT 1 CHECK(row_version>0)',t);
    EXECUTE format('CREATE TRIGGER zz_stamp_revision BEFORE INSERT OR UPDATE ON public.%I
      FOR EACH ROW EXECUTE FUNCTION private.stamp_revision()',t);
  END LOOP;
END $$;

-- Per-row locks serialize competing creates as well as updates on an existing row.
CREATE FUNCTION public.sync_write_v2(p_table text,p_rows jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE
  rel regclass := private.sync_relation(p_table); u uuid := auth.uid(); item jsonb;
  prior jsonb; canonical jsonb; proposed jsonb; reply jsonb := '[]'; outcome text;
  target uuid; shop uuid; base bigint; cols text; placeholder boolean;
  immutable boolean := p_table IN ('stock_movements','sales','sale_items','returns','return_items');
  metadata text[] := ARRAY['base_version','row_version','created_at','updated_at','server_updated_at','device_id'];
BEGIN
  IF u IS NULL OR p_rows IS NULL OR jsonb_typeof(p_rows)<>'array' OR jsonb_array_length(p_rows)>200 THEN
    RAISE EXCEPTION 'Invalid sync request';
  END IF;
  SELECT string_agg(format('%1$I = incoming.%1$I',attname),', ' ORDER BY attnum)
    INTO cols FROM pg_catalog.pg_attribute WHERE attrelid=rel AND attnum>0 AND NOT attisdropped
    AND NOT (attname::text=ANY(metadata || ARRAY['id','shop_id']));
  FOR item IN SELECT value FROM jsonb_array_elements(p_rows) LOOP
    target := (item->>'id')::uuid; shop := (item->>'shop_id')::uuid; base := (item->>'base_version')::bigint;
    IF target IS NULL OR base IS NULL OR base<0 OR NOT EXISTS
      (SELECT 1 FROM public.shop_members WHERE shop_id=shop AND user_id=u) THEN RAISE EXCEPTION 'Invalid membership or base version'; END IF;
    PERFORM pg_advisory_xact_lock(hashtextextended(p_table||target::text,1));
    EXECUTE format('SELECT to_jsonb(t) FROM %s t WHERE id=$1 FOR UPDATE',rel) INTO prior USING target;
    IF prior IS NOT NULL AND (prior->>'shop_id')::uuid<>shop THEN RAISE EXCEPTION 'Row belongs to another shop'; END IF;
    EXECUTE format('SELECT to_jsonb(x) FROM jsonb_populate_record(NULL::%s,$1) x',rel) INTO proposed USING item;
    placeholder := p_table='shops' AND (prior->>'created_at')::timestamptz='0001-01-01Z'::timestamptz AND base=0;
    outcome := 'ok';
    IF prior IS NULL THEN
      IF base<>0 THEN RAISE EXCEPTION 'Referenced revision is missing'; END IF;
      EXECUTE format('INSERT INTO %s AS t SELECT * FROM jsonb_populate_record(NULL::%s,$1) RETURNING to_jsonb(t)',rel,rel) INTO canonical USING item;
    ELSIF (prior-metadata)=(proposed-metadata) THEN
      canonical := prior;
    ELSIF immutable THEN
      RAISE EXCEPTION 'Immutable ledger identity already has different content';
    ELSIF (prior->>'row_version')::bigint=base OR placeholder THEN
      EXECUTE format('UPDATE %s AS t SET %s %s FROM jsonb_populate_record(NULL::%s,$1) incoming
        WHERE t.id=$2 RETURNING to_jsonb(t)',rel,cols,
        CASE WHEN placeholder THEN ', created_at=incoming.created_at, device_id=incoming.device_id' ELSE '' END,rel)
        INTO canonical USING item,target;
    ELSE
      outcome := 'conflict'; canonical := prior;
    END IF;
    reply := reply || jsonb_build_array(jsonb_build_object('status',outcome,'row',canonical));
  END LOOP;
  RETURN reply;
END $$;

CREATE FUNCTION public.sync_manifest_v2(p_table text,p_shop uuid,p_after uuid,p_limit integer)
RETURNS TABLE(id uuid,row_version bigint) LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE rel regclass := private.sync_relation(p_table);
BEGIN
  IF p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 500 THEN RAISE EXCEPTION 'Invalid page size'; END IF;
  IF NOT EXISTS(SELECT 1 FROM public.shop_members WHERE shop_id=p_shop AND user_id=auth.uid()) THEN RETURN; END IF;
  RETURN QUERY EXECUTE format('SELECT t.id,t.row_version FROM %s t WHERE t.shop_id=$1 AND ($2 IS NULL OR t.id>$2) ORDER BY t.id LIMIT $3',rel)
    USING p_shop,p_after,p_limit;
END $$;

CREATE FUNCTION public.sync_rows_v2(p_table text,p_shop uuid,p_ids uuid[]) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE rel regclass := private.sync_relation(p_table); result jsonb;
BEGIN
  IF p_ids IS NULL OR cardinality(p_ids)>500 THEN RAISE EXCEPTION 'Invalid row selection'; END IF;
  IF NOT EXISTS(SELECT 1 FROM public.shop_members WHERE shop_id=p_shop AND user_id=auth.uid()) THEN RETURN '[]'; END IF;
  EXECUTE format('SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY t.id),''[]''::jsonb) FROM %s t WHERE t.shop_id=$1 AND t.id=ANY($2)',rel)
    INTO result USING p_shop,p_ids;
  RETURN result;
END $$;

REVOKE EXECUTE ON FUNCTION public.sync_push(text,jsonb) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.sync_write_v2(text,jsonb),public.sync_manifest_v2(text,uuid,uuid,integer),public.sync_rows_v2(text,uuid,uuid[]) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.sync_write_v2(text,jsonb),public.sync_manifest_v2(text,uuid,uuid,integer),public.sync_rows_v2(text,uuid,uuid[]) TO authenticated;
COMMIT;

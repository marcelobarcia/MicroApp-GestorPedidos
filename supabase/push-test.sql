-- Runs against the real schema, then rolls back every fixture and queued request.
begin;
do $$
declare owner uuid; fixture jsonb; ord jsonb; lines jsonb; version text; count_jobs integer;
  actor uuid := '11111111-1111-4111-8111-111111111111';
  receiver uuid := '22222222-2222-4222-8222-222222222222';
begin
  select owner_id, order_workspaces.snapshot into owner,fixture from public.order_workspaces limit 1;
  if owner is null then raise exception 'A workspace is required for this test'; end if;
  if has_table_privilege('anon','public.order_push_config','SELECT') or
     has_table_privilege('authenticated','public.order_push_devices','SELECT') or
     has_function_privilege('authenticated','public.claim_order_push_jobs()','EXECUTE') then
    raise exception 'Client access to private push data';
  end if;
  insert into public.order_push_devices(id,owner_id,subscription) values
    (actor,owner,'{}'),(receiver,owner,'{}');
  perform set_config('request.headers',jsonb_build_object('x-order-device',actor)::text,true);
  lines := '[{"id":"push-test-line","vendorId":"push-test-vendor","qty":2,"net":100,"gross":119}]';
  version := '[["push-test-line",2,100,119]]';
  ord := jsonb_build_object('id','push-test-order','lines',lines,'deliveries',jsonb_build_object('push-test-vendor',jsonb_build_object('whatsapp',jsonb_build_object('version',version,'sent',false))));
  fixture := jsonb_set(fixture,'{drafts}',coalesce(fixture->'drafts','[]')||jsonb_build_array(ord));
  update public.order_workspaces set snapshot=fixture where owner_id=owner;
  select count(*) into count_jobs from public.order_push_jobs where device_id in (actor,receiver);
  if count_jobs <> 0 then raise exception 'Opening WhatsApp must not notify'; end if;
  ord := jsonb_set(ord,'{deliveries,push-test-vendor,whatsapp,sent}','true');
  fixture := jsonb_set(fixture,'{drafts}',(select jsonb_agg(case when value->>'id'='push-test-order' then ord else value end) from jsonb_array_elements(fixture->'drafts')));
  update public.order_workspaces set snapshot=fixture where owner_id=owner;
  select count(*) into count_jobs from public.order_push_jobs where device_id=receiver;
  if count_jobs <> 1 then raise exception 'One sent event expected, got %',count_jobs; end if;
  if exists(select 1 from public.order_push_jobs where device_id=actor) then raise exception 'Actor must not receive own event'; end if;
  update public.order_workspaces set snapshot=fixture where owner_id=owner;
  select count(*) into count_jobs from public.order_push_jobs where device_id=receiver;
  if count_jobs <> 1 then raise exception 'Duplicate notification'; end if;
  ord := jsonb_set(ord,'{agreements}',jsonb_build_object('push-test-vendor',jsonb_build_object('version',version,'changed',false)));
  fixture := jsonb_set(fixture,'{drafts}',(select jsonb_agg(case when value->>'id'='push-test-order' then ord else value end) from jsonb_array_elements(fixture->'drafts')));
  update public.order_workspaces set snapshot=fixture where owner_id=owner;
  select count(*) into count_jobs from public.order_push_jobs where device_id=receiver;
  if count_jobs <> 2 then raise exception 'One confirmation expected, got %',count_jobs; end if;
  -- An old confirmation copied onto changed lines must not generate another event.
  ord := jsonb_set(ord,'{agreements,push-test-vendor,version}','"[[\"push-test-line\",9,100,119]]"');
  fixture := jsonb_set(fixture,'{drafts}',(select jsonb_agg(case when value->>'id'='push-test-order' then ord else value end) from jsonb_array_elements(fixture->'drafts')));
  update public.order_workspaces set snapshot=fixture where owner_id=owner;
  select count(*) into count_jobs from public.order_push_jobs where device_id=receiver;
  if count_jobs <> 2 then raise exception 'Stale confirmation generated event'; end if;
end $$;
rollback;

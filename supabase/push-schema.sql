-- Server-only configuration, device subscriptions and a durable delivery queue.
create extension if not exists pg_net with schema extensions;
create extension if not exists pg_cron with schema pg_catalog;
create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

create table public.order_push_config (
  id boolean primary key default true check (id),
  dispatch_token text not null default encode(extensions.gen_random_bytes(32), 'hex'),
  vapid jsonb
);
insert into public.order_push_config (id) values (true);
create table public.order_push_devices (
  id uuid primary key,
  owner_id uuid not null references auth.users(id) on delete cascade,
  subscription jsonb not null,
  active boolean not null default true,
  updated_at timestamptz not null default now()
);
create index order_push_devices_owner_idx on public.order_push_devices(owner_id);
create table public.order_push_jobs (
  id bigint generated always as identity primary key,
  device_id uuid not null references public.order_push_devices(id) on delete cascade,
  event_key text not null,
  payload jsonb not null,
  attempts integer not null default 0,
  available_at timestamptz not null default now(),
  delivered_at timestamptz,
  last_error text,
  unique(device_id, event_key)
);
create index order_push_jobs_pending_idx on public.order_push_jobs(available_at) where delivered_at is null;
alter table public.order_push_config enable row level security;
alter table public.order_push_devices enable row level security;
alter table public.order_push_jobs enable row level security;
revoke all on public.order_push_config, public.order_push_devices, public.order_push_jobs from public, anon, authenticated;
grant all on public.order_push_config, public.order_push_devices, public.order_push_jobs to service_role;
grant usage, select on sequence public.order_push_jobs_id_seq to service_role;

create function public.claim_order_push_jobs() returns setof public.order_push_jobs
language sql set search_path = '' as $$
  update public.order_push_jobs set attempts = attempts + 1, available_at = now() + interval '2 minutes'
  where id in (select id from public.order_push_jobs where delivered_at is null and attempts < 8 and available_at <= now()
    order by id for update skip locked limit 20) returning *;
$$;
revoke all on function public.claim_order_push_jobs() from public, anon, authenticated;
grant execute on function public.claim_order_push_jobs() to service_role;

create function private.dispatch_order_push() returns void
language plpgsql security definer set search_path = '' as $$
declare secret text;
begin
  if not exists(select 1 from public.order_push_jobs where delivered_at is null and attempts < 8 and available_at <= now()) then return; end if;
  select dispatch_token into secret from public.order_push_config where id;
  perform net.http_post(
    url := 'https://pymauwkwfyohdwrrmilv.supabase.co/functions/v1/order-push',
    headers := jsonb_build_object('Content-Type','application/json','Authorization','Bearer '||secret),
    body := '{"action":"dispatch"}'::jsonb,
    timeout_milliseconds := 10000);
end;
$$;
revoke all on function private.dispatch_order_push() from public, anon, authenticated;

create function private.queue_order_push() returns trigger
language plpgsql security definer set search_path = '' as $$
declare ord jsonb; before_order jsonb; supplier text; rec jsonb; previous jsonb; entry record;
  kind text; title text; event_key text; source text; destination text;
begin
  if auth.uid() is not null and auth.uid() <> new.owner_id then raise exception 'Workspace access denied'; end if;
  source := coalesce(nullif(current_setting('request.headers', true),'')::jsonb->>'x-order-device','');
  for ord in select value from jsonb_array_elements(coalesce(new.snapshot->'drafts','[]')) loop
    select value into before_order from jsonb_array_elements(coalesce(old.snapshot->'drafts','[]')) where value->>'id' = ord->>'id';
    for entry in
      select key as vendor_id, 'confirmed'::text as kind, value as record from jsonb_each(coalesce(ord->'agreements','{}'))
      union all
      select d.key, 'sent', channel.value from jsonb_each(coalesce(ord->'deliveries','{}')) d
        cross join lateral jsonb_each(d.value) channel where channel.value->>'sent' = 'true'
    loop
      rec := entry.record; supplier := entry.vendor_id; kind := entry.kind;
      -- Old acknowledgements can remain in a draft after quantities/prices change.
      -- Only notify when the acknowledgement matches the current lines.
      if (rec->>'version')::jsonb is distinct from (
        select jsonb_agg(jsonb_build_array(line->'id',line->'qty',line->'net',line->'gross'))
        from jsonb_array_elements(coalesce(ord->'lines','[]')) line where line->>'vendorId'=supplier
      ) then continue; end if;
      if kind = 'confirmed' then
        previous := before_order->'agreements'->supplier;
        if previous->>'version' = rec->>'version' then continue; end if;
        title := case when rec->>'changed' = 'true' then 'Pedido confirmado con cambios' else 'Pedido confirmado' end;
      else
        if exists(select 1 from jsonb_each(coalesce(before_order->'deliveries'->supplier,'{}')) where value->>'sent'='true' and value->>'version'=rec->>'version') then continue; end if;
        title := 'Pedido enviado';
      end if;
      select value->>'name' into destination from jsonb_array_elements(coalesce(new.snapshot->'vendors','[]')) where value->>'id'=supplier;
      event_key := md5(new.owner_id::text || (ord->>'id') || supplier || kind || coalesce(rec->>'version',''));
      insert into public.order_push_jobs(device_id,event_key,payload)
      select id,event_key,jsonb_build_object('title',title,'body',coalesce(destination,'Proveedor') || ' · Toca para ver el pedido.',
        'orderId',ord->>'id','tag',event_key)
      from public.order_push_devices where owner_id=new.owner_id and active and id::text <> source
      on conflict do nothing;
    end loop;
  end loop;
  perform private.dispatch_order_push();
  return new;
end;
$$;
revoke all on function private.queue_order_push() from public, anon, authenticated;
create trigger order_workspace_push after update of snapshot on public.order_workspaces for each row execute function private.queue_order_push();
select cron.schedule('order-push-retry','* * * * *','select private.dispatch_order_push()');

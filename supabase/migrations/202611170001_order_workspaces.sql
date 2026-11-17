create table public.order_workspaces (
  owner_id uuid primary key references auth.users(id) on delete cascade default auth.uid(),
  revision bigint not null default 1 check (revision > 0),
  snapshot jsonb not null check (jsonb_typeof(snapshot) = 'object')
);

alter table public.order_workspaces enable row level security;
revoke all on public.order_workspaces from anon, authenticated;
grant select on public.order_workspaces to authenticated;
grant insert (snapshot), update (snapshot, revision) on public.order_workspaces to authenticated;

create policy "Owners read their workspace" on public.order_workspaces
  for select to authenticated using (owner_id = (select auth.uid()));
create policy "Owners create their workspace" on public.order_workspaces
  for insert to authenticated with check (owner_id = (select auth.uid()));
create policy "Owners update their workspace" on public.order_workspaces
  for update to authenticated
  using (owner_id = (select auth.uid()))
  with check (owner_id = (select auth.uid()));

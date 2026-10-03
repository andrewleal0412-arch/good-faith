-- Workspaces, part 2: the templates a demo copy is made from, the pre-paid sandbox deposits, and the day's copy count.
-- Additive: new tables, a default and a not-null on the new workspace columns (every row already has one), and a
-- guard that keeps the owner workspace. Nothing existing is dropped or rewritten.

create or replace function public.owner_workspace_id()
returns uuid
language sql
stable
set search_path = ''
as $$
  select id from public.workspaces where kind = 'owner'
$$;
revoke execute on function public.owner_workspace_id() from public, anon, authenticated;
grant execute on function public.owner_workspace_id() to service_role;

-- A writer that doesn't name a workspace writes into the owner's, never into a visitor's copy.
alter table public.properties alter column workspace_id set default public.owner_workspace_id();
alter table public.tenancies alter column workspace_id set default public.owner_workspace_id();
alter table public.properties alter column workspace_id set not null;
alter table public.tenancies alter column workspace_id set not null;
create index workspaces_demo_created_idx on public.workspaces (created_at) where kind = 'demo';

-- The owner workspace is never deleted, and no workspace changes kind.
create or replace function public.keep_owner_workspace()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' and old.kind = 'owner' then
    raise exception 'the owner workspace is never deleted';
  end if;
  if tg_op = 'UPDATE' and new.kind is distinct from old.kind then
    raise exception 'a workspace keeps its kind';
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end
$$;
revoke execute on function public.keep_owner_workspace() from public, anon, authenticated;
create trigger workspaces_keep_owner before delete or update on public.workspaces
  for each row execute function public.keep_owner_workspace();

-- The tenancies a demo copy is made from. Read only: a template can't be deleted while it is listed here (restrict),
-- and the app never writes one. anchor is the template's own day the story turns on (the close-out for the closed
-- unit, the move-out for the move-out unit); in a copy that day falls days_ago days before the day it is made, and
-- every other date moves by the same number of days.
create table public.demo_templates (
  tenancy_id uuid primary key references public.tenancies(id) on delete restrict,
  role text not null unique check (role in ('closed', 'move_out')),
  anchor date not null,
  days_ago integer not null check (days_ago between 0 and 60),
  created_at timestamptz not null default now()
);
alter table public.demo_templates enable row level security;
revoke all on table public.demo_templates from anon, authenticated;

-- The two demo tenancies of this project, when they exist (a fresh project registers its own after seeding).
insert into public.demo_templates (tenancy_id, role, anchor, days_ago)
select v.tenancy_id, v.role, v.anchor, v.days_ago
from (values
  ('94ee6bca-7a26-4671-96b6-75498112155a'::uuid, 'closed', date '2026-10-01', 3),
  ('e06de0e7-70e2-4c8a-bb6c-1db47531e5ee'::uuid, 'move_out', date '2026-10-01', 1)
) as v(tenancy_id, role, anchor, days_ago)
join public.tenancies t on t.id = v.tenancy_id
on conflict do nothing;

-- Real deposits paid in the PayPal sandbox by the sandbox tenant (scripts/demo-pool.mjs), one per demo copy of the
-- move-out unit, so each copy's refund runs against its own payment. raw has the shape payments.raw keeps for a
-- deposit invoice: {id, payLink, transactions}. claimed_by has no foreign key, so a deposit claimed by a workspace
-- that was later removed still reads as used.
create table public.demo_deposit_pool (
  id uuid primary key default gen_random_uuid(),
  invoice_id text not null unique,
  capture_id text not null,
  amount numeric(12,2) not null check (amount > 0),
  payer_email text not null,
  paid_at timestamptz not null,
  raw jsonb not null,
  created_at timestamptz not null default now(),
  claimed_by uuid,
  claimed_at timestamptz,
  check ((claimed_by is null) = (claimed_at is null))
);
create index demo_deposit_pool_unclaimed_idx on public.demo_deposit_pool (paid_at) where claimed_by is null;
create index demo_deposit_pool_claimed_idx on public.demo_deposit_pool (claimed_by) where claimed_by is not null;
alter table public.demo_deposit_pool enable row level security;
revoke all on table public.demo_deposit_pool from anon, authenticated;

-- New demo copies per day: so many per caller address (ip_key is a keyed hash of the address, never the address
-- itself) and a total across every address ('*'). Counted in create_demo_workspace, in the same transaction as the
-- copy, so a copy that fails counts nothing. The Pacific day, as for daily_usage.
create table public.demo_copy_usage (
  day date not null,
  ip_key text not null check (length(ip_key) between 1 and 64),
  used integer not null default 0 check (used >= 0),
  updated_at timestamptz not null default now(),
  primary key (day, ip_key)
);
alter table public.demo_copy_usage enable row level security;
revoke all on table public.demo_copy_usage from anon, authenticated;

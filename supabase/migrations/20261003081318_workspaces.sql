-- Workspaces, part 1: the table and the workspace column on properties and tenancies. Every existing row goes to the
-- one owner workspace. Additive: a new table and two new columns; nothing existing is dropped or rewritten.
create table public.workspaces (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('owner', 'demo')),
  label text,
  created_at timestamptz not null default now(),
  last_seen_at timestamptz
);
create unique index workspaces_one_owner_idx on public.workspaces (kind) where kind = 'owner';
alter table public.workspaces enable row level security;
revoke all on table public.workspaces from anon, authenticated;
insert into public.workspaces (kind, label) values ('owner', 'Owner');

alter table public.properties add column workspace_id uuid references public.workspaces(id);
alter table public.tenancies add column workspace_id uuid references public.workspaces(id);
update public.properties set workspace_id = (select id from public.workspaces where kind = 'owner') where workspace_id is null;
update public.tenancies set workspace_id = (select id from public.workspaces where kind = 'owner') where workspace_id is null;
create index properties_workspace_idx on public.properties (workspace_id);
create index tenancies_workspace_idx on public.tenancies (workspace_id, created_at);

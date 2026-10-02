-- One agent run (e.g. the move-out close-out). The full model conversation is kept so a run that pauses for the
-- landlord's approval can resume exactly where it stopped, and so every step is reviewable afterwards.
create table public.agent_runs (
  id uuid primary key default gen_random_uuid(),
  tenancy_id uuid not null references public.tenancies(id) on delete cascade,
  kind text not null check (kind in ('close_out')),
  status text not null check (status in ('running', 'awaiting_approval', 'done', 'failed')),
  messages jsonb not null default '[]',
  pending jsonb,
  error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index agent_runs_tenancy_idx on public.agent_runs (tenancy_id, created_at desc);
alter table public.agent_runs enable row level security;

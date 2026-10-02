-- Move-out deductions (Civ. Code 1950.5(b)(1)-(3)). The chargeable amount and its explanation are computed on the
-- server from the inputs below, never typed in. Each row snapshots the inspection finding it came from, so running
-- the inspection again doesn't orphan it.
create table public.deductions (
  id uuid primary key default gen_random_uuid(),
  tenancy_id uuid not null references public.tenancies(id) on delete cascade,
  category text not null check (category in ('rent', 'damage', 'cleaning')),
  room text,
  item text not null,
  finding jsonb,
  work text not null check (work in ('repair', 'replace', 'clean', 'other')),
  performer text not null check (performer in ('vendor', 'own_labor')),
  billed numeric(10,2) not null check (billed >= 0),
  hours numeric(6,2),
  hourly_rate numeric(8,2),
  labor_description text,
  vendor jsonb,
  proration text not null default 'none' check (proration in ('none', 'useful_life', 'paint_schedule')),
  item_age_years numeric(5,2),
  useful_life_years numeric(5,2),
  amount numeric(10,2) not null check (amount >= 0),
  math text not null,
  is_estimate boolean not null default false,
  receipt_path text,
  after_photo_paths text[] not null default '{}',
  created_at timestamptz not null default now()
);
create index deductions_tenancy_idx on public.deductions (tenancy_id);
alter table public.deductions enable row level security;

insert into storage.buckets (id, name, public) values ('receipts', 'receipts', false) on conflict (id) do nothing;

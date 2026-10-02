-- Deposit Agent: California security deposits from move-in to refund (PayPal AI Hackathon, 2026-10-01).
-- Only the Next.js server talks to the database, with the secret key. RLS is on with no policies, so the
-- public (anon/publishable) key can read and write nothing.

create table public.properties (
  id uuid primary key default gen_random_uuid(),
  address text not null,
  city text,
  owner_name text,
  owner_type text not null default 'unknown',
  owner_property_count int,
  owner_unit_count int,
  created_at timestamptz not null default now()
);

create table public.tenancies (
  id uuid primary key default gen_random_uuid(),
  property_id uuid not null references public.properties(id) on delete cascade,
  tenants jsonb not null default '[]',            -- [{name, email}]
  monthly_rent numeric(12,2),
  deposit_amount numeric(12,2),
  other_charges jsonb not null default '[]',      -- [{label, amount, refundable, quote}]
  start_date date,
  end_date date,
  move_out_date date,
  lease_pdf_path text,                            -- storage: leases bucket
  lease_terms jsonb,                              -- what Claude extracted
  lease_flags jsonb not null default '[]',        -- rules engine output (docs/LEGAL_RULES.md ids)
  refund_agreement jsonb,                         -- AB 414: {method, paypal_email, signed_by[], signed_at}
  status text not null default 'move_in'
    check (status in ('move_in','active','moving_out','statement_sent','closed')),
  created_at timestamptz not null default now()
);

create table public.photos (
  id uuid primary key default gen_random_uuid(),
  tenancy_id uuid not null references public.tenancies(id) on delete cascade,
  phase text not null check (phase in ('move_in','move_out_before','move_out_after')),  -- Civ. Code 1950.5(g)
  room text not null,
  storage_path text not null,                     -- storage: photos bucket
  caption text,
  taken_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create table public.payments (
  id uuid primary key default gen_random_uuid(),
  tenancy_id uuid not null references public.tenancies(id) on delete cascade,
  kind text not null check (kind in ('deposit_invoice','refund','payout','damage_invoice')),
  paypal_id text,
  amount numeric(12,2) not null,
  status text not null,
  raw jsonb,
  created_at timestamptz not null default now()
);

create table public.audit_log (
  id bigint generated always as identity primary key,
  tenancy_id uuid references public.tenancies(id) on delete cascade,
  actor text not null check (actor in ('agent','landlord','tenant','system')),
  action text not null,
  detail jsonb,
  created_at timestamptz not null default now()
);

create index on public.tenancies (property_id);
create index on public.photos (tenancy_id, phase);
create index on public.payments (tenancy_id);
create index on public.audit_log (tenancy_id, created_at);

alter table public.properties enable row level security;
alter table public.tenancies enable row level security;
alter table public.photos enable row level security;
alter table public.payments enable row level security;
alter table public.audit_log enable row level security;

-- Private buckets; the server hands out short-lived signed URLs.
insert into storage.buckets (id, name, public) values ('leases', 'leases', false), ('photos', 'photos', false)
on conflict (id) do nothing;

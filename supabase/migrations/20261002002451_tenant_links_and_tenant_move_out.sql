-- Private tenant links (/t/<token>). The token is 32 random bytes in base64url, shown to the landlord once and never
-- stored: the table keeps its SHA-256, so a copy of the database opens no tenant page. Unknown and revoked tokens
-- answer 404 with no detail. Row level security on with no policies, like every other table: only the server reads it.
create table public.tenant_links (
  id uuid primary key default gen_random_uuid(),
  tenancy_id uuid not null references public.tenancies(id) on delete cascade,
  token_hash text not null unique,
  created_at timestamptz not null default now(),
  revoked_at timestamptz,
  last_seen_at timestamptz
);
create index tenant_links_tenancy_id_idx on public.tenant_links (tenancy_id);
alter table public.tenant_links enable row level security;

-- What the tenants send through their link: that they are moving out, the planned date, and the forwarding address
-- the itemized statement is mailed to (Civ. Code 1950.5(h)(6)). One record per tenancy; a repeat replaces it.
alter table public.tenancies add column tenant_move_out jsonb;

-- Replaces the record under a row lock and keeps the first submission's time, so two submissions at once (a double
-- tap, two roommates) neither duplicate nor drop each other. Returns the record replaced and the one now stored.
create or replace function public.set_tenant_move_out(p_tenancy uuid, p_record jsonb)
returns jsonb
language plpgsql
as $$
declare
  prev jsonb;
  next_record jsonb;
begin
  select tenant_move_out into prev from public.tenancies where id = p_tenancy for update;
  if not found then
    return null;
  end if;
  next_record := p_record || jsonb_build_object('submitted_at', coalesce(prev ->> 'submitted_at', p_record ->> 'submitted_at'));
  update public.tenancies set tenant_move_out = next_record where id = p_tenancy;
  return jsonb_build_object('previous', prev, 'record', next_record);
end
$$;
revoke execute on function public.set_tenant_move_out(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.set_tenant_move_out(uuid, jsonb) to service_role;

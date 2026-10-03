-- State rule packs (src/lib/states/): which state's deposit law a property follows, and the records the other states'
-- packs keep. Additive only: a new column whose default backfills every existing property (and every demo copy made by
-- copy_demo_template, which does not list it) to California, and a new function beside set_notice. Nothing existing is
-- dropped, rewritten or replaced.

alter table public.properties add column if not exists state text not null default 'CA';
alter table public.properties drop constraint if exists properties_state_code;
alter table public.properties add constraint properties_state_code check (state ~ '^[A-Z]{2}$');
comment on column public.properties.state is 'USPS code of the state whose deposit law the property follows (src/lib/states/); CA for everything made before the state packs';

-- The records the New York, Texas, Florida and Washington packs keep in tenancies.notices, next to California's two
-- notices (which set_notice keeps writing): the move-in inspection offer (NY), the account the deposit is held in and
-- its notice (NY, FL, WA), Florida's holding notice, Washington's signed move-in checklist, the tenant's written
-- forwarding address (TX), Florida's claim notice and the tenant's objection to it. Same atomic merge as set_notice.
create or replace function public.set_state_notice(p_tenancy uuid, p_kind text, p_record jsonb)
returns jsonb
language plpgsql
set search_path = public, pg_temp
as $$
declare
  prev jsonb;
begin
  if p_kind not in ('move_in_inspection', 'deposit_account', 'holding_notice', 'move_in_checklist',
                    'forwarding_address', 'claim_notice', 'claim_objection') then
    raise exception 'unknown state notice kind %', p_kind;
  end if;
  select coalesce(notices, '{}'::jsonb) into prev from public.tenancies where id = p_tenancy for update;
  if not found then
    return null;
  end if;
  update public.tenancies set notices = prev || jsonb_build_object(p_kind, p_record) where id = p_tenancy;
  return jsonb_build_object('previous', prev -> p_kind, 'notices', prev || jsonb_build_object(p_kind, p_record));
end
$$;

comment on function public.set_state_notice(uuid, text, jsonb) is 'Records one of the state packs'' records (NY, TX, FL, WA) atomically, as set_notice does for California''s notices. Returns {previous, notices} or null when the tenancy does not exist.';

revoke execute on function public.set_state_notice(uuid, text, jsonb) from public, anon, authenticated;
grant execute on function public.set_state_notice(uuid, text, jsonb) to service_role;

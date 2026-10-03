-- Review fixes to the state rule packs. Additive only: a new nullable column, and set_state_notice (added earlier today,
-- called only by the new code) accepting one more record kind. Nothing existing is dropped or narrowed; the live site
-- reads neither.

-- Who gave the notice to end the tenancy. New York's inspection-rights notice is not owed only when the tenant ends the
-- tenancy with less than two weeks' notice (GOL 7-108(1-a)(d), docs/rules/NY.md N16); after the landlord's notice it is
-- always owed. Null when not recorded, which the app treats as owed. Demo copies (copy_demo_template lists its
-- columns) get null, and their California templates never read it.
alter table public.tenancies add column if not exists notice_given_by text;
alter table public.tenancies drop constraint if exists tenancies_notice_given_by;
alter table public.tenancies add constraint tenancies_notice_given_by check (notice_given_by is null or notice_given_by in ('tenant', 'landlord'));
comment on column public.tenancies.notice_given_by is 'Who gave the notice to end the tenancy (tenant or landlord); null if not recorded. Read by the New York pack (src/lib/states/ny.ts).';

-- The same atomic merge as before, with New York's late_acknowledgment: the landlord's recorded reason for keeping a
-- deduction after day 14 (GOL 7-108(1-a)(e), docs/rules/NY.md N21, action W).
create or replace function public.set_state_notice(p_tenancy uuid, p_kind text, p_record jsonb)
returns jsonb
language plpgsql
set search_path = public, pg_temp
as $$
declare
  prev jsonb;
begin
  if p_kind not in ('move_in_inspection', 'deposit_account', 'holding_notice', 'move_in_checklist',
                    'forwarding_address', 'claim_notice', 'claim_objection', 'late_acknowledgment') then
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

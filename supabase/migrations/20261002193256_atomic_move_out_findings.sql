-- Atomic writes to tenancies.move_out_findings. The findings routes and the inspection used to read the array, change
-- it in JavaScript and write the whole column back, so two reviews in flight (dismiss one finding, reopen another)
-- lost one of them. Each function locks the tenancy row, changes only what it names and writes, in one transaction.
-- Only the server's service role may call them.

-- Set one finding's review status (null reopens it), or remove it. Returns the finding as it was before, or null when
-- the tenancy or the finding is gone (a newer comparison replaced it).
create or replace function public.set_move_out_finding(p_tenancy uuid, p_finding text, p_status text, p_remove boolean default false)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  cur jsonb;
  hit jsonb;
begin
  if p_status is not null and p_status not in ('accepted', 'dismissed') then
    raise exception 'unknown finding status %', p_status;
  end if;
  select coalesce(move_out_findings, '[]'::jsonb) into cur from public.tenancies where id = p_tenancy for update;
  if not found then
    return null;
  end if;
  select a.e into hit from jsonb_array_elements(cur) as a(e) where a.e ->> 'id' = p_finding limit 1;
  if hit is null then
    return null;
  end if;
  update public.tenancies set move_out_findings = (
    select coalesce(jsonb_agg(case when a.e ->> 'id' = p_finding then jsonb_set(a.e, '{status}', coalesce(to_jsonb(p_status), 'null'::jsonb), true) else a.e end order by a.i), '[]'::jsonb)
    from jsonb_array_elements(cur) with ordinality as a(e, i)
    where not (p_remove and a.e ->> 'id' = p_finding)
  ) where id = p_tenancy;
  return hit;
end
$$;

-- Add one finding the landlord recorded by hand to the end of the list. Returns false when the tenancy is gone.
create or replace function public.append_move_out_finding(p_tenancy uuid, p_finding jsonb)
returns boolean
language plpgsql
set search_path = ''
as $$
begin
  perform 1 from public.tenancies where id = p_tenancy for update;
  if not found then
    return false;
  end if;
  update public.tenancies set move_out_findings = coalesce(move_out_findings, '[]'::jsonb) || jsonb_build_array(p_finding) where id = p_tenancy;
  return true;
end
$$;

-- Save a new comparison: its findings replace the suggested ones, and the findings the landlord added by hand stay,
-- read under the lock so one added while the comparison ran is kept. Returns false when the tenancy is gone.
create or replace function public.replace_suggested_findings(p_tenancy uuid, p_findings jsonb)
returns boolean
language plpgsql
set search_path = ''
as $$
declare
  cur jsonb;
begin
  select coalesce(move_out_findings, '[]'::jsonb) into cur from public.tenancies where id = p_tenancy for update;
  if not found then
    return false;
  end if;
  update public.tenancies set
    move_out_findings = coalesce(p_findings, '[]'::jsonb) || coalesce((
      select jsonb_agg(a.e order by a.i) from jsonb_array_elements(cur) with ordinality as a(e, i) where a.e ->> 'source' = 'landlord'
    ), '[]'::jsonb),
    move_out_inspected_at = now(),
    status = 'moving_out'
  where id = p_tenancy;
  return true;
end
$$;

revoke execute on function public.set_move_out_finding(uuid, text, text, boolean) from public, anon, authenticated;
grant execute on function public.set_move_out_finding(uuid, text, text, boolean) to service_role;
revoke execute on function public.append_move_out_finding(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.append_move_out_finding(uuid, jsonb) to service_role;
revoke execute on function public.replace_suggested_findings(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.replace_suggested_findings(uuid, jsonb) to service_role;

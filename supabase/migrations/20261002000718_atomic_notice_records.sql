-- Atomic writes to tenancies.notices (one record per notice kind). The API routes used to read the object, spread
-- in the new kind and write it back, so two requests that interleaved dropped one record. Each function locks the
-- row, applies its change and returns the record it replaced, in one transaction.

create or replace function public.set_notice(p_tenancy uuid, p_kind text, p_record jsonb)
returns jsonb
language plpgsql
as $$
declare
  prev jsonb;
begin
  if p_kind not in ('inspection', 'electronic_refund') then
    raise exception 'unknown notice kind %', p_kind;
  end if;
  select coalesce(notices, '{}'::jsonb) into prev from public.tenancies where id = p_tenancy for update;
  if not found then
    return null;
  end if;
  update public.tenancies set notices = prev || jsonb_build_object(p_kind, p_record) where id = p_tenancy;
  return jsonb_build_object('previous', prev -> p_kind, 'notices', prev || jsonb_build_object(p_kind, p_record));
end
$$;

create or replace function public.remove_notice(p_tenancy uuid, p_kind text)
returns jsonb
language plpgsql
as $$
declare
  prev jsonb;
begin
  select coalesce(notices, '{}'::jsonb) into prev from public.tenancies where id = p_tenancy for update;
  if not found then
    return null;
  end if;
  if not (prev ? p_kind) then
    return jsonb_build_object('previous', null, 'notices', prev);
  end if;
  update public.tenancies set notices = prev - p_kind where id = p_tenancy;
  return jsonb_build_object('previous', prev -> p_kind, 'notices', prev - p_kind);
end
$$;

comment on function public.set_notice(uuid, text, jsonb) is 'Records that a notice was given, atomically: locks the tenancy row and merges the record into notices by kind. Returns {previous, notices} or null when the tenancy does not exist.';
comment on function public.remove_notice(uuid, text) is 'Undoes a notice record atomically. Returns {previous, notices}; previous is null when the kind was not recorded.';

-- Only the server (service role) calls these; nothing public or signed in may.
revoke execute on function public.set_notice(uuid, text, jsonb) from public, anon, authenticated;
revoke execute on function public.remove_notice(uuid, text) from public, anon, authenticated;
grant execute on function public.set_notice(uuid, text, jsonb) to service_role;
grant execute on function public.remove_notice(uuid, text) to service_role;

-- Jev's reads on the landlord's finding form (src/lib/jev.ts, POST /api/tenancies/[id]/findings/classify) take one
-- unit each of a new usage kind, 'jev', with its own day's total, 'jev_total', so typing never spends the Claude
-- allowance ('ai_total'). Additive: the kind check widens, and take_usage and give_back_usage are the same functions
-- with 'jev' added to the kinds they accept (pooled under 'jev_total'). Every kind they took before is taken as before,
-- so the hosted demo's running build keeps working against this database.

alter table public.daily_usage drop constraint daily_usage_kind_check;
alter table public.daily_usage add constraint daily_usage_kind_check check (kind in (
  'lease', 'inspect', 'close_out', 'invoice', 'tenancy', 'upload_mb', 'advocate', 'jev',
  'ai_total', 'invoice_total', 'tenancy_total', 'upload_mb_total', 'jev_total'
));

create or replace function public.take_usage(p_session text, p_kind text, p_units integer, p_session_limit integer, p_global_limit integer)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  d date := (now() at time zone 'America/Los_Angeles')::date;
  pool text;
  g integer;
  s integer;
begin
  if p_kind is null or p_kind not in ('lease', 'inspect', 'close_out', 'invoice', 'tenancy', 'upload_mb', 'advocate', 'jev') then
    raise exception 'unknown usage kind %', p_kind;
  end if;
  if p_session is null or p_session = '' or p_session = '*' or length(p_session) > 64 then
    raise exception 'bad session id';
  end if;
  if p_units is null or p_units < 1 or p_units > 1000 then
    raise exception 'bad units %', p_units;
  end if;
  pool := case p_kind
    when 'invoice' then 'invoice_total'
    when 'tenancy' then 'tenancy_total'
    when 'upload_mb' then 'upload_mb_total'
    when 'jev' then 'jev_total'
    else 'ai_total'
  end;
  insert into public.daily_usage (day, session_id, kind) values (d, '*', pool) on conflict do nothing;
  select used into g from public.daily_usage where day = d and session_id = '*' and kind = pool for update;
  insert into public.daily_usage (day, session_id, kind) values (d, p_session, p_kind) on conflict do nothing;
  select used into s from public.daily_usage where day = d and session_id = p_session and kind = p_kind for update;
  if p_global_limit is not null and g + p_units > p_global_limit then
    return jsonb_build_object('allowed', false, 'reason', 'global', 'day', d, 'used', s, 'limit', p_session_limit, 'total_used', g, 'total_limit', p_global_limit);
  end if;
  if p_session_limit is not null and s + p_units > p_session_limit then
    return jsonb_build_object('allowed', false, 'reason', 'session', 'day', d, 'used', s, 'limit', p_session_limit, 'total_used', g, 'total_limit', p_global_limit);
  end if;
  update public.daily_usage set used = used + p_units, updated_at = now() where day = d and session_id = '*' and kind = pool;
  update public.daily_usage set used = used + p_units, updated_at = now() where day = d and session_id = p_session and kind = p_kind;
  return jsonb_build_object('allowed', true, 'reason', null, 'day', d, 'used', s + p_units, 'limit', p_session_limit, 'total_used', g + p_units, 'total_limit', p_global_limit);
end
$$;

create or replace function public.give_back_usage(p_day date, p_session text, p_kind text, p_units integer)
returns void
language plpgsql
set search_path = ''
as $$
declare
  pool text;
begin
  if p_kind is null or p_kind not in ('lease', 'inspect', 'close_out', 'invoice', 'tenancy', 'upload_mb', 'advocate', 'jev') then
    raise exception 'unknown usage kind %', p_kind;
  end if;
  if p_day is null or p_session is null or p_session = '*' or p_units is null or p_units < 1 or p_units > 1000 then
    raise exception 'bad give-back';
  end if;
  pool := case p_kind
    when 'invoice' then 'invoice_total'
    when 'tenancy' then 'tenancy_total'
    when 'upload_mb' then 'upload_mb_total'
    when 'jev' then 'jev_total'
    else 'ai_total'
  end;
  update public.daily_usage set used = greatest(used - p_units, 0), updated_at = now() where day = p_day and session_id = '*' and kind = pool;
  update public.daily_usage set used = greatest(used - p_units, 0), updated_at = now() where day = p_day and session_id = p_session and kind = p_kind;
end
$$;

revoke execute on function public.take_usage(text, text, integer, integer, integer) from public, anon, authenticated;
grant execute on function public.take_usage(text, text, integer, integer, integer) to service_role;
revoke execute on function public.give_back_usage(date, text, text, integer) from public, anon, authenticated;
grant execute on function public.give_back_usage(date, text, text, integer) to service_role;

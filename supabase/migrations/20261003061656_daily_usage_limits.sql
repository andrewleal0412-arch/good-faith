-- Daily limits for the hosted demo. Each Claude job (a lease extraction, a move-out inspection, a close-out agent run)
-- and each PayPal sandbox invoice takes one unit of today's allowance before it starts: so many per session, and a
-- total across every session for the Claude jobs (and one for invoices). The day is the Pacific calendar day.
-- take_ai_run locks the total's row and then the session's row and checks and counts in one transaction, so requests
-- that arrive together can't go past a limit. Only the server's service role may call it; the table has RLS on and
-- no policies, like every other table here.
create table public.daily_usage (
  day date not null,
  session_id text not null, -- the session's id from its signed cookie, or '*' for the day's totals
  kind text not null check (kind in ('lease', 'inspect', 'close_out', 'invoice', 'ai_total', 'invoice_total')),
  used integer not null default 0 check (used >= 0),
  updated_at timestamptz not null default now(),
  primary key (day, session_id, kind)
);
alter table public.daily_usage enable row level security;
revoke all on table public.daily_usage from anon, authenticated;

-- Take one run of p_kind for p_session if today's counts allow it. A null limit means no limit (the owner's session
-- has no per-session limit but still counts toward the total). Returns {allowed, reason: 'session' | 'global' | null,
-- used, limit, total_used, total_limit}.
create or replace function public.take_ai_run(p_session text, p_kind text, p_session_limit integer, p_global_limit integer)
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
  if p_kind is null or p_kind not in ('lease', 'inspect', 'close_out', 'invoice') then
    raise exception 'unknown run kind %', p_kind;
  end if;
  if p_session is null or p_session = '' or p_session = '*' or length(p_session) > 64 then
    raise exception 'bad session id';
  end if;
  pool := case when p_kind = 'invoice' then 'invoice_total' else 'ai_total' end;
  -- The total's row first, then the session's, always in this order, so two requests never wait on each other.
  insert into public.daily_usage (day, session_id, kind) values (d, '*', pool) on conflict do nothing;
  select used into g from public.daily_usage where day = d and session_id = '*' and kind = pool for update;
  insert into public.daily_usage (day, session_id, kind) values (d, p_session, p_kind) on conflict do nothing;
  select used into s from public.daily_usage where day = d and session_id = p_session and kind = p_kind for update;
  if p_global_limit is not null and g >= p_global_limit then
    return jsonb_build_object('allowed', false, 'reason', 'global', 'used', s, 'limit', p_session_limit, 'total_used', g, 'total_limit', p_global_limit);
  end if;
  if p_session_limit is not null and s >= p_session_limit then
    return jsonb_build_object('allowed', false, 'reason', 'session', 'used', s, 'limit', p_session_limit, 'total_used', g, 'total_limit', p_global_limit);
  end if;
  update public.daily_usage set used = used + 1, updated_at = now() where day = d and session_id = '*' and kind = pool;
  update public.daily_usage set used = used + 1, updated_at = now() where day = d and session_id = p_session and kind = p_kind;
  return jsonb_build_object('allowed', true, 'reason', null, 'used', s + 1, 'limit', p_session_limit, 'total_used', g + 1, 'total_limit', p_global_limit);
end
$$;

revoke execute on function public.take_ai_run(text, text, integer, integer) from public, anon, authenticated;
grant execute on function public.take_ai_run(text, text, integer, integer) to service_role;

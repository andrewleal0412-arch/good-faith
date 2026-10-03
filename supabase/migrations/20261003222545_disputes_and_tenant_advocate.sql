-- Disputes and the tenant's advocate (round 1 of the two-agent settlement). After the itemized statement goes out, the
-- tenants can dispute deductions from their private link (/t/<token>): they pick the deductions, say why, may add
-- photos, ask their advocate (a Claude agent working for them) to write their case, and send it to the landlord. The
-- negotiation (landlord's negotiator, counters) and the settlement paid back through PayPal come in later rounds; their
-- tables are created here so the shape is settled once.
--
-- Additive only: three new tables, four new functions, and the daily-usage kind check and its two functions widened to
-- accept 'advocate' (every existing row and caller still passes; the signatures and grants are unchanged). Nothing
-- existing is dropped or rewritten. Row level security on with no policies, like every other table: only the server,
-- with the secret key, reads or writes them, and every route scopes them to a tenancy it has already resolved (the
-- landlord's workspace, or the tenants' link token).
--
-- Not copied into demo copies: copy_demo_template is unchanged, so a copy starts with no dispute. If round 3 wants a
-- copy that opens with a dispute in progress, copy these rows there (they reference only the tenancy, its deductions
-- by id, and storage paths under the copy's own workspace prefix).

-- 1. One dispute per tenancy at a time (a draft while the tenants write it, then open, negotiating, agreed, and finally
-- settled, no agreement or withdrawn).
create table public.disputes (
  id uuid primary key default gen_random_uuid(),
  tenancy_id uuid not null references public.tenancies(id) on delete cascade,
  workspace_id uuid references public.workspaces(id), -- the tenancy's, copied when the dispute is made
  link_id uuid references public.tenant_links(id) on delete set null, -- the tenant link it was opened through
  status text not null default 'draft'
    check (status in ('draft', 'open', 'negotiating', 'agreed', 'settled', 'no_agreement', 'withdrawn')),
  opened_by text, -- the tenant's name as it is on the lease
  deduction_ids uuid[] not null default '{}', -- the deductions the tenants dispute
  reasons jsonb not null default '{}'::jsonb, -- {deduction id: the tenants' reason, in their words}
  message text, -- anything else they want the landlord to read
  -- Their photos, in the photos bucket under ws/<workspace>/<tenancy>/dispute/<dispute>/:
  -- [{id, path, name, type, bytes, deduction_id, added_at}]
  evidence jsonb not null default '[]'::jsonb,
  statement_delivered_at timestamptz, -- which delivery of the itemized statement this disputes
  -- The advocate's latest case, after the code checked it against the lawful range (src/lib/advocate.ts).
  advocate jsonb,
  advocate_status text check (advocate_status in ('running', 'done', 'failed')),
  advocate_started_at timestamptz,
  advocate_error text,
  asked_back numeric(12,2) check (asked_back >= 0), -- what the tenants asked back when they sent it
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  sent_at timestamptz,
  closed_at timestamptz
);
create unique index disputes_one_live_idx on public.disputes (tenancy_id) where status in ('draft', 'open', 'negotiating', 'agreed');
create index disputes_tenancy_idx on public.disputes (tenancy_id, created_at desc);
create index disputes_workspace_idx on public.disputes (workspace_id, status);
alter table public.disputes enable row level security;
revoke all on table public.disputes from anon, authenticated;

-- 2. Every message in the negotiation, visible to both sides: who (tenant or landlord), whether their agent or they
-- themselves wrote it, the move, a proposal per deduction (what that side proposes the landlord keeps of it, checked
-- against the lawful range), the amount back that adds up to, the message, the reasoning and the citations.
create table public.negotiation_turns (
  id uuid primary key default gen_random_uuid(),
  dispute_id uuid not null references public.disputes(id) on delete cascade,
  tenancy_id uuid not null references public.tenancies(id) on delete cascade,
  n integer not null check (n >= 1),
  side text not null check (side in ('tenant', 'landlord')),
  actor text not null check (actor in ('agent', 'human')),
  move text not null check (move in ('case', 'concede', 'hold', 'counter', 'accept', 'reject', 'withdraw', 'note')),
  proposal jsonb not null default '[]'::jsonb, -- [{deduction_id, n, amount, keep, min, max}]
  total_keep numeric(12,2) check (total_keep >= 0),
  amount_back numeric(12,2) check (amount_back >= 0), -- back to the tenants on top of the statement's refund
  message text,
  reasoning text,
  citations jsonb not null default '[]'::jsonb,
  checks jsonb, -- what the code changed or refused (clamps to the range), so both sides can see it
  created_at timestamptz not null default now(),
  unique (dispute_id, n)
);
create index negotiation_turns_tenancy_idx on public.negotiation_turns (tenancy_id, created_at);
alter table public.negotiation_turns enable row level security;
revoke all on table public.negotiation_turns from anon, authenticated;

-- 3. The settlement: it takes effect only when the tenants accepted it and the landlord approved it; then the extra
-- amount goes back through PayPal (a refund of the original payment, or a Payout), recorded here.
create table public.settlements (
  id uuid primary key default gen_random_uuid(),
  dispute_id uuid not null unique references public.disputes(id) on delete cascade,
  tenancy_id uuid not null references public.tenancies(id) on delete cascade,
  turn_id uuid references public.negotiation_turns(id) on delete set null, -- the proposal agreed
  amount numeric(12,2) not null check (amount >= 0), -- back to the tenants on top of the statement's refund
  terms jsonb not null default '[]'::jsonb, -- the agreed keep per deduction
  status text not null default 'pending'
    check (status in ('pending', 'approved', 'sending', 'sent', 'failed', 'cancelled')),
  tenant_accepted_at timestamptz,
  tenant_name text,
  landlord_approved_at timestamptz,
  rail text check (rail in ('refund_original_payment', 'payout')),
  paypal_id text,
  paypal_status text,
  raw jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index settlements_tenancy_idx on public.settlements (tenancy_id);
alter table public.settlements enable row level security;
revoke all on table public.settlements from anon, authenticated;

-- 4. Claim the advocate's run on a draft, so a double tap can't spend two Claude calls: true when this caller may run
-- it (no run in progress, or the last one started more than p_stale_seconds ago and never finished).
create or replace function public.claim_advocate_run(p_dispute uuid, p_stale_seconds integer)
returns boolean
language plpgsql
set search_path = ''
as $$
declare
  d public.disputes;
begin
  select * into d from public.disputes where id = p_dispute for update;
  if not found or d.status <> 'draft' then
    return false;
  end if;
  if d.advocate_status = 'running' and d.advocate_started_at > now() - make_interval(secs => greatest(p_stale_seconds, 30)) then
    return false;
  end if;
  update public.disputes set advocate_status = 'running', advocate_started_at = now(), advocate_error = null, updated_at = now()
  where id = p_dispute;
  return true;
end
$$;

-- 5. Add photos to a draft under its row lock, at most p_max in all. Returns the evidence list now stored, or null when
-- the dispute is gone, no longer a draft, or would hold more than p_max.
create or replace function public.add_dispute_evidence(p_dispute uuid, p_items jsonb, p_max integer)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  cur jsonb;
  st text;
begin
  select evidence, status into cur, st from public.disputes where id = p_dispute for update;
  if not found or st <> 'draft' or jsonb_typeof(p_items) <> 'array' then
    return null;
  end if;
  if jsonb_array_length(cur) + jsonb_array_length(p_items) > p_max then
    return null;
  end if;
  update public.disputes set evidence = cur || p_items, updated_at = now() where id = p_dispute;
  return cur || p_items;
end
$$;

-- 6. Remove one photo from a draft. Returns the item removed (its path, for the storage removal), or null.
create or replace function public.remove_dispute_evidence(p_dispute uuid, p_item text)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  cur jsonb;
  st text;
  hit jsonb;
begin
  select evidence, status into cur, st from public.disputes where id = p_dispute for update;
  if not found or st <> 'draft' then
    return null;
  end if;
  select a.e into hit from jsonb_array_elements(cur) as a(e) where a.e ->> 'id' = p_item limit 1;
  if hit is null then
    return null;
  end if;
  update public.disputes set updated_at = now(), evidence = (
    select coalesce(jsonb_agg(a.e order by a.i), '[]'::jsonb) from jsonb_array_elements(cur) with ordinality as a(e, i) where a.e ->> 'id' <> p_item
  ) where id = p_dispute;
  return hit;
end
$$;

-- 7. Send a draft to the landlord: under its row lock, still a draft, then the tenants' case as turn 1 and the
-- dispute open, in one transaction. Returns the turn's id, or null when it was no longer a draft (a second tap).
create or replace function public.send_dispute(p_dispute uuid, p_turn jsonb, p_asked numeric)
returns uuid
language plpgsql
set search_path = ''
as $$
declare
  d public.disputes;
  turn_id uuid := gen_random_uuid();
begin
  select * into d from public.disputes where id = p_dispute for update;
  if not found or d.status <> 'draft' then
    return null;
  end if;
  insert into public.negotiation_turns (id, dispute_id, tenancy_id, n, side, actor, move, proposal, total_keep, amount_back, message, reasoning, citations, checks)
  values (turn_id, d.id, d.tenancy_id, 1, 'tenant', coalesce(p_turn ->> 'actor', 'human'), 'case',
    coalesce(p_turn -> 'proposal', '[]'::jsonb), (p_turn ->> 'total_keep')::numeric, (p_turn ->> 'amount_back')::numeric,
    p_turn ->> 'message', p_turn ->> 'reasoning', coalesce(p_turn -> 'citations', '[]'::jsonb), p_turn -> 'checks');
  update public.disputes set status = 'open', sent_at = now(), updated_at = now(), asked_back = p_asked where id = p_dispute;
  return turn_id;
end
$$;

revoke execute on function public.claim_advocate_run(uuid, integer) from public, anon, authenticated;
grant execute on function public.claim_advocate_run(uuid, integer) to service_role;
revoke execute on function public.add_dispute_evidence(uuid, jsonb, integer) from public, anon, authenticated;
grant execute on function public.add_dispute_evidence(uuid, jsonb, integer) to service_role;
revoke execute on function public.remove_dispute_evidence(uuid, text) from public, anon, authenticated;
grant execute on function public.remove_dispute_evidence(uuid, text) to service_role;
revoke execute on function public.send_dispute(uuid, jsonb, numeric) from public, anon, authenticated;
grant execute on function public.send_dispute(uuid, jsonb, numeric) to service_role;

-- 8. The advocate's runs count against today's Claude allowance like the other Claude jobs ('ai_total'), per tenant
-- link (src/lib/limits.ts). The kind check widens; take_usage and give_back_usage are the same functions with
-- 'advocate' added to the kinds they accept.
alter table public.daily_usage drop constraint daily_usage_kind_check;
alter table public.daily_usage add constraint daily_usage_kind_check check (kind in (
  'lease', 'inspect', 'close_out', 'invoice', 'tenancy', 'upload_mb', 'advocate',
  'ai_total', 'invoice_total', 'tenancy_total', 'upload_mb_total'
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
  if p_kind is null or p_kind not in ('lease', 'inspect', 'close_out', 'invoice', 'tenancy', 'upload_mb', 'advocate') then
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
  if p_kind is null or p_kind not in ('lease', 'inspect', 'close_out', 'invoice', 'tenancy', 'upload_mb', 'advocate') then
    raise exception 'unknown usage kind %', p_kind;
  end if;
  if p_day is null or p_session is null or p_session = '*' or p_units is null or p_units < 1 or p_units > 1000 then
    raise exception 'bad give-back';
  end if;
  pool := case p_kind
    when 'invoice' then 'invoice_total'
    when 'tenancy' then 'tenancy_total'
    when 'upload_mb' then 'upload_mb_total'
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

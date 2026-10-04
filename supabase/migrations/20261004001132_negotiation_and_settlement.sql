-- The two-agent settlement (round 2 of the tenants' dispute): the landlord's negotiator answers the tenants' case, the
-- two agents negotiate for at most three exchanges inside each charge's lawful range (src/lib/negotiator.ts), and a
-- settlement takes effect only when the tenants accepted it and the landlord approved it. Then the extra amount goes
-- back through PayPal (a partial refund of the original deposit payment through the Agent Toolkit, or a Payout) and
-- the amended itemized statement records it (src/lib/settlement.ts).
--
-- Additive only: five columns on disputes, two on settlements, the payments kind check widened to two new kinds (every
-- existing row and caller still passes), five new functions, and release_demo_deposit replaced with the same signature
-- and grants (a deposit a settlement refunded, or is refunding, is used and never goes back to the pool). Nothing is
-- dropped or rewritten; the hosted demo's code reads and writes nothing it didn't before.

-- 1. The landlord's policy for the negotiator, and where its run stands.
alter table public.disputes add column negotiator_policy jsonb; -- {autoConcede: boolean, limit: number | null}
alter table public.disputes add column negotiation_status text check (negotiation_status in ('running', 'done', 'failed'));
alter table public.disputes add column negotiation_started_at timestamptz;
alter table public.disputes add column negotiation_error text;
-- Why the agents stopped and both final positions: {reason: agreed | no_movement | exhausted | limit | stopped |
-- failed, landlord_back, tenant_back, wanted?, limit?, at}.
alter table public.disputes add column negotiation_outcome jsonb;

-- 2. The settlement's own error and the moment PayPal took it.
alter table public.settlements add column error text;
alter table public.settlements add column sent_at timestamptz;

-- 3. The money a settlement sent, in the payments ledger beside the deposit and the statement's refund.
alter table public.payments drop constraint payments_kind_check;
alter table public.payments add constraint payments_kind_check check (kind in (
  'deposit_invoice', 'refund', 'payout', 'damage_invoice', 'settlement_refund', 'settlement_payout'
));

-- 4. Claim the negotiator's run on a dispute, so a double click can't spend Claude calls twice: true when this caller may
-- run it (the dispute is sent and not settled, no payment is in flight, and no run is in progress or the last one
-- started more than p_stale_seconds ago and never finished).
create or replace function public.claim_negotiation_run(p_dispute uuid, p_stale_seconds integer)
returns boolean
language plpgsql
set search_path = ''
as $$
declare
  d public.disputes;
begin
  select * into d from public.disputes where id = p_dispute for update;
  if not found or d.status not in ('open', 'negotiating', 'no_agreement') then
    return false;
  end if;
  if d.negotiation_status = 'running' and d.negotiation_started_at > now() - make_interval(secs => greatest(p_stale_seconds, 30)) then
    return false;
  end if;
  update public.disputes set negotiation_status = 'running', negotiation_started_at = now(), negotiation_error = null, updated_at = now()
  where id = p_dispute;
  return true;
end
$$;

-- 5. One turn of the negotiation, under the dispute's row lock: the dispute must be in one of p_from and hold fewer than
-- p_max_turns turns, and no settlement payment may be in flight. The turn is numbered next, the dispute moves to
-- p_status, and:
-- - to 'agreed': the settlement is the turn's proposal (made, or remade from a cancelled one), waiting on both humans;
--   a tenant's own click (side tenant, actor human) counts as their acceptance;
-- - away from 'agreed': a settlement still waiting on approval is cancelled (a counter-offer replaced it);
-- - to 'no_agreement': the dispute is closed; any other status reopens it.
-- Returns the turn's id, or null when refused (a second click, or the other side moved first).
create or replace function public.negotiation_turn(p_dispute uuid, p_turn jsonb, p_from text[], p_status text, p_max_turns integer)
returns uuid
language plpgsql
set search_path = ''
as $$
declare
  d public.disputes;
  last_n integer;
  turn_id uuid := gen_random_uuid();
  tenant_click boolean := (p_turn ->> 'side') = 'tenant' and (p_turn ->> 'actor') = 'human';
begin
  if p_status not in ('negotiating', 'agreed', 'no_agreement') then
    raise exception 'bad status %', p_status;
  end if;
  select * into d from public.disputes where id = p_dispute for update;
  if not found or not (d.status = any (p_from)) then
    return null;
  end if;
  if exists (select 1 from public.settlements s where s.dispute_id = p_dispute and s.status in ('sending', 'sent')) then
    return null;
  end if;
  select coalesce(max(n), 0) into last_n from public.negotiation_turns where dispute_id = p_dispute;
  if last_n + 1 > p_max_turns then
    return null;
  end if;
  insert into public.negotiation_turns (id, dispute_id, tenancy_id, n, side, actor, move, proposal, total_keep, amount_back, message, reasoning, citations, checks)
  values (turn_id, d.id, d.tenancy_id, last_n + 1, p_turn ->> 'side', p_turn ->> 'actor', p_turn ->> 'move',
    coalesce(p_turn -> 'proposal', '[]'::jsonb), (p_turn ->> 'total_keep')::numeric, (p_turn ->> 'amount_back')::numeric,
    p_turn ->> 'message', p_turn ->> 'reasoning', coalesce(p_turn -> 'citations', '[]'::jsonb), p_turn -> 'checks');
  update public.disputes set status = p_status, updated_at = now(),
    closed_at = case when p_status = 'no_agreement' then now() else null end
  where id = p_dispute;
  if p_status = 'agreed' then
    insert into public.settlements (dispute_id, tenancy_id, turn_id, amount, terms, status, tenant_accepted_at, tenant_name)
    values (d.id, d.tenancy_id, turn_id, (p_turn ->> 'amount_back')::numeric, coalesce(p_turn -> 'proposal', '[]'::jsonb), 'pending',
      case when tenant_click then now() end, case when tenant_click then p_turn ->> 'tenant_name' end)
    on conflict (dispute_id) do update set turn_id = excluded.turn_id, amount = excluded.amount, terms = excluded.terms,
      status = 'pending', tenant_accepted_at = excluded.tenant_accepted_at, tenant_name = excluded.tenant_name,
      landlord_approved_at = null, rail = null, paypal_id = null, paypal_status = null, raw = null, error = null, sent_at = null,
      updated_at = now();
  elsif d.status = 'agreed' then
    update public.settlements set status = 'cancelled', updated_at = now() where dispute_id = p_dispute and status in ('pending', 'failed');
  end if;
  return turn_id;
end
$$;

-- 6. The tenants accept the settlement on their link: once, while it waits on them.
create or replace function public.accept_settlement(p_dispute uuid, p_name text)
returns boolean
language plpgsql
set search_path = ''
as $$
declare
  d public.disputes;
begin
  select * into d from public.disputes where id = p_dispute for update;
  if not found or d.status <> 'agreed' then
    return false;
  end if;
  update public.settlements set tenant_accepted_at = now(), tenant_name = p_name, updated_at = now()
  where dispute_id = p_dispute and status = 'pending' and tenant_accepted_at is null;
  return found;
end
$$;

-- 7. The landlord's "Approve and pay": claimed once, under both row locks, and only when the dispute is agreed and the
-- tenants accepted. A payment PayPal refused (paypal_status 'REFUSED') may be tried again; one PayPal never answered
-- may not, since PayPal may have sent it. Returns the settlement as it now stands ('sending'), or null.
create or replace function public.claim_settlement(p_dispute uuid)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  d public.disputes;
  s public.settlements;
begin
  select * into d from public.disputes where id = p_dispute for update;
  if not found or d.status <> 'agreed' then
    return null;
  end if;
  select * into s from public.settlements where dispute_id = p_dispute for update;
  if not found or s.tenant_accepted_at is null or not (s.status = 'pending' or (s.status = 'failed' and s.paypal_status = 'REFUSED')) then
    return null;
  end if;
  update public.settlements set status = 'sending', landlord_approved_at = now(), error = null, updated_at = now()
  where id = s.id returning * into s;
  return to_jsonb(s);
end
$$;

-- 8. How the payment ended, in one transaction:
-- - 'sent': the settlement is sent with its PayPal ids, the money is in payments (when any moved), the dispute settled;
-- - 'refused': PayPal said no, so nothing moved and it may be tried again;
-- - 'unknown': PayPal never answered, so it may have moved: not tried again until someone checks PayPal;
-- - 'blocked': the rules stopped it before PayPal was called, so it waits on approval again.
-- Only a settlement in 'sending' changes. Returns true when it did.
create or replace function public.finish_settlement(p_settlement uuid, p_outcome text, p_rail text, p_kind text, p_paypal_id text,
  p_paypal_status text, p_raw jsonb, p_error text)
returns boolean
language plpgsql
set search_path = ''
as $$
declare
  s public.settlements;
begin
  if p_outcome not in ('sent', 'refused', 'unknown', 'blocked') then
    raise exception 'bad outcome %', p_outcome;
  end if;
  select * into s from public.settlements where id = p_settlement for update;
  if not found or s.status <> 'sending' then
    return false;
  end if;
  if p_outcome = 'sent' then
    update public.settlements set status = 'sent', rail = p_rail, paypal_id = p_paypal_id, paypal_status = p_paypal_status, raw = p_raw,
      error = null, sent_at = now(), updated_at = now() where id = s.id;
    if s.amount > 0 and p_kind is not null then
      insert into public.payments (tenancy_id, kind, paypal_id, amount, status, raw)
      values (s.tenancy_id, p_kind, p_paypal_id, s.amount, p_paypal_status, p_raw);
    end if;
    update public.disputes set status = 'settled', closed_at = now(), updated_at = now() where id = s.dispute_id;
  elsif p_outcome = 'blocked' then
    update public.settlements set status = 'pending', landlord_approved_at = null, error = p_error, updated_at = now() where id = s.id;
  else
    update public.settlements set status = 'failed', rail = p_rail, paypal_status = case when p_outcome = 'refused' then 'REFUSED' else 'NO_RESPONSE' end,
      raw = p_raw, error = p_error, updated_at = now() where id = s.id;
  end if;
  return true;
end
$$;

revoke execute on function public.claim_negotiation_run(uuid, integer) from public, anon, authenticated;
grant execute on function public.claim_negotiation_run(uuid, integer) to service_role;
revoke execute on function public.negotiation_turn(uuid, jsonb, text[], text, integer) from public, anon, authenticated;
grant execute on function public.negotiation_turn(uuid, jsonb, text[], text, integer) to service_role;
revoke execute on function public.accept_settlement(uuid, text) from public, anon, authenticated;
grant execute on function public.accept_settlement(uuid, text) to service_role;
revoke execute on function public.claim_settlement(uuid) from public, anon, authenticated;
grant execute on function public.claim_settlement(uuid) to service_role;
revoke execute on function public.finish_settlement(uuid, text, text, text, text, text, jsonb, text) from public, anon, authenticated;
grant execute on function public.finish_settlement(uuid, text, text, text, text, text, jsonb, text) to service_role;

-- 9. release_demo_deposit (as in 20261003095529_demo_copy_review_fixes.sql) with one change: a deposit a settlement
-- refunded (or is refunding right now) is used too, so a partly refunded payment never goes back to the pool for the
-- next copy's close-out.
create or replace function public.release_demo_deposit(p_ws uuid)
returns integer
language plpgsql
set search_path = ''
as $$
declare
  released integer := 0;
begin
  if exists (select 1 from public.workspaces where id = p_ws and kind = 'owner') then
    raise exception 'the owner workspace holds no demo deposit';
  end if;
  with freed as (
    update public.demo_deposit_pool dp set claimed_by = null, claimed_at = null
    where dp.claimed_by = p_ws
      and not exists (
        select 1 from public.payments d join public.tenancies t on t.id = d.tenancy_id
        where t.workspace_id = p_ws and d.kind = 'deposit_invoice' and d.paypal_id = dp.invoice_id
          and (exists (select 1 from public.payments x where x.tenancy_id = d.tenancy_id and x.kind in ('refund', 'payout', 'settlement_refund', 'settlement_payout'))
            or exists (select 1 from public.audit_log l where l.tenancy_id = d.tenancy_id and l.action in ('refund_sent', 'settlement_paid'))
            or exists (select 1 from public.settlements s where s.tenancy_id = d.tenancy_id and s.status in ('sending', 'sent'))
            or exists (select 1 from public.agent_runs a where a.tenancy_id = d.tenancy_id and a.status = 'running')))
    returning dp.id
  )
  select count(*) into released from freed;
  return released;
end
$$;
revoke execute on function public.release_demo_deposit(uuid) from public, anon, authenticated;
grant execute on function public.release_demo_deposit(uuid) to service_role;

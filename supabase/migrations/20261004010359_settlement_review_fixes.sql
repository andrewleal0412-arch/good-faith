-- Review fixes for the two-agent settlement (20261004001132_negotiation_and_settlement.sql). A settlement PayPal never
-- answered (failed, NO_RESPONSE) could be reset by a later offer, accepted again and paid a second time; now nothing
-- moves it but a check with PayPal that sends the same request with the same idempotency key, so PayPal answers with
-- the first payment if it went and makes it once if it didn't (src/lib/settlement.ts).
--
-- Additive only: two columns on settlements, and four functions replaced with the same signatures and grants
-- (negotiation_turn, claim_settlement, release_demo_deposit; finish_settlement is unchanged). Nothing is dropped or
-- rewritten; the hosted demo's code calls none of these.

-- 1. Each attempt's idempotency key (PayPal-Request-Id for a refund, sender_batch_id for a Payout) and when it was
-- made: PayPal keeps refund keys 45 days and refuses a repeated batch id for 30, so a check reuses the key inside that.
alter table public.settlements add column paypal_request_id text;
alter table public.settlements add column paypal_requested_at timestamptz;

-- 2. negotiation_turn (as in 20261004001132) with four changes:
-- - no turn while a settlement payment is unconfirmed (failed, NO_RESPONSE), as while it is sending or sent;
-- - an agent's turn carries its number (p_turn.n), and one made before a human's offer landed is refused;
-- - at the cap of p_max_turns, a turn that agrees still goes in, so two humans can always close;
-- - leaving 'agreed' cancels only a settlement nothing was sent for (pending, or refused by PayPal), and a reused row
--   drops the old attempt's key.
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
  if exists (select 1 from public.settlements s where s.dispute_id = p_dispute
      and (s.status in ('sending', 'sent') or (s.status = 'failed' and s.paypal_status = 'NO_RESPONSE'))) then
    return null;
  end if;
  select coalesce(max(n), 0) into last_n from public.negotiation_turns where dispute_id = p_dispute;
  if (p_turn ->> 'n') is not null and (p_turn ->> 'n')::integer <> last_n + 1 then
    return null;
  end if;
  if last_n + 1 > p_max_turns and p_status <> 'agreed' then
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
      paypal_request_id = null, paypal_requested_at = null, updated_at = now();
  elsif d.status = 'agreed' then
    update public.settlements set status = 'cancelled', updated_at = now()
    where dispute_id = p_dispute and (status = 'pending' or (status = 'failed' and paypal_status = 'REFUSED'));
  end if;
  return turn_id;
end
$$;

-- 3. claim_settlement, same signature, two ways in, both once and under both row locks, and only when the dispute is
-- agreed and the tenants accepted:
-- - a fresh attempt (pending, refused by PayPal, or a claim that lost its process before it chose a rail, so before
--   PayPal was called): approved now, with a new idempotency key;
-- - a check of an attempt PayPal never confirmed (failed, NO_RESPONSE, or still sending ten minutes after the claim),
--   within 28 days of its key: the same key and rail again ('recheck' true).
-- settlement.ts records the rail, under the key, before it calls PayPal. Returns the settlement as it now stands, or null.
create or replace function public.claim_settlement(p_dispute uuid)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  d public.disputes;
  s public.settlements;
  stale boolean;
begin
  select * into d from public.disputes where id = p_dispute for update;
  if not found or d.status <> 'agreed' then
    return null;
  end if;
  select * into s from public.settlements where dispute_id = p_dispute for update;
  if not found or s.tenant_accepted_at is null then
    return null;
  end if;
  stale := s.status = 'sending' and s.updated_at < now() - interval '10 minutes';
  if s.status = 'pending' or (s.status = 'failed' and s.paypal_status = 'REFUSED') or (stale and s.rail is null) then
    update public.settlements set status = 'sending', landlord_approved_at = now(), error = null, rail = null,
      paypal_request_id = 'settlement-' || s.id::text || '-' || left(md5(gen_random_uuid()::text), 8), paypal_requested_at = now(),
      updated_at = now()
    where id = s.id returning * into s;
    return to_jsonb(s) || jsonb_build_object('recheck', false);
  end if;
  if s.paypal_request_id is not null and s.rail is not null and s.paypal_requested_at > now() - interval '28 days'
      and ((s.status = 'failed' and s.paypal_status = 'NO_RESPONSE') or stale) then
    update public.settlements set status = 'sending', error = null, updated_at = now() where id = s.id returning * into s;
    return to_jsonb(s) || jsonb_build_object('recheck', true);
  end if;
  return null;
end
$$;

revoke execute on function public.negotiation_turn(uuid, jsonb, text[], text, integer) from public, anon, authenticated;
grant execute on function public.negotiation_turn(uuid, jsonb, text[], text, integer) to service_role;
revoke execute on function public.claim_settlement(uuid) from public, anon, authenticated;
grant execute on function public.claim_settlement(uuid) to service_role;

-- 4. release_demo_deposit (as in 20261004001132) with one change: a deposit whose settlement PayPal never confirmed is
-- used too, since PayPal may have refunded part of it.
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
            or exists (select 1 from public.settlements s where s.tenancy_id = d.tenancy_id
              and (s.status in ('sending', 'sent') or (s.status = 'failed' and s.paypal_status = 'NO_RESPONSE')))
            or exists (select 1 from public.agent_runs a where a.tenancy_id = d.tenancy_id and a.status = 'running')))
    returning dp.id
  )
  select count(*) into released from freed;
  return released;
end
$$;
revoke execute on function public.release_demo_deposit(uuid) from public, anon, authenticated;
grant execute on function public.release_demo_deposit(uuid) to service_role;

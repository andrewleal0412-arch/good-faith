-- PayPal disputes and chargebacks: the landlord's response, prepared by the defense agent and sent only after the
-- landlord approves it (src/lib/chargeback.ts, src/lib/chargeback-agent.ts, src/lib/chargeback-store.ts).
--
-- Additive only: one new table, one new column, four new functions, one widened check, and release_demo_deposit
-- replaced with the same signature and grants. Nothing is dropped or rewritten; the hosted demo's code reads none of
-- this until the deploy.

-- 1. When the app last asked PayPal about a dispute itself (the Disputes API through the Agent Toolkit), as opposed to
--    hearing of it from the webhook.
alter table public.paypal_disputes add column checked_at timestamptz;

-- 2. Each response the defense agent prepared for a PayPal dispute, and what became of it. The landlord approves one
--    exact response (its hash), and only that one goes to PayPal:
--    preparing   the agent is at work (a run that never finished is taken over after p_stale_seconds);
--    ready       prepared and checked by code, waiting on the landlord;
--    declined    the landlord said no; nothing went to PayPal;
--    superseded  a newer preparation replaced it before it was approved;
--    sending     approved, PayPal being asked (claimed once, so a double click sends once);
--    sent        PayPal took it;
--    refused     PayPal said no, and nothing moved;
--    unknown     PayPal never answered a step, so it may have gone: nothing is sent again until "Check with PayPal"
--                reads the dispute and, if the step didn't go, sends the same request with the same key;
--    failed      the agent couldn't prepare one.
create table public.paypal_dispute_responses (
  id uuid primary key default gen_random_uuid(),
  dispute_id text not null references public.paypal_disputes(id) on delete cascade,
  tenancy_id uuid not null references public.tenancies(id) on delete cascade,
  workspace_id uuid references public.workspaces(id) on delete set null,
  status text not null default 'preparing'
    check (status in ('preparing', 'ready', 'declined', 'superseded', 'sending', 'sent', 'refused', 'unknown', 'failed')),
  -- refund_and_evidence (a refund of the owed part before the evidence) is allowed here but no longer made: PayPal
  -- refuses a partial refund while a case is open on the payment (tried in the sandbox on 2026-10-05).
  action text check (action in ('provide_evidence', 'refund_and_evidence', 'accept_claim', 'make_offer')),
  amount numeric(12,2),                                  -- the money it sends back, if any
  response jsonb,                                        -- the exact response the landlord approves (chargeback.ts)
  response_hash text,                                    -- what the approval was given for
  messages jsonb,                                        -- the agent's conversation, for the record
  model text,
  steps integer,
  progress jsonb not null default '{}'::jsonb,           -- each PayPal step as it went: {refund, evidence, accept, offer}
  paypal_request_id text,                                -- the idempotency key's stem, gf-dispute-<id>
  error text,
  started_at timestamptz not null default now(),
  approved_at timestamptz,
  sent_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index paypal_dispute_responses_tenancy_idx on public.paypal_dispute_responses (tenancy_id, created_at desc);
-- At most one response per dispute is in play at a time.
create unique index paypal_dispute_responses_one_open on public.paypal_dispute_responses (dispute_id)
  where status in ('preparing', 'ready', 'sending', 'unknown');
alter table public.paypal_dispute_responses enable row level security;
revoke all on table public.paypal_dispute_responses from anon, authenticated;

-- 3. Money PayPal itself sent back through a dispute (an accepted claim, an offer the tenants accepted, PayPal's own
--    decision), in the payments ledger beside the deposit and the refunds. Its paypal_id is the dispute's id.
alter table public.payments drop constraint payments_kind_check;
alter table public.payments add constraint payments_kind_check check (kind in (
  'deposit_invoice', 'refund', 'payout', 'damage_invoice', 'settlement_refund', 'settlement_payout', 'dispute_refund'
));

-- 4. Start a preparation: under the dispute's row lock, refused (null) while a response is being sent, is unconfirmed,
--    or another preparation started less than p_stale_seconds ago. A preparation older than that died with its
--    process and is marked failed; a ready one nobody approved is superseded. Returns the new response's id.
create or replace function public.claim_dispute_defense(p_dispute text, p_tenancy uuid, p_stale_seconds integer)
returns uuid
language plpgsql
set search_path = ''
as $$
declare
  d public.paypal_disputes;
  new_id uuid;
begin
  select * into d from public.paypal_disputes where id = p_dispute and tenancy_id = p_tenancy for update;
  if not found then
    return null;
  end if;
  if exists (select 1 from public.paypal_dispute_responses r where r.dispute_id = p_dispute
      and (r.status in ('sending', 'unknown')
        or (r.status = 'preparing' and r.started_at > now() - make_interval(secs => greatest(p_stale_seconds, 30))))) then
    return null;
  end if;
  update public.paypal_dispute_responses set status = 'failed', error = coalesce(error, 'The run stopped before it finished.'), updated_at = now()
  where dispute_id = p_dispute and status = 'preparing';
  update public.paypal_dispute_responses set status = 'superseded', updated_at = now()
  where dispute_id = p_dispute and status = 'ready';
  insert into public.paypal_dispute_responses (dispute_id, tenancy_id, workspace_id)
  values (d.id, d.tenancy_id, d.workspace_id) returning id into new_id;
  return new_id;
end
$$;

-- 5. The landlord's approval of one exact response: only a ready one whose hash matches what the page showed, claimed
--    once (to 'sending'), with its idempotency key's stem set the first time. Or a check of an unconfirmed one (p_hash
--    null and p_recheck true): 'unknown' back to 'sending', same key, so the same requests go again. Returns the row,
--    or null when refused.
create or replace function public.approve_dispute_response(p_response uuid, p_hash text, p_recheck boolean default false)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  r public.paypal_dispute_responses;
begin
  select * into r from public.paypal_dispute_responses where id = p_response for update;
  if not found then
    return null;
  end if;
  if p_recheck then
    if r.status <> 'unknown' then
      return null;
    end if;
  elsif r.status <> 'ready' or r.response_hash is distinct from p_hash then
    return null;
  end if;
  update public.paypal_dispute_responses
     set status = 'sending', approved_at = coalesce(approved_at, now()), error = null,
         paypal_request_id = coalesce(paypal_request_id, 'gf-dispute-' || r.id::text), updated_at = now()
   where id = r.id
  returning * into r;
  return to_jsonb(r);
end
$$;

-- 6. One PayPal step done while sending (a refund before the evidence goes): its record merged into progress, and the
--    money it moved in payments, once (a row of that kind and PayPal id already there is left alone). Only while the
--    response is sending. True when it was recorded.
create or replace function public.record_dispute_step(p_response uuid, p_progress jsonb, p_payment jsonb)
returns boolean
language plpgsql
set search_path = ''
as $$
declare
  r public.paypal_dispute_responses;
begin
  select * into r from public.paypal_dispute_responses where id = p_response for update;
  if not found or r.status <> 'sending' then
    return false;
  end if;
  update public.paypal_dispute_responses set progress = progress || coalesce(p_progress, '{}'::jsonb), updated_at = now() where id = r.id;
  if p_payment is not null and not exists (select 1 from public.payments p where p.tenancy_id = r.tenancy_id
      and p.kind = p_payment ->> 'kind' and p.paypal_id = p_payment ->> 'paypal_id') then
    insert into public.payments (tenancy_id, kind, paypal_id, amount, status, raw)
    values (r.tenancy_id, p_payment ->> 'kind', p_payment ->> 'paypal_id', (p_payment ->> 'amount')::numeric,
      p_payment ->> 'status', p_payment -> 'raw');
  end if;
  return true;
end
$$;

-- 7. How the sending ended: 'sent', 'refused' (PayPal said no and nothing moved), 'unknown' (no answer: it may have
--    gone), or 'blocked' (the guard stopped it before PayPal was asked: ready again, with the reason). Only a response
--    in 'sending' changes. True when it did.
create or replace function public.finish_dispute_response(p_response uuid, p_outcome text, p_progress jsonb, p_error text)
returns boolean
language plpgsql
set search_path = ''
as $$
declare
  r public.paypal_dispute_responses;
begin
  if p_outcome not in ('sent', 'refused', 'unknown', 'blocked') then
    raise exception 'bad outcome %', p_outcome;
  end if;
  select * into r from public.paypal_dispute_responses where id = p_response for update;
  if not found or r.status <> 'sending' then
    return false;
  end if;
  update public.paypal_dispute_responses
     set status = case p_outcome when 'blocked' then 'ready' else p_outcome end,
         approved_at = case when p_outcome = 'blocked' then null else approved_at end,
         progress = progress || coalesce(p_progress, '{}'::jsonb),
         error = p_error,
         sent_at = case when p_outcome = 'sent' then now() else sent_at end,
         updated_at = now()
   where id = r.id;
  return true;
end
$$;

revoke execute on function public.claim_dispute_defense(text, uuid, integer) from public, anon, authenticated;
grant execute on function public.claim_dispute_defense(text, uuid, integer) to service_role;
revoke execute on function public.approve_dispute_response(uuid, text, boolean) from public, anon, authenticated;
grant execute on function public.approve_dispute_response(uuid, text, boolean) to service_role;
revoke execute on function public.record_dispute_step(uuid, jsonb, jsonb) from public, anon, authenticated;
grant execute on function public.record_dispute_step(uuid, jsonb, jsonb) to service_role;
revoke execute on function public.finish_dispute_response(uuid, text, jsonb, text) from public, anon, authenticated;
grant execute on function public.finish_dispute_response(uuid, text, jsonb, text) to service_role;

-- 8. release_demo_deposit (as in 20261004010359_settlement_review_fixes.sql) with one change: a deposit the tenants
--    disputed with PayPal is used too. PayPal may hold it, refund it or reverse it, so it never goes back to the pool
--    for the next copy's close-out.
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
          and (exists (select 1 from public.payments x where x.tenancy_id = d.tenancy_id
                and x.kind in ('refund', 'payout', 'settlement_refund', 'settlement_payout', 'dispute_refund'))
            or exists (select 1 from public.audit_log l where l.tenancy_id = d.tenancy_id and l.action in ('refund_sent', 'settlement_paid'))
            or exists (select 1 from public.settlements s where s.tenancy_id = d.tenancy_id
              and (s.status in ('sending', 'sent') or (s.status = 'failed' and s.paypal_status = 'NO_RESPONSE')))
            or exists (select 1 from public.agent_runs a where a.tenancy_id = d.tenancy_id and a.status = 'running')
            or exists (select 1 from public.paypal_disputes pd where pd.tenancy_id = d.tenancy_id)
            or (dp.capture_id is not null and exists (select 1 from public.paypal_disputes pd2 where pd2.capture_id = dp.capture_id))))
    returning dp.id
  )
  select count(*) into released from freed;
  return released;
end
$$;
revoke execute on function public.release_demo_deposit(uuid) from public, anon, authenticated;
grant execute on function public.release_demo_deposit(uuid) to service_role;

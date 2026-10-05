-- Review fixes for the PayPal dispute defense (20261005100322_paypal_dispute_defense.sql).
--
-- Additive only: one new column, one new trigger function and its trigger, and four functions replaced with the same
-- signatures and grants. Nothing is dropped; the hosted demo's code calls none of the dispute functions until the
-- deploy, and release_demo_deposit only frees fewer deposits than before.

-- 1. A pool deposit the tenants disputed with PayPal is marked on the pool row itself, so the mark outlives the copy:
--    paypal_disputes rows go with their tenancy when the sweep removes a copy, and release_demo_deposit then can't see
--    them any more. Set by the trigger below whenever a dispute of the deposit's payment is stored (the webhook or
--    Check PayPal), and never cleared.
alter table public.demo_deposit_pool add column disputed_at timestamptz;

create or replace function public.mark_pool_deposit_disputed()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  update public.demo_deposit_pool dp set disputed_at = coalesce(dp.disputed_at, now())
  where dp.disputed_at is null
    and ((new.capture_id is not null and dp.capture_id = new.capture_id)
      or dp.invoice_id in (select p.paypal_id from public.payments p where p.tenancy_id = new.tenancy_id and p.kind = 'deposit_invoice'));
  return new;
end
$$;
revoke execute on function public.mark_pool_deposit_disputed() from public, anon, authenticated;

create trigger paypal_disputes_mark_pool
  after insert or update of capture_id, tenancy_id on public.paypal_disputes
  for each row execute function public.mark_pool_deposit_disputed();

-- The disputes already stored.
update public.demo_deposit_pool dp set disputed_at = now()
where dp.disputed_at is null and exists (select 1 from public.paypal_disputes pd where pd.capture_id = dp.capture_id);

-- 2. release_demo_deposit (as in 20261005100322_paypal_dispute_defense.sql) with one more condition: a deposit marked
--    disputed never goes back to the pool, whether or not its copy still exists.
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
      and dp.disputed_at is null
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

-- 3. A send whose process died between PayPal's call and its record (a restart, a request cut off) stays 'sending'
--    for good. After ten minutes it is taken as unconfirmed ('unknown'): "Check with PayPal" reads the dispute and
--    sends only what PayPal doesn't show, as for an answer that was lost. A send takes well under a minute (one
--    PayPal read, a few files, one PayPal write with a 60-second limit), so ten minutes never cuts one off that is
--    still running.
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
  update public.paypal_dispute_responses
     set status = 'unknown', error = coalesce(error, 'The send stopped before PayPal''s answer was recorded.'), updated_at = now()
   where dispute_id = p_dispute and status = 'sending' and updated_at < now() - interval '10 minutes';
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

-- 4. The approval, as before; and the check (p_recheck) now also takes a send stuck in 'sending' for over ten
--    minutes, the same way as an unconfirmed one.
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
    if r.status <> 'unknown' and not (r.status = 'sending' and r.updated_at < now() - interval '10 minutes') then
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

-- 5. How the sending ended, as before, with one more outcome: 'closed', when PayPal resolved the dispute before the
--    response went (or before it was confirmed). It is retired ('superseded', with the reason), never put back for
--    approval: nothing can be sent on a resolved dispute.
create or replace function public.finish_dispute_response(p_response uuid, p_outcome text, p_progress jsonb, p_error text)
returns boolean
language plpgsql
set search_path = ''
as $$
declare
  r public.paypal_dispute_responses;
begin
  if p_outcome not in ('sent', 'refused', 'unknown', 'blocked', 'closed') then
    raise exception 'bad outcome %', p_outcome;
  end if;
  select * into r from public.paypal_dispute_responses where id = p_response for update;
  if not found or r.status <> 'sending' then
    return false;
  end if;
  update public.paypal_dispute_responses
     set status = case p_outcome when 'blocked' then 'ready' when 'closed' then 'superseded' else p_outcome end,
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
revoke execute on function public.finish_dispute_response(uuid, text, jsonb, text) from public, anon, authenticated;
grant execute on function public.finish_dispute_response(uuid, text, jsonb, text) to service_role;

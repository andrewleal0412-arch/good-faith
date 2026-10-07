-- Refunds made in PayPal, not from here (src/lib/reconcile.ts, src/lib/outside-refunds.ts). Until now a refund of a
-- tenancy's deposit payment that the app didn't send was an activity entry and a blocker on the close-out, fixed by
-- hand. Now each one PayPal reports (its PAYMENT.CAPTURE.REFUNDED webhook, or the invoice's refunds when a page reads
-- PayPal) is kept once per tenancy, and the landlord either records it as the deposit's refund (a payments row of kind
-- 'outside_refund', which counts wherever the app's own refunds count) or marks it "not this deposit". Nothing is
-- recorded on its own.
--
-- Additive only: one new table, one new column on the pool, two new indexes, a widened kind check, four new functions
-- (one of them a trigger's), one new trigger, and release_demo_deposit replaced with the same signature and grants,
-- freeing fewer deposits than before. Nothing is dropped; the hosted demo's code reads none of it until the deploy.

-- 1. The payments kind for a refund made in PayPal that the landlord recorded as the deposit's refund. Its paypal_id is
--    PayPal's refund id, and its created_at the moment PayPal made the refund (not the moment it was recorded), so the
--    ledger dates it as PayPal does.
alter table public.payments drop constraint payments_kind_check;
alter table public.payments add constraint payments_kind_check check (kind in (
  'deposit_invoice', 'refund', 'payout', 'damage_invoice', 'settlement_refund', 'settlement_payout', 'dispute_refund',
  'outside_refund'
));
-- Recorded once: a second click, a second tab or a retry can't count the same PayPal refund twice.
create unique index payments_one_outside_refund on public.payments (tenancy_id, paypal_id) where kind = 'outside_refund';

-- 2. Each refund PayPal reported on a tenancy's deposit payment that isn't on record as the app's own (the close-out's,
--    a settlement's, PayPal's own through a PayPal dispute), once per tenancy and refund id, whichever path saw it first
--    and however often. status: open until the landlord decides; recorded (payment_id is the row it made) or dismissed.
create table public.paypal_outside_refunds (
  id uuid primary key default gen_random_uuid(),
  tenancy_id uuid not null references public.tenancies(id) on delete cascade,
  workspace_id uuid not null,
  refund_id text not null check (refund_id ~ '^[A-Za-z0-9-]{4,64}$'),   -- PayPal's refund id
  capture_id text,                                                     -- the deposit payment it came out of
  amount numeric(12,2) not null check (amount > 0),
  paypal_status text,                                                  -- COMPLETED, PENDING, ...
  refunded_at timestamptz,                                             -- when PayPal made it (the webhook's time, else noon Pacific on the invoice's date)
  seen_via text[] not null default '{}',                               -- 'webhook', 'check'
  first_event_id text,                                                 -- the webhook event that reported it first, if one did
  status text not null default 'open' check (status in ('open', 'recorded', 'dismissed')),
  payment_id uuid references public.payments(id) on delete set null,
  decided_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenancy_id, refund_id)
);
create index paypal_outside_refunds_open_idx on public.paypal_outside_refunds (workspace_id) where status = 'open';
alter table public.paypal_outside_refunds enable row level security;
revoke all on table public.paypal_outside_refunds from anon, authenticated;

-- Whether a tenancy's records already hold this PayPal refund as the app's own: the close-out's refund, a settlement's,
-- one recorded from here, or one PayPal listed for a PayPal dispute's refund.
create or replace function public.refund_on_record(p_tenancy uuid, p_refund text)
returns boolean
language sql
stable
set search_path = ''
as $$
  select exists (
    select 1 from public.payments p
    where p.tenancy_id = p_tenancy
      and ((p.kind in ('refund', 'settlement_refund', 'outside_refund') and p.paypal_id = p_refund)
        or (p.kind = 'dispute_refund' and coalesce(p.raw -> 'refund_ids', '[]'::jsonb) ? p_refund))
  )
$$;
revoke execute on function public.refund_on_record(uuid, text) from public, anon, authenticated;
grant execute on function public.refund_on_record(uuid, text) to service_role;

-- 3. Note a refund PayPal reported: 'new' the first time for this tenancy, 'seen' after (the other path saw it too, or
--    the same one again: its seen_via grows, the webhook's exact time replaces the invoice's date), 'ours' when the
--    tenancy's records already hold it (nothing stored). A decided refund stays decided. Never on a template, which
--    nothing writes to.
create or replace function public.note_outside_refund(
  p_tenancy uuid, p_refund text, p_capture text, p_amount numeric, p_status text, p_refunded_at timestamptz, p_via text, p_event text
)
returns text
language plpgsql
set search_path = ''
as $$
declare
  ws uuid;
  inserted boolean;
begin
  if p_via not in ('webhook', 'check') then
    raise exception 'note_outside_refund: unknown path %', p_via;
  end if;
  if exists (select 1 from public.demo_templates where tenancy_id = p_tenancy) then
    return 'template';
  end if;
  select workspace_id into ws from public.tenancies where id = p_tenancy;
  if ws is null then
    raise exception 'note_outside_refund: no such tenancy';
  end if;
  if public.refund_on_record(p_tenancy, p_refund) then
    return 'ours';
  end if;
  insert into public.paypal_outside_refunds as o (tenancy_id, workspace_id, refund_id, capture_id, amount, paypal_status, refunded_at, seen_via, first_event_id)
  values (p_tenancy, ws, p_refund, p_capture, p_amount, p_status, p_refunded_at, array[p_via], p_event)
  on conflict (tenancy_id, refund_id) do update set
    seen_via = (select array(select distinct v from unnest(o.seen_via || array[p_via]) as v order by v)),
    capture_id = coalesce(o.capture_id, excluded.capture_id),
    paypal_status = case when o.status = 'open' then coalesce(excluded.paypal_status, o.paypal_status) else o.paypal_status end,
    refunded_at = case when p_via = 'webhook' and excluded.refunded_at is not null and o.status = 'open' then excluded.refunded_at
                       else coalesce(o.refunded_at, excluded.refunded_at) end,
    first_event_id = coalesce(o.first_event_id, excluded.first_event_id),
    updated_at = now()
  returning (o.xmax = 0) into inserted;
  return case when inserted then 'new' else 'seen' end;
end
$$;
revoke execute on function public.note_outside_refund(uuid, text, text, numeric, text, timestamptz, text, text) from public, anon, authenticated;
grant execute on function public.note_outside_refund(uuid, text, text, numeric, text, timestamptz, text, text) to service_role;

-- 4. The landlord's decision, under the refund's row lock, once: 'record' makes the payments row (and the audit entry)
--    in the same step, 'dismiss' marks it not this deposit. Refused, with the reason, when it was decided already, when
--    the tenancy's records hold it meanwhile (the app's own refund, written after PayPal reported it), or on a template.
create or replace function public.decide_outside_refund(p_tenancy uuid, p_refund text, p_decision text)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  o public.paypal_outside_refunds;
  pay uuid;
begin
  if p_decision not in ('record', 'dismiss') then
    raise exception 'decide_outside_refund: unknown decision %', p_decision;
  end if;
  if exists (select 1 from public.demo_templates where tenancy_id = p_tenancy) then
    return jsonb_build_object('ok', false, 'reason', 'template');
  end if;
  select * into o from public.paypal_outside_refunds where tenancy_id = p_tenancy and refund_id = p_refund for update;
  if not found then
    return jsonb_build_object('ok', false, 'reason', 'missing');
  end if;
  if o.status <> 'open' then
    return jsonb_build_object('ok', false, 'reason', 'decided', 'status', o.status);
  end if;
  if public.refund_on_record(p_tenancy, p_refund) then
    return jsonb_build_object('ok', false, 'reason', 'ours');
  end if;
  if p_decision = 'record' then
    insert into public.payments (tenancy_id, kind, paypal_id, amount, status, raw, created_at)
    values (p_tenancy, 'outside_refund', o.refund_id, o.amount, coalesce(o.paypal_status, 'COMPLETED'),
      jsonb_build_object('outside', jsonb_build_object('recorded_at', now(), 'refunded_at', o.refunded_at, 'seen_via', to_jsonb(o.seen_via), 'capture_id', o.capture_id)),
      coalesce(o.refunded_at, now()))
    returning id into pay;
    update public.paypal_outside_refunds set status = 'recorded', payment_id = pay, decided_at = now(), updated_at = now() where id = o.id;
    insert into public.audit_log (tenancy_id, actor, action, detail)
    values (p_tenancy, 'landlord', 'outside_refund_recorded', jsonb_build_object(
      'refund_id', o.refund_id, 'amount', o.amount, 'refunded_at', o.refunded_at, 'capture_id', o.capture_id, 'status', coalesce(o.paypal_status, 'COMPLETED'), 'payment_id', pay));
  else
    update public.paypal_outside_refunds set status = 'dismissed', decided_at = now(), updated_at = now() where id = o.id;
    insert into public.audit_log (tenancy_id, actor, action, detail)
    values (p_tenancy, 'landlord', 'outside_refund_dismissed', jsonb_build_object(
      'refund_id', o.refund_id, 'amount', o.amount, 'refunded_at', o.refunded_at, 'capture_id', o.capture_id));
  end if;
  return jsonb_build_object('ok', true, 'status', case when p_decision = 'record' then 'recorded' else 'dismissed' end, 'payment_id', pay);
end
$$;
revoke execute on function public.decide_outside_refund(uuid, text, text) from public, anon, authenticated;
grant execute on function public.decide_outside_refund(uuid, text, text) to service_role;

-- 5. A pool deposit refunded in PayPal outside the app is marked on the pool row itself, as a disputed one is, so the
--    mark outlives the copy (its paypal_outside_refunds rows go with the tenancy when the sweep removes it) and the
--    deposit never goes back to the pool: the next copy would find part of it gone.
alter table public.demo_deposit_pool add column refunded_outside_at timestamptz;

create or replace function public.mark_pool_deposit_refunded_outside()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  update public.demo_deposit_pool dp set refunded_outside_at = coalesce(dp.refunded_outside_at, now())
  where dp.refunded_outside_at is null
    and ((new.capture_id is not null and dp.capture_id = new.capture_id)
      or dp.invoice_id in (select p.paypal_id from public.payments p where p.tenancy_id = new.tenancy_id and p.kind = 'deposit_invoice'));
  return new;
end
$$;
revoke execute on function public.mark_pool_deposit_refunded_outside() from public, anon, authenticated;

create trigger paypal_outside_refunds_mark_pool
  after insert on public.paypal_outside_refunds
  for each row execute function public.mark_pool_deposit_refunded_outside();

-- 6. release_demo_deposit (as in 20261005111401_paypal_dispute_review_fixes.sql) with two more conditions: a deposit
--    marked refunded outside the app never goes back to the pool, nor one whose tenancy recorded such a refund or has
--    one waiting for the landlord's decision.
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
      and dp.refunded_outside_at is null
      and not exists (
        select 1 from public.payments d join public.tenancies t on t.id = d.tenancy_id
        where t.workspace_id = p_ws and d.kind = 'deposit_invoice' and d.paypal_id = dp.invoice_id
          and (exists (select 1 from public.payments x where x.tenancy_id = d.tenancy_id
                and x.kind in ('refund', 'payout', 'settlement_refund', 'settlement_payout', 'dispute_refund', 'outside_refund'))
            or exists (select 1 from public.paypal_outside_refunds o where o.tenancy_id = d.tenancy_id)
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

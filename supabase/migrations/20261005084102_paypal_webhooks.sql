-- PayPal webhooks (src/app/api/paypal/webhook/route.ts, src/lib/paypal-webhook.ts): every event PayPal signs and
-- sends, recorded once by its id, with the workspace and tenancy it was matched to; the PayPal disputes those events
-- report (CUSTOMER.DISPUTE.*), kept for the dispute handling still to come; and one deposit invoice per tenancy.
--
-- Additive only: two new tables, one new function, two new indexes. Nothing existing is dropped or rewritten, and the
-- hosted demo's code reads none of this until the deploy.

-- 1. Each verified event, once. A redelivery (PayPal retries anything but a 2xx for three days, and the dashboard can
--    resend) finds its row and is not processed again, unless the last try failed or stalled.
create table public.paypal_webhook_events (
  id text primary key,                                   -- PayPal's event id (WH-...)
  event_type text not null,
  resource_type text,
  resource_id text,
  summary text,
  paypal_created_at timestamptz,                         -- the event's create_time
  received_at timestamptz not null default now(),        -- first delivery
  claimed_at timestamptz not null default now(),         -- the latest try
  attempts integer not null default 1,
  status text not null default 'processing'
    check (status in ('processing', 'applied', 'recorded', 'unmatched', 'ignored', 'failed')),
  -- Where it was matched. Set null when a demo copy is swept, so the event (and its id) stays on record.
  workspace_id uuid references public.workspaces(id) on delete set null,
  tenancy_id uuid references public.tenancies(id) on delete set null,
  note text,
  error text,
  payload jsonb not null,                                -- the event as PayPal sent it, after its signature checked out
  processed_at timestamptz
);
create index paypal_webhook_events_workspace_idx on public.paypal_webhook_events (workspace_id, received_at desc);
create index paypal_webhook_events_tenancy_idx on public.paypal_webhook_events (tenancy_id, received_at desc);
alter table public.paypal_webhook_events enable row level security;
revoke all on table public.paypal_webhook_events from anon, authenticated;

-- 2. PayPal disputes (a tenant's chargeback or claim on the deposit payment), one row per PayPal dispute id, newest
--    state kept. Distinct from the tenants' disputes of the statement (public.disputes).
create table public.paypal_disputes (
  id text primary key,                                   -- PayPal's dispute_id (PP-D-...)
  tenancy_id uuid not null references public.tenancies(id) on delete cascade,
  workspace_id uuid references public.workspaces(id) on delete set null,
  capture_id text,                                       -- the deposit payment it disputes
  reason text,
  status text,
  stage text,                                            -- dispute_life_cycle_stage
  amount numeric(12,2),
  currency text,
  outcome text,                                          -- dispute_outcome.outcome_code, once resolved
  paypal_created_at timestamptz,
  paypal_updated_at timestamptz,
  last_event_id text,
  raw jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index paypal_disputes_tenancy_idx on public.paypal_disputes (tenancy_id);
alter table public.paypal_disputes enable row level security;
revoke all on table public.paypal_disputes from anon, authenticated;

-- 3. Claim an event for processing: 'new' the first time, 'retry' when the last try failed or has been processing for
--    five minutes (its process died), 'duplicate' otherwise. One locked step, so two deliveries at once process once.
create or replace function public.claim_paypal_event(
  p_id text, p_type text, p_resource_type text, p_resource_id text, p_summary text, p_created timestamptz, p_payload jsonb
)
returns text
language plpgsql
set search_path = ''
as $$
begin
  insert into public.paypal_webhook_events (id, event_type, resource_type, resource_id, summary, paypal_created_at, payload)
  values (p_id, p_type, p_resource_type, p_resource_id, p_summary, p_created, p_payload)
  on conflict (id) do nothing;
  if found then
    return 'new';
  end if;
  update public.paypal_webhook_events
     set status = 'processing', claimed_at = now(), attempts = attempts + 1, error = null
   where id = p_id
     and (status = 'failed' or (status = 'processing' and claimed_at < now() - interval '5 minutes'));
  if found then
    return 'retry';
  end if;
  return 'duplicate';
end
$$;

revoke execute on function public.claim_paypal_event(text, text, text, text, text, timestamptz, jsonb) from public, anon, authenticated;
grant execute on function public.claim_paypal_event(text, text, text, text, text, timestamptz, jsonb) to service_role;

-- 4. Lookups by PayPal id (an invoice, refund or payout batch), which every event makes.
create index payments_paypal_id_idx on public.payments (paypal_id);

-- 5. One deposit invoice per tenancy. The route refuses a second one already; this makes two requests that arrive
--    together unable to record two (at PayPal the invoice is made once by its invoice number, which PayPal refuses to
--    repeat: src/lib/paypal.ts, depositInvoiceNumber).
create unique index payments_one_deposit_invoice_idx on public.payments (tenancy_id) where kind = 'deposit_invoice';

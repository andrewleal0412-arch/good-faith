-- PayPal webhooks, review fixes (src/lib/paypal-webhook-store.ts, src/lib/deposit.ts). Additive only: one new
-- function and one new index. Nothing existing is dropped or rewritten.

-- 1. Write a payment row's status and merge keys into its raw, only while its status is still the one the writer read.
--    Two writers that touch different keys (a webhook's capture and another's reversal, a page's refreshed transactions
--    and a webhook's reversal) both keep theirs: nothing replaces the whole raw any more. p_unset drops keys first (the
--    page's own read of the status takes the place of the webhook's status_from mark).
create or replace function public.merge_payment(p_id uuid, p_expect text, p_status text, p_set jsonb, p_unset text[] default '{}')
returns boolean
language plpgsql
set search_path = ''
as $$
begin
  if jsonb_typeof(coalesce(p_set, '{}'::jsonb)) <> 'object' then
    raise exception 'merge_payment: p_set must be a JSON object';
  end if;
  update public.payments
     set status = p_status,
         raw = ((case when jsonb_typeof(raw) = 'object' then raw else '{}'::jsonb end) - coalesce(p_unset, '{}'::text[]))
               || coalesce(p_set, '{}'::jsonb)
   where id = p_id
     and status = p_expect;
  return found;
end
$$;

revoke execute on function public.merge_payment(uuid, text, text, jsonb, text[]) from public, anon, authenticated;
grant execute on function public.merge_payment(uuid, text, text, jsonb, text[]) to service_role;

-- 2. A refund, reversal or dispute event names the deposit's capture, found inside payments.raw (transactions[].payment_id).
create index if not exists payments_raw_gin_idx on public.payments using gin (raw jsonb_path_ops);

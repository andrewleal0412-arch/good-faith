-- The tenants may withdraw a dispute they sent, and a withdrawn dispute can be opened again from their link as a new
-- dispute of the same statement (Andrew's decision of 2026-10-04); a settled dispute, and one that ended with no
-- agreement, stay closed. 'withdrawn' has been an allowed status since 20261003222545, but nothing set it.
--
-- Additive only: one new function. The reopening needs no database change: disputes_one_live_idx counts only the live
-- statuses (draft, open, negotiating, agreed), so a new draft beside a withdrawn dispute is allowed, and the route
-- (src/app/api/t/[token]/dispute/route.ts) opens one only when the latest dispute was withdrawn.

-- Withdraw a sent dispute under its row lock: only while it is open, negotiating or agreed; never while the landlord's
-- negotiator is running (started within p_stale_seconds), after the tenants accepted a settlement, or while a
-- settlement payment is on its way, sent, or unconfirmed by PayPal (it may have gone). A settlement still waiting on
-- approval is cancelled. Returns true when the dispute was withdrawn.
create or replace function public.withdraw_dispute(p_dispute uuid, p_stale_seconds integer)
returns boolean
language plpgsql
set search_path = ''
as $$
declare
  d public.disputes;
begin
  select * into d from public.disputes where id = p_dispute for update;
  if not found or d.status not in ('open', 'negotiating', 'agreed') then
    return false;
  end if;
  if d.negotiation_status = 'running' and d.negotiation_started_at > now() - make_interval(secs => greatest(p_stale_seconds, 30)) then
    return false;
  end if;
  if exists (
    select 1 from public.settlements s
    where s.dispute_id = p_dispute
      and (s.status in ('sending', 'sent')
        or (s.status = 'failed' and s.paypal_status = 'NO_RESPONSE')
        or (s.status <> 'cancelled' and s.tenant_accepted_at is not null))
  ) then
    return false;
  end if;
  update public.settlements set status = 'cancelled', updated_at = now() where dispute_id = p_dispute and status in ('pending', 'failed');
  update public.disputes set status = 'withdrawn', closed_at = now(), updated_at = now() where id = p_dispute;
  return true;
end
$$;

revoke execute on function public.withdraw_dispute(uuid, integer) from public, anon, authenticated;
grant execute on function public.withdraw_dispute(uuid, integer) to service_role;

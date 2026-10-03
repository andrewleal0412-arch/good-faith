-- Round 1 review fixes for the dispute (additive: one function created in the previous migration is replaced with
-- the same signature, grants unchanged). send_dispute now refuses, under the draft's row lock, while the tenants'
-- advocate is still writing their case (advocate_status 'running', started within the 300 seconds after which
-- claim_advocate_run lets a run start again; ADVOCATE_STALE_SECONDS in src/lib/disputes.ts). Before, the route checked
-- this outside the lock, and a case finished between the check and the send was dropped after Claude was paid for.
--
-- Note for round 2: while a dispute the tenants sent is live (open, negotiating, agreed), the landlord's deduction
-- routes refuse to add or remove a deduction (deductionsFrozen in src/lib/disputes.ts), so the negotiation and the
-- settlement are over the lines the tenants disputed. There is no route that edits a deduction in place.
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
  if d.advocate_status = 'running' and d.advocate_started_at > now() - interval '300 seconds' then
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

revoke execute on function public.send_dispute(uuid, jsonb, numeric) from public, anon, authenticated;
grant execute on function public.send_dispute(uuid, jsonb, numeric) to service_role;

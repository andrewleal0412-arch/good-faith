-- Demo copies' settled history, review fixes. Additive: two functions from 20261004013843_demo_settled_history.sql
-- replaced with the same signatures and grants. Nothing else changes; the code live before the settled history calls
-- create_demo_copy, which is untouched.
--
-- 1. copy_demo_history: when the copy's closed unit already has a live tenant link (one copied from its template, which
--    copy_demo_template leaves never opened), the link now reads as last opened when the tenants accepted the
--    settlement, since the recorded dispute came through it. A link it makes itself already did.
-- 2. create_demo_copy_with_history: a template's history that fails to go in (a hand-edited history row, a constraint
--    changed later) no longer fails the whole copy, which would turn every judges' sign-in away until the row was fixed.
--    Each history goes in under its own savepoint: a failure rolls back that history only, the copy is made as one made
--    before the history existed, and the result names the failure so the server logs it. The result adds
--    {history: the copies that got one, history_expected: the copies whose template has one, history_failed:
--    [{role, error}]}.

-- 1. As in 20261004013843, with the existing link's last_seen_at moved up to the acceptance.
create or replace function public.copy_demo_history(p_copy uuid, p_template uuid, p_now timestamptz)
returns boolean
language plpgsql
set search_path = ''
as $$
declare
  h jsonb;
  tpl public.demo_templates;
  t public.tenancies;
  c public.tenancies;
  off integer;
  yr integer;
  cap timestamptz := p_now - interval '1 minute';
  ded_map jsonb;
  id_map jsonb;
  d jsonb;
  s jsonb;
  new_dispute uuid := gen_random_uuid();
  new_settlement uuid := gen_random_uuid();
  link uuid;
  turn_ids jsonb := '{}'::jsonb;
  r record;
  new_id uuid;
begin
  select history into h from public.demo_template_history where tenancy_id = p_template;
  if h is null then
    return false;
  end if;
  select * into tpl from public.demo_templates where tenancy_id = p_template;
  if not found then
    return false;
  end if;
  select * into t from public.tenancies where id = p_template;
  if not found then
    return false;
  end if;
  select * into c from public.tenancies where id = p_copy;
  if not found then
    return false;
  end if;
  if not exists (select 1 from public.workspaces w where w.id = c.workspace_id and w.kind = 'demo') then
    raise exception 'a template''s history goes into a demo copy only';
  end if;
  if exists (select 1 from public.disputes x where x.tenancy_id = p_copy) then
    return false;
  end if;
  off := c.start_date - t.start_date;
  if off is null or off < 0 then
    return false;
  end if;
  yr := extract(year from tpl.anchor)::integer;

  -- The template's deductions matched to the copy's: the same category, room, item and amount, in the order made.
  select coalesce(jsonb_object_agg(a.id::text, b.id::text), '{}'::jsonb) into ded_map
  from (
    select x.id, x.category, x.room, x.item, x.amount,
      row_number() over (partition by x.category, x.room, x.item, x.amount order by x.created_at, x.id) as k
    from public.deductions x where x.tenancy_id = p_template
  ) a
  join (
    select y.id, y.category, y.room, y.item, y.amount,
      row_number() over (partition by y.category, y.room, y.item, y.amount order by y.created_at, y.id) as k
    from public.deductions y where y.tenancy_id = p_copy
  ) b on b.category = a.category and b.room is not distinct from a.room and b.item = a.item and b.amount = a.amount and b.k = a.k;
  if exists (
    select 1 from jsonb_array_elements_text(coalesce(h #> '{dispute,deduction_ids}', '[]'::jsonb)) as x(v) where not ded_map ? x.v
    union all
    select 1 from jsonb_array_elements(coalesce(h #> '{settlement,terms}', '[]'::jsonb)) as x(v) where not ded_map ? (x.v ->> 'deduction_id')
  ) then
    return false;
  end if;

  id_map := ded_map || jsonb_build_object(h #>> '{dispute,id}', new_dispute::text, h #>> '{settlement,id}', new_settlement::text);
  d := public.demo_remap_ids(h -> 'dispute', id_map);
  s := public.demo_remap_ids(h -> 'settlement', id_map);
  select x.id into link from public.tenant_links x where x.tenancy_id = p_copy and x.revoked_at is null order by x.created_at desc limit 1;
  -- The tenants disputed through their private link, so a copy without one gets one, made the day the statement went
  -- out and last opened when they accepted: a random token nobody holds, as for every copy's link.
  if link is null then
    link := gen_random_uuid();
    insert into public.tenant_links (id, tenancy_id, token_hash, created_at, revoked_at, last_seen_at)
    values (link, p_copy, encode(sha256(convert_to(gen_random_uuid()::text || clock_timestamp()::text || gen_random_uuid()::text, 'UTF8')), 'hex'),
      coalesce(c.statement_delivered_at, public.demo_shift_ts((d ->> 'created_at')::timestamptz, off, cap)), null,
      public.demo_shift_ts((s ->> 'tenant_accepted_at')::timestamptz, off, cap));
    insert into public.audit_log (tenancy_id, actor, action, detail, created_at)
    values (p_copy, 'landlord', 'tenant_link_created', jsonb_build_object('link_id', link, 'replaced', '[]'::jsonb),
      coalesce(c.statement_delivered_at, public.demo_shift_ts((d ->> 'created_at')::timestamptz, off, cap)));
  else
    -- A link the copy already has (from its template) was the one they used: opened no later than their acceptance.
    -- greatest() skips a null, so a link never opened takes the acceptance's time.
    update public.tenant_links
    set last_seen_at = greatest(last_seen_at, public.demo_shift_ts((s ->> 'tenant_accepted_at')::timestamptz, off, cap))
    where id = link;
  end if;

  -- The dispute, settled.
  insert into public.disputes (
    id, tenancy_id, workspace_id, link_id, status, opened_by, deduction_ids, reasons, message, evidence, statement_delivered_at,
    advocate, advocate_status, advocate_started_at, advocate_error, asked_back, created_at, updated_at, sent_at, closed_at,
    negotiator_policy, negotiation_status, negotiation_started_at, negotiation_error, negotiation_outcome
  ) values (
    new_dispute, p_copy, c.workspace_id, link, 'settled', d ->> 'opened_by',
    (select coalesce(array_agg(x.v::uuid order by x.i), '{}'::uuid[]) from jsonb_array_elements_text(d -> 'deduction_ids') with ordinality as x(v, i)),
    coalesce(public.shift_jsonb_dates(d -> 'reasons', off, yr), '{}'::jsonb), public.shift_text_dates(d ->> 'message', off, yr), '[]'::jsonb,
    c.statement_delivered_at,
    public.shift_jsonb_dates(d -> 'advocate', off, yr), 'done', public.demo_shift_ts((d ->> 'advocate_started_at')::timestamptz, off, cap), null,
    (d ->> 'asked_back')::numeric,
    public.demo_shift_ts((d ->> 'created_at')::timestamptz, off, cap), public.demo_shift_ts((d ->> 'updated_at')::timestamptz, off, cap),
    public.demo_shift_ts((d ->> 'sent_at')::timestamptz, off, cap), public.demo_shift_ts((d ->> 'closed_at')::timestamptz, off, cap),
    d -> 'negotiator_policy', 'done', public.demo_shift_ts((d ->> 'negotiation_started_at')::timestamptz, off, cap), null,
    case when d -> 'negotiation_outcome' is null then null
      else jsonb_set(d -> 'negotiation_outcome', '{at}', to_jsonb(public.demo_shift_ts((d #>> '{negotiation_outcome,at}')::timestamptz, off, cap))) end
  );

  -- Every turn, in order.
  for r in
    select x.v, (x.v ->> 'n')::integer as n
    from jsonb_array_elements(public.demo_remap_ids(coalesce(h -> 'turns', '[]'::jsonb), id_map)) as x(v)
    order by (x.v ->> 'n')::integer
  loop
    new_id := gen_random_uuid();
    insert into public.negotiation_turns (id, dispute_id, tenancy_id, n, side, actor, move, proposal, total_keep, amount_back, message, reasoning, citations, checks, created_at)
    values (new_id, new_dispute, p_copy, r.n, r.v ->> 'side', r.v ->> 'actor', r.v ->> 'move',
      public.shift_jsonb_dates(coalesce(r.v -> 'proposal', '[]'::jsonb), off, yr), (r.v ->> 'total_keep')::numeric, (r.v ->> 'amount_back')::numeric,
      public.shift_text_dates(r.v ->> 'message', off, yr), public.shift_text_dates(r.v ->> 'reasoning', off, yr),
      coalesce(r.v -> 'citations', '[]'::jsonb), r.v -> 'checks', public.demo_shift_ts((r.v ->> 'created_at')::timestamptz, off, cap));
    turn_ids := turn_ids || jsonb_build_object(r.n::text, new_id::text);
  end loop;

  -- The settlement and its ledger row: the demo's recorded example, with no PayPal id. Nothing goes to PayPal.
  insert into public.settlements (
    id, dispute_id, tenancy_id, turn_id, amount, terms, status, tenant_accepted_at, tenant_name, landlord_approved_at, rail,
    paypal_id, paypal_status, raw, error, sent_at, paypal_request_id, paypal_requested_at, created_at, updated_at
  ) values (
    new_settlement, new_dispute, p_copy, (turn_ids ->> (s ->> 'turn_n'))::uuid, (s ->> 'amount')::numeric, coalesce(s -> 'terms', '[]'::jsonb), 'sent',
    public.demo_shift_ts((s ->> 'tenant_accepted_at')::timestamptz, off, cap), s ->> 'tenant_name',
    public.demo_shift_ts((s ->> 'landlord_approved_at')::timestamptz, off, cap), s ->> 'rail',
    null, null, '{"demo_example": true}'::jsonb, null, public.demo_shift_ts((s ->> 'sent_at')::timestamptz, off, cap), null, null,
    public.demo_shift_ts((s ->> 'created_at')::timestamptz, off, cap), public.demo_shift_ts((s ->> 'updated_at')::timestamptz, off, cap)
  );
  if (s ->> 'amount')::numeric > 0 then
    insert into public.payments (tenancy_id, kind, paypal_id, amount, status, raw, created_at)
    values (p_copy, case when s ->> 'rail' = 'payout' then 'settlement_payout' else 'settlement_refund' end, null, (s ->> 'amount')::numeric, 'COMPLETED',
      '{"demo_example": true}'::jsonb, public.demo_shift_ts((h #>> '{payment,created_at}')::timestamptz, off, cap));
  end if;

  -- The activity, one entry per step, as the app writes it.
  insert into public.audit_log (tenancy_id, actor, action, detail, created_at)
  select p_copy, x.v ->> 'actor', x.v ->> 'action', public.shift_jsonb_dates(public.demo_remap_ids(x.v -> 'detail', id_map), off, yr),
    public.demo_shift_ts((x.v ->> 'created_at')::timestamptz, off, cap)
  from jsonb_array_elements(coalesce(h -> 'audit', '[]'::jsonb)) with ordinality as x(v, i)
  order by x.i;
  return true;
end
$$;

-- 2. A new demo workspace, as create_demo_copy makes it, with each template's history added to its copy in the same
-- transaction, each under its own savepoint (the begin ... exception block), so a history that fails leaves the copy
-- as it would be without one. create_demo_copy always makes a demo workspace, so copy_demo_history's demo-only check
-- can't fire here.
create or replace function public.create_demo_copy_with_history(p_ip_key text, p_ip_limit integer, p_total_limit integer, p_replace uuid default null,
  p_label text default 'Harbor View Rentals', p_roles text[] default null)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  res jsonb;
  x jsonb;
  tpl uuid;
  added integer := 0;
  expected integer := 0;
  failed jsonb := '[]'::jsonb;
begin
  res := public.create_demo_copy(p_ip_key, p_ip_limit, p_total_limit, p_replace, p_label, p_roles);
  if coalesce((res ->> 'allowed')::boolean, false) then
    for x in select e.v from jsonb_array_elements(coalesce(res -> 'copies', '[]'::jsonb)) as e(v) loop
      select dt.tenancy_id into tpl from public.demo_templates dt where dt.role = x ->> 'role';
      if tpl is null or not exists (select 1 from public.demo_template_history th where th.tenancy_id = tpl) then
        continue;
      end if;
      expected := expected + 1;
      begin
        if public.copy_demo_history((x ->> 'tenancy')::uuid, tpl, now()) then
          added := added + 1;
        end if;
      exception when others then
        failed := failed || jsonb_build_array(jsonb_build_object('role', x ->> 'role', 'error', left(sqlerrm, 300)));
      end;
    end loop;
    res := res || jsonb_build_object('history', added, 'history_expected', expected, 'history_failed', failed);
  end if;
  return res;
end
$$;

revoke execute on function public.copy_demo_history(uuid, uuid, timestamptz) from public, anon, authenticated;
revoke execute on function public.create_demo_copy_with_history(text, integer, integer, uuid, text, text[]) from public, anon, authenticated;
grant execute on function public.copy_demo_history(uuid, uuid, timestamptz) to service_role;
grant execute on function public.create_demo_copy_with_history(text, integer, integer, uuid, text, text[]) to service_role;

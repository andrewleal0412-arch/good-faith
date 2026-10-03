-- Demo copies, follow-up fixes from review. Additive: no table, column or row changes; grants revoked from roles the
-- app never uses, and two functions replaced with the same signatures and grants.

-- 1. The eight tables from before workspaces still had Supabase's default grants to anon and authenticated (only row
-- level security with no policies kept them closed). The app reads and writes with the secret key (service_role), so
-- nothing uses these grants; revoked, as for every table made since.
revoke all on table public.properties, public.tenancies, public.photos, public.payments, public.audit_log,
  public.deductions, public.agent_runs, public.tenant_links from anon, authenticated;

-- 2. A demo workspace's pre-paid deposit back in the pool unless the deposit was used: a refund or payout recorded on
-- the tenancy holding it, or a close-out run still running there (it may be sending the money right now). A run that
-- only proposed a refund (awaiting approval), failed or ended without one no longer keeps the deposit: once it is back in
-- the pool the old copy can't send that refund any more (src/lib/demo-pool.ts depositNotOurs, checked again by
-- guardRefund right before PayPal is called). Before this, pressing Prepare refund and then Start over kept the deposit
-- claimed for good. Start over calls this for the copy it replaces, and the sweep for each workspace it removes.
-- Returns how many went back.
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
          and (exists (select 1 from public.payments x where x.tenancy_id = d.tenancy_id and x.kind in ('refund', 'payout'))
            or exists (select 1 from public.audit_log l where l.tenancy_id = d.tenancy_id and l.action = 'refund_sent')
            or exists (select 1 from public.agent_runs a where a.tenancy_id = d.tenancy_id and a.status = 'running')))
    returning dp.id
  )
  select count(*) into released from freed;
  return released;
end
$$;
revoke execute on function public.release_demo_deposit(uuid) from public, anon, authenticated;
grant execute on function public.release_demo_deposit(uuid) to service_role;

-- 3. copy_demo_template (as in 20261003090952_demo_copy_dates_never_earlier.sql) with one change: the copy's tenant
-- link has no last_seen_at. The template's was copied, so a copy said its link was last opened at a moment nobody
-- could have opened it.
create or replace function public.copy_demo_template(p_ws uuid, p_template uuid, p_now timestamptz, p_pool uuid)
returns uuid
language plpgsql
set search_path = ''
as $$
declare
  tpl public.demo_templates;
  t public.tenancies;
  pr public.properties;
  pool public.demo_deposit_pool;
  today date := (p_now at time zone 'America/Los_Angeles')::date;
  cap timestamptz := p_now - interval '1 minute';
  off integer;
  yr integer;
  s_day date;
  m_day date;
  new_prop uuid := gen_random_uuid();
  new_ten uuid := gen_random_uuid();
  agreement jsonb;
  tenants jsonb;
  terms jsonb;
  approved uuid;
  run_map jsonb := '{}'::jsonb;
  link_map jsonb := '{}'::jsonb;
  r record;
  new_id uuid;
  moved timestamptz;
begin
  select * into tpl from public.demo_templates where tenancy_id = p_template;
  if not found then
    raise exception 'not a demo template: %', p_template;
  end if;
  select * into t from public.tenancies where id = p_template;
  select * into pr from public.properties where id = t.property_id;
  if p_pool is not null then
    select * into pool from public.demo_deposit_pool where id = p_pool and claimed_by = p_ws;
    if not found then
      raise exception 'that deposit is not claimed by this workspace';
    end if;
  end if;
  -- Never earlier than the template's own dates: PayPal's records (the deposit's payment, a refund) keep their real
  -- dates, so a copy dated earlier than its template could show a refund sent before the deposit was paid. In the first
  -- days after a template is made, its copy is dated as the template is; after that, days_ago before the copy is made.
  off := greatest((today - tpl.days_ago) - tpl.anchor, 0);
  yr := extract(year from tpl.anchor)::integer;
  s_day := t.start_date + off;
  m_day := t.move_out_date + off;

  -- The tenants' written refund agreement, signed on move-in day, pointing at the account that paid the deposit.
  agreement := t.refund_agreement;
  tenants := t.tenants;
  if agreement is not null then
    agreement := jsonb_set(agreement, '{signed_at}', to_jsonb(public.demo_place_ts(public.demo_shift_ts((agreement ->> 'signed_at')::timestamptz, off, cap), s_day, 5)));
    if p_pool is not null and lower(agreement ->> 'paypal_email') <> lower(pool.payer_email) then
      tenants := (select coalesce(jsonb_agg(case when lower(x.v ->> 'email') = lower(agreement ->> 'paypal_email')
        then jsonb_set(x.v, '{email}', to_jsonb(pool.payer_email)) else x.v end order by x.i), '[]'::jsonb)
        from jsonb_array_elements(t.tenants) with ordinality as x(v, i));
      agreement := jsonb_set(agreement, '{paypal_email}', to_jsonb(pool.payer_email));
    end if;
  end if;
  terms := t.lease_terms;
  if terms is not null and jsonb_typeof(terms -> 'tenancyStartDate') = 'string' then
    terms := jsonb_set(terms, '{tenancyStartDate}', to_jsonb(public.shift_text_dates(terms ->> 'tenancyStartDate', off, yr)));
  end if;
  if terms is not null and jsonb_typeof(terms -> 'leaseEndDate') = 'string' then
    terms := jsonb_set(terms, '{leaseEndDate}', to_jsonb(public.shift_text_dates(terms ->> 'leaseEndDate', off, yr)));
  end if;

  insert into public.properties (id, workspace_id, address, city, owner_name, owner_type, owner_property_count, owner_unit_count, created_at)
  values (new_prop, p_ws, pr.address, pr.city, pr.owner_name, pr.owner_type, pr.owner_property_count, pr.owner_unit_count,
    public.demo_place_ts(public.demo_shift_ts(pr.created_at, off, cap), s_day, 0));

  insert into public.tenancies (
    id, workspace_id, property_id, tenants, monthly_rent, deposit_amount, other_charges, start_date, end_date, move_out_date,
    lease_pdf_path, lease_terms, lease_flags, refund_agreement, status, created_at, move_out_findings, move_out_inspected_at,
    statement_delivered_at, statement_delivery, notice_given_on, planned_move_out, notices, tenant_move_out
  ) values (
    new_ten, p_ws, new_prop, tenants, t.monthly_rent, t.deposit_amount, t.other_charges, s_day, t.end_date + off, m_day,
    t.lease_pdf_path, terms, t.lease_flags, agreement, t.status,
    public.demo_place_ts(public.demo_shift_ts(t.created_at, off, cap), s_day, 1),
    t.move_out_findings,
    public.demo_place_ts(public.demo_shift_ts(t.move_out_inspected_at, off, cap), m_day, 30),
    public.demo_shift_ts(t.statement_delivered_at, off, cap),
    public.shift_jsonb_dates(t.statement_delivery, off, yr),
    t.notice_given_on + off, t.planned_move_out + off,
    public.shift_jsonb_dates(t.notices, off, yr),
    public.shift_jsonb_dates(t.tenant_move_out, off, yr)
  );

  -- Payments: the deposit invoice (sent on move-in day), and any refund or payout as the template has it.
  for r in select * from public.payments where tenancy_id = p_template order by created_at, id loop
    moved := public.demo_shift_ts(r.created_at, off, cap);
    if r.kind = 'deposit_invoice' then
      moved := public.demo_place_ts(moved, s_day, 6);
    end if;
    if r.kind = 'deposit_invoice' and p_pool is not null then
      insert into public.payments (tenancy_id, kind, paypal_id, amount, status, raw, created_at)
      values (new_ten, 'deposit_invoice', pool.invoice_id, pool.amount, 'PAID', pool.raw, moved);
    else
      insert into public.payments (tenancy_id, kind, paypal_id, amount, status, raw, created_at)
      values (new_ten, r.kind, r.paypal_id, r.amount, r.status, r.raw, moved);
    end if;
  end loop;

  -- Photos: move-in on the lease start, move-out before repairs on the move-out day, after-repair as moved.
  insert into public.photos (tenancy_id, phase, room, storage_path, caption, taken_at, created_at)
  select new_ten, z.phase, z.room, z.storage_path, z.caption, z.ts, z.ts
  from (
    select p.*, case p.phase
        when 'move_in' then public.demo_place_ts(public.demo_shift_ts(p.created_at, off, cap), s_day, 20 + p.k)
        when 'move_out_before' then public.demo_place_ts(public.demo_shift_ts(p.created_at, off, cap), m_day, p.k)
        else public.demo_shift_ts(p.created_at, off, cap)
      end as ts
    from (
      select x.*, (row_number() over (partition by x.phase order by x.created_at, x.id) - 1)::integer as k
      from public.photos x where x.tenancy_id = p_template
    ) p
  ) z
  order by z.ts, z.storage_path;

  insert into public.deductions (
    tenancy_id, category, room, item, finding, work, performer, billed, hours, hourly_rate, labor_description, vendor,
    proration, item_age_years, useful_life_years, amount, math, is_estimate, receipt_path, after_photo_paths, created_at, note
  )
  select new_ten, d.category, d.room, d.item, d.finding, d.work, d.performer, d.billed, d.hours, d.hourly_rate, d.labor_description, d.vendor,
    d.proration, d.item_age_years, d.useful_life_years, d.amount, d.math, d.is_estimate, d.receipt_path, d.after_photo_paths,
    public.demo_shift_ts(d.created_at, off, cap), public.shift_text_dates(d.note, off, yr)
  from public.deductions d where d.tenancy_id = p_template
  order by d.created_at, d.id;

  -- The close-out run the landlord approved, for the refund's receipt page. A run still waiting for approval is not
  -- copied: its proposal names the template's own PayPal payment.
  select (a.detail ->> 'run_id')::uuid into approved from public.audit_log a
  where a.tenancy_id = p_template and a.action = 'refund_approved' order by a.created_at desc, a.id desc limit 1;
  if approved is not null then
    new_id := gen_random_uuid();
    insert into public.agent_runs (id, tenancy_id, kind, status, messages, pending, error, created_at, updated_at)
    select new_id, new_ten, a.kind, a.status, public.shift_run_messages(a.messages, off, yr), null, a.error,
      public.demo_shift_ts(a.created_at, off, cap), public.demo_shift_ts(a.updated_at, off, cap)
    from public.agent_runs a where a.id = approved and a.tenancy_id = p_template and a.status = 'done';
    if found then
      run_map := jsonb_build_object(approved::text, new_id::text);
    end if;
  end if;

  -- The live tenant link, with a fresh random token hash: the template's token never opens a copy. Nobody holds the new
  -- token, so the copy's link has never been opened (no last_seen_at).
  for r in select * from public.tenant_links where tenancy_id = p_template and revoked_at is null order by created_at limit 1 loop
    new_id := gen_random_uuid();
    insert into public.tenant_links (id, tenancy_id, token_hash, created_at, revoked_at, last_seen_at)
    values (new_id, new_ten,
      encode(sha256(convert_to(gen_random_uuid()::text || clock_timestamp()::text || gen_random_uuid()::text, 'UTF8')), 'hex'),
      public.demo_shift_ts(r.created_at, off, cap), null, null);
    link_map := link_map || jsonb_build_object(r.id::text, new_id::text);
  end loop;

  -- The activity, one entry per real step: no deduction added and removed again, no repeated comparison or photo
  -- upload, no test runs of the close-out, no PDF rebuilds.
  insert into public.audit_log (tenancy_id, actor, action, detail, created_at)
  select new_ten, c.actor, c.action, c.detail, c.ts
  from (
    select k.id, k.actor, k.action,
      case
        when k.action = 'deposit_invoice_sent' and p_pool is not null
          then jsonb_set(jsonb_set(public.shift_jsonb_dates(k.detail, off, yr), '{paypal_invoice}', to_jsonb(pool.invoice_id)), '{amount}', to_jsonb(pool.amount))
        when k.detail ? 'run_id' then jsonb_set(public.shift_jsonb_dates(k.detail, off, yr), '{run_id}',
          coalesce(run_map -> (k.detail ->> 'run_id'), k.detail -> 'run_id'))
        when k.action = 'tenant_link_created' then jsonb_set(jsonb_set(public.shift_jsonb_dates(k.detail, off, yr), '{link_id}',
          coalesce(link_map -> (k.detail ->> 'link_id'), (select v from jsonb_each(link_map) as e(key, v) limit 1))), '{replaced}', '[]'::jsonb)
        else public.shift_jsonb_dates(k.detail, off, yr)
      end as detail,
      case
        when k.action = 'lease_checked' then public.demo_place_ts(k.moved, s_day, 0)
        when k.action = 'tenancy_started' then public.demo_place_ts(k.moved, s_day, 1)
        when k.action = 'refund_method_agreed' then public.demo_place_ts(k.moved, s_day, 5)
        when k.action in ('deposit_invoice_sent', 'deposit_invoice_failed') then public.demo_place_ts(k.moved, s_day, 6)
        when k.action = 'photos_added' and k.detail ->> 'phase' = 'move_in' then public.demo_place_ts(k.moved, s_day, 20 + k.pk)
        when k.action = 'photos_added' and k.detail ->> 'phase' = 'move_out_before' then public.demo_place_ts(k.moved, m_day, k.pk)
        when k.action = 'move_out_date_set' then public.demo_place_ts(k.moved, m_day, 10)
        when k.action = 'move_out_inspected' then public.demo_place_ts(k.moved, m_day, 30)
        else k.moved
      end as ts
    from (
      select s.*, public.demo_shift_ts(s.created_at, off, cap) as moved,
        (row_number() over (partition by s.action, s.detail ->> 'phase' order by s.created_at, s.id) - 1)::integer as pk
      from public.audit_log s
      where s.tenancy_id = p_template
        and s.action not in ('deduction_removed', 'statement_packet_built', 'refund_blocked', 'refund_failed', 'tenant_link_revoked')
        -- the close-out's steps only for the run that was copied
        and (s.action not in ('close_out_started', 'close_out_finished', 'refund_proposed', 'refund_approved', 'refund_declined')
          or run_map ? (s.detail ->> 'run_id'))
        and (s.action <> 'tenant_link_created' or link_map <> '{}'::jsonb)
        -- a deduction that is still on file, its last entry
        and (s.action <> 'deduction_added' or exists (
          select 1 from public.deductions d where d.tenancy_id = p_template and d.item = s.detail ->> 'item'))
        -- the last entry of a step repeated for the same thing
        and not exists (
          select 1 from public.audit_log y
          where y.tenancy_id = p_template and y.action = s.action and (y.created_at, y.id) > (s.created_at, s.id)
            and (
              (s.action = 'deduction_added' and y.detail ->> 'item' = s.detail ->> 'item')
              or (s.action = 'photos_added' and y.detail ->> 'room' = s.detail ->> 'room' and y.detail ->> 'phase' = s.detail ->> 'phase')
              or (s.action = 'finding_reviewed' and y.detail ->> 'item' = s.detail ->> 'item' and y.detail ->> 'room' = s.detail ->> 'room')
              or s.action in ('lease_checked', 'tenancy_started', 'move_out_inspected', 'tenant_link_created', 'refund_method_agreed')
            ))
    ) k
  ) c
  order by c.ts, c.id;

  return new_ten;
end
$$;

revoke execute on function public.copy_demo_template(uuid, uuid, timestamptz, uuid) from public, anon, authenticated;
grant execute on function public.copy_demo_template(uuid, uuid, timestamptz, uuid) to service_role;

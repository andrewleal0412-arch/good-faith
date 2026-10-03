-- Workspaces, part 3: making a demo copy. create_demo_workspace counts the day's copies, takes one pre-paid sandbox
-- deposit for the move-out unit's copy (SKIP LOCKED) and copies both templates into a new demo workspace in one
-- transaction, every date shifted so the story is current. Templates are read, never written: a copy's photos,
-- receipts and lease point at the template's storage objects. Additive: new functions only.

-- Every date in a piece of text moved by p_days: ISO dates (2026-10-01, also inside a timestamp, whose time is kept),
-- long dates (October 1, 2026) and month-day dates (September 30, read in p_year). Anything that isn't a real date is
-- left as it is. One pass, left to right, so a date already moved is never moved again.
create or replace function public.shift_text_dates(p_text text, p_days integer, p_year integer)
returns text
language plpgsql
immutable
set search_path = ''
as $$
declare
  months constant text[] := array['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  pat constant text := '((?<![0-9A-Za-z])([0-9]{4})-([0-9]{2})-([0-9]{2})(?![0-9])|(January|February|March|April|May|June|July|August|September|October|November|December) ([0-9]{1,2})(?![0-9])(?:, ([0-9]{4})(?![0-9]))?)';
  done text := '';
  rest text := p_text;
  pos integer;
  m text[];
  whole text;
  repl text;
  d date;
begin
  if p_text is null or p_days is null or p_days = 0 then
    return p_text;
  end if;
  loop
    pos := regexp_instr(rest, pat);
    exit when pos is null or pos = 0;
    m := regexp_match(rest, pat);
    whole := m[1];
    exit when whole is null or whole = '';
    repl := whole;
    begin
      if m[2] is not null then
        d := make_date(m[2]::integer, m[3]::integer, m[4]::integer) + p_days;
        repl := to_char(d, 'YYYY-MM-DD');
      else
        d := make_date(coalesce(m[7]::integer, p_year), array_position(months, m[5]), m[6]::integer) + p_days;
        repl := months[extract(month from d)::integer] || ' ' || extract(day from d)::integer
          || case when m[7] is not null then ', ' || extract(year from d)::integer else '' end;
      end if;
    exception when others then
      repl := whole;
    end;
    done := done || substr(rest, 1, pos - 1) || repl;
    rest := substr(rest, pos + length(whole));
  end loop;
  return done || rest;
end
$$;

-- The same for every string inside a JSON value.
create or replace function public.shift_jsonb_dates(p jsonb, p_days integer, p_year integer)
returns jsonb
language plpgsql
immutable
set search_path = ''
as $$
declare
  t text := jsonb_typeof(p);
begin
  if p is null or p_days is null or p_days = 0 then
    return p;
  end if;
  if t = 'object' then
    return coalesce((select jsonb_object_agg(e.k, public.shift_jsonb_dates(e.v, p_days, p_year)) from jsonb_each(p) as e(k, v)), '{}'::jsonb);
  elsif t = 'array' then
    return coalesce((select jsonb_agg(public.shift_jsonb_dates(a.v, p_days, p_year) order by a.i) from jsonb_array_elements(p) with ordinality as a(v, i)), '[]'::jsonb);
  elsif t = 'string' then
    return to_jsonb(public.shift_text_dates(p #>> '{}', p_days, p_year));
  end if;
  return p;
end
$$;

-- An agent run's conversation with its dates moved: the agent's own sentences and the results of the app's own tools
-- (the close-out facts and the statement checklist). PayPal's answers keep PayPal's dates.
create or replace function public.shift_run_messages(p jsonb, p_days integer, p_year integer)
returns jsonb
language sql
immutable
set search_path = ''
as $$
  select coalesce(jsonb_agg(
    case
      when y.m ->> 'role' = 'assistant' and jsonb_typeof(y.m -> 'content') = 'array' then jsonb_set(y.m, '{content}', (
        select coalesce(jsonb_agg(case when x.c ->> 'type' = 'text'
          then jsonb_set(x.c, '{text}', to_jsonb(public.shift_text_dates(x.c ->> 'text', p_days, p_year))) else x.c end order by x.i), '[]'::jsonb)
        from jsonb_array_elements(y.m -> 'content') with ordinality as x(c, i)))
      when y.m ->> 'role' = 'tool' and jsonb_typeof(y.m -> 'content') = 'array' then jsonb_set(y.m, '{content}', (
        select coalesce(jsonb_agg(case when x.c ->> 'type' = 'tool-result' and x.c ->> 'toolName' in ('get_close_out_facts', 'get_statement_checklist')
          then jsonb_set(x.c, '{output}', public.shift_jsonb_dates(x.c -> 'output', p_days, p_year)) else x.c end order by x.i), '[]'::jsonb)
        from jsonb_array_elements(y.m -> 'content') with ordinality as x(c, i)))
      else y.m
    end order by y.o), '[]'::jsonb)
  from jsonb_array_elements(p) with ordinality as y(m, o)
$$;

-- A template's timestamp in a copy: moved by p_days, never later than p_cap (a moment before the copy is made).
create or replace function public.demo_shift_ts(p_ts timestamptz, p_days integer, p_cap timestamptz)
returns timestamptz
language sql
immutable
set search_path = ''
as $$
  select case when p_ts is null then null else least(p_ts + make_interval(days => p_days), p_cap) end
$$;

-- A step placed on the day it belongs to (10:00 Pacific daylight time plus p_minute), as the demo seed dates its
-- records: only ever earlier than p_moved, the timestamp moved with everything else.
create or replace function public.demo_place_ts(p_moved timestamptz, p_day date, p_minute integer)
returns timestamptz
language sql
immutable
set search_path = ''
as $$
  select case
    when p_moved is null then null
    when p_day is null then p_moved
    else least(p_moved, (p_day::timestamp + interval '17 hours' + make_interval(mins => p_minute)) at time zone 'UTC')
  end
$$;

-- One template tenancy copied into a workspace: its property, the tenancy, payments, photos (rows pointing at the
-- template's own storage objects), findings and their boxes (on the tenancy row), deductions, notices, the agent run
-- the landlord approved, a new tenant link (a random token nobody holds; the landlord makes a new link to open the
-- tenants' page), and the activity, curated to one entry per real step. Every date moves so the template's anchor
-- day falls days_ago days before p_now; the move-in steps sit on the shifted lease start and the move-out steps on the
-- shifted move-out day; nothing lands after p_now. PayPal's own records (the deposit's payment date, a refund's ids)
-- stay PayPal's. With p_pool, the copy's deposit is that pre-paid sandbox deposit instead of the template's.
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
  off := (today - tpl.days_ago) - tpl.anchor;
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

  -- The live tenant link, with a fresh random token hash: the template's token never opens a copy.
  for r in select * from public.tenant_links where tenancy_id = p_template and revoked_at is null order by created_at limit 1 loop
    new_id := gen_random_uuid();
    insert into public.tenant_links (id, tenancy_id, token_hash, created_at, revoked_at, last_seen_at)
    values (new_id, new_ten,
      encode(sha256(convert_to(gen_random_uuid()::text || clock_timestamp()::text || gen_random_uuid()::text, 'UTF8')), 'hex'),
      public.demo_shift_ts(r.created_at, off, cap), null, public.demo_shift_ts(r.last_seen_at, off, cap));
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

-- Both templates copied into a new demo workspace, the move-out unit's copy with a pre-paid sandbox deposit when one
-- is left (claimed with SKIP LOCKED, so two copies made at once never take the same one; a deposit more than 170 days
-- old is past PayPal's refund window and is skipped). Without one the copy still works, and its refund page says
-- today's sandbox deposits are used up. Returns {copies: [{role, tenancy}], pool: 'claimed' | 'empty', deposit}.
create or replace function public.clone_demo_templates(p_ws uuid, p_now timestamptz)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  pool_id uuid;
  r record;
  copies jsonb := '[]'::jsonb;
begin
  if not exists (select 1 from public.workspaces where id = p_ws and kind = 'demo') then
    raise exception 'copies go into a demo workspace';
  end if;
  if exists (select 1 from public.demo_templates where role = 'move_out') then
    select id into pool_id from public.demo_deposit_pool
    where claimed_by is null and paid_at > p_now - interval '170 days'
    order by paid_at, id limit 1
    for update skip locked;
    if pool_id is not null then
      update public.demo_deposit_pool set claimed_by = p_ws, claimed_at = p_now where id = pool_id;
    end if;
  end if;
  for r in select * from public.demo_templates order by role loop
    copies := copies || jsonb_build_array(jsonb_build_object('role', r.role,
      'tenancy', public.copy_demo_template(p_ws, r.tenancy_id, p_now, case when r.role = 'move_out' then pool_id end)));
  end loop;
  return jsonb_build_object('copies', copies, 'pool', case when pool_id is null then 'empty' else 'claimed' end, 'deposit', pool_id);
end
$$;

-- A demo workspace's pre-paid deposit back in the pool when the copy never used it: no refund or payout recorded and
-- no close-out run started on the tenancy holding it. Start over calls this for the copy it replaces, and the sweep
-- for each workspace it removes. The workspace keeps its rows; a deposit back in the pool can't be refunded from it
-- any more (the app refunds a pool deposit only from the workspace that holds the claim). Returns how many went back.
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
            or exists (select 1 from public.agent_runs a where a.tenancy_id = d.tenancy_id)))
    returning dp.id
  )
  select count(*) into released from freed;
  return released;
end
$$;

-- A new demo workspace for one browser, in one transaction: today's copy allowance for the caller's address and for
-- everyone (demo_copy_usage), then, for Start over, the deposit of the browser's previous copy back in the pool when
-- it was never used (first, so the new copy can take it), then the workspace and its copies. The previous copy's rows
-- stay until the sweep (scripts/demo-sweep.mjs). A refusal counts nothing and changes nothing.
-- Returns {allowed, reason} or {allowed, workspace, released, copies, pool, deposit}.
create or replace function public.create_demo_workspace(p_ip_key text, p_ip_limit integer, p_total_limit integer, p_replace uuid default null, p_label text default 'Harbor View Rentals')
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  d date := (now() at time zone 'America/Los_Angeles')::date;
  g integer;
  s integer;
  ws uuid;
  released integer := 0;
begin
  if p_ip_key is null or p_ip_key = '' or p_ip_key = '*' or length(p_ip_key) > 64 then
    raise exception 'bad address key';
  end if;
  -- The total's row first, then the address's, always in this order (as in take_usage).
  insert into public.demo_copy_usage (day, ip_key) values (d, '*') on conflict do nothing;
  select used into g from public.demo_copy_usage where day = d and ip_key = '*' for update;
  insert into public.demo_copy_usage (day, ip_key) values (d, p_ip_key) on conflict do nothing;
  select used into s from public.demo_copy_usage where day = d and ip_key = p_ip_key for update;
  if p_total_limit is not null and g >= p_total_limit then
    return jsonb_build_object('allowed', false, 'reason', 'global');
  end if;
  if p_ip_limit is not null and s >= p_ip_limit then
    return jsonb_build_object('allowed', false, 'reason', 'address');
  end if;
  update public.demo_copy_usage set used = used + 1, updated_at = now() where day = d and ip_key in ('*', p_ip_key);
  if p_replace is not null then
    if not exists (select 1 from public.workspaces where id = p_replace and kind = 'demo') then
      raise exception 'only a demo copy can be replaced';
    end if;
    released := public.release_demo_deposit(p_replace);
  end if;
  insert into public.workspaces (kind, label) values ('demo', coalesce(p_label, 'Harbor View Rentals')) returning id into ws;
  return jsonb_build_object('allowed', true, 'workspace', ws, 'released', released) || public.clone_demo_templates(ws, now());
end
$$;

-- Who may call what: the server's service role only.
revoke execute on function public.shift_text_dates(text, integer, integer) from public, anon, authenticated;
revoke execute on function public.shift_jsonb_dates(jsonb, integer, integer) from public, anon, authenticated;
revoke execute on function public.shift_run_messages(jsonb, integer, integer) from public, anon, authenticated;
revoke execute on function public.demo_shift_ts(timestamptz, integer, timestamptz) from public, anon, authenticated;
revoke execute on function public.demo_place_ts(timestamptz, date, integer) from public, anon, authenticated;
revoke execute on function public.copy_demo_template(uuid, uuid, timestamptz, uuid) from public, anon, authenticated;
revoke execute on function public.clone_demo_templates(uuid, timestamptz) from public, anon, authenticated;
revoke execute on function public.release_demo_deposit(uuid) from public, anon, authenticated;
revoke execute on function public.create_demo_workspace(text, integer, integer, uuid, text) from public, anon, authenticated;
grant execute on function public.shift_text_dates(text, integer, integer) to service_role;
grant execute on function public.shift_jsonb_dates(jsonb, integer, integer) to service_role;
grant execute on function public.shift_run_messages(jsonb, integer, integer) to service_role;
grant execute on function public.demo_shift_ts(timestamptz, integer, timestamptz) to service_role;
grant execute on function public.demo_place_ts(timestamptz, date, integer) to service_role;
grant execute on function public.copy_demo_template(uuid, uuid, timestamptz, uuid) to service_role;
grant execute on function public.clone_demo_templates(uuid, timestamptz) to service_role;
grant execute on function public.release_demo_deposit(uuid) to service_role;
grant execute on function public.create_demo_workspace(text, integer, integer, uuid, text) to service_role;

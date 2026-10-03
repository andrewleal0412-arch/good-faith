-- The Texas demo template (2317 Mesquite Bend Dr, Unit 3, Austin; registered in 20261003210352_demo_texas_template.sql)
-- moves out when its lease ends, as the seed now records it (`npm run demo:seed -- --state TX`): the tenants' 30 days'
-- written notice on 2026-08-31 for 2026-09-30, the last day of the fixed term. A copy, which dates the notice 20 days
-- before it is made, then shows "Lease end" and "Moving out" as one day 10 days ahead, rather than a fixed term that
-- ended 3 days ago with the tenants still there. Three smaller corrections ride along: the tenants gave the notice
-- (notice_given_by); the tenant link went out with the notice, so a copy no longer shows it as the newest entry; and the
-- refund record is the tenants' written designation of their PayPal account (`designated`), which Texas asks for in
-- place of no agreement, so the activity doesn't call it a refund agreement.
--
-- Data only, and only this project's Texas template: on any other project the first check matches nothing and nothing
-- changes. One transaction, so a copy made meanwhile sees the old dates or the new ones, never half of each. The two
-- California templates are not touched.

do $$
declare
  tpl constant uuid := '3e4598bf-b983-4fef-89ac-9cf2ff5261d6';
begin
  if not exists (select 1 from public.demo_templates where tenancy_id = tpl and role = 'notice' and anchor = date '2026-09-13') then
    return;
  end if;
  update public.tenancies
  set notice_given_on = date '2026-08-31', planned_move_out = date '2026-09-30', notice_given_by = 'tenant'
  where id = tpl and move_out_date is null;
  update public.audit_log
  set created_at = timestamptz '2026-08-31 17:00:00+00',
    detail = jsonb_build_object('previous', null, 'notice_given_on', '2026-08-31', 'planned_move_out', '2026-09-30',
      'given_by', 'tenant', 'inspection_window_opens', null, 'statement_due_if_on_time', '2026-10-30')
  where tenancy_id = tpl and action = 'notice_recorded';
  update public.audit_log set created_at = timestamptz '2026-08-31 17:05:00+00' where tenancy_id = tpl and action = 'tenant_link_created';
  update public.tenant_links set created_at = timestamptz '2026-08-31 17:05:00+00' where tenancy_id = tpl and revoked_at is null;
  update public.audit_log set detail = detail || '{"designated": true}'::jsonb where tenancy_id = tpl and action = 'refund_method_agreed';
  update public.demo_templates set anchor = date '2026-08-31' where tenancy_id = tpl and role = 'notice';
end
$$;

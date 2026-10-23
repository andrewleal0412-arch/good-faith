-- The move-out demo's people renamed (Andrew, 2026-10-23, his roommates as an easter egg):
--   tenants  Priya Raman   -> Luke Jones
--            Daniel Okafor -> Lane Forti
--   landlord Elena Marquez -> Teddy Buettner
-- NOT APPLIED. Run it only on his yes, in the Supabase SQL editor or with execute_sql, then upload the renamed lease and
-- receipts (2026-10-23-roommate-files.mjs --apply), then deploy the branch roommate-names: the e2e gate and
-- scripts/ca-snapshot.mjs expect the new names once this is in, and the old ones until then.
-- Revert: 2026-10-23-roommate-names-revert.sql (and the files script with --revert).
--
-- Only full names change. The template holds no first name on its own, and the tenants' PayPal email
-- (sb-...@personal.example.com) is the sandbox buyer account that pays every deposit, so it stays. History rows are left
-- as written: audit_log.detail, agent_runs.messages and paypal_webhook_events.payload keep the names they had.

-- Before: rows that still carry an old name (run again after; every count should be 0 except the history tables).
select 'tenancies' as tbl, count(*) from tenancies where (tenants::text || lease_terms::text || coalesce(notices::text, '')
    || coalesce(refund_agreement::text, '') || coalesce(statement_delivery::text, '')) ~ 'Priya Raman|Daniel Okafor|Elena Marquez'
union all select 'properties', count(*) from properties where owner_name = 'Elena Marquez'
union all select 'disputes', count(*) from disputes where opened_by ~ 'Priya Raman|Daniel Okafor'
union all select 'settlements', count(*) from settlements where tenant_name ~ 'Priya Raman|Daniel Okafor'
union all select 'history: audit_log', count(*) from audit_log where detail::text ~ 'Priya Raman|Daniel Okafor|Elena Marquez';
-- On 2026-10-23 11:30 PT: tenancies 10 (the template + 9 in demo copies), properties 10, disputes 3, settlements 3,
-- audit_log 31.

-- A. The template every demo copy is made from (1140 E. Juniper Hollow Ln, demo_templates role move_out). Required.
begin;
update tenancies set
  tenants            = replace(replace(tenants::text, 'Priya Raman', 'Luke Jones'), 'Daniel Okafor', 'Lane Forti')::jsonb,
  lease_terms        = replace(replace(replace(lease_terms::text, 'Priya Raman', 'Luke Jones'), 'Daniel Okafor', 'Lane Forti'), 'Elena Marquez', 'Teddy Buettner')::jsonb,
  notices            = replace(replace(notices::text, 'Priya Raman', 'Luke Jones'), 'Daniel Okafor', 'Lane Forti')::jsonb,
  refund_agreement   = replace(replace(refund_agreement::text, 'Priya Raman', 'Luke Jones'), 'Daniel Okafor', 'Lane Forti')::jsonb,
  statement_delivery = replace(replace(statement_delivery::text, 'Priya Raman', 'Luke Jones'), 'Daniel Okafor', 'Lane Forti')::jsonb
where id = (select tenancy_id from demo_templates where role = 'move_out');   -- 1 row
update properties set owner_name = 'Teddy Buettner'
where owner_name = 'Elena Marquez' and id = (select property_id from tenancies where id = (select tenancy_id from demo_templates where role = 'move_out'));   -- 1 row
commit;

-- B. The demo copies already made from it (8 workspaces of kind demo, 9 tenancies; 2 workspaces seen in the last 7
-- days on 10-23). Recommended: the lease and receipts in storage are shared with the template, so once the files are
-- replaced a copy left alone would show Luke Jones on its lease and Priya Raman on its own pages. The other way is to
-- remove the old copies (npm run demo:sweep) instead of running this block.
begin;
with copies as (
  select t.id from tenancies t join workspaces w on w.id = t.workspace_id
  where w.kind = 'demo' and (t.tenants::text || t.lease_terms::text) ~ 'Priya Raman|Daniel Okafor|Elena Marquez'
)
update tenancies set
  tenants            = replace(replace(tenants::text, 'Priya Raman', 'Luke Jones'), 'Daniel Okafor', 'Lane Forti')::jsonb,
  lease_terms        = replace(replace(replace(lease_terms::text, 'Priya Raman', 'Luke Jones'), 'Daniel Okafor', 'Lane Forti'), 'Elena Marquez', 'Teddy Buettner')::jsonb,
  notices            = replace(replace(notices::text, 'Priya Raman', 'Luke Jones'), 'Daniel Okafor', 'Lane Forti')::jsonb,
  refund_agreement   = replace(replace(refund_agreement::text, 'Priya Raman', 'Luke Jones'), 'Daniel Okafor', 'Lane Forti')::jsonb,
  statement_delivery = replace(replace(statement_delivery::text, 'Priya Raman', 'Luke Jones'), 'Daniel Okafor', 'Lane Forti')::jsonb
where id in (select id from copies);   -- 9 rows
update properties p set owner_name = 'Teddy Buettner'
from workspaces w where w.id = p.workspace_id and w.kind = 'demo' and p.owner_name = 'Elena Marquez';   -- 9 rows
update disputes d set opened_by = replace(replace(opened_by, 'Priya Raman', 'Luke Jones'), 'Daniel Okafor', 'Lane Forti')
from workspaces w where w.id = d.workspace_id and w.kind = 'demo' and d.opened_by ~ 'Priya Raman|Daniel Okafor';   -- 3 rows
update settlements s set tenant_name = replace(replace(tenant_name, 'Priya Raman', 'Luke Jones'), 'Daniel Okafor', 'Lane Forti')
from tenancies t join workspaces w on w.id = t.workspace_id
where t.id = s.tenancy_id and w.kind = 'demo' and s.tenant_name ~ 'Priya Raman|Daniel Okafor';   -- 3 rows
commit;

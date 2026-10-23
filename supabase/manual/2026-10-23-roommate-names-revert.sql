-- Undo 2026-10-23-roommate-names.sql: the move-out demo's people back to Priya Raman, Daniel Okafor and Elena Marquez.
-- Run block A to undo A, and block B as well if B was run. Then put the old files back (2026-10-23-roommate-files.mjs
-- --revert --apply) and deploy main again.

-- A. The template.
begin;
update tenancies set
  tenants            = replace(replace(tenants::text, 'Luke Jones', 'Priya Raman'), 'Lane Forti', 'Daniel Okafor')::jsonb,
  lease_terms        = replace(replace(replace(lease_terms::text, 'Luke Jones', 'Priya Raman'), 'Lane Forti', 'Daniel Okafor'), 'Teddy Buettner', 'Elena Marquez')::jsonb,
  notices            = replace(replace(notices::text, 'Luke Jones', 'Priya Raman'), 'Lane Forti', 'Daniel Okafor')::jsonb,
  refund_agreement   = replace(replace(refund_agreement::text, 'Luke Jones', 'Priya Raman'), 'Lane Forti', 'Daniel Okafor')::jsonb,
  statement_delivery = replace(replace(statement_delivery::text, 'Luke Jones', 'Priya Raman'), 'Lane Forti', 'Daniel Okafor')::jsonb
where id = (select tenancy_id from demo_templates where role = 'move_out');
update properties set owner_name = 'Elena Marquez'
where owner_name = 'Teddy Buettner' and id = (select property_id from tenancies where id = (select tenancy_id from demo_templates where role = 'move_out'));
commit;

-- B. The demo copies (every copy made from the renamed template too, since it carries the new names).
begin;
with copies as (
  select t.id from tenancies t join workspaces w on w.id = t.workspace_id
  where w.kind = 'demo' and (t.tenants::text || t.lease_terms::text) ~ 'Luke Jones|Lane Forti|Teddy Buettner'
)
update tenancies set
  tenants            = replace(replace(tenants::text, 'Luke Jones', 'Priya Raman'), 'Lane Forti', 'Daniel Okafor')::jsonb,
  lease_terms        = replace(replace(replace(lease_terms::text, 'Luke Jones', 'Priya Raman'), 'Lane Forti', 'Daniel Okafor'), 'Teddy Buettner', 'Elena Marquez')::jsonb,
  notices            = replace(replace(notices::text, 'Luke Jones', 'Priya Raman'), 'Lane Forti', 'Daniel Okafor')::jsonb,
  refund_agreement   = replace(replace(refund_agreement::text, 'Luke Jones', 'Priya Raman'), 'Lane Forti', 'Daniel Okafor')::jsonb,
  statement_delivery = replace(replace(statement_delivery::text, 'Luke Jones', 'Priya Raman'), 'Lane Forti', 'Daniel Okafor')::jsonb
where id in (select id from copies);
update properties p set owner_name = 'Elena Marquez'
from workspaces w where w.id = p.workspace_id and w.kind = 'demo' and p.owner_name = 'Teddy Buettner';
update disputes d set opened_by = replace(replace(opened_by, 'Luke Jones', 'Priya Raman'), 'Lane Forti', 'Daniel Okafor')
from workspaces w where w.id = d.workspace_id and w.kind = 'demo' and d.opened_by ~ 'Luke Jones|Lane Forti';
update settlements s set tenant_name = replace(replace(tenant_name, 'Luke Jones', 'Priya Raman'), 'Lane Forti', 'Daniel Okafor')
from tenancies t join workspaces w on w.id = t.workspace_id
where t.id = s.tenancy_id and w.kind = 'demo' and s.tenant_name ~ 'Luke Jones|Lane Forti';
commit;

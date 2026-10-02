-- One live tenant link per tenancy, enforced by the database rather than by request ordering: two creates at once
-- can no longer both leave a link live (createTenantLink retries once on the unique violation).
create unique index if not exists tenant_links_one_live_idx on public.tenant_links (tenancy_id) where revoked_at is null;

-- Pin the search path of the row-locking functions (Supabase advisor: function_search_path_mutable). Their bodies
-- schema-qualify public.tenancies and use only pg_catalog functions and operators, so an empty path is enough.
alter function public.set_tenant_move_out(uuid, jsonb) set search_path = '';
alter function public.set_notice(uuid, text, jsonb) set search_path = '';
alter function public.remove_notice(uuid, text) set search_path = '';

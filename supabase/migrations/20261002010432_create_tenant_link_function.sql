-- Make a tenant link and retire the live one in a single step. Locks the tenancy row, so creates made at the same
-- time (a double click, two tabs) queue up instead of racing: each sees the previous link and revokes it, and the
-- unique index tenant_links_one_live_idx is never hit. Returns the new row's public fields and the ids replaced, or
-- null when the tenancy does not exist. Only the server's service role may call it.
create or replace function public.create_tenant_link(p_tenancy uuid, p_token_hash text)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  replaced uuid[];
  new_row public.tenant_links;
begin
  perform 1 from public.tenancies where id = p_tenancy for update;
  if not found then
    return null;
  end if;
  with r as (
    update public.tenant_links set revoked_at = now() where tenancy_id = p_tenancy and revoked_at is null returning id
  )
  select coalesce(array_agg(id), '{}'::uuid[]) into replaced from r;
  insert into public.tenant_links (tenancy_id, token_hash) values (p_tenancy, p_token_hash) returning * into new_row;
  return jsonb_build_object('id', new_row.id, 'created_at', new_row.created_at, 'last_seen_at', new_row.last_seen_at, 'replaced', to_jsonb(replaced));
end
$$;
revoke execute on function public.create_tenant_link(uuid, text) from public, anon, authenticated;
grant execute on function public.create_tenant_link(uuid, text) to service_role;

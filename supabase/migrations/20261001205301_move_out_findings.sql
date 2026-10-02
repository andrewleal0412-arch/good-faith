-- Move-out inspection: what the agent found comparing move-in and move-out photos, room by room.
alter table public.tenancies add column if not exists move_out_findings jsonb;
alter table public.tenancies add column if not exists move_out_inspected_at timestamptz;

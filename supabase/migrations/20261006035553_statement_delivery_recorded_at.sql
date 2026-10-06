-- When the landlord recorded the statement's delivery, apart from the delivery date the record names (Andrew,
-- 2026-10-05). A delivery recorded on a later day than the day it says the statement went out shows "recorded <date>"
-- beside that date on the statement, its PDF and the tenants' page. Additive: existing rows (the demo's templates
-- among them) keep null and read as recorded on their delivery date; the demo copy functions name their columns, so a
-- copy starts with null too.

alter table public.tenancies add column if not exists statement_delivery_recorded_at timestamptz;

comment on column public.tenancies.statement_delivery_recorded_at is 'When the statement delivery record was last saved (the delivery date itself is statement_delivery.date); null for rows from before it, read as recorded on the delivery date';

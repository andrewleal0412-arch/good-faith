-- The tenant's (or landlord's) notice to end the tenancy, and the written notices the landlord gives back:
-- the initial-inspection notice (Civ. Code 1950.5(f)(1)) and the electronic-refund notice ((h)(1)(A)(ii)(II)).
-- Additive and nullable; move_out_date stays the actual move-out, planned_move_out is the date given at notice.
alter table public.tenancies
  add column if not exists notice_given_on date,
  add column if not exists planned_move_out date,
  add column if not exists notices jsonb;

comment on column public.tenancies.notice_given_on is 'Date notice to end the tenancy was given (by either party)';
comment on column public.tenancies.planned_move_out is 'Move-out date planned when notice was given; move_out_date is the actual one';
comment on column public.tenancies.notices is 'Notices given to the tenant, keyed by kind (inspection, electronic_refund): {date, method, to, recorded_at}';

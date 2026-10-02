-- Delivery record for the itemized statement (Civ. Code 1950.5(h)(1)(B), (h)(6)): when it went out and how
-- (personal delivery, first-class mail to the forwarding address or the unit, or email by written agreement).
alter table public.tenancies
  add column if not exists statement_delivered_at timestamptz,
  add column if not exists statement_delivery jsonb;

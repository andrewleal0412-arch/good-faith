-- The delivery route keeps statement_delivery_recorded_at through a correction that keeps the delivery date (a fixed
-- address, another adult named), so an on-time delivery corrected days later doesn't read as recorded late; a new
-- delivery, or a new date, is recorded when it is saved (src/lib/delivery.ts, recordedAtFor). A comment change only.

comment on column public.tenancies.statement_delivery_recorded_at is 'When this delivery date was recorded (the date itself is statement_delivery.date): set when a delivery is first saved or its date changes, kept through a correction that keeps the date; null for rows from before it, read as recorded on the delivery date';

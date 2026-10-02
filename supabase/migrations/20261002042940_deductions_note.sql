-- Why the work was done, in the landlord's words: part of the written explanation of the cost that goes on the
-- itemized statement (Civ. Code 1950.5(h)(2)(D)). Additive and nullable; existing rows read as no note.
alter table public.deductions add column if not exists note text;
comment on column public.deductions.note is 'Why the work was done, for the statement with the cost (Civ. Code 1950.5(h)(2)(D)).';

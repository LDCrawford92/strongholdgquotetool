create table if not exists public.pricing_settings (
  id uuid primary key default gen_random_uuid(),
  category text not null,
  key text not null,
  label text not null,
  value numeric not null default 0,
  unit text,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  unique(category, key)
);

insert into public.pricing_settings (category, key, label, value, unit)
values
  ('coil_carriers', 'rate_per_metre', 'Rate per metre', 148, 'GBP_PER_METRE'),
  ('coil_carriers', 'rear_door_fee', 'Rear door fee', 180, 'GBP'),
  ('coil_carriers', 'drip_sheet_fee', 'Drip sheet rate per metre', 0, 'GBP_PER_METRE'),
  ('coil_carriers', 'flicker_each', 'Flicker each', 18, 'GBP'),
  ('coil_carriers', 'rhino_fitting_fee', 'Rhino fitting fee', 450, 'GBP')
on conflict (category, key) do nothing;

update public.pricing_settings
set
  label = 'Drip sheet rate per metre',
  unit = 'GBP_PER_METRE'
where category = 'coil_carriers'
  and key = 'drip_sheet_fee';

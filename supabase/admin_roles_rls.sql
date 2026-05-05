create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text,
  username text,
  full_name text,
  role text not null default 'user',
  created_at timestamptz default now()
);

alter table public.profiles
  add column if not exists email text,
  add column if not exists username text,
  add column if not exists full_name text,
  add column if not exists role text not null default 'user',
  add column if not exists created_at timestamptz default now();

create or replace function public.is_admin(user_id uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1
    from public.profiles
    where id = user_id
      and role = 'admin'
  );
$$;

create or replace function public.current_user_role()
returns text
language sql
security definer
set search_path = public
stable
as $$
  select coalesce(
    (select role from public.profiles where id = auth.uid()),
    'user'
  );
$$;

alter table public.profiles enable row level security;

grant select, update on public.profiles to authenticated;

drop policy if exists "Users can read own profile" on public.profiles;
drop policy if exists "Admins can read all profiles" on public.profiles;
drop policy if exists "Users can update own profile without role escalation" on public.profiles;
drop policy if exists "Admins can update profiles" on public.profiles;

create policy "Users can read own profile"
on public.profiles
for select
to authenticated
using (auth.uid() = id);

create policy "Admins can read all profiles"
on public.profiles
for select
to authenticated
using (public.is_admin(auth.uid()));

create policy "Users can update own profile without role escalation"
on public.profiles
for update
to authenticated
using (auth.uid() = id)
with check (
  auth.uid() = id
  and role = public.current_user_role()
);

create policy "Admins can update profiles"
on public.profiles
for update
to authenticated
using (public.is_admin(auth.uid()))
with check (public.is_admin(auth.uid()));

alter table public.pricing_settings enable row level security;

grant select on public.pricing_settings to anon, authenticated;
grant insert, update, delete on public.pricing_settings to authenticated;

drop policy if exists "Anyone can read pricing settings" on public.pricing_settings;
drop policy if exists "Admins can insert pricing settings" on public.pricing_settings;
drop policy if exists "Admins can update pricing settings" on public.pricing_settings;
drop policy if exists "Admins can delete pricing settings" on public.pricing_settings;

create policy "Anyone can read pricing settings"
on public.pricing_settings
for select
to anon, authenticated
using (true);

create policy "Admins can insert pricing settings"
on public.pricing_settings
for insert
to authenticated
with check (public.is_admin(auth.uid()));

create policy "Admins can update pricing settings"
on public.pricing_settings
for update
to authenticated
using (public.is_admin(auth.uid()))
with check (public.is_admin(auth.uid()));

create policy "Admins can delete pricing settings"
on public.pricing_settings
for delete
to authenticated
using (public.is_admin(auth.uid()));

alter table public.price_sheets enable row level security;

grant select on public.price_sheets to authenticated;
grant insert, update, delete on public.price_sheets to authenticated;

drop policy if exists "Authenticated users can read price sheets" on public.price_sheets;
drop policy if exists "Admins can insert price sheets" on public.price_sheets;
drop policy if exists "Admins can update price sheets" on public.price_sheets;
drop policy if exists "Admins can delete price sheets" on public.price_sheets;

create policy "Authenticated users can read price sheets"
on public.price_sheets
for select
to authenticated
using (true);

create policy "Admins can insert price sheets"
on public.price_sheets
for insert
to authenticated
with check (public.is_admin(auth.uid()));

create policy "Admins can update price sheets"
on public.price_sheets
for update
to authenticated
using (public.is_admin(auth.uid()))
with check (public.is_admin(auth.uid()));

create policy "Admins can delete price sheets"
on public.price_sheets
for delete
to authenticated
using (public.is_admin(auth.uid()));

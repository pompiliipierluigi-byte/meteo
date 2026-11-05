-- 0003_places.sql — luoghi salvati (porto base e preferiti) con Row Level Security (SPEC §4.6).
-- Da eseguire nel SQL Editor di Supabase dopo 0002_routes.sql (vedi supabase/README.md).

create table public.places (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  name text not null check (length(trim(name)) between 1 and 100),
  lat double precision not null check (lat between -90 and 90),
  lon double precision not null check (lon between -180 and 180),
  note text check (note is null or length(note) <= 500),
  -- Porto base: al massimo uno per utente (indice unico parziale sotto).
  is_home boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index places_user_id_idx on public.places (user_id);
create unique index places_one_home_idx on public.places (user_id) where is_home;

create trigger places_updated_at
  before update on public.places
  for each row execute function public.set_updated_at();

alter table public.places enable row level security;

revoke all on public.places from anon;
revoke all on public.places from authenticated;
grant select, insert, update, delete on public.places to authenticated;

create policy places_select on public.places
  for select to authenticated
  using (user_id = (select auth.uid()));

create policy places_insert on public.places
  for insert to authenticated
  with check (user_id = (select auth.uid()));

create policy places_update on public.places
  for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

create policy places_delete on public.places
  for delete to authenticated
  using (user_id = (select auth.uid()));

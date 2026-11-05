-- 0002_routes.sql — rotte salvate con Row Level Security (SPEC §4.4, §4.5).
-- Da eseguire nel SQL Editor di Supabase dopo 0001_init.sql (vedi supabase/README.md).

create table public.routes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  -- La rotta resta consultabile anche se la barca viene eliminata (polare copiata in params).
  boat_id uuid references public.boats (id) on delete set null,
  name text not null check (length(trim(name)) between 1 and 100),
  start_lat double precision not null check (start_lat between -90 and 90),
  start_lon double precision not null check (start_lon between -180 and 180),
  end_lat double precision not null check (end_lat between -90 and 90),
  end_lon double precision not null check (end_lon between -180 and 180),
  waypoints jsonb not null default '[]'::jsonb check (jsonb_typeof(waypoints) = 'array' and jsonb_array_length(waypoints) <= 20),
  departure_at timestamptz not null,
  model text not null check (model in ('auto', 'icon2i', 'ecmwf', 'gfs')),
  forecast_run_at timestamptz,
  polar_kind text not null check (polar_kind in ('full', 'white')),
  params jsonb not null check (jsonb_typeof(params) = 'object'),
  track jsonb not null check (jsonb_typeof(track) = 'array'),
  duration_h numeric(6,2) not null check (duration_h >= 0),
  distance_nm numeric(7,2) not null check (distance_nm >= 0),
  motor_h numeric(6,2) not null check (motor_h >= 0),
  max_tws_kn numeric(5,1),
  max_gust_kn numeric(5,1),
  max_wave_m numeric(4,1),
  -- Finestra di partenza (24 riepiloghi, senza tracce). "window" è parola riservata in SQL.
  departure_window jsonb check (departure_window is null or jsonb_typeof(departure_window) = 'object'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- Limite di dimensione (piano gratuito: 500 MB in tutto).
  check (pg_column_size(track) + pg_column_size(params) + coalesce(pg_column_size(departure_window), 0) < 2000000)
);

create index routes_user_id_idx on public.routes (user_id, created_at desc);
create index routes_boat_id_idx on public.routes (boat_id);

create trigger routes_updated_at
  before update on public.routes
  for each row execute function public.set_updated_at();

alter table public.routes enable row level security;

revoke all on public.routes from anon;
revoke all on public.routes from authenticated;
grant select, insert, update, delete on public.routes to authenticated;

-- routes: proprie righe; la barca, se indicata, deve essere propria.
create policy routes_select on public.routes
  for select to authenticated
  using (user_id = (select auth.uid()));

create policy routes_insert on public.routes
  for insert to authenticated
  with check (
    user_id = (select auth.uid())
    and (boat_id is null or exists (select 1 from public.boats b where b.id = boat_id and b.user_id = (select auth.uid())))
  );

create policy routes_update on public.routes
  for update to authenticated
  using (user_id = (select auth.uid()))
  with check (
    user_id = (select auth.uid())
    and (boat_id is null or exists (select 1 from public.boats b where b.id = boat_id and b.user_id = (select auth.uid())))
  );

create policy routes_delete on public.routes
  for delete to authenticated
  using (user_id = (select auth.uid()));

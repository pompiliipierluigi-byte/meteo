-- 0001_init.sql — profili, barche e polari con Row Level Security (SPEC §4.1–4.3, §4.5).
-- Da eseguire una volta nel SQL Editor di Supabase (vedi supabase/README.md).
-- Ogni tabella nasce con RLS attiva: senza policy nessuno vede nulla.

-- ---------------------------------------------------------------------------
-- Funzioni comuni
-- ---------------------------------------------------------------------------

-- Aggiorna updated_at a ogni modifica.
create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- boats (§4.2)
-- ---------------------------------------------------------------------------

create table public.boats (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  name text not null check (length(trim(name)) between 1 and 100),
  model text check (model is null or length(model) <= 100),
  loa_m numeric(5,2) check (loa_m is null or loa_m between 2 and 100),
  source text not null check (source in ('orc', 'manual', 'csv')),
  orc_ref text check (orc_ref is null or length(orc_ref) <= 100),
  orc_year int check (orc_year is null or orc_year between 1990 and 2100),
  -- Default dipendente da source (true per ORC): impostato dal trigger boats_defaults.
  apply_efficiency boolean not null,
  motor_speed_kn numeric(4,1) not null default 6.0 check (motor_speed_kn between 0.5 and 30),
  tack_penalty_s int not null default 0 check (tack_penalty_s between 0 and 600),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index boats_user_id_idx on public.boats (user_id);

-- apply_efficiency: default true per le barche ORC, false per manuali/CSV (SPEC §2.5).
create or replace function public.boats_defaults()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.apply_efficiency is null then
    new.apply_efficiency := (new.source = 'orc');
  end if;
  return new;
end;
$$;

create trigger boats_defaults
  before insert on public.boats
  for each row execute function public.boats_defaults();

create trigger boats_updated_at
  before update on public.boats
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- polars (§4.3)
-- ---------------------------------------------------------------------------

create table public.polars (
  id uuid primary key default gen_random_uuid(),
  boat_id uuid not null references public.boats (id) on delete cascade,
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  kind text not null check (kind in ('full', 'white')),
  data jsonb not null check (jsonb_typeof(data) = 'object'),
  source text not null check (source in ('orc', 'manual', 'csv')),
  notes text check (notes is null or length(notes) <= 2000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (boat_id, kind)
);

create index polars_user_id_idx on public.polars (user_id);
create index polars_boat_id_idx on public.polars (boat_id);

create trigger polars_updated_at
  before update on public.polars
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- profiles (§4.1)
-- ---------------------------------------------------------------------------

create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  display_name text check (display_name is null or length(display_name) <= 100),
  default_boat_id uuid references public.boats (id) on delete set null,
  upwind_eff_pct numeric(5,1) not null default 80 check (upwind_eff_pct between 30 and 120),
  downwind_eff_pct numeric(5,1) not null default 80 check (downwind_eff_pct between 30 and 120),
  white_downwind_pct numeric(5,1) not null default 50 check (white_downwind_pct between 20 and 100),
  split_twa_deg numeric(4,1) not null default 90 check (split_twa_deg between 30 and 150),
  motor_mode text not null default 'vmg' check (motor_mode in ('speed', 'vmg')),
  motor_threshold_kn numeric(4,1) not null default 3.0 check (motor_threshold_kn between 0 and 10),
  motor_near_land boolean not null default false,
  motor_near_land_nm numeric(4,2) not null default 0.5 check (motor_near_land_nm between 0 and 10),
  coast_margin_nm numeric(4,2) not null default 0.3 check (coast_margin_nm between 0 and 5),
  coast_warning_nm numeric(4,2) not null default 1.0 check (coast_warning_nm between 0 and 10),
  wave_warning_m numeric(4,1) not null default 2.0 check (wave_warning_m between 0.1 and 15),
  -- Limiti di navigabilità: null = disattivato.
  limit_tws_kn numeric(4,1) check (limit_tws_kn is null or limit_tws_kn between 1 and 80),
  limit_gust_kn numeric(4,1) check (limit_gust_kn is null or limit_gust_kn between 1 and 100),
  limit_wave_m numeric(4,1) check (limit_wave_m is null or limit_wave_m between 0.1 and 15),
  settings jsonb not null default '{}'::jsonb check (jsonb_typeof(settings) = 'object'),
  disclaimer_version int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index profiles_default_boat_id_idx on public.profiles (default_boat_id);

create trigger profiles_updated_at
  before update on public.profiles
  for each row execute function public.set_updated_at();

-- Riga di profilo creata alla registrazione dell'utente.
-- security definer: unico modo di inserire in profiles (nessuna policy di insert per i client).
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, display_name)
  values (new.id, nullif(coalesce(new.raw_user_meta_data ->> 'full_name', new.raw_user_meta_data ->> 'name'), ''));
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------------------------------------------------------------------------
-- Row Level Security (§4.5)
-- ---------------------------------------------------------------------------

alter table public.profiles enable row level security;
alter table public.boats enable row level security;
alter table public.polars enable row level security;

-- Solo utenti autenticati; il ruolo anon non accede a nessuna tabella.
revoke all on public.profiles, public.boats, public.polars from anon;
revoke all on public.profiles, public.boats, public.polars from authenticated;
grant select, update on public.profiles to authenticated;
grant select, insert, update, delete on public.boats, public.polars to authenticated;

-- profiles: lettura e modifica della propria riga; barca predefinita solo tra le proprie.
create policy profiles_select on public.profiles
  for select to authenticated
  using (id = (select auth.uid()));

create policy profiles_update on public.profiles
  for update to authenticated
  using (id = (select auth.uid()))
  with check (
    id = (select auth.uid())
    and (
      default_boat_id is null
      or exists (select 1 from public.boats b where b.id = default_boat_id and b.user_id = (select auth.uid()))
    )
  );

-- boats: tutto sulle proprie righe.
create policy boats_select on public.boats
  for select to authenticated
  using (user_id = (select auth.uid()));

create policy boats_insert on public.boats
  for insert to authenticated
  with check (user_id = (select auth.uid()));

create policy boats_update on public.boats
  for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

create policy boats_delete on public.boats
  for delete to authenticated
  using (user_id = (select auth.uid()));

-- polars: proprie righe, e solo su barche proprie.
create policy polars_select on public.polars
  for select to authenticated
  using (user_id = (select auth.uid()));

create policy polars_insert on public.polars
  for insert to authenticated
  with check (
    user_id = (select auth.uid())
    and exists (select 1 from public.boats b where b.id = boat_id and b.user_id = (select auth.uid()))
  );

create policy polars_update on public.polars
  for update to authenticated
  using (user_id = (select auth.uid()))
  with check (
    user_id = (select auth.uid())
    and exists (select 1 from public.boats b where b.id = boat_id and b.user_id = (select auth.uid()))
  );

create policy polars_delete on public.polars
  for delete to authenticated
  using (user_id = (select auth.uid()));

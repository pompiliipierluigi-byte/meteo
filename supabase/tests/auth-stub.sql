-- Imitazione minima dello schema auth di Supabase per provare le migrazioni in un PostgreSQL locale.
-- NON eseguire su Supabase.
create role anon nologin;
create role authenticated nologin;
create schema auth;
create table auth.users (
  id uuid primary key default gen_random_uuid(),
  email text,
  raw_user_meta_data jsonb default '{}'::jsonb
);
-- Come in Supabase: l'utente corrente arriva dal JWT (qui da un'impostazione di sessione).
create function auth.uid() returns uuid language sql stable as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
$$;
grant usage on schema auth to anon, authenticated;
grant usage on schema public to anon, authenticated;

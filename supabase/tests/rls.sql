-- Verifica di trigger e RLS con due utenti (A e B) e il ruolo anon.
-- Ogni controllo fallito interrompe lo script con un errore.
\set ON_ERROR_STOP on
\set QUIET on

insert into auth.users (id, email, raw_user_meta_data) values
  ('00000000-0000-0000-0000-00000000000a', 'a@example.com', '{"full_name": "Utente A"}'),
  ('00000000-0000-0000-0000-00000000000b', 'b@example.com', '{}');

-- Funzione di asserzione.
create function pg_temp.check(ok boolean, msg text) returns void language plpgsql as $$
begin
  if not coalesce(ok, false) then raise exception 'FALLITO: %', msg; end if;
  raise notice 'ok: %', msg;
end $$;

select pg_temp.check((select count(*) = 2 from public.profiles), 'trigger: un profilo per utente');
select pg_temp.check((select display_name = 'Utente A' from public.profiles where id = '00000000-0000-0000-0000-00000000000a'), 'display_name dai metadati');

-- --- Utente A ---
set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000a';

insert into public.boats (id, name, source) values ('10000000-0000-0000-0000-00000000000a', 'Barca A', 'orc');
insert into public.boats (name, source) values ('Barca A2', 'csv');
select pg_temp.check((select apply_efficiency from public.boats where name = 'Barca A'), 'apply_efficiency true per ORC');
select pg_temp.check((select not apply_efficiency from public.boats where name = 'Barca A2'), 'apply_efficiency false per CSV');
select pg_temp.check((select user_id = auth.uid() from public.boats where name = 'Barca A'), 'user_id = auth.uid() di default');
insert into public.polars (boat_id, kind, data, source) values ('10000000-0000-0000-0000-00000000000a', 'full', '{"version":1}', 'orc');
update public.profiles set default_boat_id = '10000000-0000-0000-0000-00000000000a', upwind_eff_pct = 75;
select pg_temp.check((select count(*) = 1 from public.profiles), 'A vede solo il proprio profilo');

-- --- Utente B ---
set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000b';
select pg_temp.check((select count(*) = 0 from public.boats), 'B non vede le barche di A');
select pg_temp.check((select count(*) = 0 from public.polars), 'B non vede le polari di A');
select pg_temp.check((select count(*) = 1 from public.profiles), 'B vede solo il proprio profilo');

with u as (update public.boats set name = 'rubata' where id = '10000000-0000-0000-0000-00000000000a' returning 1)
select pg_temp.check((select count(*) = 0 from u), 'B non modifica le barche di A');
with d as (delete from public.boats where id = '10000000-0000-0000-0000-00000000000a' returning 1)
select pg_temp.check((select count(*) = 0 from d), 'B non elimina le barche di A');
with u as (update public.profiles set upwind_eff_pct = 50 where id = '00000000-0000-0000-0000-00000000000a' returning 1)
select pg_temp.check((select count(*) = 0 from u), 'B non modifica il profilo di A');

-- Inserimenti vietati: devono fallire.
create function pg_temp.must_fail(sql text, msg text) returns void language plpgsql as $$
begin
  begin
    execute sql;
  exception when others then
    raise notice 'ok: % (%)', msg, sqlerrm;
    return;
  end;
  raise exception 'FALLITO: % (riuscito ma doveva fallire)', msg;
end $$;

select pg_temp.must_fail($$insert into public.boats (user_id, name, source) values ('00000000-0000-0000-0000-00000000000a', 'x', 'manual')$$, 'B non crea barche a nome di A');
select pg_temp.must_fail($$insert into public.polars (boat_id, kind, data, source) values ('10000000-0000-0000-0000-00000000000a', 'white', '{}', 'manual')$$, 'B non aggiunge polari alla barca di A');
select pg_temp.must_fail($$update public.profiles set default_boat_id = '10000000-0000-0000-0000-00000000000a'$$, 'B non usa la barca di A come predefinita');
select pg_temp.must_fail($$insert into public.profiles (id) values ('00000000-0000-0000-0000-00000000000b')$$, 'nessun insert diretto in profiles');
select pg_temp.must_fail($$update public.profiles set upwind_eff_pct = 10$$, 'vincolo efficienza 30–120 %');
insert into public.boats (id, name, source) values ('10000000-0000-0000-0000-00000000000b', 'Barca B', 'manual');
select pg_temp.must_fail($$insert into public.polars (boat_id, kind, data, source) values ('10000000-0000-0000-0000-00000000000b', 'full', '[]', 'manual')$$, 'data deve essere un oggetto JSON');
select pg_temp.must_fail($$update public.boats set user_id = '00000000-0000-0000-0000-00000000000a' where id = '10000000-0000-0000-0000-00000000000b'$$, 'B non cede la propria barca ad A');

-- --- anon ---
reset request.jwt.claim.sub;
set role anon;
select pg_temp.must_fail('select * from public.boats', 'anon non legge boats');
select pg_temp.must_fail('select * from public.profiles', 'anon non legge profiles');

-- --- Cascata ---
reset role;
delete from public.boats where id = '10000000-0000-0000-0000-00000000000a';
select pg_temp.check((select count(*) = 0 from public.polars where boat_id = '10000000-0000-0000-0000-00000000000a'), 'polari eliminate con la barca');
select pg_temp.check((select default_boat_id is null from public.profiles where id = '00000000-0000-0000-0000-00000000000a'), 'barca predefinita azzerata');
delete from auth.users where id = '00000000-0000-0000-0000-00000000000b';
select pg_temp.check((select count(*) = 0 from public.boats where name = 'Barca B'), 'dati eliminati con l''utente');

\echo 'RLS: tutti i controlli superati'

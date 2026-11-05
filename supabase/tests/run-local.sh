#!/bin/sh
# Prova le migrazioni e la RLS in un PostgreSQL locale usa e getta (richiede PostgreSQL ≥ 15).
# Uso: sh supabase/tests/run-local.sh
set -eu
here=$(cd "$(dirname "$0")" && pwd)
bin=${PG_BIN:-$(dirname "$(command -v pg_ctl || ls /usr/lib/postgresql/*/bin/pg_ctl | tail -1)")}
tmp=$(mktemp -d)
trap '"$bin/pg_ctl" -D "$tmp/data" stop -m immediate >/dev/null 2>&1 || true; rm -rf "$tmp"' EXIT
if [ "$(id -u)" = 0 ]; then
  chown -R postgres "$tmp"
  run() { su postgres -s /bin/sh -c "$*"; }
else
  run() { sh -c "$*"; }
fi
run "'$bin/initdb' -D '$tmp/data' -A trust -U postgres >/dev/null"
run "'$bin/pg_ctl' -D '$tmp/data' -o '-k $tmp -p 54329 -c listen_addresses=' -l '$tmp/log' -w start >/dev/null"
psql="$bin/psql -h $tmp -p 54329 -U postgres -v ON_ERROR_STOP=1 -q -t -A"
$psql -c 'create database t' postgres
$psql -f "$here/auth-stub.sql" t
for f in "$here"/../migrations/*.sql; do
  echo "migrazione: $(basename "$f")"
  $psql -f "$f" t
done
if $psql -f "$here/rls.sql" t >"$tmp/out" 2>&1; then status=0; else status=1; fi
sed -n 's/.*NOTICE:  //p; s/.*ERROR:  /ERRORE: /p; /RLS:/p' "$tmp/out"
exit $status

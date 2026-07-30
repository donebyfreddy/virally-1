#!/usr/bin/env bash
# =============================================================================
# Schema + RLS verification against a plain PostgreSQL instance.
#
# Applies supabase/tests/00_supabase_shim.sql, then every file in
# supabase/migrations/ in order, then every supabase/tests/[0-9]*_test.sql.
#
# Exists because the Phase 2 gate — "prove cross-tenant access is denied" — is not
# something you can assert by reading SQL. It needs two real users hitting real
# policies. Docker (and therefore `supabase start`) is not always available; a
# local postgres almost always is.
#
# Usage:
#   PGHOST=127.0.0.1 PGPORT=55432 PGUSER=postgres ./supabase/tests/run.sh
#
# Any error aborts immediately: ON_ERROR_STOP=1 plus `set -e`. An earlier version
# of this script piped psql through `head`, which hid a migration failure and let
# a broken schema look clean — hence the deliberate absence of any filtering on
# the error path.
# =============================================================================
set -euo pipefail

DB="${VIRALLY_TEST_DB:-virally_test}"
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"

export PGHOST="${PGHOST:-127.0.0.1}"
export PGPORT="${PGPORT:-55432}"
export PGUSER="${PGUSER:-postgres}"

echo "▸ Recreating database '$DB' on $PGHOST:$PGPORT"
dropdb --if-exists "$DB"
createdb "$DB"

run() {
  # -q silences command tags; NOTICEs are downgraded so the log shows only real
  # problems. Errors still surface because ON_ERROR_STOP aborts the run.
  psql -q -d "$DB" -v ON_ERROR_STOP=1 \
    --set=client_min_messages=warning \
    -f "$1" >/dev/null
}

echo "▸ Applying Supabase compatibility shim"
run "$HERE/00_supabase_shim.sql"

echo "▸ Applying migrations"
for f in "$ROOT"/supabase/migrations/*.sql; do
  printf '    %s ... ' "$(basename "$f")"
  run "$f"
  echo "ok"
done

echo "▸ Running tests"
shopt -s nullglob
for f in "$HERE"/[0-9]*_test.sql; do
  printf '    %s ... ' "$(basename "$f")"
  # Tests print their own failures via RAISE EXCEPTION, which ON_ERROR_STOP turns
  # into a non-zero exit. Output is shown so a passing run still reports counts.
  psql -q -d "$DB" -v ON_ERROR_STOP=1 --set=client_min_messages=warning -f "$f"
done

echo "▸ All schema and RLS checks passed"

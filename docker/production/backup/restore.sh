#!/usr/bin/env bash
# Restores the database from the pgBackRest repository into an EMPTY or stopped data directory.
# Run with PostgreSQL stopped (see docs/production/BACKUP_AND_RECOVERY.md):
#
#   marketplace-restore                       latest backup + all archived WAL (newest state)
#   marketplace-restore "2026-12-01 09:30:00+08"   point in time
#   marketplace-restore --set 20261201-...F   one specific backup, no WAL replay beyond it
set -euo pipefail
STANZA=main
PGDATA="${PGDATA:-/var/lib/postgresql/data}"
render-pgbackrest

if [ -f "$PGDATA/postmaster.pid" ] && pg_ctl -D "$PGDATA" status >/dev/null 2>&1; then
  echo "PostgreSQL is running on $PGDATA; stop it first." >&2
  exit 1
fi

args=(--stanza=$STANZA --delta --log-level-console=info)
if [ "${1:-}" = "--set" ]; then
  args+=(--set="$2" --type=immediate --target-action=promote)
elif [ -n "${1:-}" ]; then
  args+=(--type=time --target="$1" --target-action=promote)
fi
mkdir -p "$PGDATA"
chmod 700 "$PGDATA"
echo "Restoring into $PGDATA: ${args[*]}"
pgbackrest "${args[@]}" restore
echo "Restore finished. Start PostgreSQL; it replays WAL and opens the database."

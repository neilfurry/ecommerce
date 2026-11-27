#!/usr/bin/env bash
# PostgreSQL archive_command. WAL is pushed to the pgBackRest repository once the stanza
# exists (the backup service creates it and leaves a marker in the data directory). Before
# the first backup there is nothing to recover to, so WAL is not kept; afterwards a failed
# push fails the command and PostgreSQL retries (WAL then piles up and an alert fires).
set -euo pipefail
if [ ! -f "${PGDATA:-/var/lib/postgresql/data}/.pgbackrest-stanza" ]; then
  exit 0
fi
exec pgbackrest --stanza=main archive-push "$1"

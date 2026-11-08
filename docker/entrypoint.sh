#!/bin/sh
set -eu

# Bind-mounted data directories are created by Docker/NAS as root. Fix their
# ownership before dropping privileges so the non-root app user can write.
DATA_DIR="${IW_DATA_DIR:-/app/data}"

if ! mkdir -p "$DATA_DIR"; then
  echo "ERROR: cannot create data directory: $DATA_DIR" >&2
  exit 1
fi

if ! chown -R node:node "$DATA_DIR"; then
  echo "ERROR: cannot chown data directory: $DATA_DIR" >&2
  echo "Fix the host directory ownership or use a Docker named volume." >&2
  exit 1
fi

exec gosu node "$@"

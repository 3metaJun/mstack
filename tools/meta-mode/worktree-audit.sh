#!/usr/bin/env sh
# Compatibility wrapper for environments that invoke the historical .sh name.
# The implementation is Node.js so Git paths and behavior are portable.
set -eu
script_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
exec node "$script_dir/worktree-audit.mjs" "$@"

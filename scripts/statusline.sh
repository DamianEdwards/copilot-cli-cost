#!/usr/bin/env sh
script_dir=$(CDPATH= cd "$(dirname "$0")" && pwd)
exec node "$script_dir/statusline-launcher.mjs" "$@"

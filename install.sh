#!/usr/bin/env bash
set -euo pipefail

plugin_source="${COPILOT_COST_PLUGIN_SOURCE:-DamianEdwards/copilot-cli-cost}"
install_base_url="${COPILOT_COST_INSTALL_BASE_URL:-https://raw.githubusercontent.com/DamianEdwards/copilot-cli-cost/main}"
skip_statusline=0
assume_yes=0

usage() {
  cat <<'USAGE'
Usage: ./install.sh [--plugin-source <source>] [--install-base-url <url>] [--skip-statusline] [--yes]

Installs the Copilot CLI Cost plugin, user extension shim, and status line.
USAGE
}

while [ "$#" -gt 0 ]; do
  case "$1" in
    --plugin-source)
      if [ "$#" -lt 2 ]; then
        echo "--plugin-source requires a value." >&2
        exit 1
      fi
      plugin_source="$2"
      shift 2
      ;;
    --install-base-url)
      if [ "$#" -lt 2 ]; then
        echo "--install-base-url requires a value." >&2
        exit 1
      fi
      install_base_url="$2"
      shift 2
      ;;
    --skip-statusline)
      skip_statusline=1
      shift
      ;;
    --yes)
      assume_yes=1
      shift
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "Unknown argument: $1" >&2
      usage >&2
      exit 1
      ;;
  esac
done

require_command() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "Required command '$1' was not found on PATH." >&2
    exit 1
  fi
}

download_file() {
  url="$1"
  output="$2"

  if command -v curl >/dev/null 2>&1; then
    curl -fsSL "$url" -o "$output"
  elif command -v wget >/dev/null 2>&1; then
    wget -qO "$output" "$url"
  else
    echo "Required command 'curl' or 'wget' was not found on PATH." >&2
    exit 1
  fi
}

get_configure_script() {
  local_configure_script="${script_dir}/scripts/configure-install.mjs"
  if [ -f "$local_configure_script" ]; then
    echo "$local_configure_script"
    return
  fi

  temp_dir="$(mktemp -d)"
  trap 'rm -rf "$temp_dir"' EXIT
  remote_configure_script="${temp_dir}/configure-install.mjs"
  remote_url="${install_base_url%/}/scripts/configure-install.mjs"

  echo "Downloading installer helper from ${remote_url}..." >&2
  download_file "$remote_url" "$remote_configure_script"
  echo "$remote_configure_script"
}

script_dir="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"
installed_plugins="${HOME}/.copilot/installed-plugins"

require_command copilot
require_command node

echo "Installing Copilot CLI Cost plugin from ${plugin_source}..."
if copilot plugin list 2>/dev/null | grep -qi 'copilot-cli-cost'; then
  echo "Copilot CLI Cost plugin is already installed."
else
  copilot plugin install "$plugin_source"
fi

installer="$(
  find "$installed_plugins" -type f -path '*/copilot-cli-cost*/scripts/install-extension-shim.mjs' 2>/dev/null |
    sort |
    head -n 1
)"

if [ -z "$installer" ]; then
  echo "Could not find the installed copilot-cli-cost plugin under ${installed_plugins}." >&2
  exit 1
fi

echo "Installing Copilot Cost extension shim..."
node "$installer"

configure_script="$(get_configure_script)"
configure_args=("$configure_script" "--platform" "posix")
if [ "$skip_statusline" -eq 1 ]; then
  configure_args+=("--skip-statusline")
fi
if [ "$assume_yes" -eq 1 ]; then
  configure_args+=("--yes")
fi

echo "Configuring Copilot experimental features and status line..."
node "${configure_args[@]}"

echo
echo "Install complete. If /cost is not available in an active Copilot CLI session, run /extensions and enable copilot-cli-cost under User."

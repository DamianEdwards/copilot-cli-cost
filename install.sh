#!/usr/bin/env bash
set -euo pipefail

plugin_source="${COPILOT_COST_PLUGIN_SOURCE:-DamianEdwards/copilot-cli-cost}"
marketplace_name="${COPILOT_COST_MARKETPLACE_NAME:-copilot-cli-cost-marketplace}"
plugin_name="${COPILOT_COST_PLUGIN_NAME:-copilot-cli-cost}"
install_base_url="${COPILOT_COST_INSTALL_BASE_URL:-https://raw.githubusercontent.com/DamianEdwards/copilot-cli-cost/main}"
copilot_home="${COPILOT_HOME:-${HOME}/.copilot}"
configure_script=""
configure_temp_dir=""
installer_script_dir=""
skip_statusline=0
assume_yes=0
uninstall=0

if [ -n "${BASH_SOURCE[0]:-}" ] && [ -f "${BASH_SOURCE[0]}" ]; then
  installer_script_dir="$(CDPATH= cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
fi

usage() {
  cat <<'USAGE'
Usage: ./install.sh [--plugin-source <source>] [--marketplace-name <name>] [--plugin-name <name>] [--install-base-url <url>] [--copilot-home <path>] [--skip-statusline] [--yes] [--uninstall]

Installs or uninstalls the Copilot CLI Cost plugin, user extension shim, and status line.
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
    --marketplace-name)
      if [ "$#" -lt 2 ]; then
        echo "--marketplace-name requires a value." >&2
        exit 1
      fi
      marketplace_name="$2"
      shift 2
      ;;
    --plugin-name)
      if [ "$#" -lt 2 ]; then
        echo "--plugin-name requires a value." >&2
        exit 1
      fi
      plugin_name="$2"
      shift 2
      ;;
    --copilot-home)
      if [ "$#" -lt 2 ]; then
        echo "--copilot-home requires a value." >&2
        exit 1
      fi
      copilot_home="$2"
      shift 2
      ;;
    --skip-statusline)
      skip_statusline=1
      shift
      ;;
    --uninstall)
      uninstall=1
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

version_at_least() {
  current_major="$1"
  current_minor="$2"
  current_patch="$3"
  current_prerelease="$4"
  minimum_major="$5"
  minimum_minor="$6"
  minimum_patch="$7"
  minimum_prerelease="$8"

  if [ "$current_major" -ne "$minimum_major" ]; then
    [ "$current_major" -gt "$minimum_major" ]
    return
  fi
  if [ "$current_minor" -ne "$minimum_minor" ]; then
    [ "$current_minor" -gt "$minimum_minor" ]
    return
  fi
  if [ "$current_patch" -ne "$minimum_patch" ]; then
    [ "$current_patch" -gt "$minimum_patch" ]
    return
  fi
  [ "$current_prerelease" -ge "$minimum_prerelease" ]
}

copilot_supports_marketplace_install() {
  version_text="$(copilot --version 2>/dev/null || true)"
  if [[ "$version_text" =~ ([0-9]+)\.([0-9]+)\.([0-9]+)(-([0-9]+))? ]]; then
    prerelease="${BASH_REMATCH[5]:-2147483647}"
    version_at_least "${BASH_REMATCH[1]}" "${BASH_REMATCH[2]}" "${BASH_REMATCH[3]}" "$prerelease" 1 0 56 0
    return
  fi
  return 1
}

plugin_installed() {
  plugin_list="$1"
  name="$2"
  printf '%s\n' "$plugin_list" | awk -v name="$name" '$2 == name { found = 1 } END { exit found ? 0 : 1 }'
}

marketplace_registered() {
  marketplace_list="$1"
  name="$2"
  printf '%s\n' "$marketplace_list" | awk -v name="$name" '$2 == name { found = 1 } END { exit found ? 0 : 1 }'
}

initialize_plugin_marketplace() {
  source="$1"
  name="$2"
  marketplace_list="$(copilot plugin marketplace list 2>/dev/null || true)"
  if marketplace_registered "$marketplace_list" "$name"; then
    copilot plugin marketplace update "$name"
  else
    copilot plugin marketplace add "$source"
  fi
}

get_configure_script() {
  get_local_script "configure-install.mjs"
  local_configure_script="$local_script"
  get_local_script "statusline-launcher.mjs"
  local_launcher_script="$local_script"
  if [ -n "$local_configure_script" ] && [ -n "$local_launcher_script" ]; then
    echo "Using local installer helper at ${local_configure_script}." >&2
    configure_script="$local_configure_script"
    return
  fi

  configure_temp_dir="$(mktemp -d)"
  trap 'rm -rf "$configure_temp_dir"' EXIT
  configure_script="${configure_temp_dir}/configure-install.mjs"
  configure_remote_url="${install_base_url%/}/scripts/configure-install.mjs"
  launcher_remote_url="${install_base_url%/}/scripts/statusline-launcher.mjs"

  echo "Downloading installer helper from ${configure_remote_url}..." >&2
  download_file "$configure_remote_url" "$configure_script"
  download_file "$launcher_remote_url" "${configure_temp_dir}/statusline-launcher.mjs"
}

get_local_script() {
  name="$1"
  local_script=""
  if [ -n "$installer_script_dir" ] && [ -f "${installer_script_dir}/scripts/${name}" ]; then
    local_script="${installer_script_dir}/scripts/${name}"
  fi
}

get_remote_script() {
  name="$1"
  get_local_script "$name"
  if [ -n "$local_script" ]; then
    echo "Using local installer helper at ${local_script}." >&2
    remote_script="$local_script"
    return
  fi

  if [ -z "$configure_temp_dir" ]; then
    configure_temp_dir="$(mktemp -d)"
    trap 'rm -rf "$configure_temp_dir"' EXIT
  fi

  remote_url="${install_base_url%/}/scripts/${name}"
  output="${configure_temp_dir}/${name}"
  download_file "$remote_url" "$output"
  remote_script="$output"
}

uninstall_plugin_if_installed() {
  plugin_list="$1"
  name="$2"
  if plugin_installed "$plugin_list" "$name"; then
    echo "Uninstalling Copilot CLI Cost plugin ${name}..."
    copilot plugin uninstall "$name"
    return 0
  fi
  return 1
}

case "$copilot_home" in
  /*) ;;
  *) copilot_home="$(pwd)/$copilot_home" ;;
esac
export COPILOT_HOME="$copilot_home"
installed_plugins="${copilot_home}/installed-plugins"

require_command copilot
require_command node

if [ "$uninstall" -eq 1 ]; then
  echo "Uninstalling Copilot CLI Cost..."
  get_remote_script "configure-install.mjs"
  configure_script="$remote_script"
  get_remote_script "install-extension-shim.mjs"
  shim_script="$remote_script"

  node "$configure_script" --uninstall --platform posix --copilot-home "$copilot_home"
  node "$shim_script" --uninstall --copilot-home "$copilot_home"

  plugin_list="$(copilot plugin list 2>/dev/null || true)"
  marketplace_plugin="${plugin_name}@${marketplace_name}"
  removed_plugin=0
  if uninstall_plugin_if_installed "$plugin_list" "$marketplace_plugin"; then
    removed_plugin=1
    plugin_list="$(copilot plugin list 2>/dev/null || true)"
  fi
  if uninstall_plugin_if_installed "$plugin_list" "$plugin_name"; then
    removed_plugin=1
  fi
  if [ "$removed_plugin" -eq 0 ]; then
    echo "Copilot CLI Cost plugin was not installed."
  fi

  echo
  echo "Uninstall complete. Restart active Copilot CLI sessions to unload any extension instance that was already running."
  exit 0
fi

echo "Installing or updating Copilot CLI Cost plugin..."
plugin_list="$(copilot plugin list 2>/dev/null || true)"
if copilot_supports_marketplace_install; then
  marketplace_plugin="${plugin_name}@${marketplace_name}"
  initialize_plugin_marketplace "$plugin_source" "$marketplace_name"
  plugin_list="$(copilot plugin list 2>/dev/null || true)"
  has_marketplace_plugin=0
  has_direct_plugin=0
  if plugin_installed "$plugin_list" "$marketplace_plugin"; then
    has_marketplace_plugin=1
  fi
  if plugin_installed "$plugin_list" "$plugin_name"; then
    has_direct_plugin=1
  fi

  if [ "$has_direct_plugin" -eq 1 ]; then
    echo "Removing deprecated direct Copilot CLI Cost plugin install..."
    copilot plugin uninstall "$plugin_name"
  fi

  if [ "$has_marketplace_plugin" -eq 1 ]; then
    copilot plugin update "$marketplace_plugin"
  else
    echo "Installing Copilot CLI Cost plugin from ${marketplace_plugin}..."
    copilot plugin install "$marketplace_plugin"
  fi
elif plugin_installed "$plugin_list" "$plugin_name"; then
  copilot plugin update "$plugin_name"
else
  echo "Installing Copilot CLI Cost plugin from ${plugin_source}..."
  copilot plugin install "$plugin_source"
fi

installer="$(
  find "$installed_plugins" -type f -path '*copilot-cli-cost*/scripts/install-extension-shim.mjs' 2>/dev/null |
    sort |
    head -n 1
)"

if [ -z "$installer" ]; then
  echo "Could not find the installed copilot-cli-cost plugin under ${installed_plugins}." >&2
  exit 1
fi

echo "Installing Copilot Cost extension shim..."
node "$installer" --copilot-home "$copilot_home"

get_configure_script
configure_args=("$configure_script" "--platform" "posix" "--copilot-home" "$copilot_home")
if [ "$skip_statusline" -eq 1 ]; then
  configure_args+=("--skip-statusline")
fi
if [ "$assume_yes" -eq 1 ]; then
  configure_args+=("--yes")
fi

echo "Configuring Copilot experimental features and status line..."
node "${configure_args[@]}"

echo
echo "Install complete. Start a new GitHub Copilot app session or restart/reload the app to pick up the Session Cost canvas. In the interactive copilot CLI, use /extensions if you need to inspect or reload copilot-cli-cost."

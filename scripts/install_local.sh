#!/bin/sh
set -eu

root_dir=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
if [ "$#" -gt 1 ]; then
  printf '%s\n' "Usage: sh scripts/install_local.sh [/path/to/home-assistant-config]" >&2
  exit 1
fi
repo_parent=$(CDPATH= cd -- "$root_dir/.." && pwd)
if [ "$(basename "$repo_parent")" = "repos" ]; then
  default_config_dir=$(CDPATH= cd -- "$root_dir/../.." && pwd)
else
  default_config_dir=""
fi
config_dir=${1:-${HA_CONFIG_DIR:-$default_config_dir}}
source_dir="$root_dir/backend"
target_dir="$config_dir/custom_components/ha_notifications"
panel_file="$root_dir/dist/panel.js"

if [ ! -f "$source_dir/manifest.json" ]; then
  printf '%s\n' "Integration source is missing: $source_dir" >&2
  exit 1
fi

if [ -z "$config_dir" ]; then
  printf '%s\n' "Home Assistant config path is required outside config/repos layout." >&2
  printf '%s\n' "Pass a path or set HA_CONFIG_DIR." >&2
  exit 1
fi

if [ ! -f "$panel_file" ]; then
  printf '%s\n' "Compiled frontend is missing: $panel_file" >&2
  printf '%s\n' "Run npm run build first, then run this script again." >&2
  exit 1
fi

mkdir -p "$config_dir/custom_components"
rm -rf "$target_dir"
cp -R "$source_dir" "$target_dir"
mkdir -p "$target_dir/dist"
cp "$panel_file" "$target_dir/dist/panel.js"

printf '%s\n' "Installed HA Notifications into $target_dir"
printf '%s\n' "Start Home Assistant with this configuration directory to test it."
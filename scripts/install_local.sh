#!/bin/sh
set -eu

root_dir=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
config_dir=${1:-"$(CDPATH= cd -- "$root_dir/../.." && pwd)"}
source_dir="$root_dir/backend"
target_dir="$config_dir/custom_components/ha_notifications"
panel_file="$root_dir/dist/panel.js"

if [ ! -f "$source_dir/manifest.json" ]; then
  printf '%s\n' "Integration source is missing: $source_dir" >&2
  exit 1
fi

if [ ! -f "$panel_file" ]; then
  printf '%s\n' "Compiled frontend is missing: $panel_file" >&2
  exit 1
fi

mkdir -p "$config_dir/custom_components"
rm -rf "$target_dir"
cp -R "$source_dir" "$target_dir"
mkdir -p "$target_dir/dist"
cp "$panel_file" "$target_dir/dist/panel.js"

printf '%s\n' "Installed HA Notifications into $target_dir"
printf '%s\n' "Start Home Assistant with this configuration directory to test it."
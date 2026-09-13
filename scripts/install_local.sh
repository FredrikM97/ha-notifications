#!/bin/sh
set -eu

root_dir=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
config_dir=${1:-"$(CDPATH= cd -- "$root_dir/../.." && pwd)"}
source_dir="$root_dir/custom_components/notification_center"
target_dir="$config_dir/custom_components/notification_center"
panel_file="$source_dir/dist/panel.js"

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

printf '%s\n' "Installed Notification Center into $target_dir"
printf '%s\n' "Start Home Assistant with this configuration directory to test it."
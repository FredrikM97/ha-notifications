#!/bin/sh
set -eu

root_dir=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
config_dir=${1:-"$root_dir/.ha-config"}
source_dir="$root_dir/custom_components/notification_center"
target_dir="$config_dir/custom_components/notification_center"

if [ ! -f "$source_dir/manifest.json" ]; then
  printf '%s\n' "Integration source is missing: $source_dir" >&2
  exit 1
fi

(cd "$root_dir" && npm run build)
trap '(cd "$root_dir" && npm run clean)' EXIT

mkdir -p "$config_dir/custom_components"
rm -rf "$target_dir"
cp -R "$source_dir" "$target_dir"

# Home Assistant loads the compiled frontend; TypeScript remains source-only.
rm -f "$target_dir"/frontend/*.ts
rm -rf "$target_dir"/frontend/node_modules

printf '%s\n' "Installed Notification Center into $target_dir"
printf '%s\n' "Start Home Assistant with this configuration directory to test it."
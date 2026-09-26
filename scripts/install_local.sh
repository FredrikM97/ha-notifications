#!/bin/sh

set -eu

root_dir=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
config_dir=$(CDPATH= cd -- "$root_dir/../.." && pwd)
target_dir="${1:-$config_dir/custom_components/ha_notifications}"

if [ ! -d "$config_dir/custom_components" ]; then
    printf '%s\n' \
        "Home Assistant custom_components directory not found: $config_dir/custom_components" >&2
    exit 1
fi

rm -rf "$target_dir"
mkdir -p "$target_dir"

cp -R \
    "$root_dir/custom_components/ha_notifications/." \
    "$target_dir/"

mkdir -p "$target_dir/frontend"

cp \
    "$root_dir/build/frontend/panel.js" \
    "$target_dir/frontend/panel.js"

printf '%s\n' "Installed to $target_dir"
#!/bin/sh

set -eu

root_dir=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
default_config_dir=$(CDPATH= cd -- "$root_dir/../.." && pwd)
config_dir="${1:-${HA_CONFIG_DIR:-$default_config_dir}}"
target_dir="$config_dir/custom_components/ha_notifications"
build_dir="$root_dir/build"

if [ ! -d "$config_dir" ]; then
    printf '%s\n' \
        "Home Assistant config directory not found: $config_dir" >&2
    exit 1
fi

for required_file in manifest.json __init__.py frontend/panel.js; do
    if [ ! -f "$build_dir/$required_file" ]; then
        printf '%s\n' "Build file is missing: $build_dir/$required_file. Run npm run build first." >&2
        exit 1
    fi
done

rm -rf "$target_dir"
mkdir -p "$target_dir"

cp -R "$build_dir/." "$target_dir/"

printf '%s\n' "Installed to $target_dir"
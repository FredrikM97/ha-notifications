#!/bin/sh

set -eu

root_dir=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
zip_path="${1:-$root_dir/ha-notifications.zip}"

tmp_dir=$(mktemp -d)
trap 'rm -rf "$tmp_dir"' EXIT

mkdir -p "$tmp_dir/ha_notifications/frontend"

cp -R \
    "$root_dir/custom_components/ha_notifications/." \
    "$tmp_dir/ha_notifications/"

cp \
    "$root_dir/build/frontend/panel.js" \
    "$tmp_dir/ha_notifications/frontend/panel.js"

rm -f "$zip_path"

(
    cd "$tmp_dir"
    zip -qr "$zip_path" ha_notifications
)

printf '%s\n' "Created $zip_path"
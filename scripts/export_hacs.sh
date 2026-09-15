#!/bin/sh
set -eu

root_dir=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
output_dir=${1:-"$root_dir/hacs-export"}

(cd "$root_dir" && npm run build)
trap '(cd "$root_dir" && npm run clean)' EXIT
rm -rf "$output_dir"
mkdir -p "$output_dir"
cp -R "$root_dir/custom_components" "$output_dir/custom_components"
package_dir="$output_dir/custom_components/ha_notifications"
rm -rf "$package_dir/frontend"/*.ts "$package_dir/frontend"/node_modules

printf '%s\n' "HACS package exported to $output_dir"
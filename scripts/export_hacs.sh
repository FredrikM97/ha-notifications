#!/bin/sh
set -eu

root_dir=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
output_dir=${1:-"$root_dir/hacs-export"}

(cd "$root_dir" && npm run build)
panel_file="$root_dir/dist/panel.js"
if [ ! -f "$panel_file" ]; then
	printf '%s\n' "Compiled frontend is missing: $panel_file" >&2
	exit 1
fi
trap '(cd "$root_dir" && npm run clean)' EXIT
rm -rf "$output_dir"
mkdir -p "$output_dir"
cp -R "$root_dir/custom_components" "$output_dir/custom_components"
package_dir="$output_dir/custom_components/ha_notifications"
mkdir -p "$package_dir/dist"
cp "$panel_file" "$package_dir/dist/panel.js"
find "$output_dir/custom_components" -type d -name __pycache__ -prune -exec rm -rf {} +
find "$output_dir/custom_components" -type f -name '*.pyc' -delete
if [ ! -f "$package_dir/dist/panel.js" ]; then
	printf '%s\n' "Exported frontend bundle is missing: $package_dir/dist/panel.js" >&2
	exit 1
fi
if [ -e "$package_dir/frontend" ]; then
	printf '%s\n' "Raw frontend source leaked into the HACS package: $package_dir/frontend" >&2
	exit 1
fi

printf '%s\n' "HACS package exported to $output_dir"
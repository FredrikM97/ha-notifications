#!/bin/sh

set -eu

root_dir=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
version=${1:-}
zip_path=${2:-"$root_dir/ha-notifications.zip"}

build_dir="$root_dir/build"
package_dir="$build_dir"

if [ ! -d "$package_dir" ]; then
	printf '%s\n' "Build directory is missing: $package_dir" >&2
	exit 1
fi

manifest_path="$package_dir/manifest.json"

if [ ! -f "$manifest_path" ]; then
	printf '%s\n' "HACS manifest is missing: $manifest_path" >&2
	exit 1
fi

if [ ! -f "$package_dir/frontend/panel.js" ]; then
	printf '%s\n' "Built frontend is missing: $package_dir/frontend/panel.js" >&2
	exit 1
fi

if [ -n "$version" ]; then
	node - "$manifest_path" "$version" <<'NODE'
const fs = require("fs");

const [manifestPath, version] = process.argv.slice(2);
const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));

manifest.version = version;

fs.writeFileSync(
	manifestPath,
	`${JSON.stringify(manifest, null, 2)}\n`,
);
NODE
fi

rm -f "$zip_path"

(
	cd "$build_dir"
	zip -qr "$zip_path" . \
		-x '*.pyc' \
		-x '*__pycache__/*'
)

unzip -tq "$zip_path"

archive_entries=$(unzip -Z1 "$zip_path")

for required_entry in \
	manifest.json \
	__init__.py \
	frontend/panel.js
do
	if ! printf '%s\n' "$archive_entries" | grep -Fxq "$required_entry"; then
		printf '%s\n' "HACS archive is missing: $required_entry" >&2
		exit 1
	fi
done

if printf '%s\n' "$archive_entries" | grep -q '^custom_components/'; then
	printf '%s\n' "HACS archive must not contain custom_components/" >&2
	exit 1
fi

printf '%s\n' "Created $zip_path"
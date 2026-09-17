#!/bin/sh
set -eu

root_dir=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
version=${1:-}
zip_path=${2:-"$root_dir/ha-notifications.zip"}

(cd "$root_dir" && npm run export:hacs)
package_dir="$root_dir/hacs-export/custom_components/ha_notifications"
manifest_path="$package_dir/manifest.json"

if [ ! -f "$manifest_path" ]; then
	printf '%s\n' "HACS manifest is missing: $manifest_path" >&2
	exit 1
fi

if [ -n "$version" ]; then
	node - "$manifest_path" "$version" <<'NODE'
const fs = require("fs");

const [manifestPath, version] = process.argv.slice(2);
const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
manifest.version = version;
fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
NODE
fi

rm -f "$zip_path"
(
	cd "$package_dir"
	zip -qr "$zip_path" . -x '*.pyc' '*__pycache__/*'
)
unzip -tq "$zip_path" 'dist/panel.js'
archive_entries=$(unzip -Z1 "$zip_path")
if printf '%s\n' "$archive_entries" | grep -q '^custom_components/'; then
	printf '%s\n' "HACS archive must contain the integration at its root" >&2
	exit 1
fi
for required_entry in manifest.json __init__.py dist/panel.js; do
	if ! printf '%s\n' "$archive_entries" | grep -Fxq "$required_entry"; then
		printf '%s\n' "HACS archive is missing root entry: $required_entry" >&2
		exit 1
	fi
done

printf '%s\n' "HACS archive created at $zip_path"
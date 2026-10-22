#!/bin/sh

set -eu

npm test

python3 -m ruff format --check custom_components/ha_notifications tests/backend scripts
python3 -m ruff check custom_components/ha_notifications tests/backend scripts

python3 -m pytest tests/backend/
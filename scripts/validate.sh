#!/bin/sh

set -eu

npm test

python3 -m ruff check custom_components/ha_notifications tests/backend

python3 -m pytest tests/backend/
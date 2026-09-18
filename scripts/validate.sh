#!/bin/sh
set -eu

npm run build
python3 -m ruff check custom_components/ha_notifications tests/backend
python3 -m pytest tests/backend/
npm run test:frontend
npm run test:unit

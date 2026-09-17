#!/bin/sh
set -eu

npm run build
python3 -m ruff check backend tests/backend
python3 -m pytest tests/backend/
npm run test:frontend
npm run test:unit

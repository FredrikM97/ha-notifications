#!/bin/sh
set -eu

python3 -m ruff check custom_components tests
npm run build
python3 -m pytest tests/
npm run test:frontend
npm run test:unit

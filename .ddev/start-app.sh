#!/usr/bin/env bash
set -euo pipefail
cd /var/www/html
lock_hash=$(sha256sum package-lock.json | cut -d ' ' -f 1)
if [[ ! -f node_modules/.systv-lock ]] || [[ $(cat node_modules/.systv-lock) != "$lock_hash" ]]; then
  npm ci --no-audit --no-fund
  echo "$lock_hash" > node_modules/.systv-lock
fi
npm run db:migrate
npm run db:import-sqlite -- --if-present
npm run db:seed
exec node --watch server.js

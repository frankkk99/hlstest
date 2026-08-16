#!/usr/bin/env bash
set -euo pipefail

APP_DIR="${APP_DIR:-$(pwd)}"
BRANCH="${BRANCH:-main}"
PM2_APP="${PM2_APP:-dev2u-player-gateway}"

cd "$APP_DIR"

echo "[1/6] Syncing $BRANCH"
git fetch origin "$BRANCH"
git checkout "$BRANCH"
git pull --ff-only origin "$BRANCH"

echo "[2/6] Installing dependencies"
npm ci

echo "[3/6] Building standalone Next.js"
npm run build

echo "[4/6] Copying static assets into standalone output"
rm -rf .next/standalone/public .next/standalone/.next/static
cp -R public .next/standalone/public
mkdir -p .next/standalone/.next
cp -R .next/static .next/standalone/.next/static

echo "[5/6] Starting/reloading PM2"
if ! command -v pm2 >/dev/null 2>&1; then
  echo "PM2 not found. Install it first: npm install -g pm2"
  exit 1
fi

if pm2 describe "$PM2_APP" >/dev/null 2>&1; then
  pm2 reload ecosystem.config.cjs --only "$PM2_APP" --update-env
else
  pm2 start ecosystem.config.cjs --only "$PM2_APP"
fi
pm2 save

echo "[6/6] Local health check"
for attempt in 1 2 3 4 5 6; do
  if curl -fsS --max-time 10 http://127.0.0.1:3000/ >/dev/null; then
    echo "aaPanel deploy OK: http://127.0.0.1:3000"
    exit 0
  fi
  sleep 2
done

echo "Application did not answer on port 3000. Check: pm2 logs $PM2_APP"
exit 1

# dev2u.online Player Gateway on aaPanel

This project is prepared to run as a persistent Next.js process behind aaPanel Nginx.

## Runtime shape

- Nginx/aaPanel terminates HTTPS for `dev2u.online` and `www.dev2u.online`.
- Nginx reverse-proxies to `127.0.0.1:3000`.
- PM2 runs exactly **1** `dev2u-player-gateway` process.
- The process keeps the shared Chromium browser, prepared playback sessions, and browser-session proxy state in memory.
- Do not enable PM2 cluster/multiple instances until session state is moved to shared storage or sticky routing is implemented.

## 1. Server prerequisites

Recommended: Node.js 22 LTS, Git, PM2, curl, and a system Chrome/Chromium installation.

```bash
node -v
npm -v
git --version
npm install -g pm2
```

Install Chrome/Chromium using the package appropriate for the VPS OS, then locate it:

```bash
which google-chrome-stable || which google-chrome || which chromium || which chromium-browser
```

Save the returned path as `CHROMIUM_EXECUTABLE_PATH` in `.env.production`.

## 2. Clone the repository

Example aaPanel site/app path:

```bash
cd /www/wwwroot
git clone https://github.com/frankkk99/hlstest.git dev2u-player-gateway
cd /www/wwwroot/dev2u-player-gateway
git checkout main
```

If the repo is already present, only use `main` for production.

## 3. Production environment

Create `/www/wwwroot/dev2u-player-gateway/.env.production` from `.env.example` and fill server-only secrets locally on the VPS. Do not commit the real file.

Important values include:

```dotenv
NODE_ENV=production
ENABLE_STREAM_PROXY=true
PLAYER_GATEWAY_FRAME_ANCESTORS=*
CHROMIUM_EXECUTABLE_PATH=/usr/bin/google-chrome-stable
HLSHUB_SUPABASE_URL=https://qlunnckudeynhruxzpnb.supabase.co
HLSHUB_SUPABASE_SERVICE_ROLE_KEY=REPLACE_ON_SERVER
HLSHUB_ADMIN_PASSWORD=REPLACE_ON_SERVER
HLSHUB_ADMIN_SESSION_SECRET=REPLACE_WITH_RANDOM_SECRET
HLSHUB_ADMIN_KEY=REPLACE_ON_SERVER
UPLOAD18_USERNAME=REPLACE_ON_SERVER
UPLOAD18_PASSWORD=REPLACE_ON_SERVER
```

Keep all actual credentials only on the VPS/aaPanel environment.

## 4. First build/start

```bash
cd /www/wwwroot/dev2u-player-gateway
npm ci
npm run build
rm -rf .next/standalone/public .next/standalone/.next/static
cp -R public .next/standalone/public
mkdir -p .next/standalone/.next
cp -R .next/static .next/standalone/.next/static
pm2 start ecosystem.config.cjs
pm2 save
pm2 startup
```

Run the command printed by `pm2 startup` once so the Gateway returns after a VPS reboot.

Check locally:

```bash
curl -I http://127.0.0.1:3000/
pm2 status
pm2 logs dev2u-player-gateway --lines 100
```

## 5. aaPanel Nginx

Create the aaPanel website for:

```text
dev2u.online
www.dev2u.online
```

Use Nginx and enable SSL in aaPanel. Reverse proxy to:

```text
http://127.0.0.1:3000
```

The repository contains `deploy/aapanel-nginx.conf.example`. Merge its proxy locations into the aaPanel site config. In particular, buffering is disabled for `/api/stream` and `/api/browser-session` so HLS/session data is forwarded immediately.

Validate/reload Nginx after editing:

```bash
nginx -t
```

Then use aaPanel's Reload button or your system Nginx reload command.

## 6. Deploy updates from main

The deploy script always syncs `main`, builds standalone output, copies static assets, reloads the single PM2 process, and runs a local check.

```bash
cd /www/wwwroot/dev2u-player-gateway
bash scripts/deploy-aapanel.sh
```

Do not run it while uncommitted production code changes exist in the repo.

## 7. Move DNS only after the VPS passes tests

Before moving the public domain, test the VPS locally or through a temporary hostname/hosts-file mapping. Verify at least:

- `/` shows the Gateway wrapper list.
- `/player/{catalogId}` opens the Test Player.
- `/embed/{catalogId}` renders without the old tool navigation.
- Playback session resolves and video starts.
- Retry/forceFresh works.
- `/admin` login works.
- HTML Import page works.

After those pass, change the DNS A/AAAA records for `dev2u.online`/`www.dev2u.online` from Vercel to the VPS IP. Keep the Vercel project unchanged until DNS propagation and playback verification are complete so rollback remains possible.

## Why one PM2 process initially

`/api/browser-session` currently stores browser/session mappings in process memory. Multiple workers can split a playback session from later manifest/segment proxy requests. A single persistent process also allows the shared Chromium browser and 30-minute prepared-session cache to survive between requests much more reliably than serverless instances.

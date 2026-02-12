---
name: deploy
description: Deploy telegatask bot to the TimeWeb server. Use when the user asks to deploy, push to server, update production, or release.
---

# Deploying Telegatask

## Quick Deploy

```bash
cd /Users/nicko/telegatask && bash scripts/deploy.sh
```

## What it does

1. Validates local `.env` and `serviceAccountKey.json`
2. Checks server ports (VPN, bot)
3. Rsync files to `/opt/telegatask/` (excludes node_modules, dist, .git)
4. SCP `.env` and `serviceAccountKey.json`
5. `npm install` + `npm run build` on server
6. `pm2 delete telegatask && pm2 start dist/index.js --name telegatask --update-env`
7. `pm2 save && pm2 startup`

## Server details

| Property | Value |
|----------|-------|
| Host | 147.45.132.90 |
| SSH port | 2222 |
| User | root |
| App dir | /opt/telegatask |
| Bot port | 3000 |
| Process | PM2 `telegatask` |
| Auth | SSH key (~/.ssh/id_ed25519) |

## Manual server commands

```bash
# SSH
ssh -p 2222 root@147.45.132.90

# Logs
pm2 logs telegatask --lines 30

# Status
pm2 status

# Restart
pm2 restart telegatask

# Health check
curl http://localhost:3000/health
curl http://localhost:3000/debug/status
```

## Important

- VPN (Xray) runs on same server — different ports, no conflicts
- Always build locally first: `npx tsc --noEmit`
- PM2 must start from `/opt/telegatask` dir (for dotenv)
- After deploy, Telegram long-poll may take ~50s to reconnect

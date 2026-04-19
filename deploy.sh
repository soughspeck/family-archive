#!/bin/bash
# deploy.sh — run this on the Hetzner VPS to update to the latest version
# Usage: ./deploy.sh
set -e

echo "==> Pulling latest code..."
git pull origin main

echo "==> Installing dependencies..."
npm ci --omit=dev

echo "==> Building server TypeScript..."
npx tsc

echo "==> Building client TypeScript..."
npx tsc --project tsconfig.client.json

echo "==> Restarting app with PM2..."
pm2 reload ecosystem.config.js --update-env

echo ""
echo "✓ Deploy complete"
pm2 status

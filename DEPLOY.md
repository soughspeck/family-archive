# Deployment Guide — Hetzner VPS + Cloudflare R2

## One-time VPS setup

### 1. Provision a Hetzner VPS
- Cheapest option: CX22 (~€4/mo), Ubuntu 24.04
- Add your SSH key during creation

### 2. Install Node.js 20 + PM2 + Caddy
```bash
# Node.js via nvm
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.7/install.sh | bash
source ~/.bashrc
nvm install 20
nvm use 20

# PM2 (process manager)
npm install -g pm2
pm2 startup  # follow the printed command to enable auto-start on reboot

# Caddy (reverse proxy + auto-HTTPS)
sudo apt install -y debian-keyring debian-archive-keyring apt-transport-https curl
curl -1sLf 'https://dl.cloudflare.com/caddy/stable/gpg.key' | sudo gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
curl -1sLf 'https://dl.cloudflare.com/caddy/stable/debian.deb.txt' | sudo tee /etc/apt/sources.list.d/caddy-stable.list
sudo apt update && sudo apt install caddy
```

### 3. Clone the repo and configure
```bash
git clone https://github.com/soughspeck/family-archive.git
cd family-archive
cp .env.example .env
nano .env   # fill in all values (see below)
```

### 4. `.env` values for production
```
NODE_ENV=production
PORT=3000
DB_PATH=/home/user/family-archive/family-archive.db
APP_NAME=Family Archive

# R2 — get these from Cloudflare R2 dashboard
MEDIA_BASE_URL=https://pub-XXXX.r2.dev   # or your custom domain
R2_ENDPOINT=https://ACCOUNT_ID.r2.cloudflarestorage.com
R2_BUCKET=family-archive
R2_ACCESS_KEY=your_access_key_id
R2_SECRET_KEY=your_secret_access_key

# Keep empty — uploads/ only used for tmp files in prod
UPLOADS_DIR=./uploads
```

### 5. Upload your existing database and uploads (first deploy only)
```bash
# From your local machine:
scp family-archive.db user@YOUR_VPS_IP:~/family-archive/
# If you have local media to migrate to R2, see "Migrating existing media" below
```

### 6. Initial build and start
```bash
npm ci
npm run build
mkdir -p /var/log/family-archive
pm2 start ecosystem.config.js
pm2 save
```

### 7. Configure Caddy
```bash
sudo cp Caddyfile /etc/caddy/Caddyfile
# Edit it — replace YOUR_DOMAIN with your actual domain
sudo nano /etc/caddy/Caddyfile
sudo systemctl reload caddy
```

Point your domain's DNS A record to the VPS IP. Caddy will auto-provision HTTPS.

---

## Cloudflare R2 setup

1. Go to **Cloudflare Dashboard → R2**
2. Create a bucket named `family-archive`
3. Under bucket settings, enable **Public access** (or set up a custom domain)
4. Create an **R2 API token** with Object Read & Write permissions
5. Fill in your `.env` with the endpoint and credentials

---

## Subsequent deploys

```bash
ssh user@YOUR_VPS_IP
cd family-archive
./deploy.sh
```

---

## Migrating existing local media to R2

If you have existing photos in `uploads/` that need to move to R2:

```bash
# Install rclone on VPS
sudo apt install rclone

# Configure rclone with your R2 credentials
rclone config
# Choose: New remote → S3 → Cloudflare → fill in credentials

# Sync uploads/ to R2
rclone sync ./uploads r2:family-archive --progress
```

After syncing, existing `local_path` values in the DB (e.g. `originals/uuid.jpg`)
match R2 keys exactly — no DB migration needed.

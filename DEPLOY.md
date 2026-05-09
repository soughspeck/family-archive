# Deployment Guide — Hetzner VPS + Cloudflare R2

This app needs a real server — it runs Node.js, writes to a SQLite database, processes uploads, and generates thumbnails. GitHub Pages and similar static hosts won't work. The setup below gives you a private URL, automatic HTTPS, and media stored in Cloudflare R2.

**Total time: ~1 hour on first deploy. Subsequent deploys: under 2 minutes.**

---

## What you'll end up with

- A URL like `https://archive.yourdomain.com` accessible from anywhere
- All photos/videos stored in Cloudflare R2 (cheap, reliable, globally fast)
- The server running on a €4/mo Hetzner VPS in Germany
- Automatic HTTPS via Caddy (no certificate management)
- Auto-restart on crash and on VPS reboot via PM2

---

## Prerequisites

- A domain name you control (e.g. `yourdomain.com`). If you don't have one, buy one at Namecheap or Cloudflare Registrar (~€10/yr).
- A Cloudflare account (free). Go to https://cloudflare.com and sign up.
- A Hetzner account (free). Go to https://hetzner.com/cloud and sign up.
- Your SSH public key (`~/.ssh/id_rsa.pub` or `~/.ssh/id_ed25519.pub`). If you don't have one, run: `ssh-keygen -t ed25519`

---

## Part 1 — Cloudflare R2 (media storage)

R2 is where all your photos and videos will actually live. It's S3-compatible, has no egress fees, and Cloudflare's free tier covers 10GB storage and 1M reads/month — more than enough for a family archive.

### Step 1: Add your domain to Cloudflare

Even if you're only using R2, adding your domain to Cloudflare lets you use their CDN for media delivery and manage DNS in one place.

1. Log in to https://dash.cloudflare.com
2. Click **"Add a site"** → enter your domain (e.g. `yourdomain.com`) → click **Add site**
3. Choose the **Free plan**
4. Cloudflare will scan your existing DNS records. Review them and click **Continue**
5. Cloudflare shows you **two nameservers** (e.g. `erin.ns.cloudflare.com`). Copy these.
6. Go to wherever you registered your domain (Namecheap, GoDaddy, etc.) and replace the nameservers with the two Cloudflare ones.
7. Click **"Done, check nameservers"** in Cloudflare. Propagation takes a few minutes to a few hours. You can continue with the next steps while you wait.

### Step 2: Create an R2 bucket

1. In the Cloudflare dashboard, click **R2** in the left sidebar (you may need to scroll down)
2. If prompted, set up billing — R2 requires a payment method even for the free tier
3. Click **"Create bucket"**
4. Name it `family-archive` (or anything you like — just keep it consistent)
5. Leave the region as **Automatic**
6. Click **"Create bucket"**

### Step 3: Enable public access on the bucket

Your app needs to serve media files directly to browsers. There are two options:

**Option A — Cloudflare subdomain (recommended):**
1. Inside your bucket, click the **Settings** tab
2. Scroll to **"R2.dev subdomain"** → click **"Allow Access"**
3. You'll get a URL like `https://pub-XXXX.r2.dev`. Copy this — it's your `MEDIA_BASE_URL`.

**Option B — Custom domain (cleaner URLs):**
1. Inside your bucket, click the **Settings** tab
2. Under **"Custom Domains"** → click **"Connect Domain"**
3. Enter something like `media.yourdomain.com`
4. Cloudflare automatically adds the DNS record. Your `MEDIA_BASE_URL` will be `https://media.yourdomain.com`.

### Step 4: Create an R2 API token

1. In the Cloudflare dashboard, click your profile icon (top right) → **"My Profile"**
2. Click **"API Tokens"** in the left sidebar
3. Click **"Create Token"**
4. Scroll down to **"Create Custom Token"** → click **"Get started"**
5. Give it a name like `family-archive-r2`
6. Under **Permissions**: choose **Account** → **Cloudflare R2** → **Edit**
7. Click **"Continue to summary"** → **"Create Token"**
8. **Copy the token immediately** — you won't see it again. Save it somewhere safe.

Also note your **Account ID**: visible in the R2 dashboard URL or the right sidebar when viewing R2. It looks like `a1b2c3d4e5f6...` (32 hex chars).

---

## Part 2 — Hetzner VPS (the server)

### Step 5: Create the VPS

1. Log in to https://console.hetzner.cloud
2. Click **"New project"** → name it `family-archive` → click **"Add server"**
3. **Location**: pick one close to you (Nuremberg, Falkenstein, or Helsinki for Europe)
4. **Image**: Ubuntu 24.04
5. **Type**: Shared CPU → **CX22** (2 vCPU, 4GB RAM, €3.79/mo). This is more than enough.
6. **SSH Keys**: click **"Add SSH Key"** → paste the contents of your `~/.ssh/id_ed25519.pub` (or `~/.ssh/id_rsa.pub`) → name it anything → click **"Add"**
7. Leave everything else as default
8. Click **"Create & Buy now"**
9. Wait ~30 seconds. The server IP will appear in the dashboard. **Copy the IP address.**

### Step 6: Point your subdomain to the VPS

1. Go to Cloudflare dashboard → your domain → **DNS**
2. Click **"Add record"**
3. Type: **A**, Name: `archive` (or whatever subdomain you want, e.g. `memories`), IPv4: paste your VPS IP, Proxy: **orange cloud ON** (proxied)
4. Click **Save**

Your app will be available at `https://archive.yourdomain.com` once everything is running.

---

## Part 3 — Server setup (one time only)

SSH into your new server. All commands below run **on the VPS**, not your Mac.

```bash
ssh root@YOUR_VPS_IP
```

### Step 7: Install Node.js 20

```bash
# Install nvm (Node version manager)
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.7/install.sh | bash

# Reload shell so nvm is available
source ~/.bashrc

# Install Node.js 20 and set it as default
nvm install 20
nvm use 20
nvm alias default 20

# Verify
node --version   # should print v20.x.x
npm --version
```

### Step 8: Install PM2 (process manager)

PM2 keeps the app running and restarts it automatically if it crashes or the server reboots.

```bash
npm install -g pm2

# Set up PM2 to start on boot — this prints a command, run it
pm2 startup

# Copy and run the printed command (looks like):
# sudo env PATH=$PATH:/root/.nvm/versions/node/v20.x.x/bin pm2 startup systemd -u root --hp /root
```

### Step 9: Install Caddy (reverse proxy + HTTPS)

Caddy automatically gets and renews HTTPS certificates via Let's Encrypt. Zero configuration needed.

```bash
sudo apt install -y debian-keyring debian-archive-keyring apt-transport-https curl

curl -1sLf 'https://dl.cloudflare.com/caddy/stable/gpg.key' \
  | sudo gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg

curl -1sLf 'https://dl.cloudflare.com/caddy/stable/debian.deb.txt' \
  | sudo tee /etc/apt/sources.list.d/caddy-stable.list

sudo apt update && sudo apt install -y caddy

# Verify
caddy version
```

### Step 10: Install ffmpeg (for video thumbnails)

```bash
sudo apt install -y ffmpeg

# Verify
ffmpeg -version
```

### Step 11: Clone the repo and configure

```bash
# Clone the repo
git clone https://github.com/soughspeck/family-archive.git
cd family-archive

# Copy the example env file
cp .env.example .env

# Open it for editing
nano .env
```

Fill in every value. Here's exactly what to put:

```env
NODE_ENV=production
PORT=3000
DB_PATH=/root/family-archive/family-archive.db
APP_NAME=Family Archive

# Your R2 public URL from Step 3 (Option A or B)
MEDIA_BASE_URL=https://pub-XXXX.r2.dev

# R2 endpoint — replace ACCOUNT_ID with your 32-char Cloudflare Account ID
R2_ENDPOINT=https://ACCOUNT_ID.r2.cloudflarestorage.com

# R2 bucket name from Step 2
R2_BUCKET=family-archive

# API token from Step 4
R2_ACCESS_KEY=your_token_id
R2_SECRET_KEY=your_token_secret

# Temp folder for uploads (only used for processing, not final storage)
UPLOADS_DIR=./uploads
```

Save and close: `Ctrl+O` → Enter → `Ctrl+X`

### Step 12: Build and start the app

```bash
# Install dependencies
npm ci

# Build TypeScript (server + client)
npm run build

# Create log directory
mkdir -p /var/log/family-archive

# Start the app with PM2
pm2 start ecosystem.config.js

# Save the PM2 process list so it survives reboots
pm2 save

# Check it's running
pm2 status
# You should see family-archive with status "online"

# Check logs for any startup errors
pm2 logs family-archive --lines 30
```

### Step 13: Configure Caddy

```bash
# Copy the Caddyfile from the repo
sudo cp /root/family-archive/Caddyfile /etc/caddy/Caddyfile

# Edit it — replace YOUR_DOMAIN with your actual subdomain
sudo nano /etc/caddy/Caddyfile
# Change: YOUR_DOMAIN → archive.yourdomain.com
# Save: Ctrl+O → Enter → Ctrl+X

# Reload Caddy
sudo systemctl reload caddy

# Verify Caddy is running
sudo systemctl status caddy
```

### Step 14: Verify it's working

```bash
# Check the health endpoint
curl https://archive.yourdomain.com/api/health
# Should return: {"ok":true,"app":"Family Archive",...}
```

If that works, open `https://archive.yourdomain.com` in your browser. You should see the app.

---

## Part 4 — Migrate your existing data (first deploy only)

If you've been using the app locally and have photos/videos already, migrate them now.

### Step 15: Upload your database

Run this **on your Mac**, not the VPS:

```bash
# From the family-archive directory on your Mac
scp family-archive.db root@YOUR_VPS_IP:/root/family-archive/
```

### Step 16: Migrate local media files to R2

Your existing files are in `uploads/originals/`, `uploads/thumbnails/`, and `uploads/display/`. They need to move to R2.

**On your Mac**, install rclone:

```bash
brew install rclone
```

Configure it with your R2 credentials:

```bash
rclone config
```

Follow the prompts:
1. `n` → New remote
2. Name: `r2`
3. Storage type: `5` (Amazon S3 Compliant)
4. Provider: `C` (Cloudflare)
5. Access key ID: your R2 token ID
6. Secret access key: your R2 token secret
7. Endpoint: `https://ACCOUNT_ID.r2.cloudflarestorage.com`
8. Leave everything else blank/default
9. `y` to confirm

Then sync your uploads folder to R2:

```bash
# From the family-archive directory on your Mac
rclone sync ./uploads r2:family-archive --progress
```

This copies `originals/`, `thumbnails/`, and `display/` into your R2 bucket. The keys in the database (e.g. `originals/uuid.jpg`) match the R2 object keys exactly, so no database changes needed.

---

## Subsequent deploys

Every time you push a code change and want to update the live site:

```bash
# SSH into the VPS
ssh root@YOUR_VPS_IP
cd family-archive

# Pull, build, and restart — one command
./deploy.sh
```

The deploy script does: `git pull` → `npm ci` → `tsc` → `pm2 reload` (zero-downtime restart).

---

## Troubleshooting

**App won't start:**
```bash
pm2 logs family-archive --lines 50
```
Look for the error. Common causes: wrong env vars in `.env`, missing `npm ci`, build not run.

**HTTPS not working / Caddy errors:**
```bash
sudo journalctl -u caddy --no-pager -n 50
```
Common causes: DNS not pointing to your VPS yet (wait up to 1 hour), or wrong domain in Caddyfile.

**Uploads failing in production:**
Check that all four R2 env vars are filled in correctly. Test the R2 connection:
```bash
curl -I https://pub-XXXX.r2.dev/originals/some-existing-file.jpg
# Should return 200, not 403
```

**Media not loading (images show as broken):**
The `MEDIA_BASE_URL` in `.env` must exactly match your R2 public URL. No trailing slash. Check: `grep MEDIA_BASE_URL .env`

**Database errors after deploy:**
New migrations run automatically on startup. If you see migration errors, check `pm2 logs` — it usually means a migration SQL has a syntax error.

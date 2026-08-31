# Deploying MarginGuard to a VPS

The frontend is a Next.js server, not a static bundle: `/api/market` renders on demand, so
a static host would deploy successfully and leave the chart permanently empty. Anything that
runs Node works.

Nothing here holds a secret. Trading keys are derived in the visitor's browser from a wallet
signature, so the server never sees a key and there is nothing on the box worth stealing
beyond the box itself.

## 1. Server

Ubuntu 22.04+ with Node 20 or newer (Next 16 requires it):

```bash
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt-get install -y nodejs nginx git
sudo adduser --system --group --home /srv/marginguard deploy
```

## 2. Build

```bash
sudo -u deploy git clone https://github.com/Stella112/marginguard.git /srv/marginguard
cd /srv/marginguard
sudo -u deploy npm ci
sudo -u deploy npm run build
```

`npm ci` needs the dev dependencies, so do not pass `--omit=dev`: the build itself needs
TypeScript and Tailwind.

## 3. Run it under systemd

```bash
sudo cp deploy/vps/marginguard.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now marginguard
systemctl status marginguard
```

`Restart=always` plus `enable` is what makes this survive a crash or a reboot. Skipping it
is the usual reason a VPS deployment is fine on the day and dead a week later.

## 4. Reverse proxy and TLS

```bash
sudo cp deploy/vps/nginx.conf /etc/nginx/sites-available/marginguard
sudo ln -s /etc/nginx/sites-available/marginguard /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx
```

Point DNS at the box first - an `A` record for `getmarginguard.xyz` (and `www`) to the
server's IPv4 - and wait for it to resolve. Then:

```bash
sudo apt-get install -y certbot python3-certbot-nginx
sudo certbot --nginx -d getmarginguard.xyz -d www.getmarginguard.xyz
```

Certbot adds the TLS block and the redirect, and installs a renewal timer.

**HTTPS is not cosmetic here.** Browser wallets do not inject into an insecure origin, so on
plain http the Connect button finds no wallet at all and the app looks broken.

## 5. Updating

```bash
cd /srv/marginguard
sudo -u deploy git pull
sudo -u deploy npm ci
sudo -u deploy npm run build
sudo systemctl restart marginguard
```

The site is down for a second or two during the restart. Vercel does this with zero downtime;
matching that on a VPS means running two instances behind the proxy and switching between
them, which is more machinery than a hackathon needs.

## What you are taking on

| | Vercel | This |
|---|---|---|
| TLS renewal | automatic | certbot timer, yours to monitor |
| Crash recovery | automatic | `Restart=always` (configured above) |
| Rollback | one click | `git checkout` + rebuild |
| CDN | global | single region |
| Cost | free tier | your VPS |

Worth it if you want the box anyway. On a deadline, Vercel is fewer moving parts.

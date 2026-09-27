# npa-nas-backend

Self-hosted database + Admin login backend for the [UPGB NPA Dashboard](https://npadashboard.alokmittal.net), designed to run on Alok's own Synology NAS.

Replaces two things the main app used to do via GitHub directly:
- **Database**: `data/latest.json` etc. used to be committed straight into the `NPA-DASHBOARD` repo. Now they live in a small SQLite database here instead, served over a simple HTTP API.
- **Admin login**: used to be GitHub OAuth (Device Flow), restricted to one hardcoded GitHub account. Now it's a real username/password, set up once, stored (hashed) in this same database.

**Nothing is retired from GitHub** — every publish also writes the same files to the `NPA-DASHBOARD` repo's `data/` folder as a read-only backup copy, so the app keeps working (viewing only, not publishing) even if the NAS itself is ever unreachable. See the big comment on `fetchDataFile()` in `NPA-DASHBOARD/js/app.js` for the full reasoning.

## What's already built and verified (in a cloud sandbox, not the real NAS)

- Every endpoint (admin setup/login/logout/me, data read, publish, history) tested directly with `curl` against a local run.
- A full Playwright browser test of the real app's login → publish → read cycle, plus a NAS-down drill confirming the app falls back to the GitHub copy with **zero visible disruption** — no error screen, data just quietly loads from the fallback tier.
- `docker build` verified to succeed and the resulting image verified to actually run and respond on `/health`.

## What you (Alok) need to do — M3: deploy the container

1. On your Synology, open **Package Center** and install **Container Manager** if you haven't already.
2. Copy this whole `backend/` folder onto the NAS (e.g. via File Station, or `git clone` this repo directly on the NAS if it has internet access and git installed).
3. Copy `.env.example` to `.env` and fill in a real `GITHUB_PAT` — a GitHub Personal Access Token scoped **only** to the `NPA-DASHBOARD` repo, with just "Contents: Read and write" permission (create a fine-grained PAT at github.com/settings/personal-access-tokens, as the `mittalok-creator` account). This is what lets the backend keep the GitHub backup copy in sync.
4. In Container Manager (or via SSH), run:
   ```
   cd backend
   docker compose up -d --build
   ```
5. One-time setup — create your real Admin username and password (replace `<nas-ip>` with the NAS's own LAN IP, and pick a real password, at least 8 characters):
   ```
   curl -X POST http://<nas-ip>:4100/api/admin/setup \
     -H "Content-Type: application/json" \
     -d '{"username":"YOUR_USERNAME","password":"YOUR_PASSWORD"}'
   ```
   This only works **once** — if it says `admin_already_configured`, you're already set up.
6. Confirm it's running: `curl http://<nas-ip>:4100/health` should return `{"ok":true,...}`.

**If you ever forget your password**: there's no email-reset (didn't seem worth building for one person) — instead, run this from the NAS/Container Manager's own terminal:
```
docker compose exec npa-nas-backend node scripts/reset-admin-password.js YOUR_NEW_PASSWORD
```

## What you need to do next — M4: make it reachable from the internet

The container above only listens on your NAS's own local network so far — branches can't reach it yet. Recommended: **Cloudflare Tunnel** (avoids opening any port on your router at all, and avoids needing your ISP to support that in the first place).

1. Create a free account at cloudflare.com.
2. Cloudflare needs your domain (`alokmittal.net`) pointed at it to manage a hostname for the tunnel — this means moving `alokmittal.net`'s nameservers from Squarespace to Cloudflare. **Before doing this**: log into Squarespace, write down (or screenshot) every existing DNS record for `alokmittal.net` — especially any email-related (MX) records — so nothing breaks when you switch. The two existing site records (`npadashboard` and `dashboard`, both pointing to GitHub Pages) will need to be recreated on Cloudflare's side too.
3. Once the domain is on Cloudflare: **Zero Trust → Networks → Tunnels → Create a tunnel**, name it (e.g. `npa-backend`), and follow its instructions to install `cloudflared` — easiest is adding it as a second service in this same `docker-compose.yml` (already there, commented out — just uncomment it and paste in the tunnel token Cloudflare gives you).
4. In the tunnel's **Public Hostname** settings, map `api.alokmittal.net` → `http://npa-nas-backend:4100` (the backend container's own internal address — no NAS IP or router port involved at all).
5. From your phone, on mobile data (not your home WiFi), open `https://api.alokmittal.net/health` — you should see `{"ok":true,...}`. That confirms it's genuinely reachable from outside your house.

## After M3 + M4 are both done

Tell Claude the real `https://api.alokmittal.net` (or whatever hostname you used) is live and reachable — the main app's `index.html` already has this exact URL wired in (`window.UPGB_NAS_API_BASE`), so once M3+M4 are confirmed working, the frontend changes (already built and tested, just not yet shipped to the live site) can be merged and deployed.

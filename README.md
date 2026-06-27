# COO Agent Server

An always-on relay that turns Claude into your operational second-in-command
across all your entities — **Maumee Street Taproom, Musgrove, Hosting-Openclaw,
Solutions Now, Greater Lenawee Chamber, and Body Products.**

Every conversation — from the dashboard, the Claude mobile app, or a curl
command in a parking lot — starts with the agent already knowing your business:
entities, costing rules, project status, plus live documents from Google Drive
and live sales data from Toast. You talk; it already has the context.

> This is the deployable codebase. It was rebuilt clean in this repo (the repo
> started empty), so reconcile it against the `coo-agent-server.tar.gz` artifact
> from the design chat if you have local edits there.

## What's in here

```
src/
  server.js                 always-on relay + health/refresh endpoints
  context/masterContext.js  your operating brain (entities, costing, projects)
  routes/chat.js            assembles context, calls Claude (streaming)
  routes/drive.js           reads your Drive docs into context
  routes/toast.js           pulls live Maumee sales/labor from Toast
  middleware/auth.js        bearer-token gate (locks the server to you)
  lib/cache.js              TTL cache so feeds aren't re-pulled every turn
deploy/nginx.conf.example   reverse-proxy config (SSE-ready) + TLS notes
.env.example                copy to .env and fill in
```

The agent is a *clone, not a generic assistant* because of
`src/context/masterContext.js`. Edit that file as the business changes and the
whole agent updates on the next request. It deliberately holds **no live
numbers and no staff names** — sales/prices/par-levels come from Toast/Drive at
runtime so they're never stale, and the team roster is left for you to fill in.

## Deploy (Hosting-Openclaw)

### 1. Get the code on the server

```bash
git clone <this repo> coo-agent-server
cd coo-agent-server
npm install
```

### 2. Configure

```bash
cp .env.example .env
# Generate your access token:
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

Fill in `.env`:

- `ACCESS_TOKEN` — the generated string. Every request sends it as a bearer.
- `ANTHROPIC_API_KEY` — your Anthropic key. (Model defaults to `claude-opus-4-8`.)
- **Toast** — `TOAST_CLIENT_ID`, `TOAST_CLIENT_SECRET`, `TOAST_RESTAURANT_GUID`
  from Toast's API portal. Leave blank to run without Toast.
- **Google Drive** — see the refresh-token walkthrough below. Leave blank to
  run without Drive.

> Plaid is intentionally **not** wired — it's on hold per your call.

### 3. Run it

```bash
npm start            # foreground, for a first smoke test
# then, for always-on, use pm2 or a systemd unit:
npx pm2 start src/server.js --name coo-agent
```

Verify: `curl http://127.0.0.1:8787/health` → shows which feeds are live.

### 4. Expose it

Point a subdomain at it with the reverse proxy in
`deploy/nginx.conf.example` (it's already configured for SSE streaming), then
run certbot for TLS. Now `https://coo.yourdomain.com` is reachable from any
device.

## The Google OAuth refresh token (~10 min)

The agent reads Drive with a long-lived refresh token so it never needs you to
re-auth.

1. In [Google Cloud Console](https://console.cloud.google.com/), create (or
   pick) a project and **enable the Google Drive API**.
2. **APIs & Services → Credentials → Create OAuth client ID → Desktop app.**
   Copy the **Client ID** and **Client secret** into `.env`.
3. Get a refresh token via the [OAuth Playground](https://developers.google.com/oauthplayground/):
   - Gear icon → **Use your own OAuth credentials** → paste client ID/secret.
   - Authorize scope `https://www.googleapis.com/auth/drive.readonly`.
   - **Exchange authorization code for tokens** → copy the **refresh token**
     into `GOOGLE_REFRESH_TOKEN`.
4. Put the Drive **folder IDs** the agent may read into
   `GOOGLE_DRIVE_FOLDER_IDS` (comma-separated). A folder ID is the last path
   segment of its URL: `drive.google.com/drive/folders/<THIS_PART>`.

### Adding more entities to Drive

Create one folder per entity, share the docs into it, add the folder ID to
`GOOGLE_DRIVE_FOLDER_IDS`, and hit `POST /refresh`. The agent reads new docs
immediately — no code change.

## Talking to the COO

This is where you communicate with the agent. Two endpoints, both authenticated
with `Authorization: Bearer <ACCESS_TOKEN>`:

**Streaming (SSE)** — `POST /chat`

```bash
curl -N https://coo.yourdomain.com/chat \
  -H "Authorization: Bearer $ACCESS_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"message": "What needs my attention at Maumee today?"}'
```

**Sync (one JSON response)** — `POST /chat/sync`

```bash
curl https://coo.yourdomain.com/chat/sync \
  -H "Authorization: Bearer $ACCESS_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"message": "Draft a vendor follow-up about the salmon price."}'
```

Both accept either `{"message": "..."}` or a full multi-turn
`{"messages": [{"role":"user","content":"..."}, ...]}`. Point the COO dashboard
at `/chat` and you get full Drive + Toast context on every message, from any
device — the same brain whether you're at your desk or on your phone.

**Other endpoints:** `GET /health` (unauthenticated uptime check) and
`POST /refresh` (force-refresh the Drive/Toast cache after dropping a new doc).

## Security notes

- The server is single-tenant — the bearer token is the only thing standing
  between the internet and your business data, so keep it long and secret, and
  always run behind TLS.
- `.env` is gitignored. Never commit real keys.
- Drive access is `readonly`. The agent reads your docs; it doesn't write them.

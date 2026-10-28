# mi-health-mcp

A tiny Cloudflare Worker that exposes Kapil's **steps and sleep** (Mi Band → Mi Fitness → Health Connect → Google Health app) to a Grok Bot agent (**Him**) as a **remote MCP server**.

```
Mi Band ─BLE─▶ Mi Fitness ─▶ Health Connect (phone) ─▶ Google Health cloud
                                                          │  Google Health API v4 (OAuth, read-only)
                                                          ▼
                    Cloudflare Worker  mi-health.kapil-lohani.workers.dev
                    ├─ /oauth/*   one-time Google consent, refresh token → KV
                    ├─ /mcp       Streamable HTTP MCP (bearer MCP_TOKEN)
                    └─ /debug/raw raw API responses (last 7 days)
                                                          ▼
                                             Grok Bot "Him" (MCP connector)
```

## Endpoints

| Path | Auth | Purpose |
|---|---|---|
| `GET /health` | none | Status: is the Google client configured, is a refresh token stored, granted scopes. No health data. |
| `GET /oauth/start?key=SETUP_KEY` | setup key | Redirects to Google consent (`access_type=offline`, `prompt=consent`). |
| `GET /oauth/callback` | OAuth `state` (KV, 10 min) | Exchanges the code and stores the refresh token in KV. |
| `GET /debug/raw?key=SETUP_KEY[&start=YYYY-MM-DD&end=YYYY-MM-DD]` | setup key or `Authorization: Bearer MCP_TOKEN` | Raw `steps:dailyRollUp` + `sleep:reconcile` responses for both `all-sources` and `google-sources`, last 7 days by default. Use this to confirm Mi Band data is arriving. |
| `POST /mcp` | `Authorization: Bearer MCP_TOKEN` | MCP JSON-RPC (Streamable HTTP, stateless, JSON responses). `GET` returns 405 (no SSE). |

### MCP tools

| Tool | Args | Returns |
|---|---|---|
| `get_steps` | `start_date`, `end_date` (YYYY-MM-DD, inclusive, ≤ 90 days) | per-day steps, total, average |
| `get_sleep` | `start_date`, `end_date` | sleep sessions grouped by wake-up date: start/end (IST), minutes asleep, stage minutes, source |
| `get_daily_summary` | `date` (optional, default today IST) | steps + sleep for that day |

## Google Health API calls used

* Steps: `POST https://health.googleapis.com/v4/users/me/dataTypes/steps/dataPoints:dailyRollUp` with a closed-open civil `range`, `windowSizeDays: 1`, `dataSourceFamily`.
  Scope `https://www.googleapis.com/auth/googlehealth.activity_and_fitness.readonly`.
* Sleep: `GET https://health.googleapis.com/v4/users/me/dataTypes/sleep/dataPoints:reconcile?filter=sleep.interval.civil_end_time >= "…" AND sleep.interval.civil_end_time < "…"&dataSourceFamily=…` (page size ≤ 25, paginated).
  Scope `https://www.googleapis.com/auth/googlehealth.sleep.readonly`.
* `dataSourceFamily` defaults to `users/me/dataSourceFamilies/all-sources` (var `DATA_SOURCE_FAMILY` in `wrangler.jsonc`). `google-sources` also includes Health Connect; switch if `all-sources` behaves oddly.

Docs: <https://developers.google.com/health>, [dailyRollUp](https://developers.google.com/health/reference/rest/v4/users.dataTypes.dataPoints/dailyRollUp), [reconcile](https://developers.google.com/health/reference/rest/v4/users.dataTypes.dataPoints/reconcile), [filters](https://developers.google.com/health/filters).

## Configuration

`wrangler.jsonc` vars: `PUBLIC_URL`, `USER_TIMEZONE` (Asia/Calcutta), `DATA_SOURCE_FAMILY`. KV binding `KV`.

Worker secrets:

| Secret | Notes |
|---|---|
| `MCP_TOKEN` | bearer token Him uses for `/mcp` |
| `SETUP_KEY` | protects `/oauth/start` and `/debug/raw` |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | Google Cloud OAuth client (type *Web application*) |

## Setup

1. **Google Cloud**: create a project, enable the **Google Health API**, configure the OAuth consent screen (External, add yourself as a test user, add the two scopes above), create an OAuth client of type *Web application* with authorized redirect URI
   `https://mi-health.kapil-lohani.workers.dev/oauth/callback`.
2. **Secrets**: `GOOGLE_CLIENT_ID=… GOOGLE_CLIENT_SECRET=… ./scripts/set-google-secrets.sh` (or `wrangler secret put …`).
3. **Consent**: open `https://mi-health.kapil-lohani.workers.dev/oauth/start?key=<SETUP_KEY>` and approve.
4. **Verify**: `/health` shows `refresh_token_present: true`; `/debug/raw?key=<SETUP_KEY>` shows step/sleep data points.
5. **Connect Him**: add a remote MCP server with URL `https://mi-health.kapil-lohani.workers.dev/mcp` and header `Authorization: Bearer <MCP_TOKEN>`.

> While the consent screen is in *Testing* mode, Google expires refresh tokens after 7 days. Set the consent screen to *In production* (for personal use you can click through the "unverified app" warning) or re-run step 3 when it lapses.

## Develop / deploy

```bash
npm install
npm run typecheck
npx wrangler deploy           # needs CLOUDFLARE_API_TOKEN
```

CI: `.github/workflows/deploy.yml` deploys on push to `main` using repo secret `CLOUDFLARE_API_TOKEN`.

### Quick MCP smoke test

```bash
curl -s https://mi-health.kapil-lohani.workers.dev/mcp \
  -H "authorization: Bearer $MCP_TOKEN" -H 'content-type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'
```


## Auto-deploy
Pushes to `main` deploy via `.github/workflows/deploy.yml` (repo secrets `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`).

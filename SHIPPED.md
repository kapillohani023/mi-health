# Shipped log

## 2026-10-29 — v0.1.0 — mi-health MCP bridge
- Cloudflare Worker `mi-health` deployed at https://mi-health.kapil-lohani.workers.dev (workers.dev route on).
- Endpoints: `/health`, `/oauth/start`, `/oauth/callback`, `/debug/raw`, `/mcp` (Streamable HTTP MCP, bearer auth).
- MCP tools: `get_steps`, `get_sleep`, `get_daily_summary` (Asia/Calcutta civil dates).
- KV namespace `MI_HEALTH_KV` for refresh/access tokens and OAuth state.
- Verified: `/health` 200; `/mcp` rejects missing token (401); `initialize`, `notifications/initialized` (202), `tools/list`, `tools/call` work with curl and the official MCP TypeScript SDK client.
- Pending: Google OAuth client secrets, one-time consent, confirm Mi Band data via `/debug/raw`, connect to Him.

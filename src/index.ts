import type { Env } from "./env";
import { handleMcp } from "./mcp";
import {
  addDays, buildAuthUrl, exchangeCode, getMeta, googleConfigured, hasRefreshToken,
  HealthError, redirectUri, sleepRaw, stepsRaw, todayIn,
} from "./google";

function timingSafeEqual(a: string, b: string) {
  if (!a || !b || a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}
function bearer(req: Request) {
  const h = req.headers.get("authorization") ?? "";
  return h.toLowerCase().startsWith("bearer ") ? h.slice(7).trim() : "";
}
function isMcpAuthed(req: Request, env: Env) { return timingSafeEqual(bearer(req), env.MCP_TOKEN ?? ""); }
function isSetupAuthed(url: URL, env: Env) { return timingSafeEqual(url.searchParams.get("key") ?? "", env.SETUP_KEY ?? ""); }

const html = (title: string, body: string, status = 200) =>
  new Response(`<!doctype html><meta charset=utf-8><meta name=viewport content="width=device-width"><title>${title}</title><body style="font-family:system-ui;max-width:40rem;margin:3rem auto;padding:0 1rem"><h2>${title}</h2>${body}</body>`, {
    status, headers: { "content-type": "text/html; charset=utf-8" },
  });

const CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET, POST, DELETE, OPTIONS",
  "access-control-allow-headers": "authorization, content-type, mcp-protocol-version, mcp-session-id",
  "access-control-expose-headers": "mcp-session-id",
};

async function route(req: Request, env: Env): Promise<Response> {
  const url = new URL(req.url);
  const path = url.pathname.replace(/\/+$/, "") || "/";

  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });

  if (path === "/" ) {
    return Response.json({ service: "mi-health", endpoints: ["/health", "/mcp", "/oauth/start?key=…", "/oauth/callback", "/debug/raw?key=…"] });
  }

  if (path === "/health") {
    const connected = await hasRefreshToken(env);
    const meta = connected ? await getMeta(env) : null;
    return Response.json({
      ok: true,
      google_client_configured: googleConfigured(env),
      refresh_token_present: connected,
      connected_at: meta?.connected_at ?? null,
      granted_scopes: meta?.scope ?? null,
      redirect_uri: redirectUri(env),
      timezone: env.USER_TIMEZONE,
      data_source_family: env.DATA_SOURCE_FAMILY,
    });
  }

  if (path === "/oauth/link" && req.method === "POST") {
    if (!isSetupAuthed(url, env)) return Response.json({ error: "unauthorized" }, { status: 401 });
    const id = crypto.randomUUID().replace(/-/g, "");
    await env.KV.put(`oauth_link:${id}`, "1", { expirationTtl: 1800 });
    return Response.json({ url: `${url.origin}/oauth/start?link=${id}`, expires_in: 1800 });
  }

  if (path === "/oauth/start") {
    const link = url.searchParams.get("link") ?? "";
    let linkOk = false;
    if (link && (await env.KV.get(`oauth_link:${link}`))) { await env.KV.delete(`oauth_link:${link}`); linkOk = true; }
    if (!linkOk && !isSetupAuthed(url, env)) return html("Forbidden", "<p>This sign-in link is invalid, expired or already used.</p>", 403);
    if (!googleConfigured(env)) return html("Not configured", "<p>GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET secrets are not set on the Worker yet.</p>", 503);
    const state = crypto.randomUUID();
    await env.KV.put(`oauth_state:${state}`, "1", { expirationTtl: 600 });
    return Response.redirect(buildAuthUrl(env, state), 302);
  }

  if (path === "/oauth/callback") {
    const error = url.searchParams.get("error");
    if (error) return html("Google sign-in failed", `<p>${error.replace(/[<>&"]/g, "")}</p>`, 400);
    const state = url.searchParams.get("state") ?? "";
    const code = url.searchParams.get("code") ?? "";
    if (!state || !(await env.KV.get(`oauth_state:${state}`))) return html("Invalid state", "<p>Start again from /oauth/start.</p>", 400);
    await env.KV.delete(`oauth_state:${state}`);
    if (!code) return html("Missing code", "", 400);
    try {
      const tok = await exchangeCode(env, code);
      return html("Connected ✅", `<p>Google Health is connected. Granted scopes:</p><pre style="white-space:pre-wrap">${String(tok.scope ?? "").replace(/[<>&]/g, "")}</pre><p>You can close this tab.</p>`);
    } catch (e: any) {
      return html("Token exchange failed", `<pre style="white-space:pre-wrap">${String(e.message).replace(/[<>&]/g, "")}\n${JSON.stringify(e.body ?? {}).replace(/[<>&]/g, "")}</pre>`, 400);
    }
  }

  if (path === "/debug/raw") {
    if (!isSetupAuthed(url, env) && !isMcpAuthed(req, env)) return Response.json({ error: "unauthorized" }, { status: 401 });
    const end = url.searchParams.get("end") ?? todayIn(env.USER_TIMEZONE);
    const start = url.searchParams.get("start") ?? addDays(end, -6);
    const families = ["users/me/dataSourceFamilies/all-sources", "users/me/dataSourceFamilies/google-sources"];
    const out: Record<string, unknown> = { start, end, timezone: env.USER_TIMEZONE };
    for (const fam of families) {
      const short = fam.split("/").pop()!;
      const [steps, sleep] = await Promise.allSettled([stepsRaw(env, start, end, fam), sleepRaw(env, start, end, fam)]);
      const fmt = (r: PromiseSettledResult<any>) => r.status === "fulfilled" ? r.value
        : { error: r.reason?.message, status: r.reason?.status, body: r.reason?.body };
      out[short] = { steps_dailyRollUp: fmt(steps), sleep_reconcile: fmt(sleep) };
    }
    return Response.json(out);
  }

  if (path === "/mcp") {
    if (!isMcpAuthed(req, env)) {
      return Response.json({ error: "unauthorized" }, { status: 401, headers: { ...CORS, "www-authenticate": 'Bearer realm="mi-health"' } });
    }
    const res = await handleMcp(req, env);
    const h = new Headers(res.headers);
    for (const [k, v] of Object.entries(CORS)) h.set(k, v);
    return new Response(res.body, { status: res.status, headers: h });
  }

  return Response.json({ error: "not found" }, { status: 404 });
}

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    try {
      return await route(req, env);
    } catch (e: any) {
      const status = e instanceof HealthError ? e.status : 500;
      return Response.json({ error: e?.message ?? "internal error", detail: e?.body }, { status });
    }
  },
} satisfies ExportedHandler<Env>;

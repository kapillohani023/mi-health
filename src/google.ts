import type { Env } from "./env";

export const SCOPES = [
  "https://www.googleapis.com/auth/googlehealth.activity_and_fitness.readonly",
  "https://www.googleapis.com/auth/googlehealth.sleep.readonly",
];
const AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const API = "https://health.googleapis.com/v4/users/me/dataTypes";

const KV_REFRESH = "google:refresh_token";
const KV_ACCESS = "google:access_token";
const KV_META = "google:meta";

export class HealthError extends Error {
  constructor(message: string, public status = 500, public body?: unknown) {
    super(message);
  }
}

export function redirectUri(env: Env) {
  return `${env.PUBLIC_URL}/oauth/callback`;
}

export function googleConfigured(env: Env) {
  return Boolean(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET);
}

export function buildAuthUrl(env: Env, state: string) {
  const p = new URLSearchParams({
    client_id: env.GOOGLE_CLIENT_ID!,
    redirect_uri: redirectUri(env),
    response_type: "code",
    scope: SCOPES.join(" "),
    access_type: "offline",
    prompt: "consent",
    include_granted_scopes: "true",
    state,
  });
  return `${AUTH_URL}?${p}`;
}

export async function exchangeCode(env: Env, code: string) {
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: env.GOOGLE_CLIENT_ID!,
      client_secret: env.GOOGLE_CLIENT_SECRET!,
      redirect_uri: redirectUri(env),
      grant_type: "authorization_code",
    }),
  });
  const data: any = await res.json();
  if (!res.ok) throw new HealthError(`Token exchange failed: ${data.error ?? res.status}`, 400, data);
  if (!data.refresh_token) {
    throw new HealthError("Google did not return a refresh token. Revoke the app at myaccount.google.com/permissions and retry /oauth/start.", 400);
  }
  await env.KV.put(KV_REFRESH, data.refresh_token);
  await env.KV.put(KV_ACCESS, data.access_token, { expirationTtl: Math.max(60, (data.expires_in ?? 3600) - 120) });
  await env.KV.put(KV_META, JSON.stringify({ connected_at: new Date().toISOString(), scope: data.scope }));
  return data;
}

export async function hasRefreshToken(env: Env) {
  return (await env.KV.get(KV_REFRESH)) !== null;
}

export async function getMeta(env: Env) {
  return (await env.KV.get(KV_META, "json")) as Record<string, unknown> | null;
}

async function getAccessToken(env: Env): Promise<string> {
  const cached = await env.KV.get(KV_ACCESS);
  if (cached) return cached;
  if (!googleConfigured(env)) throw new HealthError("Google OAuth client not configured on the Worker yet.", 503);
  const refresh = await env.KV.get(KV_REFRESH);
  if (!refresh) throw new HealthError("Google account not connected yet. Visit /oauth/start?key=<SETUP_KEY>.", 503);
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      refresh_token: refresh,
      client_id: env.GOOGLE_CLIENT_ID!,
      client_secret: env.GOOGLE_CLIENT_SECRET!,
      grant_type: "refresh_token",
    }),
  });
  const data: any = await res.json();
  if (!res.ok) throw new HealthError(`Token refresh failed: ${data.error ?? res.status}`, 502, data);
  await env.KV.put(KV_ACCESS, data.access_token, { expirationTtl: Math.max(60, (data.expires_in ?? 3600) - 120) });
  return data.access_token;
}

async function api(env: Env, path: string, init: RequestInit = {}): Promise<any> {
  const token = await getAccessToken(env);
  const res = await fetch(`${API}/${path}`, {
    ...init,
    headers: { authorization: `Bearer ${token}`, accept: "application/json", "content-type": "application/json", ...(init.headers ?? {}) },
  });
  const text = await res.text();
  let body: any;
  try { body = JSON.parse(text); } catch { body = text; }
  if (!res.ok) throw new HealthError(`Google Health API ${res.status}`, res.status, body);
  return body;
}

// ---------- date helpers (civil dates, YYYY-MM-DD) ----------
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
export function assertDate(d: string, name: string) {
  if (!DATE_RE.test(d) || isNaN(Date.parse(d + "T00:00:00Z"))) throw new HealthError(`${name} must be YYYY-MM-DD`, 400);
}
export function addDays(d: string, n: number) {
  const t = new Date(d + "T00:00:00Z");
  t.setUTCDate(t.getUTCDate() + n);
  return t.toISOString().slice(0, 10);
}
export function todayIn(tz: string) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
}
function civil(d: string) {
  const [year, month, day] = d.split("-").map(Number);
  return { date: { year, month, day }, time: { hours: 0, minutes: 0, seconds: 0, nanos: 0 } };
}
function civilToDate(c: any): string | null {
  const d = c?.date;
  if (!d) return null;
  return `${d.year}-${String(d.month).padStart(2, "0")}-${String(d.day).padStart(2, "0")}`;
}
function checkRange(start: string, end: string, maxDays = 90) {
  assertDate(start, "start_date");
  assertDate(end, "end_date");
  if (end < start) throw new HealthError("end_date must be on or after start_date", 400);
  const days = (Date.parse(end) - Date.parse(start)) / 86400000 + 1;
  if (days > maxDays) throw new HealthError(`Range too long (max ${maxDays} days)`, 400);
}

// ---------- steps ----------
export async function stepsRaw(env: Env, start: string, end: string, family = env.DATA_SOURCE_FAMILY) {
  return api(env, "steps/dataPoints:dailyRollUp", {
    method: "POST",
    body: JSON.stringify({
      range: { start: civil(start), end: civil(addDays(end, 1)) }, // closed-open
      windowSizeDays: 1,
      dataSourceFamily: family,
    }),
  });
}

export async function getSteps(env: Env, start: string, end: string) {
  checkRange(start, end);
  const raw = await stepsRaw(env, start, end);
  const byDate = new Map<string, number>();
  for (const p of raw.rollupDataPoints ?? []) {
    const d = civilToDate(p.civilStartTime);
    if (d) byDate.set(d, Number(p.steps?.countSum ?? 0));
  }
  const days: { date: string; steps: number }[] = [];
  for (let d = start; d <= end; d = addDays(d, 1)) days.push({ date: d, steps: byDate.get(d) ?? 0 });
  const total = days.reduce((s, x) => s + x.steps, 0);
  return { start_date: start, end_date: end, total_steps: total, average_steps: Math.round(total / days.length), days };
}

// ---------- sleep ----------
export async function sleepRaw(env: Env, start: string, end: string, family = env.DATA_SOURCE_FAMILY) {
  // Sessions are attributed to the civil date they END on (the "wake-up" date).
  const filter = `sleep.interval.civil_end_time >= "${start}T00:00:00" AND sleep.interval.civil_end_time < "${addDays(end, 1)}T00:00:00"`;
  const points: any[] = [];
  let pageToken = "";
  for (let i = 0; i < 20; i++) {
    const q = new URLSearchParams({ filter, dataSourceFamily: family, pageSize: "25" });
    if (pageToken) q.set("pageToken", pageToken);
    const r = await api(env, `sleep/dataPoints:reconcile?${q}`);
    points.push(...(r.dataPoints ?? []));
    pageToken = r.nextPageToken ?? "";
    if (!pageToken) break;
  }
  return { dataPoints: points };
}

function localDate(iso: string, offset: string | undefined, tz: string) {
  const t = new Date(iso);
  if (offset && /^-?\d+(\.\d+)?s$/.test(offset)) {
    return new Date(t.getTime() + parseFloat(offset) * 1000).toISOString().slice(0, 10);
  }
  return new Intl.DateTimeFormat("en-CA", { timeZone: tz }).format(t);
}
function localTime(iso: string, tz: string) {
  return new Intl.DateTimeFormat("en-GB", { timeZone: tz, hour: "2-digit", minute: "2-digit", hour12: false, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(iso));
}

export function summarizeSleep(dp: any, tz: string) {
  const s = dp.sleep ?? {};
  const iv = s.interval ?? {};
  const sum = s.summary ?? {};
  const stages: Record<string, number> = {};
  for (const st of sum.stagesSummary ?? []) stages[String(st.type).toLowerCase()] = Number(st.minutes ?? 0);
  if (!sum.stagesSummary && Array.isArray(s.stages)) {
    for (const st of s.stages) {
      const m = (Date.parse(st.endTime) - Date.parse(st.startTime)) / 60000;
      const k = String(st.type).toLowerCase();
      stages[k] = (stages[k] ?? 0) + Math.round(m);
    }
  }
  const inBed = iv.startTime && iv.endTime ? Math.round((Date.parse(iv.endTime) - Date.parse(iv.startTime)) / 60000) : null;
  const asleep = sum.minutesAsleep != null ? Number(sum.minutesAsleep)
    : inBed != null ? inBed - (stages["awake"] ?? 0) : null;
  return {
    date: iv.endTime ? localDate(iv.endTime, iv.endUtcOffset, tz) : null,
    start: iv.startTime ? localTime(iv.startTime, tz) : null,
    end: iv.endTime ? localTime(iv.endTime, tz) : null,
    minutes_in_bed: inBed,
    minutes_asleep: asleep,
    hours_asleep: asleep != null ? Math.round((asleep / 60) * 100) / 100 : null,
    minutes_awake: sum.minutesAwake != null ? Number(sum.minutesAwake) : stages["awake"] ?? null,
    stages_minutes: stages,
    type: s.type ?? null,
    main_sleep: s.metadata?.main ?? null,
    source: dp.dataSource?.device?.displayName ?? dp.dataSource?.application?.packageName ?? dp.dataSource?.platform ?? null,
  };
}

export async function getSleep(env: Env, start: string, end: string) {
  checkRange(start, end);
  const raw = await sleepRaw(env, start, end);
  const sessions = raw.dataPoints.map((d: any) => summarizeSleep(d, env.USER_TIMEZONE))
    .sort((a: any, b: any) => String(a.start).localeCompare(String(b.start)));
  const nights = new Map<string, number>();
  for (const s of sessions) if (s.date && s.minutes_asleep != null) nights.set(s.date, (nights.get(s.date) ?? 0) + s.minutes_asleep);
  const vals = [...nights.values()];
  return {
    start_date: start,
    end_date: end,
    timezone: env.USER_TIMEZONE,
    note: "Sessions are grouped by the date they ended (wake-up date). Times are in the user's timezone.",
    nights_with_data: vals.length,
    average_hours_asleep: vals.length ? Math.round((vals.reduce((a, b) => a + b, 0) / vals.length / 60) * 100) / 100 : null,
    sessions,
  };
}

export async function getDailySummary(env: Env, date: string) {
  assertDate(date, "date");
  const [steps, sleep] = await Promise.all([getSteps(env, date, date), getSleep(env, date, date)]);
  const asleep = sleep.sessions.reduce((a: number, s: any) => a + (s.minutes_asleep ?? 0), 0);
  return {
    date,
    timezone: env.USER_TIMEZONE,
    steps: steps.total_steps,
    sleep_hours: sleep.sessions.length ? Math.round((asleep / 60) * 100) / 100 : null,
    sleep_sessions: sleep.sessions,
  };
}

import type { Env } from "./env";
import { getDailySummary, getSleep, getSteps, HealthError, todayIn } from "./google";

const PROTOCOL_VERSIONS = ["2025-06-18", "2025-03-26", "2024-11-05"];
const SERVER_INFO = { name: "mi-health", version: "0.1.0" };

const dateProp = (desc: string) => ({ type: "string", pattern: "^\\d{4}-\\d{2}-\\d{2}$", description: desc });

export const TOOLS = [
  {
    name: "get_steps",
    description: "Daily step counts (Mi Band via Mi Fitness -> Health Connect -> Google Health) for an inclusive civil date range in the user's timezone (Asia/Calcutta). Max 90 days.",
    inputSchema: {
      type: "object",
      properties: { start_date: dateProp("First day, YYYY-MM-DD"), end_date: dateProp("Last day (inclusive), YYYY-MM-DD") },
      required: ["start_date", "end_date"],
    },
    annotations: { readOnlyHint: true },
  },
  {
    name: "get_sleep",
    description: "Sleep sessions (start/end, minutes asleep, stage minutes) for an inclusive date range. A session belongs to the date it ended (the wake-up date). Times are in Asia/Calcutta. Max 90 days.",
    inputSchema: {
      type: "object",
      properties: { start_date: dateProp("First wake-up date, YYYY-MM-DD"), end_date: dateProp("Last wake-up date (inclusive), YYYY-MM-DD") },
      required: ["start_date", "end_date"],
    },
    annotations: { readOnlyHint: true },
  },
  {
    name: "get_daily_summary",
    description: "Steps plus last night's sleep for one day. Defaults to today in Asia/Calcutta.",
    inputSchema: {
      type: "object",
      properties: { date: dateProp("Day, YYYY-MM-DD (defaults to today)") },
    },
    annotations: { readOnlyHint: true },
  },
];

type Rpc = { jsonrpc: "2.0"; id?: string | number | null; method: string; params?: any };

function ok(id: any, result: unknown) { return { jsonrpc: "2.0", id, result }; }
function err(id: any, code: number, message: string) { return { jsonrpc: "2.0", id: id ?? null, error: { code, message } }; }

async function callTool(env: Env, name: string, args: any) {
  args = args ?? {};
  switch (name) {
    case "get_steps": return getSteps(env, args.start_date, args.end_date);
    case "get_sleep": return getSleep(env, args.start_date, args.end_date);
    case "get_daily_summary": return getDailySummary(env, args.date || todayIn(env.USER_TIMEZONE));
    default: throw new HealthError(`Unknown tool: ${name}`, 404);
  }
}

async function handle(env: Env, msg: Rpc): Promise<object | null> {
  if (!msg || msg.jsonrpc !== "2.0" || typeof msg.method !== "string") return err((msg as any)?.id, -32600, "Invalid Request");
  const isNotification = msg.id === undefined;
  switch (msg.method) {
    case "initialize": {
      const requested = msg.params?.protocolVersion;
      return ok(msg.id, {
        protocolVersion: PROTOCOL_VERSIONS.includes(requested) ? requested : PROTOCOL_VERSIONS[0],
        capabilities: { tools: { listChanged: false } },
        serverInfo: SERVER_INFO,
        instructions: "Kapil's steps and sleep from his Mi Band (via Google Health). Dates are YYYY-MM-DD in Asia/Calcutta.",
      });
    }
    case "ping": return ok(msg.id, {});
    case "tools/list": return ok(msg.id, { tools: TOOLS });
    case "tools/call": {
      try {
        const result = await callTool(env, msg.params?.name, msg.params?.arguments);
        return ok(msg.id, { content: [{ type: "text", text: JSON.stringify(result, null, 2) }], structuredContent: result });
      } catch (e: any) {
        const detail = e instanceof HealthError && e.body ? `\n${JSON.stringify(e.body).slice(0, 1500)}` : "";
        return ok(msg.id, { isError: true, content: [{ type: "text", text: `Error: ${e.message}${detail}` }] });
      }
    }
    default:
      if (isNotification) return null; // notifications/initialized etc.
      return err(msg.id, -32601, `Method not found: ${msg.method}`);
  }
}

export async function handleMcp(req: Request, env: Env): Promise<Response> {
  if (req.method === "GET") return new Response("SSE stream not supported; use POST", { status: 405, headers: { allow: "POST" } });
  if (req.method === "DELETE") return new Response(null, { status: 204 });
  if (req.method !== "POST") return new Response("Method not allowed", { status: 405 });
  let body: any;
  try { body = await req.json(); } catch { return Response.json(err(null, -32700, "Parse error"), { status: 400 }); }
  const batch = Array.isArray(body);
  const msgs: Rpc[] = batch ? body : [body];
  const out = (await Promise.all(msgs.map((m) => handle(env, m)))).filter((x) => x !== null);
  if (out.length === 0) return new Response(null, { status: 202 });
  return Response.json(batch ? out : out[0]);
}

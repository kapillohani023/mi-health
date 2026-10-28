export interface Env {
  KV: KVNamespace;
  PUBLIC_URL: string;
  USER_TIMEZONE: string;
  DATA_SOURCE_FAMILY: string;
  MCP_TOKEN: string;
  SETUP_KEY: string;
  GOOGLE_CLIENT_ID?: string;
  GOOGLE_CLIENT_SECRET?: string;
}

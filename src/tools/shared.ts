import type { Db } from "../db/client";
import type { Env } from "../env";

/** Everything a tool handler needs, built once per request in server.ts. */
export interface ToolCtx {
  db: Db;
  env: Env;
  userId: string;
  tz: string;
}

// MCP tool annotations (hints the client shows / reasons about).
export const READ_ONLY = { readOnlyHint: true } as const;
export const WRITE = { readOnlyHint: false, destructiveHint: false } as const;
export const DESTRUCTIVE = { readOnlyHint: false, destructiveHint: true } as const;

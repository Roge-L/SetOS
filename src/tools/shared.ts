import { z } from "zod";
import type { Db } from "../db/client";
import type { Env } from "../env";

/** Everything a tool handler needs, built once per request in server.ts. */
export interface ToolCtx {
  db: Db;
  env: Env;
  userId: string;
  tz: string;
}

// MCP tool annotations. Reads are marked readOnly; anything that removes data is
// marked destructive so clients can surface it differently.
export const READ_ONLY = { readOnlyHint: true, destructiveHint: false } as const;
export const WRITE = { readOnlyHint: false, destructiveHint: false } as const;
export const DESTRUCTIVE = { readOnlyHint: false, destructiveHint: true } as const;

/** Shared field shapes — constrained by schema so the model can't guess wrong. */
export const dateField = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD.")
  .optional();

export const uuidField = z.string().uuid();

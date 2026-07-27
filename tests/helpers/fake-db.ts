/**
 * A stand-in for a supabase-js client that records what each query asked for.
 *
 * The real builder is a long chain (`.from().select().eq().maybeSingle()`) that
 * resolves to `{ data, error }`. This Proxy accepts any method, records the
 * filters that matter for tenancy, and hands back canned replies in order — so a
 * test can assert both "did this query scope itself to the caller" and "does the
 * service reject a row owned by someone else".
 */

import type { Db } from "../../src/db/client";

export interface RecordedCall {
  table: string;
  /** "select" unless a mutating method was chained. */
  op: string;
  /** Column/value pairs from eq/in/gte/lte, in the order applied. */
  filters: Array<[string, unknown]>;
  payload?: unknown;
}

export interface Reply {
  data?: unknown;
  error?: { message: string } | null;
}

const FILTER_METHODS = new Set(["eq", "in", "gte", "lte", "gt", "lt", "like", "ilike"]);
const MUTATIONS = new Set(["insert", "upsert", "update", "delete"]);

export function fakeDb(replies: Reply[] = []) {
  const calls: RecordedCall[] = [];
  const rpcs: Array<{ fn: string; args: unknown }> = [];
  let replyIndex = 0;

  function chainFor(call: RecordedCall): unknown {
    const chain: unknown = new Proxy(
      {},
      {
        get(_target, prop) {
          if (typeof prop !== "string") return undefined;

          // Awaiting the chain lands here; hand out the next canned reply.
          if (prop === "then") {
            const reply = replies[replyIndex++] ?? {};
            return (onOk: (v: unknown) => unknown, onErr?: (e: unknown) => unknown) =>
              Promise.resolve({ data: reply.data ?? null, error: reply.error ?? null }).then(onOk, onErr);
          }

          return (...args: unknown[]) => {
            if (FILTER_METHODS.has(prop)) {
              call.filters.push([args[0] as string, args[1]]);
            } else if (MUTATIONS.has(prop)) {
              call.op = prop;
              if (args.length) call.payload = args[0];
            }
            return chain;
          };
        },
      }
    );
    return chain;
  }

  const db = {
    from(table: string) {
      const call: RecordedCall = { table, op: "select", filters: [] };
      calls.push(call);
      return chainFor(call);
    },
    async rpc(fn: string, args: unknown) {
      rpcs.push({ fn, args });
      return { data: null, error: null };
    },
  };

  return { db: db as unknown as Db, calls, rpcs };
}

/** True if a recorded call constrained itself to `userId`. */
export function isScopedTo(call: RecordedCall, userId: string): boolean {
  return call.filters.some(([col, val]) => col === "user_id" && val === userId);
}

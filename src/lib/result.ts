/**
 * Helpers for shaping MCP tool return values. Tool handlers must return
 * `{ content: [...] }`; these keep every tool consistent.
 *
 * Payloads are compact JSON — models parse it fine, and pretty-printing every
 * multi-row list would spend context on pure whitespace.
 */

type TextContent = { content: Array<{ type: "text"; text: string }> };

export function jsonResult(payload: unknown): TextContent {
  return { content: [{ type: "text", text: JSON.stringify(payload) }] };
}

export function textResult(text: string): TextContent {
  return { content: [{ type: "text", text }] };
}

/** Uniform error result the model can act on (fix input, retry, etc.). */
export function errorResult(err: unknown): TextContent & { isError: true } {
  const message = err instanceof Error ? err.message : String(err);
  return { content: [{ type: "text", text: `Error: ${message}` }], isError: true };
}

/**
 * Wrap a tool handler so any thrown error becomes a clean `isError` result
 * instead of crashing the MCP request. Keeps every tool's try/catch out of sight.
 */
export function run<A extends unknown[], R>(
  fn: (...args: A) => Promise<R>
): (...args: A) => Promise<R | (TextContent & { isError: true })> {
  return async (...args: A) => {
    try {
      return await fn(...args);
    } catch (err) {
      return errorResult(err);
    }
  };
}

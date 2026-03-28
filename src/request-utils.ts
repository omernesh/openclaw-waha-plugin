// HTTP request body utilities. Phase 58 — replaces openclaw/plugin-sdk/webhook-ingress.
//
// Source: reverse-engineered from monitor.ts usage (lines 291-296, 552) and
// RESEARCH.md code example. Provides bounded stream read with configurable
// size limit and optional timeout.

import type { IncomingMessage } from "node:http";

// ---------------------------------------------------------------------------
// RequestBodyLimitError
// ---------------------------------------------------------------------------
export class RequestBodyLimitError extends Error {
  constructor(public readonly type: "size" | "timeout") {
    super(type === "size" ? "Request body too large" : "Request body read timeout");
    this.name = "RequestBodyLimitError";
  }
}

// ---------------------------------------------------------------------------
// isRequestBodyLimitError
// ---------------------------------------------------------------------------
export function isRequestBodyLimitError(err: unknown): err is RequestBodyLimitError {
  return err instanceof RequestBodyLimitError;
}

// ---------------------------------------------------------------------------
// requestBodyErrorToText
// ---------------------------------------------------------------------------
export function requestBodyErrorToText(err: unknown): string {
  if (isRequestBodyLimitError(err)) return err.message;
  return "";
}

// ---------------------------------------------------------------------------
// readRequestBodyWithLimit
// Reads the HTTP request body, enforcing a byte limit and optional timeout.
// Throws RequestBodyLimitError("size") if body exceeds maxBytes.
// Throws RequestBodyLimitError("timeout") if read takes longer than timeoutMs.
// ---------------------------------------------------------------------------
export function readRequestBodyWithLimit(
  req: IncomingMessage,
  maxBytesOrOptions: number | { maxBytes: number; timeoutMs?: number },
  timeoutMsArg?: number,
): Promise<string> {
  const { maxBytes, timeoutMs } =
    typeof maxBytesOrOptions === "number"
      ? { maxBytes: maxBytesOrOptions, timeoutMs: timeoutMsArg }
      : maxBytesOrOptions;

  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let total = 0;
    let settled = false;

    const timer = timeoutMs
      ? setTimeout(() => {
          if (settled) return;
          settled = true;
          reject(new RequestBodyLimitError("timeout"));
        }, timeoutMs)
      : null;

    req.on("data", (chunk: Buffer) => {
      if (settled) return;
      total += chunk.length;
      if (total > maxBytes) {
        settled = true;
        if (timer) clearTimeout(timer);
        reject(new RequestBodyLimitError("size"));
      } else {
        chunks.push(chunk);
      }
    });

    req.on("end", () => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      resolve(Buffer.concat(chunks).toString("utf-8"));
    });

    req.on("error", (err) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      reject(err);
    });
  });
}

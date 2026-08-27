export interface ParsedInput {
  method: string;
  path: string;
  query: Record<string, string>;
  body: unknown;
  raw: string;
}

function splitHead(raw: string): { head: string; body: string } | null {
  const idx = raw.indexOf("\r\n\r\n") >= 0 ? raw.indexOf("\r\n\r\n") : raw.indexOf("\n\n");
  if (idx < 0) return null;
  const sepLen = raw.startsWith("\r\n", idx) || raw.slice(idx, idx + 4) === "\r\n\r\n" ? 4 : 2;
  return { head: raw.slice(0, idx), body: raw.slice(idx + sepLen) };
}

/**
 * Accepts either a full HTTP request (external route call), a full HTTP response
 * (this workflow's own route step piped downstream), or bare JSON (linked step).
 */
export function parseInput(raw: string): ParsedInput {
  const text = raw ?? "";
  const trimmed = text.trim();
  const empty: ParsedInput = { method: "GET", path: "/", query: {}, body: null, raw: text };
  if (!trimmed) return empty;

  const requestLine = /^([A-Z]+) (\S+) HTTP\/\d(?:\.\d)?/.exec(trimmed);
  const statusLine = /^HTTP\/\d(?:\.\d)? \d{3}/.test(trimmed);

  if (requestLine || statusLine) {
    const parts = splitHead(text) ?? { head: text, body: "" };
    let method = "GET";
    let path = "/";
    const query: Record<string, string> = {};
    if (requestLine) {
      method = requestLine[1];
      const target = requestLine[2];
      const qIdx = target.indexOf("?");
      path = qIdx >= 0 ? target.slice(0, qIdx) : target;
      if (qIdx >= 0) {
        for (const [k, v] of new URLSearchParams(target.slice(qIdx + 1))) query[k] = v;
      }
    }
    return { method, path, query, body: safeJson(parts.body), raw: text };
  }

  return { ...empty, method: "POST", body: safeJson(text) };
}

export function safeJson(text: string): unknown {
  const trimmed = (text ?? "").trim();
  if (!trimmed) return null;
  try {
    return JSON.parse(trimmed);
  } catch {
    return null;
  }
}

export function respond(status: number, payload: unknown, extraHeaders: Record<string, string> = {}): void {
  const body = JSON.stringify(payload);
  const reason =
    {
      200: "OK",
      201: "Created",
      202: "Accepted",
      400: "Bad Request",
      404: "Not Found",
      409: "Conflict",
      500: "Internal Server Error",
    }[status] ?? "OK";
  const headers: Record<string, string> = {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": String(Buffer.byteLength(body)),
    "Cache-Control": "no-store",
    ...extraHeaders,
  };
  const head = Object.entries(headers)
    .map(([k, v]) => `${k}: ${v}`)
    .join("\r\n");
  process.stdout.write(`HTTP/1.1 ${status} ${reason}\r\n${head}\r\n\r\n${body}`);
}

export function branchPrefix(): string {
  const branch = process.env._3B_BRANCH_ID;
  return branch ? `/__3b/branch/${branch}` : "";
}

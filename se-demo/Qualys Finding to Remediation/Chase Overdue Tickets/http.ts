export type Req = {
  method: string;
  path: string;
  query: URLSearchParams;
  headers: Record<string, string>;
  body: string;
};

const REQUEST_LINE = /^(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)\s+(\S+)\s+HTTP\/\d/;

export function isHttpRequest(raw: string): boolean {
  return REQUEST_LINE.test(raw.slice(0, raw.indexOf("\n") + 1 || raw.length));
}

export function parseRequest(raw: string): Req {
  const split = raw.indexOf("\r\n\r\n");
  const head = split === -1 ? raw : raw.slice(0, split);
  const body = split === -1 ? "" : raw.slice(split + 4);
  const lines = head.split(/\r?\n/);
  const match = REQUEST_LINE.exec(lines[0] ?? "");
  if (!match) throw new Error("stdin is not an HTTP request");
  const headers: Record<string, string> = {};
  for (const line of lines.slice(1)) {
    const idx = line.indexOf(":");
    if (idx > 0) headers[line.slice(0, idx).trim().toLowerCase()] = line.slice(idx + 1).trim();
  }
  const url = new URL(match[2]!, "http://local");
  return { method: match[1]!, path: url.pathname, query: url.searchParams, headers, body };
}

const REASON: Record<number, string> = {
  200: "OK",
  201: "Created",
  400: "Bad Request",
  404: "Not Found",
  405: "Method Not Allowed",
  500: "Internal Server Error",
};

export function respond(status: number, payload: unknown, contentType = "application/json"): void {
  const body = typeof payload === "string" ? payload : JSON.stringify(payload);
  const bytes = new TextEncoder().encode(body).length;
  process.stdout.write(
    `HTTP/1.1 ${status} ${REASON[status] ?? "OK"}\r\n` +
      `Content-Type: ${contentType}\r\n` +
      `Content-Length: ${bytes}\r\n` +
      `Cache-Control: no-store\r\n\r\n` +
      body,
  );
}

export function jsonBody(req: Req): Record<string, unknown> {
  if (!req.body.trim()) return {};
  try {
    const parsed = JSON.parse(req.body);
    return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : {};
  } catch {
    throw new Error("request body is not valid JSON");
  }
}

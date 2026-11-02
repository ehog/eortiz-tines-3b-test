export type ParsedRequest = {
  method: string;
  path: string;
  query: URLSearchParams;
  headers: Record<string, string>;
  body: string;
};

export function parseRequest(raw: string): ParsedRequest | null {
  const trimmed = raw.replace(/^\s+/, "");
  const match = /^([A-Z]+) (\S+) HTTP\/\d\.\d\r?\n/.exec(trimmed);
  if (!match) return null;

  const separator = trimmed.includes("\r\n\r\n") ? "\r\n\r\n" : "\n\n";
  const headEnd = trimmed.indexOf(separator);
  const head = headEnd === -1 ? trimmed : trimmed.slice(0, headEnd);
  const body = headEnd === -1 ? "" : trimmed.slice(headEnd + separator.length);

  const headers: Record<string, string> = {};
  for (const line of head.split(/\r?\n/).slice(1)) {
    const colon = line.indexOf(":");
    if (colon > 0) {
      headers[line.slice(0, colon).trim().toLowerCase()] = line
        .slice(colon + 1)
        .trim();
    }
  }

  const url = new URL(match[2], "http://internal");
  return {
    method: match[1],
    path: url.pathname,
    query: url.searchParams,
    headers,
    body,
  };
}

export function json(status: number, payload: unknown): string {
  const body = JSON.stringify(payload, null, 2);
  const bytes = Buffer.byteLength(body);
  return [
    `HTTP/1.1 ${status} ${statusText(status)}`,
    "Content-Type: application/json; charset=utf-8",
    `Content-Length: ${bytes}`,
    "Cache-Control: no-store",
    "",
    body,
  ].join("\r\n");
}

function statusText(status: number): string {
  const map: Record<number, string> = {
    200: "OK",
    201: "Created",
    400: "Bad Request",
    404: "Not Found",
    405: "Method Not Allowed",
    409: "Conflict",
  };
  return map[status] ?? "OK";
}

export function parseBody(body: string): Record<string, unknown> {
  if (!body.trim()) return {};
  try {
    return JSON.parse(body) as Record<string, unknown>;
  } catch {
    return Object.fromEntries(new URLSearchParams(body));
  }
}

export function requester(req: ParsedRequest, fallback: string): string {
  return req.headers["x-3b-authenticated-email"] || fallback;
}

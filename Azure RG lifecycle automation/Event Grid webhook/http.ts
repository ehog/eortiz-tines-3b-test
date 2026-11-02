export interface HttpMessage {
  startLine: string;
  headers: Record<string, string>;
  body: string;
}

export function parseHttp(raw: string): HttpMessage {
  let sep = raw.indexOf("\r\n\r\n");
  let sepLen = 4;
  if (sep < 0) {
    sep = raw.indexOf("\n\n");
    sepLen = 2;
  }
  const head = sep < 0 ? raw : raw.slice(0, sep);
  const body = sep < 0 ? "" : raw.slice(sep + sepLen);
  const [startLine, ...lines] = head.split(/\r?\n/);
  const headers: Record<string, string> = {};
  for (const line of lines) {
    const i = line.indexOf(":");
    if (i > 0) {
      headers[line.slice(0, i).trim().toLowerCase()] = line.slice(i + 1).trim();
    }
  }
  return { startLine, headers, body };
}

export function requestLine(msg: HttpMessage) {
  const [method, target] = msg.startLine.split(" ");
  const url = new URL(target ?? "/", "http://local");
  return { method: method.toUpperCase(), path: url.pathname, query: url.searchParams };
}

const REASONS: Record<number, string> = {
  200: "OK",
  202: "Accepted",
  303: "See Other",
  400: "Bad Request",
  401: "Unauthorized",
  404: "Not Found",
  405: "Method Not Allowed",
  409: "Conflict",
};

export function httpResponse(
  status: number,
  body: string,
  headers: Record<string, string> = {},
) {
  const all = {
    "Content-Type": "application/json",
    "Content-Length": String(Buffer.byteLength(body)),
    ...headers,
  };
  const lines = Object.entries(all).map(([k, v]) => `${k}: ${v}`);
  const reason = REASONS[status] ?? "OK";
  return `HTTP/1.1 ${status} ${reason}\r\n${lines.join("\r\n")}\r\n\r\n${body}`;
}

export function jsonFromStdin(raw: string): any {
  const text = raw.trim();
  if (!text) return null;
  if (text.startsWith("HTTP/")) {
    const body = parseHttp(text).body.trim();
    return body ? JSON.parse(body) : null;
  }
  return JSON.parse(text);
}

export function escapeHtml(value: unknown) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export const ROOT = "/storage/investigations";

export type Disposition = "benign" | "needs_review" | "likely_true_positive";

export interface Incident {
  investigationId: string;
  source: "sentinel" | "defender";
  vendorId: string;
  correlationId: string;
  title: string;
  description: string;
  severity: string;
  status: string;
  alertTime: string;
  receivedAt: string;
  vendorEntities: Record<string, unknown>[];
  raw: unknown;
}

export interface Entities {
  investigationId: string;
  users: string[];
  devices: string[];
  internalIps: string[];
  externalIps: string[];
  urls: string[];
  domains: string[];
  hashes: string[];
  processes: string[];
}

export interface TimelineEvent {
  id: string;
  ts: string;
  source: string;
  title: string;
  detail: string;
  entity: string;
  severity: string;
}

export interface LogRecord {
  ts: string;
  investigationId: string;
  step: string;
  event: string;
  target: string;
  outcome: string;
  durationMs: number;
}

export interface SourceResult {
  investigationId: string;
  source: string;
  label: string;
  status: "ok" | "error";
  mocked: boolean;
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  recordCount: number;
  data: Record<string, unknown>;
  events: TimelineEvent[];
  logs: LogRecord[];
}

export const SOURCES = ["defender", "sentinel", "zscaler", "proofpoint", "threatintel"] as const;

export function dir(investigationId: string): string {
  return `${ROOT}/${sanitizeId(investigationId)}`;
}

export function sanitizeId(id: unknown): string {
  const s = String(id ?? "").trim();
  if (!/^[A-Za-z0-9._-]{4,80}$/.test(s)) throw new Error(`invalid investigation id: ${s}`);
  return s;
}

export function newInvestigationId(): string {
  const now = new Date();
  const stamp = now.toISOString().replace(/[-:TZ.]/g, "").slice(0, 14);
  return `inv-${stamp}-${crypto.randomUUID().slice(0, 8)}`;
}

export async function readJson<T>(path: string): Promise<T | null> {
  const file = Bun.file(path);
  if (!(await file.exists())) return null;
  const text = await file.text();
  if (!text.trim()) return null;
  return JSON.parse(text) as T;
}

export async function writeJson(path: string, value: unknown): Promise<void> {
  await Bun.write(path, `${JSON.stringify(value, null, 2)}\n`);
}

export function logger(investigationId: string, step: string) {
  const sink: LogRecord[] = [];
  return {
    records: sink,
    log(event: string, target: string, outcome: string, durationMs = 0) {
      const record: LogRecord = {
        ts: new Date().toISOString(),
        investigationId,
        step,
        event,
        target,
        outcome,
        durationMs,
      };
      sink.push(record);
      process.stderr.write(`${JSON.stringify(record)}\n`);
    },
  };
}

/**
 * A step reached through a route receives a full HTTP request on stdin, a step linked from a
 * route step receives that step's HTTP response, and a plain linked step receives raw JSON,
 * so all three shapes are parsed here.
 */
export async function readInput(): Promise<{ json: unknown; query: URLSearchParams; method: string }> {
  const raw = await Bun.stdin.text();
  const trimmed = raw.trimStart();
  if (/^HTTP\/\d/.test(trimmed)) {
    const separator = trimmed.indexOf("\r\n\r\n");
    const body = separator < 0 ? "" : trimmed.slice(separator + 4);
    return {
      json: body.trim() ? JSON.parse(body) : null,
      query: new URLSearchParams(),
      method: "LINK",
    };
  }
  if (/^(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS) \S+ HTTP\/\d/.test(trimmed)) {
    const request = parseHttpRequest(trimmed);
    return {
      json: request.body.trim() ? JSON.parse(request.body) : null,
      query: request.query,
      method: request.method,
    };
  }
  return {
    json: trimmed ? JSON.parse(trimmed) : null,
    query: new URLSearchParams(),
    method: "LINK",
  };
}

export interface ParsedRequest {
  method: string;
  path: string;
  query: URLSearchParams;
  headers: Record<string, string>;
  body: string;
}

export function parseHttpRequest(raw: string): ParsedRequest {
  const separator = raw.indexOf("\r\n\r\n");
  const head = separator < 0 ? raw : raw.slice(0, separator);
  const body = separator < 0 ? "" : raw.slice(separator + 4);
  const [requestLine, ...headerLines] = head.split("\r\n");
  const [method, target] = requestLine.split(" ");
  const url = new URL(target ?? "/", "http://workflow.local");
  const headers: Record<string, string> = {};
  for (const line of headerLines) {
    const idx = line.indexOf(":");
    if (idx > 0) headers[line.slice(0, idx).toLowerCase().trim()] = line.slice(idx + 1).trim();
  }
  return { method: method ?? "GET", path: url.pathname, query: url.searchParams, headers, body };
}

export async function readHttpRequest(): Promise<ParsedRequest> {
  return parseHttpRequest(await Bun.stdin.text());
}

export async function respond(
  status: number,
  body: string | Uint8Array,
  contentType = "application/json; charset=utf-8",
  extraHeaders: Record<string, string> = {},
): Promise<void> {
  const bytes = typeof body === "string" ? new TextEncoder().encode(body) : body;
  const reasons: Record<number, string> = {
    200: "OK",
    202: "Accepted",
    400: "Bad Request",
    403: "Forbidden",
    404: "Not Found",
    405: "Method Not Allowed",
    409: "Conflict",
    500: "Internal Server Error",
  };
  const headerLines = [
    `HTTP/1.1 ${status} ${reasons[status] ?? "OK"}`,
    `Content-Type: ${contentType}`,
    `Content-Length: ${bytes.byteLength}`,
    "Cache-Control: no-store",
    ...Object.entries(extraHeaders).map(([k, v]) => `${k}: ${v}`),
  ];
  await Bun.write(Bun.stdout, new TextEncoder().encode(`${headerLines.join("\r\n")}\r\n\r\n`));
  await Bun.write(Bun.stdout, bytes);
}

export async function respondJson(status: number, value: unknown): Promise<void> {
  await respond(status, JSON.stringify(value));
}

export function shiftIso(baseIso: string, minutes: number): string {
  return new Date(new Date(baseIso).getTime() + minutes * 60_000).toISOString();
}

/**
 * Approval tokens are derived, not stored, so the isolate route can verify a token the
 * investigation API issued without shared mutable state.
 */
export async function approvalToken(investigationId: string, device: string): Promise<string> {
  const material = `soc-alert-investigation-canvas:${investigationId}:${device.toLowerCase()}`;
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(material));
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("")
    .slice(0, 32);
}

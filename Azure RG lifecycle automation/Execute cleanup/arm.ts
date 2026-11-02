import { type Config, lockGranule } from "./config";
import { log } from "./log";
import { SimArm, SimDirectory } from "./sim";

export const API = {
  resources: "2021-04-01",
  network: "2023-09-01",
  compute: "2023-04-02",
};

export type DeleteResult = "deleted" | "not_found" | "pending";

export interface Arm {
  get(path: string, apiVersion: string): Promise<any | null>;
  list(path: string, apiVersion: string): Promise<any[]>;
  put(path: string, apiVersion: string, body: unknown, deadline?: number): Promise<any>;
  delete(path: string, apiVersion: string, deadline?: number): Promise<DeleteResult>;
}

export interface Directory {
  resolveUser(id: string): Promise<{ found: boolean; id?: string; name?: string }>;
}

export class ArmError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
  ) {
    super(message);
    this.name = "ArmError";
  }
}

export class LroTimeout extends Error {
  name = "LroTimeout";
}

const ARM_BASE = "https://management.azure.com";
const GRAPH_BASE = "https://graph.microsoft.com/v1.0";
const MAX_RETRIES = 6;
const DEFAULT_LRO_MS = 5 * 60_000;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function withVersion(path: string, apiVersion: string) {
  const sep = path.includes("?") ? "&" : "?";
  return `${ARM_BASE}${path}${sep}api-version=${apiVersion}`;
}

function retryDelay(res: Response | null, attempt: number) {
  const header = res?.headers.get("retry-after");
  const seconds = header ? Number(header) : NaN;
  if (Number.isFinite(seconds)) return Math.min(seconds * 1000, 60_000);
  const backoff = Math.min(1000 * 2 ** attempt, 30_000);
  return backoff + Math.floor(Math.random() * 500);
}

export async function sendWithRetry(
  method: string,
  url: string,
  body?: unknown,
): Promise<Response> {
  const host = new URL(url).host;
  const path = new URL(url).pathname;
  for (let attempt = 0; ; attempt++) {
    const started = Date.now();
    let res: Response | null = null;
    try {
      res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
    } catch (err) {
      if (attempt >= MAX_RETRIES) throw err;
      log("warn", "http_network_error", "Network error; retrying.", {
        host, path, method, attempt, error: (err as Error).message,
      });
      await sleep(retryDelay(null, attempt));
      continue;
    }
    const duration_ms = Date.now() - started;
    log("info", "http_call", `${method} ${host}`, {
      host, path, method, status: res.status, duration_ms, attempt,
    });
    const retryable = res.status === 429 || res.status >= 500;
    if (!retryable || attempt >= MAX_RETRIES) return res;
    const delay = retryDelay(res, attempt);
    log("warn", "http_retry", "Retryable status; backing off.", {
      host, path, status: res.status, attempt, delay_ms: delay,
    });
    await sleep(delay);
  }
}

async function toError(res: Response) {
  const text = await res.text();
  let code = `HTTP${res.status}`;
  let message = text.slice(0, 300);
  try {
    const j = JSON.parse(text);
    code = j.error?.code ?? code;
    message = j.error?.message ?? message;
  } catch {}
  return new ArmError(res.status, code, message);
}

class RealArm implements Arm {
  async get(path: string, apiVersion: string) {
    const res = await sendWithRetry("GET", withVersion(path, apiVersion));
    if (res.status === 404) return null;
    if (!res.ok) throw await toError(res);
    return res.json();
  }

  async list(path: string, apiVersion: string) {
    const items: any[] = [];
    let url: string | null = withVersion(path, apiVersion);
    while (url) {
      const res = await sendWithRetry("GET", url);
      if (res.status === 404) return items;
      if (!res.ok) throw await toError(res);
      const page: any = await res.json();
      items.push(...(page.value ?? []));
      url = page.nextLink ?? null;
    }
    return items;
  }

  async put(path: string, apiVersion: string, body: unknown, deadline?: number) {
    const res = await sendWithRetry("PUT", withVersion(path, apiVersion), body);
    if (!res.ok) throw await toError(res);
    await this.waitForLro(res, deadline ?? Date.now() + DEFAULT_LRO_MS);
    return this.get(path, apiVersion);
  }

  async delete(path: string, apiVersion: string, deadline?: number) {
    const res = await sendWithRetry("DELETE", withVersion(path, apiVersion));
    if (res.status === 404 || res.status === 204) return "not_found";
    if (!res.ok) throw await toError(res);
    try {
      await this.waitForLro(res, deadline ?? Date.now() + DEFAULT_LRO_MS);
    } catch (err) {
      if (err instanceof LroTimeout) return "pending";
      throw err;
    }
    return "deleted";
  }

  private async waitForLro(res: Response, deadline: number) {
    if (res.status !== 201 && res.status !== 202) return;
    const asyncUrl = res.headers.get("azure-asyncoperation");
    const locationUrl = res.headers.get("location");
    const pollUrl = asyncUrl ?? locationUrl;
    if (!pollUrl) return;
    let last: Response = res;
    while (true) {
      if (Date.now() > deadline) {
        throw new LroTimeout("Long-running operation did not finish in time.");
      }
      await sleep(retryDelay(last, 2));
      last = await sendWithRetry("GET", pollUrl);
      if (asyncUrl) {
        if (!last.ok) throw await toError(last);
        const op: any = await last.json();
        const status = String(op.status ?? "").toLowerCase();
        if (status === "succeeded") return;
        if (status === "failed" || status === "canceled") {
          const msg = op.error?.message ?? `Operation ${status}`;
          throw new ArmError(500, op.error?.code ?? status, msg);
        }
      } else {
        if (last.status === 202) continue;
        if (!last.ok && last.status !== 404) throw await toError(last);
        return;
      }
    }
  }
}

class GraphDirectory implements Directory {
  async resolveUser(id: string) {
    const enc = encodeURIComponent(id);
    const direct = await sendWithRetry("GET", `${GRAPH_BASE}/users/${enc}?$select=id,displayName,accountEnabled`);
    if (direct.ok) {
      const u: any = await direct.json();
      return { found: u.accountEnabled !== false, id: u.id, name: u.displayName };
    }
    if (direct.status !== 404 && direct.status !== 400) throw await toError(direct);
    const filter = encodeURIComponent(`mail eq '${id.replace(/'/g, "''")}'`);
    const res = await sendWithRetry("GET", `${GRAPH_BASE}/users?$filter=${filter}&$select=id,displayName,accountEnabled`);
    if (!res.ok) throw await toError(res);
    const page: any = await res.json();
    const u = page.value?.[0];
    if (!u) return { found: false };
    return { found: u.accountEnabled !== false, id: u.id, name: u.displayName };
  }
}

export function createClients(cfg: Config, opts: { writable: boolean }) {
  if (cfg.simulate) {
    const arm = new SimArm(cfg, lockGranule(cfg), opts.writable);
    return { arm: arm as Arm, directory: new SimDirectory(cfg) as Directory };
  }
  return { arm: new RealArm() as Arm, directory: new GraphDirectory() as Directory };
}

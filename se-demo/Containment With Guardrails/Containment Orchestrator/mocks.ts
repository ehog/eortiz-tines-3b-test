import type { Database } from "bun:sqlite";
import type { ChaosConfig, ChaosKey } from "./chaos";

export interface MockServer {
  baseUrl: string;
  stop: () => void;
}

interface MockContext {
  db: Database;
  runId: string;
  chaos: ChaosConfig;
}

function getState<T>(db: Database, key: string): T | null {
  const row = db.query<{ value: string }, [string]>("SELECT value FROM mock_state WHERE key = ?").get(key);
  if (!row) return null;
  try {
    return JSON.parse(row.value) as T;
  } catch {
    return null;
  }
}

function setState(db: Database, key: string, value: unknown): void {
  db.query("INSERT INTO mock_state (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(
    key,
    JSON.stringify(value),
  );
}

function bumpCounter(db: Database, key: string): number {
  const current = getState<number>(db, key) ?? 0;
  const next = current + 1;
  setState(db, key, next);
  return next;
}

/** True when the run's chaos config says this call should fail right now. */
function shouldFail(ctx: MockContext, key: ChaosKey): boolean {
  const setting = ctx.chaos[key];
  if (!setting?.enabled) return false;
  const seen = bumpCounter(ctx.db, `chaos_attempts:${ctx.runId}:${key}`);
  return setting.mode === "always" || seen <= setting.failures;
}

async function latency(min = 40, max = 160): Promise<void> {
  await Bun.sleep(min + Math.round(Math.random() * (max - min)));
}

/** Holds the connection open past the caller's deadline, honoring client disconnect. */
async function stall(signal: AbortSignal, ms: number): Promise<void> {
  for (let waited = 0; waited < ms; waited += 100) {
    if (signal.aborted) return;
    await Bun.sleep(100);
  }
}

function json(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...headers },
  });
}

function hash(input: string): string {
  return new Bun.CryptoHasher("sha256").update(input).digest("hex").slice(0, 32);
}

export function startMockServices(db: Database, runId: string, chaos: ChaosConfig): MockServer {
  const ctx: MockContext = { db, runId, chaos };

  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    idleTimeout: 30,
    async fetch(req) {
      const url = new URL(req.url);
      const path = url.pathname;

      // Proofpoint TAP — message enrichment for the alert.
      if (req.method === "GET" && path === "/proofpoint/v2/siem/messages/blocked") {
        await latency();
        if (shouldFail(ctx, "proofpoint_500")) {
          return json({ error: "internal_error", message: "TAP backend unavailable" }, 500);
        }
        const alertId = url.searchParams.get("alertId") ?? "unknown";
        return json({
          alertId,
          sender: "billing@invoices-secure-mail.com",
          senderIp: "185.244.25.187",
          subject: "Outstanding invoice 88213 — action required",
          threatScore: 91,
          verdict: "malicious",
          campaignId: `cmp-${hash(alertId).slice(0, 8)}`,
          clickedUrl: "https://secure-invoice-portal.top/login",
        });
      }

      // Zscaler — URL category and risk lookup.
      if (req.method === "GET" && path === "/zscaler/api/v1/urlLookup") {
        if (shouldFail(ctx, "zscaler_timeout")) {
          await stall(req.signal, 25000);
          return json({ note: "late response the client already abandoned" }, 200);
        }
        await latency();
        return json([
          {
            url: url.searchParams.get("url") ?? "",
            urlClassifications: ["PHISHING", "NEWLY_REGISTERED_DOMAIN"],
            riskScore: 87,
            blocked: true,
            firstSeen: "2026-02-11T08:14:00Z",
          },
        ]);
      }

      // Microsoft Defender — device posture query.
      if (req.method === "POST" && path === "/defender/api/machines/query") {
        if (shouldFail(ctx, "defender_429")) {
          await latency(20, 60);
          return json({ error: { code: "TooManyRequests", message: "API throttled" } }, 429, { "Retry-After": "1" });
        }
        await latency();
        const payload = (await req.json().catch(() => ({}))) as { endpoint?: string };
        const endpoint = payload.endpoint ?? "unknown-host";
        return json({
          machineId: `mde-${hash(endpoint).slice(0, 12)}`,
          computerDnsName: endpoint,
          osPlatform: "Windows11",
          riskScore: "High",
          healthStatus: "Active",
          lastSeen: new Date(Date.now() - 240000).toISOString(),
          loggedOnUsers: ["CORP\\a.reyes"],
          activeAlerts: 3,
        });
      }

      // ServiceNow — incident creation, idempotent on Idempotency-Key.
      if (req.method === "POST" && path === "/servicenow/api/now/table/incident") {
        const idemKey = req.headers.get("idempotency-key") ?? "";
        const existing = idemKey ? getState<{ number: string; sys_id: string; state: string }>(db, `idem:${idemKey}`) : null;
        if (existing) {
          await latency(20, 60);
          return json({ result: existing }, 200, { "X-Idempotent-Replay": "true" });
        }
        if (shouldFail(ctx, "servicenow_400")) {
          await latency(20, 60);
          return json(
            {
              error: {
                message: "Invalid insert",
                detail: "Mandatory field u_business_service is empty — request rejected",
              },
              status: "failure",
            },
            400,
          );
        }
        await latency();
        const payload = (await req.json().catch(() => ({}))) as Record<string, unknown>;
        const seq = bumpCounter(db, "seq:incident");
        const ticket = {
          number: `INC${String(1000000 + seq)}`,
          sys_id: hash(`${runId}:${seq}`),
          state: "New",
          short_description: String(payload.short_description ?? "Containment"),
          assignment_group: "SOC Tier 2",
          opened_at: new Date().toISOString(),
        };
        setState(db, `ticket:${ticket.sys_id}`, ticket);
        if (idemKey) setState(db, `idem:${idemKey}`, ticket);
        return json({ result: ticket }, 201);
      }

      // ServiceNow — incident update (used for the "containment incomplete" flag).
      const patchMatch = /^\/servicenow\/api\/now\/table\/incident\/([^/]+)$/.exec(path);
      if ((req.method === "PATCH" || req.method === "PUT") && patchMatch) {
        await latency();
        const sysId = patchMatch[1];
        const ticket = getState<Record<string, unknown>>(db, `ticket:${sysId}`);
        if (!ticket) return json({ error: { message: "No record found" } }, 404);
        const payload = (await req.json().catch(() => ({}))) as Record<string, unknown>;
        const updated = { ...ticket, ...payload, sys_updated_on: new Date().toISOString() };
        setState(db, `ticket:${sysId}`, updated);
        return json({ result: updated });
      }

      // Microsoft Defender — machine isolation, idempotent per endpoint.
      const isolateMatch = /^\/defender\/api\/machines\/([^/]+)\/isolate$/.exec(path);
      if (req.method === "POST" && isolateMatch) {
        const machineId = isolateMatch[1];
        const idemKey = req.headers.get("idempotency-key") ?? "";
        const current = getState<{ status: string; machineId: string; requestKey: string }>(db, `isolation:${machineId}`);
        if (current?.status === "Isolated") {
          await latency(20, 60);
          return json(
            { id: hash(`${machineId}:isolate`), type: "Isolate", status: "AlreadyIsolated", machineId, requestKey: current.requestKey },
            200,
            { "X-Idempotent-Replay": "true" },
          );
        }
        if (shouldFail(ctx, "isolate_fail")) {
          await latency(20, 60);
          return json({ error: { code: "ActiveRequestAlreadyExists", message: "Isolation service unavailable" } }, 503);
        }
        await latency();
        const record = {
          status: "Isolated",
          machineId,
          requestKey: idemKey,
          isolatedAt: new Date().toISOString(),
          runId,
        };
        setState(db, `isolation:${machineId}`, record);
        return json({ id: hash(`${machineId}:isolate`), type: "Isolate", status: "Succeeded", machineId, requestKey: idemKey }, 201);
      }

      return json({ error: "not_found", path }, 404);
    },
  });

  return {
    baseUrl: `http://127.0.0.1:${server.port}`,
    stop: () => server.stop(true),
  };
}

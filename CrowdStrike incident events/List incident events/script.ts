const baseUrl = process.env.CROWD_STRIKE_URL?.replace(/\/+$/, "");

type QueryResponse = {
  resources?: string[];
  meta?: { pagination?: { total?: number } };
};

type EvidenceItem = { id?: string };

type CaseRecord = {
  id?: string;
  reference_id?: string;
  name?: string;
  description?: string;
  status?: string;
  severity?: number;
  severity_info?: { level?: string };
  created_timestamp?: string;
  updated_timestamp?: string;
  start_timestamp?: string;
  end_timestamp?: string;
  assigned_to?: { full_name?: string; email?: string } | string;
  tags?: string[];
  evidence?: {
    alerts?: EvidenceItem[];
    events?: EvidenceItem[];
    leads?: EvidenceItem[];
  };
};

type Alert = {
  composite_id?: string;
  created_timestamp?: string;
  name?: string;
  display_name?: string;
  description?: string;
  severity?: number;
  severity_name?: string;
  status?: string;
  tactic?: string;
  technique?: string;
  user_name?: string;
  filename?: string;
  cmdline?: string;
  sha256?: string;
  device?: { hostname?: string };
};

type ListedEvent = {
  kind: "alert" | "event" | "lead";
  id: string;
  timestamp?: string | null;
  name?: string | null;
  description?: string | null;
  severity?: number | null;
  severity_name?: string | null;
  status?: string | null;
  tactic?: string | null;
  technique?: string | null;
  hostname?: string | null;
  user?: string | null;
  filename?: string | null;
  command_line?: string | null;
  sha256?: string | null;
};

class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly statusText: string,
    message: string,
  ) {
    super(message);
  }
}

function httpResponse(status: number, statusText: string, body: unknown): void {
  const payload = JSON.stringify(body);
  process.stdout.write(
    `HTTP/1.1 ${status} ${statusText}\r\n` +
      `Content-Type: application/json; charset=utf-8\r\n` +
      `Content-Length: ${Buffer.byteLength(payload)}\r\n` +
      `\r\n` +
      payload,
  );
}

function parseLimit(raw: string): number {
  const text = raw.trim();
  if (!/^[A-Z]+\s+\S+/.test(text)) return 25;
  const startLine = text.split(/\r?\n/, 1)[0] ?? "";
  const target = startLine.split(/\s+/)[1] ?? "/";
  const requested = new URL(target, "http://step.local").searchParams.get("limit");
  if (requested == null || requested === "") return 25;
  const parsed = Number(requested);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 100) {
    throw new HttpError(400, "Bad Request", "limit must be an integer from 1 to 100");
  }
  return parsed;
}

async function crowdstrike<T>(path: string, init?: RequestInit): Promise<T> {
  if (!baseUrl) {
    throw new HttpError(
      500,
      "Internal Server Error",
      "CROWD_STRIKE_URL is not set. Attach the CrowdStrike connector to this step.",
    );
  }
  const response = await fetch(`${baseUrl}${path}`, {
    ...init,
    headers: {
      Accept: "application/json",
      ...(init?.body ? { "Content-Type": "application/json" } : {}),
    },
  });
  const text = await response.text();
  if (!response.ok) {
    throw new HttpError(
      502,
      "Bad Gateway",
      `CrowdStrike returned ${response.status} for ${path}: ${text.slice(0, 1500)}`,
    );
  }
  if (!text) return {} as T;
  return JSON.parse(text) as T;
}

function idsOf(items: EvidenceItem[] | undefined): string[] {
  return (items ?? []).map((item) => item.id).filter((id): id is string => Boolean(id));
}

function assignedTo(value: CaseRecord["assigned_to"]): string | null {
  if (!value) return null;
  if (typeof value === "string") return value;
  return value.full_name || value.email || null;
}

function summarizeAlert(alert: Alert): ListedEvent {
  return {
    kind: "alert",
    id: alert.composite_id ?? "",
    timestamp: alert.created_timestamp ?? null,
    name: alert.display_name || alert.name || null,
    description: alert.description ?? null,
    severity: alert.severity ?? null,
    severity_name: alert.severity_name ?? null,
    status: alert.status ?? null,
    tactic: alert.tactic ?? null,
    technique: alert.technique ?? null,
    hostname: alert.device?.hostname ?? null,
    user: alert.user_name ?? null,
    filename: alert.filename ?? null,
    command_line: alert.cmdline ?? null,
    sha256: alert.sha256 ?? null,
  };
}

async function fetchAlerts(compositeIds: string[]): Promise<Map<string, Alert>> {
  const byId = new Map<string, Alert>();
  for (let index = 0; index < compositeIds.length; index += 100) {
    const composite_ids = compositeIds.slice(index, index + 100);
    const page = await crowdstrike<{ resources?: Alert[] }>("/alerts/entities/alerts/v2", {
      method: "POST",
      body: JSON.stringify({ composite_ids }),
    });
    for (const alert of page.resources ?? []) {
      if (alert.composite_id) byId.set(alert.composite_id, alert);
    }
  }
  return byId;
}

async function main(): Promise<void> {
  const raw = await new Response(Bun.stdin).text();
  const limit = parseLimit(raw);

  const query = await crowdstrike<QueryResponse>(
    `/cases/queries/cases/v1?sort=${encodeURIComponent("created_timestamp|desc")}&limit=${limit}`,
  );
  const ids = query.resources ?? [];
  if (ids.length === 0) {
    httpResponse(200, "OK", {
      total: query.meta?.pagination?.total ?? 0,
      incidents: [],
    });
    return;
  }

  const details = await crowdstrike<{ resources?: CaseRecord[] }>("/cases/entities/cases/v2", {
    method: "POST",
    body: JSON.stringify({ ids }),
  });
  const cases = details.resources ?? [];

  const alertIds = [
    ...new Set(cases.flatMap((record) => idsOf(record.evidence?.alerts))),
  ].slice(0, 100);
  const alerts = alertIds.length > 0 ? await fetchAlerts(alertIds) : new Map<string, Alert>();

  const incidents = cases.map((record) => {
    const events: ListedEvent[] = [];
    for (const id of idsOf(record.evidence?.alerts)) {
      const alert = alerts.get(id);
      events.push(alert ? summarizeAlert(alert) : { kind: "alert", id });
    }
    for (const id of idsOf(record.evidence?.events)) {
      events.push({ kind: "event", id });
    }
    for (const id of idsOf(record.evidence?.leads)) {
      events.push({ kind: "lead", id });
    }
    return {
      id: record.id ?? null,
      reference_id: record.reference_id ?? null,
      name: record.name ?? null,
      status: record.status ?? null,
      severity: record.severity ?? null,
      severity_level: record.severity_info?.level ?? null,
      description: record.description ?? null,
      created_timestamp: record.created_timestamp ?? null,
      updated_timestamp: record.updated_timestamp ?? null,
      start_timestamp: record.start_timestamp ?? null,
      end_timestamp: record.end_timestamp ?? null,
      assigned_to: assignedTo(record.assigned_to),
      tags: record.tags ?? [],
      events,
    };
  });

  httpResponse(200, "OK", {
    total: query.meta?.pagination?.total ?? incidents.length,
    incidents,
  });
}

try {
  await main();
} catch (error) {
  if (error instanceof HttpError) {
    httpResponse(error.status, error.statusText, { error: error.message });
    if (error.status >= 500) process.exit(1);
  } else {
    const message = error instanceof Error ? error.message : "Unexpected failure";
    httpResponse(500, "Internal Server Error", { error: message });
    process.exit(1);
  }
}

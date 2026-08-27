import { recordDecision, type DecisionRecord } from "./state";

const raw = await Bun.stdin.text();
const separator = raw.indexOf("\r\n\r\n");
const head = separator === -1 ? raw : raw.slice(0, separator);
const bodyText = separator === -1 ? "" : raw.slice(separator + 4);
const lines = head.split("\r\n");
const method = (lines[0] ?? "POST /").split(" ")[0] ?? "POST";

const headers = Object.fromEntries(
  lines.slice(1).filter((l) => l.includes(":")).map((line) => {
    const i = line.indexOf(":");
    return [line.slice(0, i).toLowerCase(), line.slice(i + 1).trim()];
  }),
);

function respond(status: number, reason: string, json: unknown) {
  const body = Buffer.from(JSON.stringify(json));
  process.stdout.write(
    `HTTP/1.1 ${status} ${reason}\r\nContent-Type: application/json\r\nCache-Control: no-store\r\nContent-Length: ${body.length}\r\n\r\n`,
  );
  process.stdout.write(body);
}

if (method !== "POST") {
  respond(405, "Method Not Allowed", { error: "Use POST" });
  process.exit(0);
}

let input: Record<string, unknown>;
try {
  input = JSON.parse(bodyText || "{}") as Record<string, unknown>;
} catch {
  respond(400, "Bad Request", { error: "Body must be JSON" });
  process.exit(0);
}

const str = (key: string) => (typeof input[key] === "string" ? (input[key] as string).trim() : "");

const decision = str("decision").toUpperCase();
if (decision !== "YES" && decision !== "NO") {
  respond(400, "Bad Request", { error: "decision must be YES or NO" });
  process.exit(0);
}

const missing = ["device_id", "device_name", "package_id", "package_name"].filter((k) => !str(k));
if (missing.length > 0) {
  respond(400, "Bad Request", { error: `missing fields: ${missing.join(", ")}` });
  process.exit(0);
}

const payload: DecisionRecord = {
  decision: decision as "YES" | "NO",
  device_id: str("device_id"),
  device_name: str("device_name"),
  package_id: str("package_id"),
  package_name: str("package_name"),
  severity: str("severity") || "unknown",
  decided_by: headers["x-3b-authenticated-email"] ?? "unknown",
  decided_at: new Date().toISOString(),
};

recordDecision(payload, "app");

respond(200, "OK", {
  status: payload.decision === "YES" ? "patching" : "postponed",
  ...payload,
});

// The trailing JSON line is the workflow payload consumed by Install patch and Postpone and create case.
process.stdout.write(`\n${JSON.stringify(payload)}\n`);

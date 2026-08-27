import { recordDecision } from "./state";

const raw = await Bun.stdin.text();
const head = raw.split("\r\n\r\n")[0] ?? raw;
const lines = head.split("\r\n");
const target = (lines[0] ?? "GET /").split(" ")[1] ?? "/";
const params = new URL(target, "https://placeholder.invalid").searchParams;

const headers = Object.fromEntries(
  lines.slice(1).filter((l) => l.includes(":")).map((line) => {
    const i = line.indexOf(":");
    return [line.slice(0, i).toLowerCase(), line.slice(i + 1).trim()];
  }),
);

const decision = params.get("decision") === "YES" ? "YES" : "NO";
const payload = {
  decision,
  device_id: params.get("device_id") ?? "",
  device_name: params.get("device_name") ?? "",
  package_id: params.get("package_id") ?? "",
  package_name: params.get("package_name") ?? "",
  severity: params.get("severity") ?? "unknown",
  decided_by: headers["x-3b-authenticated-email"] ?? "unknown",
  decided_at: new Date().toISOString(),
};

recordDecision(payload, "slack");

const title = decision === "YES" ? "Patch queued" : "Patching postponed";
const detail =
  decision === "YES"
    ? `Automox will install <strong>${payload.package_name}</strong> on <strong>${payload.device_name}</strong>.`
    : `A Tines case is being created to track <strong>${payload.package_name}</strong> on <strong>${payload.device_name}</strong>.`;

const html = `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title>
<style>
body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;background:#020617;color:#e2e8f0;font-family:ui-sans-serif,system-ui,sans-serif}
main{max-width:26rem;padding:2rem;border:1px solid #1e293b;border-radius:1rem;background:#0f172a;text-align:center}
h1{font-size:1.5rem;margin:.5rem 0 .75rem}p{color:#94a3b8;line-height:1.6}
.icon{font-size:3rem}.meta{margin-top:1.5rem;font-size:.7rem;letter-spacing:.08em;text-transform:uppercase;color:#475569}
</style></head>
<body><main>
<div class="icon">${decision === "YES" ? "✅" : "⏸️"}</div>
<h1>${title}</h1>
<p>${detail}</p>
<p class="meta">Recorded for ${payload.decided_by}</p>
</main></body></html>`;

const body = Buffer.from(html);
// Content-Length bounds the HTTP response; the trailing JSON line is the workflow payload for linked steps.
process.stdout.write(
  `HTTP/1.1 200 OK\r\nContent-Type: text/html; charset=utf-8\r\nContent-Length: ${body.length}\r\n\r\n`,
);
process.stdout.write(body);
process.stdout.write(`\n${JSON.stringify(payload)}\n`);

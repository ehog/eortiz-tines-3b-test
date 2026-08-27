const ORG_ID = "104352";

type Decision = {
  decision: "YES" | "NO";
  device_id: string;
  device_name: string;
  package_id: string;
  package_name: string;
  decided_by: string;
};

const raw = (await Bun.stdin.text()).trim();
const lastLine = raw.split("\n").at(-1) ?? "{}";
const decision = JSON.parse(lastLine) as Decision;

if (decision.decision !== "YES") process.exit(0);

const res = await fetch(`https://console.automox.com/api/servers/${decision.device_id}/queues?o=${ORG_ID}`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ command_type_name: "InstallUpdate", args: [decision.package_name] }),
});
const text = await res.text();
if (!res.ok) throw new Error(`Automox install failed: ${res.status} ${text}`);

console.error(`queued ${decision.package_name} on device ${decision.device_id} for ${decision.decided_by}`);
console.log(JSON.stringify({ ...decision, automox_response: text || "queued" }));

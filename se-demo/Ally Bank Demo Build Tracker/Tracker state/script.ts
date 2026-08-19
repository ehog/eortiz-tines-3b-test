const STATE_PATH = "/storage/ally_demo_tracker/state.json";
const IDS = ["triage", "cases", "console", "self-service", "metrics", "intake"];

type Entry = { link: string; feedback: string; status: string };
const STATUSES = ["Not started", "Building", "Ready", "Needs rework"];

function blank(): Record<string, Entry> {
  return Object.fromEntries(
    IDS.map((id) => [id, { link: "", feedback: "", status: "Not started" }]),
  );
}

async function load(): Promise<Record<string, Entry>> {
  const file = Bun.file(STATE_PATH);
  if (!(await file.exists())) return blank();
  const stored = (await file.json()) as Record<string, Partial<Entry>>;
  const state = blank();
  for (const id of IDS) {
    const e = stored[id];
    if (!e) continue;
    state[id] = {
      link: typeof e.link === "string" ? e.link : "",
      feedback: typeof e.feedback === "string" ? e.feedback : "",
      status:
        typeof e.status === "string" && STATUSES.includes(e.status)
          ? e.status
          : "Not started",
    };
  }
  return state;
}

function respond(status: string, body: string) {
  process.stdout.write(
    [
      `HTTP/1.1 ${status}`,
      "Content-Type: application/json",
      `Content-Length: ${Buffer.byteLength(body)}`,
      "Cache-Control: no-store",
      "",
      body,
    ].join("\r\n"),
  );
}

const raw = await Bun.stdin.text();
const separator = raw.indexOf("\r\n\r\n");
const head = separator === -1 ? raw : raw.slice(0, separator);
const rawBody = separator === -1 ? "" : raw.slice(separator + 4);
const method = (head.split("\r\n")[0] ?? "").split(" ")[0]?.toUpperCase() ?? "GET";

if (method === "GET") {
  respond("200 OK", JSON.stringify({ state: await load() }));
} else if (method === "POST") {
  const payload = JSON.parse(rawBody) as {
    id?: string;
    link?: string;
    feedback?: string;
    status?: string;
  };
  if (!payload.id || !IDS.includes(payload.id)) {
    respond("400 Bad Request", JSON.stringify({ error: "unknown use case id" }));
  } else if (payload.status !== undefined && !STATUSES.includes(payload.status)) {
    respond("400 Bad Request", JSON.stringify({ error: "invalid status" }));
  } else {
    const state = await load();
    const current = state[payload.id]!;
    state[payload.id] = {
      link: payload.link ?? current.link,
      feedback: payload.feedback ?? current.feedback,
      status: payload.status ?? current.status,
    };
    await Bun.write(STATE_PATH, JSON.stringify(state, null, 2));
    respond("200 OK", JSON.stringify({ state }));
  }
} else {
  respond("405 Method Not Allowed", JSON.stringify({ error: "use GET or POST" }));
}

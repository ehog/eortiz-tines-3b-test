import { rmSync } from "node:fs";
import { FINDINGS_DIR, openDb, readRequest, respond } from "./lib";

const req = await readRequest();

if (req.method !== "POST") {
  respond(405, JSON.stringify({ error: "Use POST to clear demo hunt history" }));
  process.exit(0);
}

const db = openDb("write");
let removed = 0;
try {
  removed = db.query<{ n: number }, []>(`SELECT COUNT(*) AS n FROM hunts`).get()!.n;
  db.transaction(() => {
    db.exec("DELETE FROM block_requests");
    db.exec("DELETE FROM source_results");
    db.exec("DELETE FROM indicators");
    db.exec("DELETE FROM hunts");
  })();
} finally {
  db.close();
}
rmSync(FINDINGS_DIR, { recursive: true, force: true });

respond(200, JSON.stringify({ cleared: removed }));

import {
  decideStatus,
  ERROR_REASONS,
  openDb,
  readUpstreamJson,
  rng,
  type DemoMode,
} from "./lib";

export type Finding = {
  findings: Record<string, unknown>;
  frequency: number;
  firstSeen: string;
  lastSeen: string;
};

export type Generator = (args: {
  indicator: string;
  type: string;
  baseIso: string;
  next: () => number;
}) => Finding;

type Upstream = { huntId: string };

export async function runSearch(source: string, delayMs: number, generate: Generator): Promise<void> {
  const upstream = await readUpstreamJson<Upstream>();
  const huntId = upstream.huntId;
  if (!huntId) throw new Error("Upstream payload has no huntId");

  // Staggered so the live report page visibly fills in one source at a time.
  await new Promise((r) => setTimeout(r, delayMs));

  const db = openDb("write");
  try {
    const hunt = db
      .query<{ demo_mode: string; created_at: string }, [string]>(
        `SELECT demo_mode, created_at FROM hunts WHERE id = ?`,
      )
      .get(huntId);
    if (!hunt) throw new Error(`Unknown hunt ${huntId}`);

    const indicators = db
      .query<{ value: string; type: string }, [string]>(
        `SELECT value, type FROM indicators WHERE hunt_id = ? ORDER BY position`,
      )
      .all(huntId);

    const mode = hunt.demo_mode as DemoMode;
    const insert = db.query(
      `INSERT OR REPLACE INTO source_results
         (hunt_id, source, indicator, status, error_reason, findings_json, first_seen, last_seen, frequency, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );

    const summary: { indicator: string; status: string; frequency: number }[] = [];

    db.transaction(() => {
      for (const ind of indicators) {
        const seed = `${source}|${ind.value}|${hunt.created_at}`;
        const status = decideStatus(mode, source, seed);
        if (status === "error") {
          insert.run(
            huntId,
            source,
            ind.value,
            "error",
            ERROR_REASONS[source] ?? "Search failed",
            null,
            null,
            null,
            0,
            hunt.created_at,
          );
          summary.push({ indicator: ind.value, status: "error", frequency: 0 });
          continue;
        }
        if (status === "no_match") {
          insert.run(huntId, source, ind.value, "no_match", null, null, null, null, 0, hunt.created_at);
          summary.push({ indicator: ind.value, status: "no_match", frequency: 0 });
          continue;
        }
        const finding = generate({
          indicator: ind.value,
          type: ind.type,
          baseIso: hunt.created_at,
          next: rng(seed),
        });
        insert.run(
          huntId,
          source,
          ind.value,
          "hit",
          null,
          JSON.stringify(finding.findings),
          finding.firstSeen,
          finding.lastSeen,
          finding.frequency,
          hunt.created_at,
        );
        summary.push({ indicator: ind.value, status: "hit", frequency: finding.frequency });
      }
    })();

    console.log(JSON.stringify({ huntId, source, results: summary }));
  } finally {
    db.close();
  }
}

import {
  DEFAULT_CONFIG,
  etParts,
  getConfig,
  listAssets,
  openReadonly,
  parseInput,
  SEED_ASSETS,
  type Alert,
  type CriticalAsset,
} from "./soclib";
import { makeRng } from "./sources/mockutil";
import { fetchSentinel } from "./sources/sentinel";
import { fetchDefender } from "./sources/defender";
import { fetchServiceNow } from "./sources/servicenow";
import { fetchProofpoint } from "./sources/proofpoint";
import { fetchZscaler } from "./sources/zscaler";

const raw = await Bun.stdin.text();
const { body } = parseInput(raw);
const trigger = (body as { trigger?: string } | null)?.trigger === "manual" ? "manual" : "schedule";

const now = new Date();
const et = etParts(now);

// The cron fires at 10:00 and 11:00 UTC so that exactly one of them is 06:00 in New York year round.
if (trigger === "schedule" && et.hour !== 6) {
  console.error(`Not 06:00 in ${"America/New_York"} (currently ${et.label}); skipping this cron tick.`);
  process.exit(0);
}

const db = openReadonly();
const config = db ? getConfig(db) : DEFAULT_CONFIG;
const end = now;
const start = new Date(end.getTime() - config.digest.lookbackHours * 3600_000);
const rng = makeRng(`${start.toISOString().slice(0, 13)}|${config.digest.lookbackHours}`);
const win = { start, end, rng };

const sources = {
  sentinel: fetchSentinel(win),
  defender: fetchDefender(win),
  servicenow: fetchServiceNow(win),
  proofpoint: fetchProofpoint(win),
  zscaler: fetchZscaler(win),
};

type DeferredRow = { alert_id: string; queued_at: string; score: number; reason: string; json: string };
type DecisionRow = { alert_id: string; decision: string; score: number; reason: string; decided_at: string; json: string };

let assets: CriticalAsset[] = SEED_ASSETS;
let deferred: Array<{ alert: Alert; score: number; reason: string; queuedAt: string }> = [];
let gateDecisions: Array<{ alert: Alert; decision: string; score: number; reason: string; decidedAt: string }> = [];

if (db) {
  assets = listAssets(db);
  deferred = db
    .query<DeferredRow, [string]>(
      `SELECT q.alert_id, q.queued_at, q.score, q.reason, a.json
         FROM deferred_queue q JOIN alerts a ON a.id = q.alert_id
        WHERE q.digested_at IS NULL AND q.queued_at >= ?
        ORDER BY q.score DESC`,
    )
    .all(start.toISOString())
    .map((r) => ({ alert: JSON.parse(r.json) as Alert, score: r.score, reason: r.reason, queuedAt: r.queued_at }));

  gateDecisions = db
    .query<DecisionRow, [string]>(
      `SELECT d.alert_id, d.decision, d.score, d.reason, d.decided_at, a.json
         FROM gate_decisions d JOIN alerts a ON a.id = d.alert_id
        WHERE d.decided_at >= ?
        ORDER BY d.decided_at DESC`,
    )
    .all(start.toISOString())
    .map((r) => ({
      alert: JSON.parse(r.json) as Alert,
      decision: r.decision,
      score: r.score,
      reason: r.reason,
      decidedAt: r.decided_at,
    }));
  db.close();
}

const counts = Object.fromEntries(Object.entries(sources).map(([k, v]) => [k, v.length]));
console.error(
  `Collected ${Object.values(counts).reduce((a, b) => a + b, 0)} source records (${JSON.stringify(counts)}), ` +
    `${deferred.length} deferred from the gate, ${gateDecisions.length} gate decisions, trigger=${trigger}.`,
);

console.log(
  JSON.stringify({
    trigger,
    window: { start: start.toISOString(), end: end.toISOString(), lookbackHours: config.digest.lookbackHours, etLabel: et.label },
    config: { pageThreshold: config.pageThreshold, suppressBelowScore: config.suppressBelowScore, model: config.digest.model, delivery: config.delivery },
    assets,
    sources,
    deferred,
    gateDecisions,
  }),
);

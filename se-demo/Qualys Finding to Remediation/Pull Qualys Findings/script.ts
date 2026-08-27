// Scheduled pull of Qualys detections. Emits only detections that are new or
// have changed since the last pull, so a quiet scan produces no downstream work.
import { openRead as openQualys, listDetections } from "./qualys-db";
import { seenFingerprints, markSeen, getConfig, setConfig } from "./pipeline-db";
import { runStage } from "./stage";
import type { PullEnvelope, QualysDetection } from "./types";

const OPEN_STATUSES = new Set(["Active", "Re-Opened"]);

function fingerprint(d: QualysDetection): string {
  return [d.ID, d.QID, d.STATUS, d.SEVERITY, d.CVSS.BASE, d.LAST_UPDATE_DATETIME].join("|");
}

await runStage<{ force?: boolean }, PullEnvelope>({
  stage: "pull",
  handler: async (input, { db, runId, invocation }) => {
    const force = input?.force === true;
    const qualys = openQualys();
    const all = listDetections(qualys);
    const open = all.filter((d) => OPEN_STATUSES.has(d.STATUS));

    const seen = force ? new Set<string>() : seenFingerprints(db);
    const changed = open.filter((d) => !seen.has(fingerprint(d)));
    for (const d of changed) markSeen(db, fingerprint(d), d.ID);
    setConfig(db, "last_pull_at", new Date().toISOString());

    const previousTotal = Number(getConfig(db, "last_pull_total") ?? "0");
    setConfig(db, "last_pull_total", String(open.length));

    const payload: PullEnvelope = {
      run_id: runId,
      trigger: invocation.trigger,
      stage: "pull",
      generated_at: new Date().toISOString(),
      detections: changed,
      notes: [
        `${all.length} detections in Qualys, ${open.length} open (Active or Re-Opened)`,
        force ? "forced pull: fingerprint cache ignored" : `${open.length - changed.length} unchanged since last pull`,
        `previous pull saw ${previousTotal} open detections`,
      ],
    };

    return {
      payload,
      count: changed.length,
      summary:
        changed.length === 0
          ? `no new or changed detections (${open.length} open, all previously seen)`
          : `${changed.length} new or changed detections of ${open.length} open`,
      emit: changed.length > 0,
    };
  },
});

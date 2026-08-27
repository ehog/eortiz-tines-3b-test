// Backfills three weeks of change history so the report, MTTR and trend charts
// have something to show at the start of a demo. Deterministic: the same seed
// produces the same history every time.
import type { Database } from "bun:sqlite";
import { createTicket, addWorkNote, priorityFor, updateTicket } from "./snow-db";

const DAY = 86_400_000;

function mulberry32(seed: number): () => number {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const TEAMS = [
  { team: "Platform Engineering", application: "Customer Portal", group: "CAB-Platform-Engineering" },
  { team: "Platform Engineering", application: "Internal API Gateway", group: "CAB-Platform-Engineering" },
  { team: "Commerce Engineering", application: "Order Service", group: "CAB-Commerce-Engineering" },
  { team: "Payments Engineering", application: "Payments Web", group: "CAB-Payments-Engineering" },
  { team: "IT Endpoint Services", application: "Corporate Endpoints", group: "CAB-IT-Endpoint" },
  { team: "Data Platform", application: "Core Database Platform", group: "CAB-Data-Platform" },
];

// The live pipeline keeps one open change per team and application, so a
// historical change left open on an application the sample findings touch would
// absorb them on the next run. Open history therefore only ever lands on Core
// Database Platform, which no sample finding belongs to.
const OPEN_HISTORY_TARGET = TEAMS[5]!;

const CLASSES = [
  { vuln_class: "Missing Patch", weight: 6, title: "missing operating system security update" },
  { vuln_class: "Third-Party Library", weight: 5, title: "vulnerable third-party dependency" },
  { vuln_class: "Configuration", weight: 4, title: "insecure service configuration" },
  { vuln_class: "Code Defect", weight: 2, title: "application code defect" },
  { vuln_class: "Weak Cryptography", weight: 2, title: "deprecated TLS or cipher configuration" },
];

const CLASS_POOL = CLASSES.flatMap((c) => Array.from({ length: c.weight }, () => c));

const BANDS = [
  { band: "critical", sla: 3, score: 92 },
  { band: "high", sla: 7, score: 71 },
  { band: "medium", sla: 30, score: 51 },
  { band: "low", sla: 90, score: 24 },
];

export function seedHistory(db: Database, now: Date, count = 18): number {
  const random = mulberry32(20260817);
  const nowMs = now.getTime();
  let created = 0;

  for (let i = 0; i < count; i += 1) {
    const klass = CLASS_POOL[Math.floor(random() * CLASS_POOL.length)]!;
    const bandPick = BANDS[Math.floor(random() * (random() < 0.55 ? 2 : BANDS.length))]!;
    const ageDays = 1 + random() * 20;
    const openedAt = new Date(nowMs - ageDays * DAY);
    const dueDate = new Date(openedAt.getTime() + bandPick.sla * DAY);
    const roll = random();
    const closed = roll < 0.66;
    const target = closed ? TEAMS[Math.floor(random() * TEAMS.length)]! : OPEN_HISTORY_TARGET;
    const findingCount = 1 + Math.floor(random() * 4);
    const findings = Array.from({ length: findingCount }, (_, n) => ({
      finding_id: `HIST-${String(i + 1).padStart(2, "0")}-${n + 1}`,
      title: `${klass.vuln_class}: ${klass.title}`,
      vuln_class: klass.vuln_class,
      risk_score: bandPick.score - n * 3,
      risk_band: bandPick.band,
      hostname: `${target.application.split(" ")[0]!.toUpperCase()}-${10 + Math.floor(random() * 80)}`,
    }));

    const closedAt = closed
      ? new Date(
          openedAt.getTime() + Math.min(bandPick.sla * (0.35 + random() * 1.15), ageDays * 0.95) * DAY,
        )
      : null;

    const ticket = createTicket(db, {
      short_description: `[${bandPick.band.toUpperCase()}] ${findingCount} vulnerability finding${
        findingCount === 1 ? "" : "s"
      } on ${target.application}`,
      description: `Historical remediation change for ${target.application}. ${findingCount} ${klass.vuln_class.toLowerCase()} finding${
        findingCount === 1 ? "" : "s"
      } batched for ${target.team}.`,
      assignment_group: target.group,
      team: target.team,
      application: target.application,
      priority: priorityFor(bandPick.band),
      risk_score: bandPick.score,
      risk_band: bandPick.band,
      state: closed ? "closed" : random() < 0.5 ? "implement" : "assess",
      opened_at: openedAt.toISOString(),
      due_date: dueDate.toISOString(),
      closed_at: closedAt ? closedAt.toISOString() : null,
      finding_ids: findings.map((f) => f.finding_id),
      payload: { findings, history: true },
    });

    addWorkNote(
      db,
      ticket.sys_id,
      `Change opened by vulnerability automation with ${findingCount} batched finding${
        findingCount === 1 ? "" : "s"
      }. SLA ${bandPick.sla} days (${bandPick.band} band, risk score ${bandPick.score}).`,
      "vuln-automation",
      openedAt.toISOString(),
    );

    if (closedAt) {
      const late = closedAt.getTime() > dueDate.getTime();
      if (late) {
        addWorkNote(
          db,
          ticket.sys_id,
          `Escalation: change passed its SLA date of ${dueDate.toISOString().slice(0, 10)} before completion.`,
          "vuln-automation",
          dueDate.toISOString(),
        );
        updateTicket(
          db,
          ticket.sys_id,
          { escalation_level: 1, chased_at: dueDate.toISOString() },
          closedAt.toISOString(),
        );
      }
      addWorkNote(
        db,
        ticket.sys_id,
        `Remediation implemented and verified by rescan. Closed ${late ? "after" : "within"} SLA.`,
        target.team.toLowerCase().replace(/\s+/g, ".") + "@acme-demo.com",
        closedAt.toISOString(),
      );
    } else if (dueDate.getTime() < nowMs) {
      addWorkNote(
        db,
        ticket.sys_id,
        `Escalation: change is past its SLA date of ${dueDate.toISOString().slice(0, 10)} and still open.`,
        "vuln-automation",
        dueDate.toISOString(),
      );
      updateTicket(
        db,
        ticket.sys_id,
        { escalation_level: 1, chased_at: dueDate.toISOString() },
        dueDate.toISOString(),
      );
    }
    created += 1;
  }
  return created;
}

export type UseCase = {
  id: string;
  title: string;
  segment: "Builder" | "Analyst";
  driver: string;
  prompt: string;
};

export const useCases: UseCase[] = [
  {
    id: "triage",
    title: "CrowdStrike alert triage at scale",
    segment: "Builder",
    driver:
      "Ally ingests 10,000+ CrowdStrike alerts/day with heavy SIM-level tuning; any tool must not increase analyst noise.",
    prompt:
      "Ingest CrowdStrike detections on a schedule. Normalize, then dedupe and suppress at the SIM level using a tunable rules file — fingerprint on host + detection name + technique, suppress repeats inside a configurable window. Enrich survivors (host lookup, IP/hash reputation). Emit a triage decision: auto-close, escalate to case, or hold. Log suppressed vs escalated counts so I can show noise reduction numerically.",
  },
  {
    id: "cases",
    title: "Case management to replace ServiceNow",
    segment: "Analyst",
    driver:
      "Josh explicitly wants off ServiceNow; 7+ year retention; fully customizable fields.",
    prompt:
      "Take an escalated CrowdStrike detection and open a Tines Case with a custom field schema — severity, owning team, MITRE technique, affected host, SIM rule ID, SLA due. Add enrichment as case comments and attach evidence. Include a step that adds and removes a custom field live so I can demo schema flexibility, and note retention posture in the case record.",
  },
  {
    id: "console",
    title: "Analyst investigation console",
    segment: "Analyst",
    driver: "Analyst-experience segment of the demo, ~20 min.",
    prompt:
      "Build an analyst console page over the open cases: queue sorted by severity and SLA, case detail view with enrichment inline, and one-click containment actions (contain host, disable account, add hash to blocklist) each gated by a confirmation and written back to the case activity trail.",
  },
  {
    id: "self-service",
    title: "SOC self-service playbook builder",
    segment: "Builder",
    driver:
      "SOC analysts should build their own automations without the ServiceNow or Splunk/Phantom teams.",
    prompt:
      "Build a small end-to-end playbook that a SOC analyst could plausibly have built themselves in under 15 minutes: alert in, enrich, decide, act, notify. Keep it deliberately simple and legible — I'm going to show the finished result first and then walk backwards through how it was built.",
  },
  {
    id: "metrics",
    title: "SOC metrics and reporting dashboard",
    segment: "Builder",
    driver: "Dashboard/reporting capability appears in Ally's written requirements.",
    prompt:
      "Build a dashboard over case and detection data: alert volume over time, suppression/tuning effectiveness, MTTR by severity, top detections by count, and open cases by owning team. Cross-filtering and shareable URL state.",
  },
  {
    id: "intake",
    title: "Non-SOC automation intake",
    segment: "Builder",
    driver: "Rob Cannon's group outside the SOC also needs automation capability.",
    prompt:
      "Build an intake form for automation requests from outside the SOC — requester, business area, trigger, desired outcome, systems involved. AI-classify each request by complexity and route it: simple ones get an auto-generated draft workflow outline, complex ones open a case for the automation team.",
  },
];

export const statuses = ["Not started", "Building", "Ready", "Needs rework"] as const;
export type Status = (typeof statuses)[number];

import { api } from "./api";

export type TourAction = {
  /** Label for the optional "do it for me" button. */
  label: string;
  /** Label used while the action is running and in failure toasts. */
  runLabel: string;
  run: () => Promise<unknown>;
  /** Advance to the next tour step once the action succeeds. */
  advanceOnSuccess?: boolean;
};

export type TourStep = {
  id: string;
  phase: string;
  /** Route to navigate to before showing this step, without a leading slash. */
  tab?: string;
  /** `data-tour` value of the element to highlight. Omitted for centered steps. */
  anchor?: string;
  headline: string;
  body: string;
  why?: string;
  action?: TourAction;
};

export const TOUR: TourStep[] = [
  {
    id: "open",
    phase: "Set the stage",
    headline: "From scanner noise to closed changes",
    body: "Today this process is a CSV export from the scanner, a spreadsheet of owners, someone hand-writing change tickets, and a weekly chase for whatever slipped. The scan is fast; everything after it is people.",
    why: "The bottleneck is never detection. It is the triage, ownership, ticketing and follow-up between a finding and a fix — and that is exactly the work an automation platform should own.",
  },
  {
    id: "promise",
    phase: "Set the stage",
    headline: "What you are about to see",
    body: "One 3B workflow that pulls findings, scores them against your policy, writes an engineer-ready fix with AI, files the change in ServiceNow, chases the overdue ones, and reports on all of it. Every screen in this console is served by that same workflow.",
    why: "This was built conversationally, in this product, and it runs in production on a schedule. There is no separate app to host, deploy or maintain.",
  },

  {
    id: "findings-volume",
    phase: "The problem is real",
    tab: "findings",
    anchor: "findings-table",
    headline: "This is what the scanner actually gives you",
    body: "Detections simulated from Qualys VMDR, served live over the same API shape the real thing returns. QIDs, CVSS, CVE lists, asset tags. Accurate, complete — and not a decision anyone can act on.",
    why: "Severity is not risk. Nothing here tells you who owns the box, whether it is internet-facing, how long you have, or what to type to fix it. That gap is where the backlog comes from.",
  },
  {
    id: "findings-inject",
    phase: "The problem is real",
    tab: "findings",
    anchor: "findings-inject",
    headline: "Nothing here is canned",
    body: "I can inject a brand-new detection right now and it will flow through the whole pipeline with everything else. Editing severity or KEV status changes the fingerprint, so the next pull treats it as updated.",
    why: "A demo you can perturb is a demo you can trust. What you break here is what the real workflow handles.",
    action: {
      label: "Inject a KEV finding",
      runLabel: "Inject detection",
      run: () => api.injectDetection("kev_internet_web"),
    },
  },

  {
    id: "pipeline-run",
    phase: "3B does the work",
    tab: "pipeline",
    anchor: "pipeline-run",
    headline: "One run, end to end",
    body: "This is the whole path: pull from Qualys, normalize and attach ownership, score against policy, generate the AI remediation package, open the ServiceNow change. In production it runs on a schedule — nobody presses this button.",
    why: "The value is not that it can run. It is that it runs the same way every night, at 3am, with an audit trail, whether or not anyone is watching.",
    action: {
      label: "Run the full pipeline",
      runLabel: "Run pipeline",
      run: () => api.runPipeline(),
      advanceOnSuccess: true,
    },
  },
  {
    id: "pipeline-history",
    phase: "3B does the work",
    tab: "pipeline",
    anchor: "pipeline-history",
    headline: "Every stage, timed and accounted for",
    body: "Each row is a real step execution with its own trigger, duration, record count and summary. Steps are independent processes wired together — one step's output is the next step's input.",
    why: "When something goes wrong at 3am you get the failing step, its input and its error — not a 4,000-line log from a monolithic script. That is the difference between an automation you keep and one you abandon.",
  },
  {
    id: "pipeline-webhook",
    phase: "3B does the work",
    tab: "pipeline",
    anchor: "pipeline-webhook",
    headline: "Same logic, second trigger, no rebuild",
    body: "Qualys can also push. This posts a detection to the workflow's webhook route, which feeds the exact same normalization step as the scheduled pull.",
    why: "Adding a real-time path cost one route, not a second implementation. The nightly batch and the push share one set of rules, so they can never drift apart.",
  },

  {
    id: "priority-weights",
    phase: "Judgment, not plumbing",
    tab: "prioritization",
    anchor: "priority-weights",
    headline: "Your risk model, as configuration",
    body: "KEV status, internet exposure, asset criticality, patch availability, CVSS — each with a weight you can change live and re-score against. This is policy, not code.",
    why: "Your definition of urgent is yours. When it changes, a security analyst edits weights; nobody opens a ticket with engineering.",
  },
  {
    id: "priority-table",
    phase: "Judgment, not plumbing",
    tab: "prioritization",
    anchor: "priority-table",
    headline: "Every score shows its work",
    body: "Expand any finding and you get the factor breakdown: how many points came from exposure, from KEV, from criticality, and why. Same input, same score, every time.",
    why: "An auditor asking why this finding outranked that one gets an answer in seconds. Deterministic scoring is what makes the AI step downstream defensible.",
  },
  {
    id: "priority-bands",
    phase: "Judgment, not plumbing",
    tab: "prioritization",
    anchor: "priority-bands",
    headline: "The SLA clock starts here",
    body: "Scores land in bands, and each band carries a remediation window. That due date is what the change ticket inherits and what the chase step measures against.",
    why: "One policy definition drives triage, the ticket, the escalation and the report. Change it in one place and the whole chain follows.",
  },

  {
    id: "remediation",
    phase: "AI where it pays",
    tab: "remediation",
    anchor: "remediation-packages",
    headline: "The part nobody has time to write",
    body: "For a prioritized finding, a model reads the evidence — detected software versions, vendor solution text, asset facts — and produces the fix: required version, exact commands per platform, prerequisites, reboot and service impact, and validation steps. It cites the evidence it used, and says so when the evidence is not enough.",
    why: "This is the hour of an engineer's judgement per ticket that the old process could never scale. AI is one governed step here — deterministic scoring in front of it, a real change record behind it — so it drafts, and your process still decides.",
    action: {
      label: "Generate a package",
      runLabel: "Generate remediation",
      run: () => api.runStage("remediate"),
    },
  },

  {
    id: "tickets",
    phase: "It lands in the system of record",
    tab: "tickets",
    anchor: "tickets-table",
    headline: "It ends in ServiceNow, not in an inbox",
    body: "Change records simulated from ServiceNow: one change per owning team, routed to the right assignment group, carrying the risk score, the SLA due date and the full remediation package in the description. Re-running updates the open change instead of creating a duplicate.",
    why: "Idempotency is the difference between automation and spam. Engineers work in their queue, with their process — the workflow meets them there.",
  },
  {
    id: "tickets-chase",
    phase: "It lands in the system of record",
    tab: "tickets",
    anchor: "tickets-controls",
    headline: "And it keeps working after the ticket is filed",
    body: "Let me push the clock forward to breach some SLAs, then run the chase step. It escalates overdue changes and comments on them — and it remembers who it already chased, so it never nags twice for the same breach.",
    why: "Most tools stop at ticket creation, which is exactly where the backlog reappears. Persistent state across runs is what lets a workflow own follow-up instead of handing it back to a human.",
    action: {
      label: "Fast-forward and chase",
      runLabel: "Chase overdue",
      run: async () => {
        await api.advanceClock(21);
        await api.runChase();
      },
    },
  },

  {
    id: "report",
    phase: "Proof for leadership",
    tab: "report",
    anchor: "report-chart",
    headline: "Opened versus closed, without anyone building a deck",
    body: "Let me seed a few weeks of change history and regenerate. Opened against closed, recurring vulnerability classes, open risk by band and by team — computed from the same records the pipeline wrote.",
    why: "The metric everyone actually wants is whether the backlog is shrinking. Because the workflow owns the whole path, that answer is a byproduct rather than a monthly project.",
    action: {
      label: "Seed history and rebuild",
      runLabel: "Seed history",
      run: async () => {
        await api.seedHistory();
        await api.runReport();
      },
      advanceOnSuccess: true,
    },
  },
  {
    id: "report-overdue",
    phase: "Proof for leadership",
    tab: "report",
    anchor: "report-overdue",
    headline: "The exception list, ranked",
    body: "Every open change past its SLA, worst first, with the owning team. This is the standing agenda for your weekly review — and the same list the chase step is already acting on.",
    why: "Reporting and enforcement come from one source, so what leadership reads and what the workflow does can never disagree.",
  },
  {
    id: "report-source",
    phase: "Proof for leadership",
    tab: "report",
    anchor: "report-source",
    headline: "A report is an artifact, not a page",
    body: "This is the Markdown the scheduled report step writes to stdout. Because it is a step output, it can be linked to any other step — post to Slack, email the CISO, commit it to a repo.",
    why: "Nobody has to visit a dashboard for this to be useful. The workflow delivers the answer to where the decision is made.",
  },

  {
    id: "recap",
    phase: "Close",
    headline: "Three things worth remembering",
    body: "Prioritization became your policy instead of the vendor's severity. Remediation became an engineer-ready package written for every finding, not just the loud ones. And follow-up became something the workflow owns, with a report that proves it.",
    why: "The old process could do any one of those on a good week. None of them survived contact with the volume.",
  },
  {
    id: "platform",
    phase: "Close",
    headline: "And why it holds up in production",
    body: "Real code steps in TypeScript, not boxes on a canvas. Drafts you iterate on, versioned separately from what is live. Pinned step tests that replay recorded inputs so a change cannot silently break scoring or ticketing. Persistent state in named volumes. Credentials in connectors, never in the code.",
    why: "This is a workflow your team can own for years, not a script that works until the person who wrote it leaves.",
  },
  {
    id: "ask",
    phase: "Close",
    headline: "The next step",
    body: "Point this at your Qualys and ServiceNow instances and it is the same workflow — the simulated sources are two steps that swap for your endpoints, and nothing in the pipeline changes. Pick one team's backlog and we can have it running against your data.",
    why: "Start narrow, prove the reduction on one queue, then widen. The workflow does not change; only its scope does.",
  },
];

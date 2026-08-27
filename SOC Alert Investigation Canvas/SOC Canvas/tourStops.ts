import type { Investigation } from "./api";

export type TourView = "launcher" | "run" | "canvas";

export interface TourStop {
  id: string;
  view: TourView;
  chapter: string;
  title: string;
  body: string;
  whichMeans?: string;
  /** One or more selectors; the spotlight covers their union. Missing selectors are ignored. */
  target?: string[];
  placement?: "auto" | "center";
  /** Clicked once when the stop opens, to reveal what the copy talks about. */
  onEnterClick?: string;
  /** The stop's own call to action, driven from the Next button. */
  action?: { selector: string; label: string; hold?: boolean; after?: string };
  /** The stop stays in its waiting state until this is true, so the tour tracks the real run. */
  waitFor?: (data: Investigation | null) => boolean;
  waitLabel?: string;
  /** A live fact drawn from the run, shown under the copy. */
  dynamic?: (data: Investigation | null) => string | null;
  nextLabel?: string;
}

const SOURCES = ["defender", "sentinel", "zscaler", "proofpoint", "threatintel"];

function landed(data: Investigation | null): number {
  return SOURCES.filter((source) => data?.status.sources[source]).length;
}

export const STOPS: TourStop[] = [
  {
    id: "big-picture",
    view: "launcher",
    placement: "center",
    chapter: "Set-up",
    title: "A Defender incident lands at 2:14am.",
    body: "Nobody opens it for forty minutes. When someone finally does, they log into five consoles, copy indicators between them by hand, and write the same paragraph they wrote yesterday. The expensive problem in a SOC is not detection — it is the triage gap after it. Three things to watch: five tools queried at once, a correlated timeline the AI is forced to cite, and the one destructive action that still needs a human.",
    nextLabel: "Show me",
  },
  {
    id: "intake",
    view: "launcher",
    chapter: "Peak 1 of 3 · Intake",
    title: "The real payload, not a tidy example",
    body: "This is an unmodified Microsoft Graph security alert — a nested alerts array, @odata.type evidence objects, MITRE technique IDs, vendor casing and all. One 3B route step accepts it and normalizes it, and that same route reads a Sentinel incident webhook too.",
    whichMeans:
      "No schema-mapping project and no waiting on a vendor to support the shape you actually get. If a tool can POST JSON, it is integrated today.",
    target: ['[data-tour="scenario-endpoint-malware"]'],
    onEnterClick: '[data-tour="raw-endpoint-malware"]',
    action: { selector: '[data-tour="launch-endpoint-malware"]', label: "Fire it at the webhook" },
  },
  {
    id: "parallel",
    view: "run",
    chapter: "Peak 2 of 3 · Parallel enrichment",
    title: "Five tools, one clock",
    body: "Defender, Sentinel, Zscaler, Proofpoint and threat intel are all querying right now. Each is its own process with its own latency, and they land out of order with their own record counts.",
    whichMeans:
      "The investigation costs the time of the slowest tool, not the sum of five. That is the difference between triage that finishes before the analyst wakes up and triage that is still running at shift change.",
    target: ['[data-tour="stage-defender"]', '[data-tour="stage-threatintel"]'],
    waitFor: (data) => landed(data) > 0,
    waitLabel: "waiting for the first source to come back…",
    dynamic: (data) => {
      const count = landed(data);
      if (count === 0) return null;
      return `${count} of 5 sources landed`;
    },
  },
  {
    id: "barrier",
    view: "run",
    chapter: "Peak 2 continued · The barrier",
    title: "The step that knows how to wait",
    body: "All five enrichers link to one merge step, so it runs five times and exits silently every time until the last source file is on the shared volume. Then it emits the merged timeline and everything downstream fires — from a few lines of ordinary code, not a scheduler guess.",
    whichMeans:
      "Correlation is logic you own and can pin a test on, not a drag-and-drop join that quietly breaks when one API is slow. And if a source is genuinely down, retry and build anyway are right here — the analyst is never stuck behind a dead tool.",
    target: ['[data-tour="stage-timeline"]', '[data-tour="force-timeline"]'],
    waitFor: (data) => Boolean(data?.status.timeline),
    waitLabel: "the merge step is running and exiting quiet each time a source lands…",
    dynamic: (data) => {
      if (data?.timeline) return `${data.timeline.eventCount} events merged from ${5 - data.timeline.missingSources.length} sources`;
      return `still waiting on ${5 - landed(data)} of 5 sources`;
    },
  },
  {
    id: "disposition",
    view: "canvas",
    chapter: "Peak 3 of 3 · The disposition",
    title: "Claude reads the correlated story, not one alert",
    body: "The model receives the merged timeline — mail, endpoint, proxy, intel, in order — and returns a disposition, a confidence, an attack narrative and recommended actions in a fixed shape this page renders directly.",
    whichMeans:
      "The judgment is made over evidence that has already been assembled, which is why it reads like an analyst's note instead of a restatement of the alert title.",
    target: ['[data-tour="disposition"]'],
    waitFor: (data) => Boolean(data?.status.summary),
    waitLabel: "Claude is reading the timeline…",
    dynamic: (data) =>
      data?.summary ? `${data.summary.disposition} · ${data.summary.confidence}% confidence · ${data.summary.model}` : null,
  },
  {
    id: "evidence",
    view: "canvas",
    chapter: "Peak 3 continued · Verify it",
    title: "Every claim cites its events",
    body: "The claim highlighted here lit up the exact timeline events behind it. The model was required to return event IDs alongside each statement, so a claim with nothing under it has nowhere to hide.",
    whichMeans:
      "The analyst verifies in seconds instead of trusting a paragraph. That is the line between an AI demo and something a SOC will let near a ticket.",
    target: ['[data-tour="evidence"]'],
    onEnterClick: '[data-tour="evidence-claim"]',
  },
  {
    id: "forensics",
    view: "canvas",
    chapter: "Depth on demand",
    title: "Nothing is hidden behind the summary",
    body: "Forensic captures of the messages Proofpoint actually saw, and directly below them the raw response from every tool, exactly as it came back.",
    whichMeans:
      "The senior analyst who does not trust the summary gets the underlying data without leaving the page or logging into five consoles. Trust comes from being auditable, not from sounding confident.",
    target: ['[data-tour="captures"]', '[data-tour="collected"]'],
    dynamic: (data) => `${data?.screenshots.length ?? 0} captures · ${data?.logs.length ?? 0} logged external calls`,
  },
  {
    id: "containment",
    view: "canvas",
    chapter: "The line 3B will not cross for you",
    title: "Containment stays a human decision",
    body: "Everything up to this point ran unattended. This does not. The isolate step refuses any request that does not carry explicit approval, an approval token this page derived for this investigation, and a device that is genuinely an entity of this incident. If the device is already isolated the panel says so and the record is in the history below.",
    whichMeans:
      "Human-in-the-loop and the audit trail are enforced in code at the step, not promised in a policy document. Approve it and watch the record land.",
    target: ['[data-tour="containment"]', '[data-tour="actions"]'],
    onEnterClick: '[data-tour="isolate-open"]',
    action: {
      selector: '[data-tour="isolate-confirm"]',
      label: "Approve and isolate",
      hold: true,
      after:
        "Defender accepted it, and the action is now in the history with who approved it, when, and the machine action ID. Refuse instead and nothing is sent — the rejected attempt is still written to the log.",
    },
  },
  {
    id: "close",
    view: "canvas",
    placement: "center",
    chapter: "Recap",
    title: "Five tools at once, cited evidence, a gated hand on the switch",
    body: "That is what the analyst got. Here is what produced it: one 3B workflow — HTTP routes for intake and every fetch this page makes, five enrichers running in parallel, a merge step gated on shared volume state, a Claude agent, a ticket sync, and this React app served from the same workflow. Ordinary TypeScript, built in chat, with pinned tests on the intake, entity, barrier and approval logic.",
    whichMeans:
      "Every integration except Claude is mocked and one flag from live, so the shape of the automation is already right — going live is a credential, not a rebuild. Yours starts from the same conversation.",
    nextLabel: "Finish",
  },
];

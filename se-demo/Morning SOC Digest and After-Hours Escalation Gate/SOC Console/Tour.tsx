import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import type { CSSProperties } from "react";
import type { ConsoleState } from "./api";

export type TourTabId = "live" | "inject" | "config" | "audit" | "pages" | "assets" | "digest";

type Snapshot = {
  decisions: number;
  acked: number;
  digestId: number;
  clockMode: string;
  config: string;
  replays: number;
};

function snapshot(state: ConsoleState): Snapshot {
  return {
    decisions: state.decisions.length,
    acked: state.pages.filter((p) => p.status !== "triggered").length,
    digestId: state.digests[0]?.id ?? 0,
    clockMode: state.clockMode,
    config: JSON.stringify(state.config),
    replays: state.decisions.filter((d) => d.replayed).length,
  };
}

type Step = {
  act: number;
  tab?: TourTabId;
  anchor?: string;
  headline: string;
  seeing?: string;
  why?: string;
  action?: string;
  advance?: (now: Snapshot, base: Snapshot) => boolean;
};

const ACTS = [
  "The 2 a.m. problem",
  "The gate is always on",
  "A real threat pages in seconds",
  "Noise never wakes anyone",
  "The business owns the threshold",
  "The brief writes itself",
  "Why 3B",
];

const STEPS: Step[] = [
  {
    act: 0,
    tab: "live",
    anchor: "stats",
    headline: "Overnight, alerts pile up faster than anyone reads them.",
    seeing: "These six counters are the whole overnight shift: what arrived, what woke someone, what waited, what was thrown away.",
    why: "There are only two outcomes today, and both cost you. Either a real intrusion sits untouched until 08:00, or the on-call analyst is woken for a phishing bulk-send. One is risk; the other is attrition.",
  },
  {
    act: 0,
    tab: "live",
    anchor: "timeline",
    headline: "In the next four minutes, that decision stops being a person's job.",
    seeing: "This timeline is the running record. Everything you are about to see appears here as it happens — no rehearsed screenshots.",
    why: "The promise: every overnight alert triaged the moment it lands, only the ones that earn it paging a human, and everything else arriving at 06:00 as one written brief.",
  },
  {
    act: 1,
    tab: "live",
    anchor: "clock-badge",
    headline: "The escalation policy knows what time it is.",
    seeing: "This badge is live. Between 19:00 and 07:00 ET, and all weekend, the gate is armed and scoring. In business hours it stands down and lets the queue work normally.",
    why: "Coverage stops depending on someone remembering the rota.",
  },
  {
    act: 1,
    tab: "live",
    anchor: "clock-modes",
    headline: "Your turn — arm the gate.",
    seeing: "The demo clock overrides ET so you never have to wait until 2 a.m. to see the behaviour.",
    why: "The same override is how you test an escalation policy change before it goes live, instead of finding out overnight.",
    action: "Click “Force after-hours”. The badge turns red and the gate arms.",
    advance: (now) => now.clockMode === "after_hours",
  },
  {
    act: 2,
    tab: "inject",
    anchor: "scenario-critical_asset_ransomware",
    headline: "A real intrusion should wake somebody. Watch how fast.",
    seeing: "This scenario posts a vendor-shaped Defender alert to the same webhook production uses. Nothing about the path is faked — it scores severity, detection confidence, the CMDB tier of the host and business impact.",
    why: "Payment database, confirmed detection, Tier 0 asset. This is the alert you never want sitting in a queue.",
    action: "Click “Send” on this scenario.",
    advance: (now, base) => now.decisions > base.decisions,
  },
  {
    act: 2,
    tab: "live",
    anchor: "timeline",
    headline: "Scored, decided and paged before you finished reading it.",
    seeing: "The gate scored the alert against the live threshold and wrote the decision to the timeline. Seconds, not the next shift.",
    why: "Mean time to a woken analyst is now a function of the automation, not of who is awake.",
  },
  {
    act: 2,
    tab: "pages",
    anchor: "pages-inbox",
    headline: "One incident, one page — with the Slack notice already posted.",
    seeing: "The page carries the score, the on-call name and a dedup key. Related alerts for the same host collapse onto that key instead of firing again. The Slack line underneath is a real message to a real channel.",
    why: "This is the difference between paging and page-storming. The analyst gets woken once, with context.",
  },
  {
    act: 2,
    tab: "pages",
    anchor: "page-actions",
    headline: "Close the loop the way the analyst would.",
    seeing: "Acknowledge writes back to the page record and the timeline, so the audit shows who took it and when.",
    why: "Escalation without acknowledgement is just noise with extra steps.",
    action: "Click “Acknowledge” on the page.",
    advance: (now, base) => now.acked > base.acked,
  },
  {
    act: 3,
    tab: "inject",
    anchor: "scenario-noisy_low_sev_phishing",
    headline: "Now the harder half of the problem: not paging.",
    seeing: "A bulk phishing burst — low severity, low confidence, no critical asset. Exactly the traffic that produces 2 a.m. pages nobody thanks you for.",
    why: "Any tool can escalate. Value comes from what it declines to escalate, at 3 a.m., without asking.",
    action: "Click “Send” on this scenario.",
    advance: (now, base) => now.decisions > base.decisions,
  },
  {
    act: 3,
    tab: "audit",
    anchor: "audit-rows",
    headline: "Every suppression is defensible, line by line.",
    seeing: "Open the newest row. You get each factor, its raw value, its weight, the weighted contribution, the total, the threshold it was measured against and a plain-English reason.",
    why: "This is the artefact that earns the gate its trust. When someone asks why an alert did not page, the answer is on screen — not a guess about a model.",
    action: "Click the top row to expand its score breakdown and raw alert JSON.",
  },
  {
    act: 3,
    tab: "audit",
    anchor: "audit-filters",
    headline: "Filter it the way an auditor would.",
    seeing: "Filter to Suppressed and you have the overnight noise the team never had to look at. Filter to Paged and you have the short list that mattered.",
    why: "You can prove coverage and prove restraint from the same record.",
  },
  {
    act: 4,
    tab: "config",
    anchor: "threshold-sliders",
    headline: "The SOC owns this policy — not a change request.",
    seeing: "Page threshold and suppress floor, read from the workflow's own storage on every single alert. Nothing here is hardcoded in the scoring step.",
    why: "Risk appetite changes during an incident, a launch, or an audit. Changing it should take seconds.",
    action: "Drag the page threshold a few points below the score you just saw.",
  },
  {
    act: 4,
    tab: "config",
    anchor: "config-save",
    headline: "Save it and the next alert obeys it.",
    seeing: "Saving writes the config to the shared volume and records the change on the timeline, so policy edits are auditable too.",
    why: "Tuning becomes a normal operational act instead of a deployment.",
    action: "Click “Save changes”.",
    advance: (now, base) => now.config !== base.config,
  },
  {
    act: 4,
    tab: "config",
    anchor: "config-replay",
    headline: "Do it again — prove the change is real.",
    seeing: "Replay re-scores the newest alert with the saved config and writes a fresh audit row marked as a replay. If the new threshold crosses it, it pages for real.",
    why: "You can rehearse a policy change against actual alerts before trusting it overnight.",
    action: "Click “Replay with current config”.",
    advance: (now, base) => now.replays > base.replays || now.decisions > base.decisions,
  },
  {
    act: 4,
    tab: "assets",
    anchor: "assets-editor",
    headline: "Asset criticality comes from your CMDB, not a hunch.",
    seeing: "This is the CMDB record the score reads, simulated from ServiceNow. Change a host's tier here and the same alert scores differently next time.",
    why: "The gate inherits the business context you already maintain, so “critical” means what your CMDB says it means.",
  },
  {
    act: 5,
    tab: "digest",
    anchor: "deferred-queue",
    headline: "Everything that did not page is still accounted for.",
    seeing: "The deferred queue. Each of these was scored, judged not worth a phone call, and held for the morning — with its score already attached.",
    why: "Nothing is silently dropped. The alternative to paging is not ignoring.",
  },
  {
    act: 5,
    tab: "digest",
    anchor: "run-digest",
    headline: "Do it again — the 06:00 brief, on demand.",
    seeing: "This runs the real scheduled pipeline: pull 14 hours from Sentinel, Defender, ServiceNow, Proofpoint and Zscaler, dedupe and correlate by user, host and indicator, have Claude write one prioritised digest, then send it to Gmail and Slack.",
    why: "The shift starts with a ranked brief and a reason each item matters, instead of an analyst opening five consoles.",
    action: "Click “Run digest now”, then watch the pipeline line up underneath. It takes about a minute.",
    advance: (now, base) => now.digestId > base.digestId,
  },
  {
    act: 5,
    tab: "digest",
    anchor: "digest-view",
    headline: "This is the email that lands at 06:00.",
    seeing: "The rendered HTML that was emailed, plus the plain-text and Slack forms and the run details. Action items first with a one-line “why this matters”, then counts by source, then the auto-closed and suppressed tail.",
    why: "Two analysts, forty minutes of morning triage each, replaced by a brief that is already prioritised — every weekday.",
  },
  {
    act: 6,
    headline: "What you just watched is one 3B project.",
    seeing: "Twelve steps: a webhook, a scheduled collector, a correlator, a Claude writer, Slack and Gmail delivery, an API, and this console — which is itself a step in the same workflow.",
    why: "UI, API, schedule, webhook and agent version and ship together. There is no separate frontend repo, no separate scheduler, no glue service holding it up.",
  },
  {
    act: 6,
    headline: "And it stays correct.",
    seeing: "The scoring step carries pinned tests: a Tier 0 critical that must page, a below-threshold alert that must defer, and a business-hours alert that must not page. They replay on every change, with no network access.",
    why: "The escalation policy is code with a safety net, so tuning it does not mean gambling with the next night.",
  },
  {
    act: 6,
    headline: "The delta: hours of overnight triage and needless pages, removed every night.",
    seeing: "Slack, Gmail and Claude are live connectors; the detection feeds are simulated from Sentinel, Defender, ServiceNow, Proofpoint, Zscaler and PagerDuty — point those at your own tenants and the same flow is production.",
    why: "And it was built conversationally, in this editor, by describing what should happen. That is the shortest path from “we should automate this” to something running tonight.",
  },
];

type Rect = { top: number; left: number; width: number; height: number };

export function Tour({
  state,
  tab,
  setTab,
  onClose,
  onResetDemo,
}: {
  state: ConsoleState;
  tab: TourTabId;
  setTab: (t: TourTabId) => void;
  onClose: () => void;
  onResetDemo: () => void;
}) {
  const [index, setIndex] = useState(() => {
    const saved = Number(sessionStorage.getItem("soc-tour-step"));
    return Number.isInteger(saved) && saved > 0 && saved < STEPS.length ? saved : 0;
  });
  const [rect, setRect] = useState<Rect | null>(null);
  const baseline = useRef<Snapshot>(snapshot(state));
  const step = STEPS[index];

  useEffect(() => {
    sessionStorage.setItem("soc-tour-step", String(index));
  }, [index]);

  useEffect(() => {
    baseline.current = snapshot(state);
    if (step.tab && step.tab !== tab) setTab(step.tab);
    // Re-baselining on state here would defeat the gate, so this depends on the step only.
  }, [index]);

  const measure = useCallback(() => {
    if (!step.anchor) {
      setRect(null);
      return;
    }
    const el = document.querySelector<HTMLElement>(`[data-tour="${step.anchor}"]`);
    if (!el) {
      setRect(null);
      return;
    }
    const r = el.getBoundingClientRect();
    setRect({ top: r.top, left: r.left, width: r.width, height: r.height });
  }, [step.anchor]);

  useLayoutEffect(() => {
    measure();
    const el = step.anchor ? document.querySelector<HTMLElement>(`[data-tour="${step.anchor}"]`) : null;
    if (el) {
      const r = el.getBoundingClientRect();
      if (r.top < 80 || r.bottom > window.innerHeight - 40) el.scrollIntoView({ block: "center", behavior: "smooth" });
    }
    const timer = setInterval(measure, 400);
    window.addEventListener("resize", measure);
    window.addEventListener("scroll", measure, true);
    return () => {
      clearInterval(timer);
      window.removeEventListener("resize", measure);
      window.removeEventListener("scroll", measure, true);
    };
  }, [measure, index, tab]);

  useEffect(() => {
    if (!step.advance) return;
    if (step.advance(snapshot(state), baseline.current)) setIndex((i) => Math.min(i + 1, STEPS.length - 1));
  }, [state, index]);

  const close = () => {
    sessionStorage.removeItem("soc-tour-step");
    onClose();
  };

  const last = index === STEPS.length - 1;
  const gated = Boolean(step.action && step.advance);

  const cardWidth = 380;
  const margin = 16;
  let cardStyle: CSSProperties;
  if (rect) {
    const below = rect.top + rect.height + margin;
    const preferBelow = below + 260 < window.innerHeight;
    const left = Math.min(Math.max(margin, rect.left + rect.width / 2 - cardWidth / 2), window.innerWidth - cardWidth - margin);
    cardStyle = preferBelow
      ? { top: below, left, width: cardWidth }
      : { top: Math.max(margin, rect.top - margin - 260), left, width: cardWidth };
  } else {
    cardStyle = { top: "50%", left: "50%", transform: "translate(-50%, -50%)", width: 520 };
  }

  return (
    <div className="pointer-events-none fixed inset-0 z-[60]">
      {rect ? (
        <>
          <div className="pointer-events-auto absolute inset-x-0 top-0 bg-slate-950/75" style={{ height: Math.max(0, rect.top) }} />
          <div
            className="pointer-events-auto absolute inset-x-0 bottom-0 bg-slate-950/75"
            style={{ top: rect.top + rect.height }}
          />
          <div
            className="pointer-events-auto absolute left-0 bg-slate-950/75"
            style={{ top: rect.top, height: rect.height, width: Math.max(0, rect.left) }}
          />
          <div
            className="pointer-events-auto absolute right-0 bg-slate-950/75"
            style={{ top: rect.top, height: rect.height, left: rect.left + rect.width }}
          />
          <div
            className="pointer-events-none absolute rounded-xl ring-2 ring-sky-400/80"
            style={{ top: rect.top - 4, left: rect.left - 4, width: rect.width + 8, height: rect.height + 8 }}
          />
        </>
      ) : (
        <div className="pointer-events-auto absolute inset-0 bg-slate-950/85" />
      )}

      <div
        className="pointer-events-auto absolute rounded-xl border border-sky-500/40 bg-slate-900 p-4 shadow-2xl shadow-black/60"
        style={cardStyle}
      >
        <div className="flex items-center gap-2 text-[10px] uppercase tracking-wider text-sky-300">
          <span className="rounded bg-sky-500/15 px-1.5 py-0.5 font-semibold">
            Act {step.act} · {ACTS[step.act]}
          </span>
          <span className="ml-auto tabular-nums text-slate-500">
            {index + 1} / {STEPS.length}
          </span>
        </div>

        <p className="mt-2 text-sm font-semibold leading-snug text-slate-50">{step.headline}</p>
        {step.seeing && <p className="mt-2 text-xs leading-relaxed text-slate-300">{step.seeing}</p>}
        {step.why && <p className="mt-2 text-xs italic leading-relaxed text-slate-400">{step.why}</p>}

        {step.action && (
          <p className="mt-3 rounded-lg border border-sky-500/40 bg-sky-500/10 px-3 py-2 text-xs font-medium text-sky-200">
            {step.action}
          </p>
        )}

        {last && (
          <div className="mt-3 flex gap-2">
            <button
              type="button"
              onClick={() => {
                baseline.current = snapshot(state);
                setIndex(0);
              }}
              className="rounded-lg border border-slate-700 bg-slate-800 px-3 py-1.5 text-xs font-medium text-slate-100 hover:bg-slate-700"
            >
              Restart tour
            </button>
            <button
              type="button"
              onClick={() => {
                onResetDemo();
                close();
              }}
              className="rounded-lg border border-rose-500/50 bg-rose-500/10 px-3 py-1.5 text-xs font-medium text-rose-200 hover:bg-rose-500/20"
            >
              Reset demo and exit
            </button>
          </div>
        )}

        <div className="mt-4 flex items-center gap-3 border-t border-slate-800 pt-3">
          <button
            type="button"
            disabled={index === 0}
            onClick={() => setIndex((i) => Math.max(0, i - 1))}
            className="text-xs text-slate-400 transition hover:text-slate-100 disabled:opacity-30"
          >
            Back
          </button>
          {!last && (
            <button
              type="button"
              onClick={() => setIndex((i) => Math.min(STEPS.length - 1, i + 1))}
              className={`rounded-lg border px-3 py-1.5 text-xs font-medium transition ${
                gated
                  ? "border-transparent bg-transparent text-slate-400 hover:text-slate-100"
                  : "border-sky-500/60 bg-sky-500/15 text-sky-200 hover:bg-sky-500/25"
              }`}
            >
              {gated ? "Next anyway" : "Next"}
            </button>
          )}
          <button type="button" onClick={close} className="ml-auto text-xs text-slate-500 transition hover:text-slate-200">
            Exit tour
          </button>
        </div>

        <div className="mt-3 flex gap-1">
          {ACTS.map((name, a) => (
            <div key={name} className="flex-1" title={`Act ${a} · ${name}`}>
              <div className={`h-1 rounded-full ${a < step.act ? "bg-sky-500/60" : a === step.act ? "bg-sky-400" : "bg-slate-800"}`} />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

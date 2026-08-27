import { useCallback, useEffect, useLayoutEffect, useState } from "react";

export type TourTab = "findings" | "history";

type TourStep = {
  target?: string;
  tab?: TourTab;
  title: string;
  body: string;
  soWhat: string;
};

export const TOUR_STEPS: TourStep[] = [
  {
    title: "Patching shouldn't wait on a human's inbox",
    body: "Automox already knows which packages on which devices carry known CVEs. What it can't do is decide. So the list gets exported, pasted into a ticket, assigned, chased — and the fix that took ninety seconds waits nine days.",
    soWhat: "This app closes that gap: a scheduled scan finds the risk, an admin makes one call, and the patch installs. No ticket queue in between.",
  },
  {
    target: "metrics",
    tab: "findings",
    title: "Start with the whole picture",
    body: "Open findings and affected devices, then everything already decided — patched and postponed. One line, current as of the last scan.",
    soWhat: "A single 3B step pulls the org's package catalog, every device's installed packages, and correlates them — here, simulated from Automox. That reconciliation used to be a spreadsheet exercise; now it runs every weekday morning on a cron.",
  },
  {
    target: "filters",
    tab: "findings",
    title: "Get to what matters",
    body: "Search by device or package, filter by status and by severity. Default view is what's still open, because that's the queue.",
    soWhat: "The data behind this is one small read-only step over a shared SQLite volume — so the UI stays instant, and it's the exact same data the Slack alert acts on. One source of truth, two front doors.",
  },
  {
    target: "findings-table",
    tab: "findings",
    title: "One row per real decision",
    body: "Grouped by severity, worst first. Each row is a specific package on a specific device, with its current status and when it was last seen.",
    soWhat: "Because state lives in the workflow's own volume, every finding is a durable record — not a message someone scrolled past in a channel.",
  },
  {
    target: "row-actions",
    tab: "findings",
    title: "The decision point",
    body: "Patch now or Postpone, behind a confirmation. These are the same two choices the buttons in the Slack alert offer.",
    soWhat: "Patch now queues an InstallUpdate in Automox for real. Postpone has Claude write the risk narrative, opens a Tines case, and posts the summary back to Slack. The human keeps the judgment; 3B does all the typing.",
  },
  {
    target: "view-switcher",
    tab: "history",
    title: "Every call is on the record",
    body: "The decision timeline: what was patched, what was postponed, by whom, and whether it came from Slack or from this console.",
    soWhat: "Nobody built an audit log. It's a by-product of routing both decision paths through the same workflow — which is exactly what an auditor asks for and what a channel thread can never give you.",
  },
  {
    target: "history-charts",
    tab: "history",
    title: "Is the risk shrinking or piling up?",
    body: "Findings by severity, and patched versus postponed per day.",
    soWhat: "Postponing is legitimate — but postponing everything is a trend, not a decision. This is the view that answers the question leadership actually asks, without anyone assembling a report.",
  },
  {
    title: "What 3B put behind this screen",
    body: "A scheduled Automox scan, a Slack alert with one-click controls, two decision branches, an AI-written case for deferred risk, a shared state volume, and this space-private app — one workflow, versioned and published together.",
    soWhat: "The automation and the interface over it aren't two projects with two teams. That's the difference: from vulnerability found to patch installed, with a human in exactly one place — the decision.",
  },
];

type Rect = { top: number; left: number; width: number; height: number };

const PAD = 8;

export default function Tour({
  onClose,
  setTab,
}: {
  onClose: () => void;
  setTab: (tab: TourTab) => void;
}) {
  const [index, setIndex] = useState(0);
  const [rect, setRect] = useState<Rect | null>(null);

  const step = TOUR_STEPS[index];
  const last = index === TOUR_STEPS.length - 1;

  useEffect(() => {
    if (step.tab) setTab(step.tab);
  }, [step, setTab]);

  const measure = useCallback(() => {
    if (!step.target) {
      setRect(null);
      return;
    }
    const el = document.querySelector(`[data-tour="${step.target}"]`);
    if (!el) {
      setRect(null);
      return;
    }
    const r = el.getBoundingClientRect();
    setRect({ top: r.top, left: r.left, width: r.width, height: r.height });
  }, [step]);

  useLayoutEffect(() => {
    if (step.target) {
      const el = document.querySelector(`[data-tour="${step.target}"]`);
      el?.scrollIntoView({ block: "center", behavior: "smooth" });
    }
    measure();
    const timer = setTimeout(measure, 420);
    return () => clearTimeout(timer);
  }, [measure, step]);

  useEffect(() => {
    window.addEventListener("resize", measure);
    window.addEventListener("scroll", measure, true);
    return () => {
      window.removeEventListener("resize", measure);
      window.removeEventListener("scroll", measure, true);
    };
  }, [measure]);

  const next = useCallback(() => {
    setIndex((i) => (i === TOUR_STEPS.length - 1 ? i : i + 1));
  }, []);
  const back = useCallback(() => setIndex((i) => Math.max(0, i - 1)), []);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
      else if (e.key === "ArrowRight") next();
      else if (e.key === "ArrowLeft") back();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, next, back]);

  const viewportW = typeof window === "undefined" ? 1200 : window.innerWidth;
  const viewportH = typeof window === "undefined" ? 800 : window.innerHeight;
  const CARD_W = Math.min(416, viewportW - 32);
  const CARD_H = 320;
  const GAP = PAD + 12;

  const clamp = (v: number, min: number, max: number) => Math.max(min, Math.min(v, max));

  let cardStyle: React.CSSProperties;
  if (!rect) {
    cardStyle = {
      top: clamp(viewportH / 2 - CARD_H / 2, 16, viewportH - CARD_H - 16),
      left: clamp(viewportW / 2 - CARD_W / 2, 16, viewportW - CARD_W - 16),
    };
  } else {
    const spaceRight = viewportW - (rect.left + rect.width) - GAP;
    const spaceLeft = rect.left - GAP;
    const spaceBelow = viewportH - (rect.top + rect.height) - GAP;
    const spaceAbove = rect.top - GAP;

    if (spaceRight >= CARD_W + 16) {
      cardStyle = {
        left: rect.left + rect.width + GAP,
        top: clamp(rect.top, 16, Math.max(16, viewportH - CARD_H - 16)),
      };
    } else if (spaceLeft >= CARD_W + 16) {
      cardStyle = {
        left: rect.left - GAP - CARD_W,
        top: clamp(rect.top, 16, Math.max(16, viewportH - CARD_H - 16)),
      };
    } else if (spaceBelow >= spaceAbove) {
      cardStyle = {
        top: rect.top + rect.height + GAP,
        left: clamp(rect.left, 16, Math.max(16, viewportW - CARD_W - 16)),
      };
    } else {
      cardStyle = {
        bottom: viewportH - rect.top + GAP,
        left: clamp(rect.left, 16, Math.max(16, viewportW - CARD_W - 16)),
      };
    }
  }

  return (
    <div
      className="pointer-events-none fixed inset-0 z-40"
      role="dialog"
      aria-label="Guided tour"
    >
      {rect ? (
        <div
          className="pointer-events-none absolute rounded-xl ring-2 ring-sky-400 transition-all duration-300"
          style={{
            top: rect.top - PAD,
            left: rect.left - PAD,
            width: rect.width + PAD * 2,
            height: rect.height + PAD * 2,
            boxShadow: "0 0 0 4px rgba(56, 189, 248, 0.18), 0 0 32px 6px rgba(56, 189, 248, 0.28)",
          }}
        />
      ) : null}

      <div
        className="pointer-events-auto absolute w-[26rem] max-w-[calc(100vw-2rem)] rounded-2xl border border-sky-800/70 bg-slate-900 p-5 shadow-2xl ring-1 ring-slate-950/60 transition-all duration-300"
        style={cardStyle}
      >
        <div className="flex items-center justify-between">
          <span className="text-xs font-medium uppercase tracking-wider text-sky-400">
            {index + 1} of {TOUR_STEPS.length}
          </span>
          <button
            type="button"
            onClick={onClose}
            className="text-xs text-slate-500 transition hover:text-slate-300"
          >
            {last ? "Close" : "Skip tour"}
          </button>
        </div>

        <h2 className="mt-2 text-lg font-semibold leading-snug text-slate-100">{step.title}</h2>
        <p className="mt-2 text-sm leading-relaxed text-slate-400">{step.body}</p>
        <p className="mt-3 rounded-lg border border-sky-900/60 bg-sky-950/40 p-3 text-sm leading-relaxed text-sky-100">
          <span className="font-semibold text-sky-300">So what: </span>
          {step.soWhat}
        </p>

        <div className="mt-4 flex items-center gap-2">
          <div className="flex gap-1.5">
            {TOUR_STEPS.map((s, i) => (
              <button
                key={s.title}
                type="button"
                aria-label={`Go to step ${i + 1}`}
                onClick={() => setIndex(i)}
                className={`h-1.5 w-1.5 rounded-full transition ${i === index ? "bg-sky-400" : "bg-slate-700 hover:bg-slate-600"}`}
              />
            ))}
          </div>
          <div className="ml-auto flex gap-2">
            {index > 0 ? (
              <button
                type="button"
                onClick={back}
                className="rounded-lg border border-slate-700 px-3 py-1.5 text-sm text-slate-300 transition hover:border-slate-500 hover:text-slate-100"
              >
                Back
              </button>
            ) : null}
            {last ? (
              <>
                <button
                  type="button"
                  onClick={() => setIndex(0)}
                  className="rounded-lg border border-slate-700 px-3 py-1.5 text-sm text-slate-300 transition hover:border-slate-500 hover:text-slate-100"
                >
                  Restart tour
                </button>
                <button
                  type="button"
                  onClick={onClose}
                  className="rounded-lg bg-sky-600 px-3 py-1.5 text-sm font-medium text-white transition hover:bg-sky-500"
                >
                  Done
                </button>
              </>
            ) : (
              <button
                type="button"
                onClick={next}
                className="rounded-lg bg-sky-600 px-3 py-1.5 text-sm font-medium text-white transition hover:bg-sky-500"
              >
                Next
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

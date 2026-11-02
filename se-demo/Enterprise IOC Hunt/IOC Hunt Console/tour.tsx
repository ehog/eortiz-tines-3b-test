import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";

export type TourStop = {
  id: string;
  anchor?: string;
  headline: string;
  body: string;
  soWhat: string;
  /** Runs when the stop becomes active — used to drive the form during the launcher tour. */
  onEnter?: (actions: TourActions) => void;
  /** Skips the stop when it returns false, so absent data is never spotlighted empty. */
  available?: (actions: TourActions) => boolean;
  nextLabel?: string;
};

export type TourActions = {
  applySample?: () => void;
  addInvalidLine?: () => void;
  removeInvalidLine?: () => void;
  setForceHits?: () => void;
  hasReport?: boolean;
  hasIncompleteSources?: boolean;
  hasServiceNow?: boolean;
  hasBlockRequest?: boolean;
  hasBlockResults?: boolean;
};

type TourContextValue = {
  start: (tour: TourStop[]) => void;
  register: (actions: TourActions) => void;
};

const TourContext = createContext<TourContextValue | null>(null);

export function useTour() {
  const ctx = useContext(TourContext);
  if (!ctx) throw new Error("useTour must be used inside TourProvider");
  return ctx;
}

type Rect = { top: number; left: number; width: number; height: number };

const PAD = 6;
const CARD_W = 380;
const GAP = 16;
const MARGIN = 12;

function rectOf(el: Element): Rect {
  const r = el.getBoundingClientRect();
  return { top: r.top - PAD, left: r.left - PAD, width: r.width + PAD * 2, height: r.height + PAD * 2 };
}

/** Places the card in free space next to the target — below, above, beside — so it never covers it. */
function placeCard(rect: Rect, cardH: number): { top: number; left: number; width: number } {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const width = Math.min(CARD_W, vw - MARGIN * 2);
  const clampLeft = (l: number) => Math.min(Math.max(MARGIN, l), vw - width - MARGIN);
  const clampTop = (t: number) => Math.min(Math.max(MARGIN, t), vh - cardH - MARGIN);
  const centeredLeft = clampLeft(rect.left + rect.width / 2 - width / 2);
  const bottom = rect.top + rect.height;
  const right = rect.left + rect.width;

  if (bottom + GAP + cardH <= vh - MARGIN) return { top: bottom + GAP, left: centeredLeft, width };
  if (rect.top - GAP - cardH >= MARGIN) return { top: rect.top - GAP - cardH, left: centeredLeft, width };
  if (right + GAP + width <= vw - MARGIN) return { top: clampTop(rect.top), left: right + GAP, width };
  if (rect.left - GAP - width >= MARGIN) return { top: clampTop(rect.top), left: rect.left - GAP - width, width };

  // Nothing clears the target on any side: sit in the roomier half and stay out of its horizontal centre.
  const useLeft = rect.left + rect.width / 2 > vw / 2;
  return {
    top: clampTop(bottom - rect.height / 2 > vh / 2 ? MARGIN : vh - cardH - MARGIN),
    left: useLeft ? MARGIN : vw - width - MARGIN,
    width,
  };
}

export function TourProvider({ children }: { children: React.ReactNode }) {
  const [stops, setStops] = useState<TourStop[] | null>(null);
  const [index, setIndex] = useState(0);
  const [rect, setRect] = useState<Rect | null>(null);
  const [cardH, setCardH] = useState(260);
  const actionsRef = useRef<TourActions>({});
  const cardRef = useRef<HTMLDivElement | null>(null);

  const register = useCallback((actions: TourActions) => {
    actionsRef.current = { ...actionsRef.current, ...actions };
  }, []);

  // Recomputed every render so late-arriving data (report, block request) decides which stops apply.
  const visible = (stops ?? []).filter((s) => !s.available || s.available(actionsRef.current));

  const stop_ = visible[index] ?? null;

  const stopTour = useCallback(() => {
    setStops(null);
    setIndex(0);
    setRect(null);
  }, []);

  const start = useCallback((tour: TourStop[]) => {
    setStops(tour);
    setIndex(0);
  }, []);

  const atEnd = index >= visible.length - 1;

  const next = useCallback(() => {
    if (atEnd) {
      stopTour();
      return;
    }
    setIndex((i) => i + 1);
  }, [atEnd, stopTour]);

  const back = useCallback(() => setIndex((i) => Math.max(0, i - 1)), []);

  useEffect(() => {
    if (!stop_) return;
    stop_.onEnter?.(actionsRef.current);
  }, [stop_]);

  // Anchor tracking: scroll into view, then follow the element through scroll and layout changes.
  useLayoutEffect(() => {
    if (!stop_) return;
    if (!stop_.anchor) {
      setRect(null);
      return;
    }
    let frame = 0;
    const measure = () => {
      const el = document.querySelector(`[data-tour="${stop_.anchor}"]`);
      const nextRect = el ? rectOf(el) : null;
      setRect((prev) => {
        if (prev === nextRect) return prev;
        if (
          prev &&
          nextRect &&
          Math.abs(prev.top - nextRect.top) < 0.5 &&
          Math.abs(prev.left - nextRect.left) < 0.5 &&
          Math.abs(prev.width - nextRect.width) < 0.5 &&
          Math.abs(prev.height - nextRect.height) < 0.5
        ) {
          return prev;
        }
        return nextRect;
      });
    };
    const target = document.querySelector(`[data-tour="${stop_.anchor}"]`);
    // A target taller than the viewport's middle band is aligned to the top so the card has a free side.
    const tall = !!target && target.getBoundingClientRect().height > window.innerHeight * 0.5;
    target?.scrollIntoView({ block: tall ? "start" : "center", behavior: "smooth" });
    measure();
    const loop = () => {
      measure();
      frame = requestAnimationFrame(loop);
    };
    frame = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(frame);
  }, [stop_]);

  // The card's height decides which side of the target it fits on, so it is measured, not assumed.
  useLayoutEffect(() => {
    const el = cardRef.current;
    if (!el) return;
    const apply = () => setCardH((h) => (Math.abs(h - el.offsetHeight) < 1 ? h : el.offsetHeight));
    apply();
    const observer = new ResizeObserver(apply);
    observer.observe(el);
    return () => observer.disconnect();
  }, [stop_]);

  useEffect(() => {
    if (!stop_) return;
    const onKey = (e: KeyboardEvent) => {      if (e.key === "Escape") stopTour();
      else if (e.key === "ArrowRight") next();
      else if (e.key === "ArrowLeft") back();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [stop_, stopTour, next, back]);

  const value = useMemo<TourContextValue>(() => ({ start, register }), [start, register]);

  const cardStyle: React.CSSProperties = rect
    ? placeCard(rect, cardH)
    : { left: "50%", top: "50%", width: Math.min(CARD_W, window.innerWidth - MARGIN * 2), transform: "translate(-50%, -50%)" };

  return (
    <TourContext.Provider value={value}>
      {children}
      {stop_ && (
        <div className="pointer-events-none fixed inset-0 z-50">
          {rect && (
            <div
              className="absolute rounded-xl ring-2 ring-red-500 transition-all duration-200"
              style={{
                top: rect.top,
                left: rect.left,
                width: rect.width,
                height: rect.height,
                boxShadow: "0 0 0 4px rgba(239, 68, 68, 0.22), 0 0 28px 6px rgba(239, 68, 68, 0.35)",
              }}
            />
          )}

          <div
            ref={cardRef}
            style={cardStyle}
            className="pointer-events-auto absolute max-h-[70vh] overflow-y-auto rounded-xl border border-red-500/40 bg-slate-900 p-5 shadow-2xl shadow-black/70 ring-1 ring-inset ring-white/5"
          >
            <div className="flex items-center justify-between gap-3">
              <span className="text-[11px] font-semibold uppercase tracking-widest text-red-400">
                Guided demo · {index + 1} / {visible.length}
              </span>
              <button onClick={stopTour} className="text-xs text-slate-500 transition hover:text-slate-200">
                Skip
              </button>
            </div>

            <h3 className="mt-2 text-base font-semibold leading-snug tracking-tight text-slate-50">{stop_.headline}</h3>
            <p className="mt-2 text-sm leading-relaxed text-slate-300">{stop_.body}</p>
            <p className="mt-3 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm leading-relaxed text-red-100">
              <span className="font-semibold">So what: </span>
              {stop_.soWhat}
            </p>

            <div className="mt-4 flex items-center gap-2">
              <button
                onClick={back}
                disabled={index === 0}
                className="rounded-md border border-slate-700 px-3 py-1.5 text-xs font-medium text-slate-300 transition hover:border-slate-500 hover:text-white disabled:opacity-30"
              >
                Back
              </button>
              <button
                onClick={next}
                className="rounded-md bg-red-600 px-3.5 py-1.5 text-xs font-semibold text-white transition hover:bg-red-500"
              >
                {stop_.nextLabel ?? (atEnd ? "Finish" : "Next")}
              </button>
              <span className="ml-auto text-[11px] text-slate-500">← → to move · Esc to exit</span>
            </div>
          </div>
        </div>
      )}
    </TourContext.Provider>
  );
}

export function TourButton({ tour, label = "Take the tour" }: { tour: TourStop[]; label?: string }) {
  const { start } = useTour();
  return (
    <button
      onClick={() => start(tour)}
      className="inline-flex items-center gap-1.5 rounded-md border border-red-500/50 bg-red-500/10 px-3 py-1.5 text-xs font-semibold text-red-200 transition hover:border-red-400 hover:bg-red-500/20 hover:text-white"
    >
      <span aria-hidden>▶</span>
      {label}
    </button>
  );
}

export const LAUNCHER_TOUR: TourStop[] = [
  {
    id: "outcome",
    headline: "An advisory lands at 4pm. Blocked everywhere by 4:06pm.",
    body:
      "That is the end of this demo, so let's start there. An analyst pastes indicators from an FBI FLASH on one page, four security tools are searched in parallel, a ServiceNow incident is opened with the evidence attached, and a named human approves the block in Slack before anything is enforced.",
    soWhat:
      "The work that normally means four consoles, a spreadsheet, and a ticket someone writes by hand becomes one page and one decision — and the decision is still made by a person.",
  },
  {
    id: "one-step",
    anchor: "shell-brand",
    headline: "This whole console is one step in a 3B workflow.",
    body:
      "No separate frontend repo, no build pipeline, no hosting to buy. The page, the API routes it calls, the searches, the ticket, and the enforcement all live in the same workflow and ship together.",
    soWhat:
      "There is nothing to hand to a platform team before an analyst can use this. One workflow is the app and the automation.",
  },
  {
    id: "indicators",
    anchor: "indicator-input",
    headline: "Paste the indicators exactly as they arrive.",
    body:
      "I've dropped in the five indicators from the advisory — an IP, a domain, a URL, a SHA1 and a SHA256. Each line is typed as you paste, and unusable input is caught before anything is dispatched.",
    soWhat:
      "Analysts stop pre-sorting indicators by type into four different search syntaxes. Mixed input in, correct searches out.",
    onEnter: (a) => a.applySample?.(),
  },
  {
    id: "validation",
    anchor: "indicator-validation",
    headline: "Do you see how bad input fails here, not three systems later?",
    body:
      "I just added a junk line. The console flags it immediately, and the Submit hunt step validates again server-side — the browser is a convenience, never the gatekeeper.",
    soWhat:
      "A malformed indicator can't quietly become an empty search that looks clean. \"No results\" always means no results.",
    onEnter: (a) => a.addInvalidLine?.(),
  },
  {
    id: "reason",
    anchor: "reason-input",
    headline: "Every hunt carries why it happened.",
    body:
      "The advisory reference is stored on the hunt record and flows straight through to the ServiceNow incident and the Slack approval message.",
    soWhat:
      "When an auditor asks why an IP was blocked in March, the answer is already attached to the record. Nobody reconstructs it from memory.",
    onEnter: (a) => a.removeInvalidLine?.(),
  },
  {
    id: "modes",
    anchor: "demo-modes",
    headline: "This is a real branching workflow, not a scripted click-through.",
    body:
      "These modes change what the simulated sources return: everything hits, everything is clean, or one tool fails outright. I'm selecting force-hits so we get a full report — but the clean and error paths are live, and you can run them yourself in a moment.",
    soWhat:
      "You are about to see the same code handle the good day and the bad day. That is the difference between a demo and a system.",
    onEnter: (a) => a.setForceHits?.(),
  },
  {
    id: "fanout",
    anchor: "submit-row",
    headline: "Five indicators, four tools — twenty searches, all at once.",
    body:
      "Each search tool is its own isolated step, so 3B runs them in parallel rather than queueing them. The hunt takes as long as the slowest tool, not the sum of all four.",
    soWhat:
      "Add a fifth tool next quarter and the hunt does not get slower. You add one step and one link.",
  },
  {
    id: "history",
    anchor: "recent-hunts",
    headline: "Hunt history, with no database to operate.",
    body:
      "Every hunt, indicator, per-source result and approval is persisted in a named volume that the workflow owns. No RDS instance, no schema migration ticket, no connection string in a config file.",
    soWhat:
      "State that survives restarts is table stakes for security work — and here it costs you zero infrastructure.",
  },
  {
    id: "simulated-to-live",
    anchor: "source-banner",
    headline: "Results here are simulated from Defender, Sentinel, Proofpoint and Zscaler. Going live touches one step.",
    body:
      "Search Defender simulates Defender's response shape today. To point it at the real thing you attach the Defender connector to that step and swap the simulated response for the API call. The report, the ServiceNow record and the approval logic never change — and no key, token or secret ever appears in the code.",
    soWhat:
      "You can prove the process works with your own stakeholders before anyone files a request for production API credentials.",
  },
  {
    id: "handoff",
    anchor: "submit-row",
    headline: "Your turn — click Hunt.",
    body:
      "The form is loaded and set to force-hits. Click the red Hunt button and you'll land on the live report page, where a second tour walks through what the workflow does with the results.",
    soWhat:
      "From advisory to enforced block, with a human in the loop and a full audit trail — that's the whole loop, in one workflow you could have built this afternoon.",
    nextLabel: "Done",
  },
];

export const REPORT_TOUR: TourStop[] = [
  {
    id: "verdict",
    anchor: "verdict-banner",
    headline: "The answer the analyst actually needed, in one line.",
    body:
      "Found or clean, how many of the submitted indicators matched, and how many events across the estate. Not a raw result dump to interpret — a verdict.",
    soWhat:
      "The first thing on the page answers the question that was asked. Everything below it is the evidence for that answer.",
  },
  {
    id: "live",
    anchor: "report-controls",
    headline: "Nobody refreshes this page.",
    body:
      "The console polls a read-only report route as the searches land, so the page fills in live and keeps updating through the ticket and the approval. That's an ordinary route step — no websocket service, no queue, no realtime vendor.",
    soWhat:
      "A shareable link that is always current replaces the \"any update?\" Slack thread during an active hunt.",
  },
  {
    id: "sources",
    anchor: "source-tiles",
    headline: "Four tools, four independent processes.",
    body:
      "Each tile is a separate 3B step with its own timeout and its own credentials. One tool being slow — or down — does not hold up or sink the other three.",
    soWhat:
      "Coverage stops depending on your least reliable vendor. You always get the three answers you can get.",
  },
  {
    id: "partial",
    anchor: "partial-banner",
    headline: "When a tool fails, the report says so out loud.",
    body:
      "The failing source is recorded as incomplete and surfaced here and on every affected indicator, instead of being folded silently into \"no matches\".",
    soWhat:
      "This is the difference between an automation you can trust and one you have to double-check. A gap is reported as a gap.",
    available: (a) => !!a.hasIncompleteSources,
  },
  {
    id: "indicator",
    anchor: "indicator-cards",
    headline: "One indicator, correlated across four vendors.",
    body:
      "Which tools matched, first seen, last seen, and total event count — assembled from four different response shapes into one row a human can read.",
    soWhat:
      "The correlation that an analyst does by hand in a spreadsheet, with four browser tabs open, is done before they ever look at it.",
  },
  {
    id: "evidence",
    anchor: "indicator-cards",
    headline: "The evidence, normalized.",
    body:
      "Open an indicator and the tabs hold devices, users, email messages, network connections, proxy activity and alerts — every vendor's records mapped into common tables.",
    soWhat:
      "Scope questions get answered on this page: which endpoints, which users, when. No pivoting into four consoles to find out.",
  },
  {
    id: "fanin",
    anchor: "servicenow-card",
    headline: "The report only exists once all four tools have reported.",
    body:
      "Combine report is a fan-in step: it runs when each source lands and does nothing until the last one has. No fixed wait, no sleep, no polling loop you have to tune.",
    soWhat:
      "The incident is never opened on a half-finished picture — and you never pay for a conservative timer that makes every hunt slow.",
  },
  {
    id: "servicenow",
    anchor: "servicenow-card",
    headline: "The ticket writes itself, with the evidence attached.",
    body:
      "A ServiceNow incident is opened automatically and the full findings JSON is attached to it, referenced back to the advisory the analyst pasted in.",
    soWhat:
      "The documentation step that gets skipped when the day is busy is the step that can no longer be skipped.",
    available: (a) => !!a.hasServiceNow,
  },
  {
    id: "approval",
    anchor: "block-card",
    headline: "The machine gathered the evidence. A person decides to block.",
    body:
      "A Slack message went to the SOC channel with the proposed Zscaler and Defender actions and Approve / Deny links. Those links are space-authenticated routes, so 3B tells the workflow who clicked — the approver's identity comes from the platform, not from trusting a URL.",
    soWhat:
      "This is how you automate an action with real blast radius: full automation up to the decision, a named human on the decision, and no shared link anyone could forward.",
    available: (a) => !!a.hasBlockRequest,
  },
  {
    id: "enforcement",
    anchor: "block-card",
    headline: "Approve, and enforcement lands back on this same page.",
    body:
      "On approval the block is submitted to Zscaler and Defender and each result — system, action, indicator, reference — is written back here next to the request that authorized it.",
    soWhat:
      "Request, approver, and enforcement reference sit in one record. That is the audit trail, produced as a side effect of doing the work.",
    available: (a) => !!a.hasBlockRequest,
  },
  {
    id: "now-what",
    headline: "Now what?",
    body:
      "Eleven steps, one page, four integrations, a ticket and a human approval gate — built and iterated in a draft branch, with pinned step tests covering the hits, clean, partial-failure and bad-input paths, then published in one click. Bring your own advisory and your own tools, and this is an afternoon.",
    soWhat:
      "3B is where the automation, the interface and the state live in one place — so the thing your team actually needs ships this week instead of entering a roadmap.",
    nextLabel: "Finish",
  },
];

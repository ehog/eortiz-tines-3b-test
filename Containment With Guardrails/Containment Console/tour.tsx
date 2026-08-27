import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";

export interface TourContext {
  runWithPreset: (presetId: string) => Promise<void>;
  resumeWithChaosOff: () => Promise<void>;
  runFinished: () => boolean;
  canResume: () => boolean;
}

export interface TourStep {
  id: string;
  chapter: "menu" | "setup" | "peak" | "show" | "recap";
  peakLabel?: string;
  heading: string;
  /** What you are about to see. */
  tell: string;
  /** The exact thing on screen to look at. */
  show: string;
  meansSoc: string;
  meansExec: string;
  platform: string;
  target?: string;
  /** Stops with no anchor on screen are skipped rather than spotlighting nothing. */
  requires?: (ctx: TourContext) => boolean;
  agenda?: string[];
  proofs?: { label: string; detail: string }[];
  cliffhanger?: string;
  reveal?: string;
  action?: {
    label: string;
    pendingLabel: string;
    run: (ctx: TourContext) => Promise<void>;
    waitFor: (ctx: TourContext) => boolean;
    waitingLabel: string;
  };
}

export const TOUR_STEPS: TourStep[] = [
  {
    id: "menu",
    chapter: "menu",
    heading: "Automation your analysts actually trust",
    tell: "Most teams will not automate containment, and the reason is not the integration work — it is the fear that automation gets halfway and stops without telling anyone.",
    show: "In the next few minutes this console will prove three things, on real runs, with the vendor APIs failing on purpose.",
    meansSoc: "Analysts stop babysitting the automation and re-checking its work by hand.",
    meansExec: "Containment coverage you can extend without adding risk.",
    platform: "One 3B workflow: a console, five containment stages, a resume path and an alert.",
    target: '[data-tour="header"]',
    agenda: [
      "A vendor API throws a 500 — and containment still completes.",
      "A request is permanently rejected — and the endpoint is never left half-contained.",
      "The run is resumed — and nothing that already happened happens twice.",
    ],
  },
  {
    id: "alert",
    chapter: "setup",
    heading: "The alert an analyst gets handed",
    tell: "A Proofpoint alert on a finance workstation: enrich it, raise the incident, isolate the device.",
    show: "Alert ID, endpoint, user and severity — the whole input to the automation.",
    meansSoc: "The same four fields the analyst already has in front of them.",
    meansExec: "No new data entry, so nothing new to get wrong.",
    platform: "The console posts these to a route step that validates them before any run exists.",
    target: '[data-tour="launch"]',
  },
  {
    id: "chaos",
    chapter: "setup",
    heading: "We are going to break the vendor APIs on purpose",
    tell: "Any demo works when everything works. These toggles force each vendor to fail, either N times then recover or forever.",
    show: "Five failure modes — a 500, a timeout, a throttle, a permanent rejection and a failed isolation.",
    meansSoc: "You get to see the bad day, not the brochure day.",
    meansExec: "Failure behavior is demonstrable before go-live, not discovered during an incident.",
    platform: "Built in 3B: the four vendor APIs are simulated inside the workflow, so the deadlines, retries and Retry-After headers you are about to see are real HTTP, not animation.",
    target: '[data-tour="chaos"]',
  },
  {
    id: "peak-transient",
    chapter: "peak",
    peakLabel: "Proof 1",
    heading: "A 500 should be a non-event",
    tell: "Proofpoint will reject the first two calls with a 500, and Defender will throttle once with a 429.",
    show: "Watch the amber Retrying chip and the “backing off 2.0s before next attempt” line — then the run finishes contained anyway.",
    meansSoc: "Nobody gets paged because a vendor had a bad second.",
    meansExec: "Fewer alerts abandoned to vendor flakiness, which is where containment coverage quietly leaks.",
    platform: "Each stage carries its own deadline and retry budget with exponential backoff plus jitter, honoring Retry-After when it is longer.",
    target: '[data-tour="timeline"]',
    action: {
      label: "Run it with Transient recovery",
      pendingLabel: "Starting…",
      run: (ctx) => ctx.runWithPreset("recovery"),
      waitFor: (ctx) => ctx.runFinished(),
      waitingLabel: "Watching the run finish…",
    },
  },
  {
    id: "replay",
    chapter: "show",
    heading: "Every run is re-watchable",
    tell: "The timeline you just watched is not live UI state — it is a replay of what was recorded while the run executed.",
    show: "Press Play, or drop it to 1x. The retries and backoff gaps are the real recorded timings.",
    meansSoc: "In review you re-watch what actually happened instead of arguing about it.",
    meansExec: "Incident reconstruction months later costs a click.",
    platform: "The console rebuilds stage state from a durable attempt log, one row per attempt.",
    target: '[data-tour="replay"]',
  },
  {
    id: "peak-guardrail",
    chapter: "peak",
    peakLabel: "Proof 2",
    heading: "The failure everyone is actually afraid of",
    tell: "This time ServiceNow rejects the incident with a 400 — permanent, no amount of retrying will fix it.",
    show: "Watch the ticket fail with class=permanent and zero retries, then look at the Isolate endpoint card.",
    cliffhanger: "So what should the automation do — isolate the endpoint anyway with no ticket to track it, or stop?",
    reveal: "It stops, and it tells a human. Isolation is only ever attempted once an incident exists to record it, so the run ends blocked with nothing half-done — and an alert goes to the analyst with a resume link.",
    meansSoc: "No endpoint is ever left isolated with no ticket, and no ticket left open with no isolation.",
    meansExec: "The failure mode is a notification, not a partial state somebody discovers next week.",
    platform: "A guardrail between the two side-effecting stages, plus a linked alert step — refusing to act is a recorded outcome, not a crash.",
    target: '[data-tour="timeline"]',
    action: {
      label: "Run it with Permanent reject",
      pendingLabel: "Starting…",
      run: (ctx) => ctx.runWithPreset("permanent"),
      waitFor: (ctx) => ctx.runFinished(),
      waitingLabel: "Watching the run stop itself…",
    },
  },
  {
    id: "state",
    chapter: "show",
    heading: "The system answers the question for you",
    tell: "After any failure the first two questions are always: is this thing contained, and is it safe to try again?",
    show: "“Contained: no” and “Safe to retry: yes” — stated by the run itself, alongside the exact ticket and isolation state.",
    meansSoc: "The analyst does not have to go and check four consoles to find out what got done.",
    meansExec: "One place with the authoritative answer, which is what an auditor asks for.",
    platform: "Run and stage state is committed to a durable SQLite volume as each stage completes — writers exclusive, the read API read-only.",
    target: '[data-tour="state"]',
  },
  {
    id: "peak-resume",
    chapter: "peak",
    peakLabel: "Proof 3",
    heading: "Retrying costs nothing",
    tell: "Now resume the run with the failure cleared. It restarts at the stage that failed, not at the beginning.",
    show: "Look for the “Skipped — already done” chips on the enrichment stages, and the idempotency key on the isolation card.",
    meansSoc: "No duplicate incidents, no duplicate isolation calls, no cleanup afterwards.",
    meansExec: "Safe retry is the thing that usually blocks automating containment at all — this removes the objection.",
    platform: "Each stage commits its outcome before the next begins, and every side effect carries an idempotency key derived from the run.",
    target: '[data-tour="resume"]',
    requires: (ctx) => ctx.canResume(),
    action: {
      label: "Resume with chaos off",
      pendingLabel: "Resuming…",
      run: (ctx) => ctx.resumeWithChaosOff(),
      waitFor: (ctx) => ctx.runFinished(),
      waitingLabel: "Watching the resume skip completed work…",
    },
  },
  {
    id: "recap",
    chapter: "recap",
    heading: "Every attempt is on the record",
    tell: "One structured line per attempt, and one audit row per action attempted — including the actions that were refused.",
    show: "Open any audit row: actor, stage, idempotency key, classification and the full detail.",
    meansSoc: "The write-up is already written by the time the analyst looks at it.",
    meansExec: "Defensible without reconstructing anything after the fact.",
    platform: "Built in 3B: one workflow, seven steps, durable volume state and pinned tests on the read path and input guards. Reset demo clears everything for the next run-through.",
    target: '[data-tour="audit"]',
    proofs: [
      { label: "A 500 was a non-event", detail: "retried with backoff, contained anyway" },
      { label: "A permanent rejection stopped cleanly", detail: "nothing half-contained, a human alerted" },
      { label: "The resume repeated nothing", detail: "completed stages skipped, side effects keyed" },
    ],
  },
];

const CHAPTER_LABEL: Record<TourStep["chapter"], string> = {
  menu: "Agenda",
  setup: "Setup",
  peak: "Proof",
  show: "On screen",
  recap: "Recap",
};

type Rect = { top: number; left: number; width: number; height: number };

function measure(selector: string | undefined): Rect | null {
  if (!selector) return null;
  const node = document.querySelector(selector);
  if (!node) return null;
  const box = node.getBoundingClientRect();
  if (box.width === 0 && box.height === 0) return null;
  return { top: box.top, left: box.left, width: box.width, height: box.height };
}

const CARD_WIDTH = 420;
const GAP = 16;
const HALO = 8;

/** Places the card in the largest free band around the target so the target stays visible. */
function cardPosition(rect: Rect | null, cardH: number): { top: number; left: number } {
  const viewportH = window.innerHeight;
  const viewportW = window.innerWidth;
  const clampTop = (value: number) => Math.min(Math.max(GAP, value), Math.max(GAP, viewportH - cardH - GAP));
  const clampLeft = (value: number) => Math.min(Math.max(GAP, value), Math.max(GAP, viewportW - CARD_WIDTH - GAP));

  if (!rect) return { top: clampTop((viewportH - cardH) / 2), left: clampLeft((viewportW - CARD_WIDTH) / 2) };

  const box = {
    top: rect.top - HALO,
    left: rect.left - HALO,
    right: rect.left + rect.width + HALO,
    bottom: rect.top + rect.height + HALO,
  };
  const space = {
    right: viewportW - box.right - GAP * 2,
    left: box.left - GAP * 2,
    below: viewportH - box.bottom - GAP * 2,
    above: box.top - GAP * 2,
  };

  if (space.right >= CARD_WIDTH) {
    return { top: clampTop(rect.top + rect.height / 2 - cardH / 2), left: clampLeft(box.right + GAP) };
  }
  if (space.left >= CARD_WIDTH) {
    return { top: clampTop(rect.top + rect.height / 2 - cardH / 2), left: clampLeft(box.left - GAP - CARD_WIDTH) };
  }
  if (space.below >= cardH) {
    return { top: clampTop(box.bottom + GAP), left: clampLeft(rect.left) };
  }
  if (space.above >= cardH) {
    return { top: clampTop(box.top - GAP - cardH), left: clampLeft(rect.left) };
  }
  // Nothing fits cleanly: sit in the widest side band, hugging the viewport edge.
  return space.right >= space.left
    ? { top: clampTop(GAP), left: Math.max(GAP, viewportW - CARD_WIDTH - GAP) }
    : { top: clampTop(GAP), left: GAP };
}

export function TourOverlay({ ctx, onClose }: { ctx: TourContext; onClose: () => void }) {
  const [index, setIndex] = useState(0);
  const [rect, setRect] = useState<Rect | null>(null);
  const [pending, setPending] = useState(false);
  const [waiting, setWaiting] = useState(false);
  const [done, setDone] = useState<Record<string, boolean>>({});
  const [actionError, setActionError] = useState<string | null>(null);
  const [cardH, setCardH] = useState(360);
  const cardRef = useRef<HTMLDivElement>(null);

  const ctxRef = useRef(ctx);
  ctxRef.current = ctx;

  const visible = TOUR_STEPS.filter((step) => !step.requires || step.requires(ctx) || done[step.id]);
  const clamped = Math.min(index, visible.length - 1);
  const step = visible[clamped];
  const revealed = Boolean(step.reveal && done[step.id]);

  const go = useCallback(
    (delta: number) => {
      setActionError(null);
      setIndex((current) => {
        const next = current + delta;
        if (next < 0) return 0;
        if (next > visible.length - 1) return visible.length - 1;
        return next;
      });
    },
    [visible.length],
  );

  useLayoutEffect(() => {
    const update = () =>
      setRect((current) => {
        const next = measure(step.target);
        if (!next || !current) return next;
        const same =
          Math.abs(next.top - current.top) < 0.5 &&
          Math.abs(next.left - current.left) < 0.5 &&
          Math.abs(next.width - current.width) < 0.5 &&
          Math.abs(next.height - current.height) < 0.5;
        return same ? current : next;
      });
    const node = step.target ? document.querySelector(step.target) : null;
    node?.scrollIntoView({ behavior: "smooth", block: "center" });
    update();
    const timer = setInterval(update, 250);
    window.addEventListener("resize", update);
    window.addEventListener("scroll", update, true);
    return () => {
      clearInterval(timer);
      window.removeEventListener("resize", update);
      window.removeEventListener("scroll", update, true);
    };
  }, [step.id, step.target]);

  useEffect(() => {
    cardRef.current?.focus();
  }, [step.id]);

  useLayoutEffect(() => {
    const node = cardRef.current;
    if (!node) return;
    const observer = new ResizeObserver(() => setCardH(node.offsetHeight));
    observer.observe(node);
    setCardH(node.offsetHeight);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
      } else if (event.key === "ArrowRight") {
        go(1);
      } else if (event.key === "ArrowLeft") {
        go(-1);
      } else if (event.key === "Tab") {
        const focusable = cardRef.current?.querySelectorAll<HTMLElement>("button, select, [href]");
        if (!focusable || focusable.length === 0) return;
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first.focus();
        }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [go, onClose]);

  // After an action fires, hold on this stop until the run it started has finished.
  useEffect(() => {
    if (!waiting || !step.action) return;
    const timer = setInterval(() => {
      if (step.action!.waitFor(ctxRef.current)) {
        setWaiting(false);
        setDone((current) => ({ ...current, [step.id]: true }));
      }
    }, 600);
    return () => clearInterval(timer);
  }, [waiting, step]);

  const onAction = async () => {
    if (!step.action) return;
    setPending(true);
    setActionError(null);
    try {
      await step.action.run(ctxRef.current);
      setWaiting(true);
    } catch (error) {
      setActionError((error as Error).message);
    } finally {
      setPending(false);
    }
  };

  const position = cardPosition(rect, cardH);
  const peaks = visible.filter((entry) => entry.chapter === "peak");
  const peakIndex = step.chapter === "peak" ? peaks.findIndex((entry) => entry.id === step.id) : -1;
  const busy = pending || waiting;

  return (
    <div className="pointer-events-none fixed inset-0 z-50">
      {rect ? (
        <div
          className="absolute rounded-xl ring-2 ring-sky-400 shadow-[0_0_0_4px_rgba(56,189,248,0.18),0_0_28px_6px_rgba(56,189,248,0.28)] transition-all duration-200"
          style={{ top: rect.top - HALO, left: rect.left - HALO, width: rect.width + HALO * 2, height: rect.height + HALO * 2 }}
        />
      ) : null}

      <div
        ref={cardRef}
        role="dialog"
        aria-labelledby="tour-heading"
        tabIndex={-1}
        className="pointer-events-auto absolute w-[420px] max-w-[calc(100vw-2rem)] overflow-hidden rounded-xl border border-sky-500/40 bg-slate-900 shadow-2xl shadow-sky-950/60 outline-none"
        style={{ top: position.top, left: position.left }}
      >
        <div className="flex items-center justify-between border-b border-slate-800 px-4 py-2.5">
          <div className="flex items-center gap-2 text-[11px] uppercase tracking-wider">
            <span className="rounded bg-sky-500/15 px-1.5 py-0.5 font-semibold text-sky-300">
              {step.peakLabel ?? CHAPTER_LABEL[step.chapter]}
            </span>
            <span className="text-slate-500">
              {clamped + 1} of {visible.length}
            </span>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-[11px] text-slate-500 transition hover:text-slate-300"
          >
            Skip tour
          </button>
        </div>

        <div className="flex gap-1 px-4 pt-3">
          {peaks.map((entry, entryIndex) => (
            <span
              key={entry.id}
              className={`h-1 flex-1 rounded-full ${
                entryIndex < peakIndex || done[entry.id] ? "bg-emerald-400" : entryIndex === peakIndex ? "bg-sky-400" : "bg-slate-800"
              }`}
            />
          ))}
        </div>

        <div className="max-h-[52vh] overflow-auto px-4 py-3">
          <h2 id="tour-heading" className="text-sm font-semibold text-slate-100">
            {step.heading}
          </h2>
          <p className="mt-2 text-[12px] leading-snug text-slate-300">{step.tell}</p>

          {step.agenda ? (
            <ol className="mt-3 space-y-1.5">
              {step.agenda.map((item, itemIndex) => (
                <li key={item} className="flex gap-2 text-[12px] leading-snug text-slate-200">
                  <span className="mt-[1px] shrink-0 rounded bg-slate-800 px-1.5 text-[10px] font-semibold text-sky-300">
                    {itemIndex + 1}
                  </span>
                  {item}
                </li>
              ))}
            </ol>
          ) : null}

          {step.proofs ? (
            <ul className="mt-3 space-y-1.5">
              {step.proofs.map((proof) => (
                <li key={proof.label} className="flex gap-2 text-[12px] leading-snug">
                  <span className="mt-[1px] shrink-0 text-emerald-400">✓</span>
                  <span>
                    <span className="text-slate-100">{proof.label}</span>
                    <span className="text-slate-500"> — {proof.detail}</span>
                  </span>
                </li>
              ))}
            </ul>
          ) : null}

          <div className="mt-3 rounded-lg border border-slate-800 bg-slate-950/60 px-3 py-2">
            <div className="text-[10px] font-semibold uppercase tracking-wider text-sky-400/80">Look here</div>
            <p className="mt-1 text-[12px] leading-snug text-slate-200">{step.show}</p>
          </div>

          {step.cliffhanger && !revealed ? (
            <div className="mt-3 rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-[12px] leading-snug text-amber-100">
              {step.cliffhanger}
            </div>
          ) : null}

          {revealed && step.reveal ? (
            <div className="mt-3 rounded-lg border border-emerald-500/40 bg-emerald-500/10 px-3 py-2 text-[12px] leading-snug text-emerald-100">
              {step.reveal}
            </div>
          ) : null}

          <div className="mt-3 rounded-lg border border-slate-800 px-3 py-2">
            <div className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">Which means…</div>
            <p className="mt-1 text-[12px] leading-snug text-slate-200">{step.meansSoc}</p>
            <p className="mt-1 text-[12px] leading-snug text-slate-400">For the business: {step.meansExec}</p>
          </div>

          <p className="mt-3 text-[11px] leading-snug text-slate-500">{step.platform}</p>

          {actionError ? (
            <p className="mt-3 rounded-lg border border-rose-500/40 bg-rose-500/10 px-3 py-2 text-[11px] text-rose-100">
              {actionError}
            </p>
          ) : null}
        </div>

        <div className="flex items-center justify-between gap-2 border-t border-slate-800 px-4 py-3">
          <button
            type="button"
            onClick={() => go(-1)}
            disabled={clamped === 0}
            className="rounded-md border border-slate-700 px-3 py-1.5 text-xs text-slate-300 transition hover:border-slate-500 disabled:opacity-30"
          >
            Back
          </button>
          <div className="flex items-center gap-2">
            {step.action ? (
              <button
                type="button"
                onClick={() => void onAction()}
                disabled={busy}
                className="rounded-md bg-sky-500 px-3 py-1.5 text-xs font-semibold text-slate-950 transition hover:bg-sky-400 disabled:opacity-50"
              >
                {pending ? step.action.pendingLabel : waiting ? step.action.waitingLabel : done[step.id] ? "Run it again" : step.action.label}
              </button>
            ) : null}
            {clamped === visible.length - 1 ? (
              <button
                type="button"
                onClick={onClose}
                className="rounded-md bg-emerald-500 px-3 py-1.5 text-xs font-semibold text-slate-950 transition hover:bg-emerald-400"
              >
                Finish
              </button>
            ) : (
              <button
                type="button"
                onClick={() => go(1)}
                className="rounded-md border border-sky-500/50 px-3 py-1.5 text-xs font-semibold text-sky-200 transition hover:border-sky-400"
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

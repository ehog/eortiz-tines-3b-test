import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { fetchInvestigation, type Investigation } from "./api";
import { STOPS, type TourStop } from "./tourStops";
import { Spinner } from "./ui";

const STORAGE_KEY = "soc-canvas-tour";

interface TourState {
  active: boolean;
  index: number;
  investigationId: string | null;
}

interface TourApi extends TourState {
  start: () => void;
  exit: () => void;
  setIndex: (index: number) => void;
  setInvestigationId: (id: string) => void;
}

const TourContext = createContext<TourApi | null>(null);

export function useTour(): TourApi {
  const api = useContext(TourContext);
  if (!api) throw new Error("useTour used outside TourProvider");
  return api;
}

function readStored(): TourState {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return { active: false, index: 0, investigationId: null };
    const parsed = JSON.parse(raw) as Partial<TourState>;
    return {
      active: Boolean(parsed.active),
      index: typeof parsed.index === "number" && parsed.index >= 0 && parsed.index < STOPS.length ? parsed.index : 0,
      investigationId: typeof parsed.investigationId === "string" ? parsed.investigationId : null,
    };
  } catch {
    return { active: false, index: 0, investigationId: null };
  }
}

export function TourProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<TourState>(readStored);

  useEffect(() => {
    try {
      sessionStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch {
      /* a private-mode session without storage still runs the tour, it just will not resume */
    }
  }, [state]);

  const api = useMemo<TourApi>(
    () => ({
      ...state,
      start: () => setState({ active: true, index: 0, investigationId: null }),
      exit: () => setState((current) => ({ ...current, active: false, index: 0 })),
      setIndex: (index) => setState((current) => ({ ...current, index })),
      setInvestigationId: (investigationId) =>
        setState((current) => (current.investigationId === investigationId ? current : { ...current, investigationId })),
    }),
    [state],
  );

  return <TourContext.Provider value={api}>{children}</TourContext.Provider>;
}

function unionRect(selectors: string[]): DOMRect | null {
  let top = Infinity;
  let left = Infinity;
  let right = -Infinity;
  let bottom = -Infinity;
  let found = false;
  for (const selector of selectors) {
    for (const node of document.querySelectorAll(selector)) {
      const rect = node.getBoundingClientRect();
      if (rect.width === 0 && rect.height === 0) continue;
      found = true;
      top = Math.min(top, rect.top);
      left = Math.min(left, rect.left);
      right = Math.max(right, rect.right);
      bottom = Math.max(bottom, rect.bottom);
    }
  }
  if (!found) return null;
  return new DOMRect(left, top, right - left, bottom - top);
}

const EDGE = 16;
const GAP = 18;

/** Picks the side of the highlighted element with room for the card, so the card never covers it. */
function placeCard(rect: DOMRect, cardWidth: number, cardHeight: number): CSSProperties {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const candidates = [
    { side: "below", room: vh - rect.bottom - GAP - EDGE, need: cardHeight },
    { side: "right", room: vw - rect.right - GAP - EDGE, need: cardWidth },
    { side: "above", room: rect.top - GAP - EDGE, need: cardHeight },
    { side: "left", room: rect.left - GAP - EDGE, need: cardWidth },
  ];
  const fits = candidates.filter((candidate) => candidate.room >= candidate.need);
  const chosen = fits.length > 0 ? fits[0] : candidates.reduce((a, b) => (b.room - b.need > a.room - a.need ? b : a));

  const clamp = (value: number, size: number, limit: number) =>
    Math.max(EDGE, Math.min(value, Math.max(EDGE, limit - size - EDGE)));

  if (chosen.side === "below" || chosen.side === "above") {
    return {
      width: cardWidth,
      left: clamp(rect.left + rect.width / 2 - cardWidth / 2, cardWidth, vw),
      top:
        chosen.side === "below"
          ? Math.min(rect.bottom + GAP, Math.max(EDGE, vh - cardHeight - EDGE))
          : Math.max(EDGE, rect.top - GAP - cardHeight),
    };
  }
  return {
    width: cardWidth,
    top: clamp(rect.top + rect.height / 2 - cardHeight / 2, cardHeight, vh),
    left:
      chosen.side === "right"
        ? Math.min(rect.right + GAP, Math.max(EDGE, vw - cardWidth - EDGE))
        : Math.max(EDGE, rect.left - GAP - cardWidth),
  };
}

export function TourOverlay() {
  const tour = useTour();
  const location = useLocation();
  const navigate = useNavigate();
  const [data, setData] = useState<Investigation | null>(null);
  const [rect, setRect] = useState<DOMRect | null>(null);
  const [cardHeight, setCardHeight] = useState(300);
  const [acted, setActed] = useState(false);
  const cardRef = useRef<HTMLDivElement | null>(null);
  const entered = useRef<Set<string>>(new Set());
  const lastScroll = useRef<number>(0);

  const stop: TourStop | null = tour.active ? (STOPS[tour.index] ?? null) : null;
  const ready = stop ? (stop.waitFor ? stop.waitFor(data) : true) : false;

  useEffect(() => {
    const match = /^\/(?:run|investigation)\/([^/]+)/.exec(location.pathname);
    if (match) tour.setInvestigationId(match[1]);
  }, [location.pathname, tour]);

  useEffect(() => {
    setActed(false);
  }, [tour.index]);

  useEffect(() => {
    if (!tour.active) {
      entered.current = new Set();
      lastScroll.current = 0;
      setRect(null);
    }
  }, [tour.active]);

  const investigationId = tour.investigationId;

  useEffect(() => {
    if (!tour.active || !investigationId) return;
    let live = true;
    async function poll() {
      try {
        const next = await fetchInvestigation(investigationId as string);
        if (live) setData(next);
      } catch {
        /* the intake step may still be starting; the next poll picks it up */
      }
    }
    poll();
    const timer = setInterval(poll, 1500);
    return () => {
      live = false;
      clearInterval(timer);
    };
  }, [tour.active, investigationId]);

  const desiredPath = useMemo(() => {
    if (!stop) return null;
    if (stop.view === "launcher") return "/";
    if (!investigationId) return null;
    return stop.view === "run" ? `/run/${investigationId}` : `/investigation/${investigationId}`;
  }, [stop, investigationId]);

  useEffect(() => {
    if (!stop || !ready || !desiredPath) return;
    if (location.pathname !== desiredPath) navigate(desiredPath);
  }, [stop, ready, desiredPath, location.pathname, navigate]);

  const onPath = desiredPath === null || location.pathname === desiredPath;

  useEffect(() => {
    if (!stop || !ready || !onPath || !stop.onEnterClick || entered.current.has(stop.id)) return;
    const selector = stop.onEnterClick;
    const stopId = stop.id;
    let attempts = 0;
    // The view may still be fetching when the stop opens, so keep looking for the element.
    const timer = setInterval(() => {
      attempts += 1;
      const node = document.querySelector<HTMLElement>(selector);
      if (node) {
        entered.current.add(stopId);
        node.click();
        clearInterval(timer);
      } else if (attempts > 30) {
        clearInterval(timer);
      }
    }, 300);
    return () => clearInterval(timer);
  }, [stop, ready, onPath]);

  useEffect(() => {
    if (!stop?.target || !onPath) {
      setRect(null);
      return;
    }
    const selectors = stop.target;
    function measure() {
      const next = unionRect(selectors);
      setRect((current) => {
        if (!next || !current) return next;
        const same =
          Math.abs(current.top - next.top) < 1 &&
          Math.abs(current.left - next.left) < 1 &&
          Math.abs(current.width - next.width) < 1 &&
          Math.abs(current.height - next.height) < 1;
        return same ? current : next;
      });
      if (!next) return;
      // Nothing is dimmed, so the target has to be genuinely on screen for the highlight to read.
      const clipped = next.top < 24 || next.bottom > window.innerHeight - 24;
      if (clipped && Date.now() - lastScroll.current > 1200) {
        lastScroll.current = Date.now();
        const middle = next.top + next.height / 2;
        window.scrollTo({ top: window.scrollY + middle - window.innerHeight / 2, behavior: "smooth" });
      }
    }
    measure();
    const timer = setInterval(measure, 250);
    window.addEventListener("resize", measure);
    return () => {
      clearInterval(timer);
      window.removeEventListener("resize", measure);
    };
  }, [stop, onPath]);

  useEffect(() => {
    const node = cardRef.current;
    if (!node) return;
    function measureCard() {
      const height = node!.getBoundingClientRect().height;
      setCardHeight((current) => (Math.abs(current - height) < 1 ? current : height));
    }
    measureCard();
    const observer = new ResizeObserver(measureCard);
    observer.observe(node);
    return () => observer.disconnect();
  }, [tour.active, tour.index, ready, acted]);

  const advance = useCallback(() => {
    if (tour.index >= STOPS.length - 1) tour.exit();
    else tour.setIndex(tour.index + 1);
  }, [tour]);

  const next = useCallback(() => {
    if (!stop) return;
    if (stop.action && !acted) {
      const node = document.querySelector<HTMLElement>(stop.action.selector);
      if (!node) {
        advance();
        return;
      }
      node.click();
      if (stop.action.hold) {
        setActed(true);
        return;
      }
      setTimeout(advance, 500);
      return;
    }
    advance();
  }, [stop, acted, advance]);

  const back = useCallback(() => {
    if (tour.index > 0) tour.setIndex(tour.index - 1);
  }, [tour]);

  useEffect(() => {
    if (!tour.active) return;
    function onKey(event: KeyboardEvent) {
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      const target = event.target as HTMLElement | null;
      // A focused control handles its own keys; the tour must not double-fire on top of it.
      if (target && /^(INPUT|TEXTAREA|SELECT|BUTTON|A)$/.test(target.tagName)) {
        if (event.key !== "Escape") return;
      }
      if (event.key === "Escape") {
        event.preventDefault();
        tour.exit();
      }
      if (event.key === "ArrowRight" || event.key === "Enter") {
        event.preventDefault();
        next();
      }
      if (event.key === "ArrowLeft") {
        event.preventDefault();
        back();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [tour, next, back]);

  if (!tour.active) {
    if (location.pathname === "/") return null;
    return (
      <button
        type="button"
        onClick={tour.start}
        className="fixed right-6 bottom-6 z-40 rounded-full bg-teal-500 px-4 py-2.5 text-sm font-semibold text-slate-950 shadow-lg shadow-teal-500/20 transition hover:bg-teal-400"
      >
        ▸ Guided tour
      </button>
    );
  }

  if (!stop) return null;

  const docked = stop.placement === "center" || !rect;
  const cardWidth = Math.min(432, window.innerWidth - 2 * EDGE);
  const cardStyle: CSSProperties = docked
    ? {
        bottom: 24,
        left: "50%",
        transform: "translateX(-50%)",
        width: `min(40rem, calc(100vw - ${2 * EDGE}px))`,
      }
    : placeCard(rect as DOMRect, cardWidth, cardHeight);

  const dynamicLine = stop.dynamic ? stop.dynamic(data) : null;
  const showAfter = Boolean(acted && stop.action?.after);
  const nextLabel = showAfter
    ? tour.index >= STOPS.length - 1
      ? "Finish"
      : "Next"
    : (stop.action && !acted ? stop.action.label : null) ??
      stop.nextLabel ??
      (tour.index >= STOPS.length - 1 ? "Finish" : "Next");

  return (
    <>
      {rect && !docked ? (
        <div
          className="pointer-events-none fixed z-40 rounded-xl bg-teal-400/[0.04] ring-2 ring-teal-400 transition-all duration-300"
          style={{
            top: rect.top - 6,
            left: rect.left - 6,
            width: rect.width + 12,
            height: rect.height + 12,
            boxShadow: "0 0 0 1px rgba(19, 78, 74, 0.8), 0 0 26px 6px rgba(45, 212, 191, 0.22)",
          }}
        />
      ) : null}

      <div
        ref={cardRef}
        className="fixed z-50 rounded-xl border border-teal-500/50 bg-slate-900 p-5 shadow-2xl shadow-black/70 ring-1 ring-black/40"
        style={cardStyle}
      >
        <div className="flex items-baseline justify-between gap-3">
          <p className="font-mono text-[10px] tracking-widest text-teal-400 uppercase">{stop.chapter}</p>
          <p className="font-mono text-[10px] text-slate-500">
            {tour.index + 1} / {STOPS.length}
          </p>
        </div>
        <h3 className="mt-2 text-lg leading-snug font-semibold text-slate-100">{stop.title}</h3>
        <p className="mt-2 text-sm leading-relaxed text-slate-300">{showAfter ? stop.action?.after : stop.body}</p>

        {stop.whichMeans && !showAfter ? (
          <p className="mt-3 border-l-2 border-teal-500/60 pl-3 text-sm leading-relaxed text-teal-100/90">
            <span className="font-semibold text-teal-300">Which means </span>
            {stop.whichMeans}
          </p>
        ) : null}

        {ready && dynamicLine ? (
          <p className="mt-3 font-mono text-[11px] text-slate-400">{dynamicLine}</p>
        ) : null}

        {!ready ? (
          <p className="mt-3 flex items-center gap-2 font-mono text-[11px] text-slate-400">
            <Spinner /> {stop.waitLabel ?? "waiting for the pipeline…"}
          </p>
        ) : null}

        <div className="mt-5 flex items-center gap-2">
          <button
            type="button"
            onClick={next}
            disabled={!ready}
            className="rounded-lg bg-teal-500 px-3 py-2 text-sm font-semibold text-slate-950 transition hover:bg-teal-400 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {nextLabel}
          </button>
          {tour.index > 0 ? (
            <button
              type="button"
              onClick={back}
              className="rounded-lg border border-slate-700 px-3 py-2 text-sm text-slate-300 transition hover:border-slate-500 hover:text-slate-100"
            >
              Back
            </button>
          ) : null}
          <button
            type="button"
            onClick={tour.exit}
            className="ml-auto text-xs text-slate-500 transition hover:text-slate-300"
          >
            Exit tour
          </button>
        </div>
        <p className="mt-3 font-mono text-[10px] text-slate-600">← → to move · esc to exit</p>
      </div>
    </>
  );
}

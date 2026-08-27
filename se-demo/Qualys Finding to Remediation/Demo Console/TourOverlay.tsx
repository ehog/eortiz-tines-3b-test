import { useCallback, useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from "react";
import { useNavigate } from "react-router-dom";
import { TOUR } from "./tour-script";
import type { Shell } from "./App";

const CALLOUT_WIDTH = 372;
const GAP = 18;
const EDGE = 12;

type Rect = { top: number; left: number; width: number; height: number };

function sameRect(a: Rect | null, b: Rect | null): boolean {
  if (!a || !b) return a === b;
  return (
    Math.abs(a.top - b.top) < 0.5 &&
    Math.abs(a.left - b.left) < 0.5 &&
    Math.abs(a.width - b.width) < 0.5 &&
    Math.abs(a.height - b.height) < 0.5
  );
}

function measure(anchor: string | undefined): Rect | null {
  if (!anchor) return null;
  const el = document.querySelector(`[data-tour="${anchor}"]`);
  if (!el) return null;
  const r = el.getBoundingClientRect();
  if (r.width === 0 && r.height === 0) return null;
  return { top: r.top, left: r.left, width: r.width, height: r.height };
}

function headerHeight(): number {
  const header = document.querySelector("header");
  return header ? header.getBoundingClientRect().height : 0;
}

/** Places the callout beside the target without ever covering it. */
function place(rect: Rect, size: { width: number; height: number }) {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const minTop = headerHeight() + EDGE;
  const clampTop = (t: number) => Math.max(minTop, Math.min(t, vh - size.height - EDGE));
  const clampLeft = (l: number) => Math.max(EDGE, Math.min(l, vw - size.width - EDGE));
  const centeredTop = clampTop(rect.top + rect.height / 2 - size.height / 2);

  const rightSpace = vw - rect.left - rect.width;
  const leftSpace = rect.left;
  const belowSpace = vh - rect.top - rect.height;
  const aboveSpace = rect.top - minTop;

  if (rightSpace >= size.width + GAP + EDGE) {
    return { top: centeredTop, left: rect.left + rect.width + GAP };
  }
  if (leftSpace >= size.width + GAP + EDGE) {
    return { top: centeredTop, left: rect.left - GAP - size.width };
  }
  if (belowSpace >= size.height + GAP + EDGE) {
    return { top: rect.top + rect.height + GAP, left: clampLeft(rect.left) };
  }
  if (aboveSpace >= size.height + GAP) {
    return { top: rect.top - GAP - size.height, left: clampLeft(rect.left) };
  }
  // Nothing fits cleanly: take the roomiest side and sit as far off the target as possible.
  if (belowSpace >= aboveSpace) {
    return {
      top: Math.min(rect.top + rect.height + GAP, vh - size.height - EDGE),
      left: clampLeft(rect.left),
    };
  }
  return { top: Math.max(minTop, rect.top - GAP - size.height), left: clampLeft(rect.left) };
}

export default function TourOverlay({ shell, onExit }: { shell: Shell; onExit: () => void }) {
  const navigate = useNavigate();
  const [index, setIndex] = useState(0);
  const [rect, setRect] = useState<Rect | null>(null);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const [showWhy, setShowWhy] = useState(false);
  const calloutRef = useRef<HTMLDivElement>(null);
  const scrolledFor = useRef<string | null>(null);

  const step = TOUR[index];
  const total = TOUR.length;

  const goTo = useCallback(
    (next: number) => {
      if (next < 0 || next >= total) return;
      setShowWhy(false);
      setRect(null);
      setPos(null);
      setIndex(next);
    },
    [total],
  );

  const next = useCallback(() => {
    if (index === total - 1) onExit();
    else goTo(index + 1);
  }, [goTo, index, onExit, total]);

  const tab = step.tab;
  useEffect(() => {
    if (tab) navigate(`/${tab}`);
  }, [navigate, tab]);

  // A cheap rAF poll keeps the ring on target through scrolling, tab swaps and layout shifts.
  useEffect(() => {
    let frame = 0;
    let current: Rect | null = null;
    const tick = () => {
      const found = measure(step.anchor);
      if (!sameRect(found, current)) {
        current = found;
        setRect(found);
      }
      if (found && scrolledFor.current !== step.id) {
        const target =
          found.top +
          window.scrollY -
          Math.max(headerHeight() + 24, (window.innerHeight - found.height) / 2);
        window.scrollTo({ top: Math.max(0, target), behavior: "smooth" });
        scrolledFor.current = step.id;
      }
      frame = window.requestAnimationFrame(tick);
    };
    frame = window.requestAnimationFrame(tick);
    return () => window.cancelAnimationFrame(frame);
  }, [step.anchor, step.id]);

  useLayoutEffect(() => {
    const el = calloutRef.current;
    if (!el) return;
    if (!rect) {
      setPos(null);
      return;
    }
    setPos(place(rect, { width: el.offsetWidth || CALLOUT_WIDTH, height: el.offsetHeight }));
  }, [rect, index, showWhy]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target && /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName)) return;
      if (event.key === "Escape") {
        event.preventDefault();
        onExit();
      } else if (event.key === "ArrowRight" || event.key === "Enter") {
        event.preventDefault();
        next();
      } else if (event.key === "ArrowLeft") {
        event.preventDefault();
        goTo(index - 1);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [goTo, index, next, onExit]);

  const action = step.action;
  const busy = action ? shell.busy === action.runLabel : false;

  const runAction = async () => {
    if (!action) return;
    const ok = await shell.run(action.runLabel, action.run);
    if (ok) {
      shell.notify(`${action.label} — done.`);
      if (action.advanceOnSuccess) next();
    }
  };

  const style: CSSProperties = rect
    ? {
        top: pos ? pos.top : -9999,
        left: pos ? pos.left : -9999,
        width: CALLOUT_WIDTH,
        opacity: pos ? 1 : 0,
      }
    : { top: "50%", left: "50%", transform: "translate(-50%, -50%)", width: CALLOUT_WIDTH };

  const ringVisible = rect ? rect.top + rect.height > headerHeight() + 4 : false;

  return (
    <>
      {rect && ringVisible && (
        <div
          aria-hidden="true"
          className="tour-ring"
          style={{
            top: rect.top - 5,
            left: rect.left - 5,
            width: rect.width + 10,
            height: rect.height + 10,
          }}
        />
      )}

      <div
        ref={calloutRef}
        role="dialog"
        aria-label={`Guided tour step ${index + 1} of ${total}`}
        className="tour-callout fixed z-[60] rounded-[12px] border border-[var(--accent)]/45 bg-[var(--card-solid)] p-4"
        style={style}
      >
        <div className="flex items-center gap-2">
          <span className="rounded-full bg-[var(--accent-soft)] px-2 py-0.5 text-[10.5px] font-bold tracking-wide text-[var(--accent-deep)] uppercase">
            {step.phase}
          </span>
          <span className="ml-auto text-[11px] font-semibold tabular-nums text-[var(--text-muted)]">
            {index + 1} / {total}
          </span>
          <button
            type="button"
            onClick={onExit}
            title="End tour (Esc)"
            className="text-[13px] leading-none text-[var(--text-muted)] hover:text-[var(--text-primary)]"
          >
            ✕
          </button>
        </div>

        <h2 className="mt-2.5 text-[15px] leading-snug font-bold">{step.headline}</h2>
        <p className="mt-1.5 text-[12.5px] leading-relaxed text-[var(--text-secondary)]">
          {step.body}
        </p>

        {step.why && (
          <div className="mt-2.5">
            <button
              type="button"
              onClick={() => setShowWhy(!showWhy)}
              className="text-[11.5px] font-semibold text-[var(--accent-deep)] hover:underline"
            >
              {showWhy ? "Hide why this matters" : "Why this matters"}
            </button>
            {showWhy && (
              <p className="mt-1.5 rounded-md border border-[var(--accent)]/25 bg-[var(--accent-soft)] px-3 py-2 text-[12px] leading-relaxed text-[var(--accent-deep)]">
                {step.why}
              </p>
            )}
          </div>
        )}

        {action && (
          <button
            type="button"
            onClick={runAction}
            disabled={busy}
            className="mt-3 inline-flex w-full items-center justify-center gap-2 rounded-md bg-[var(--accent)] px-3 py-2 text-[12px] font-semibold text-white transition-colors hover:bg-[var(--accent-hover)] disabled:cursor-not-allowed disabled:opacity-50"
          >
            {busy && (
              <span className="size-3 animate-spin rounded-full border-[1.5px] border-current border-t-transparent" />
            )}
            {busy ? "Running…" : `${action.label} for me`}
          </button>
        )}

        <div className="mt-3 flex items-center gap-2 border-t border-[var(--divider)] pt-3">
          <button
            type="button"
            onClick={onExit}
            className="text-[11.5px] font-semibold text-[var(--text-muted)] hover:text-[var(--text-primary)]"
          >
            Skip tour
          </button>
          <div className="ml-auto flex items-center gap-2">
            <button
              type="button"
              onClick={() => goTo(index - 1)}
              disabled={index === 0}
              className="rounded-md border border-[var(--border)] px-2.5 py-1 text-[11.5px] font-semibold text-[var(--text-primary)] hover:bg-[var(--table-hover-bg)] disabled:opacity-40"
            >
              Back
            </button>
            <button
              type="button"
              onClick={next}
              className="rounded-md bg-[var(--accent-deep)] px-3 py-1 text-[11.5px] font-semibold text-white hover:opacity-90"
            >
              {index === total - 1 ? "Finish" : "Next"}
            </button>
          </div>
        </div>
      </div>
    </>
  );
}

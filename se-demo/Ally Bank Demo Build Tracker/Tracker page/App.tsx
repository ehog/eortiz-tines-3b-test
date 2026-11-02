import { useEffect, useMemo, useRef, useState } from "react";
import { statuses, useCases, type Status, type UseCase } from "./data";

type Entry = { link: string; feedback: string; status: Status };
type State = Record<string, Entry>;

const blankState: State = Object.fromEntries(
  useCases.map((u) => [u.id, { link: "", feedback: "", status: "Not started" as Status }]),
);

const basePath: string = (window as any).__ROUTE_PATH__ ?? "";
const stateUrl = `${basePath.replace(/\/ally-demo-tracker$/, "")}/ally-demo-tracker-state`;

const statusStyles: Record<Status, { dot: string; text: string; bg: string }> = {
  "Not started": { dot: "#4A4A4A", text: "#4A4A4A", bg: "#F1EFF4" },
  Building: { dot: "#B36B00", text: "#B36B00", bg: "#FDF4E6" },
  Ready: { dot: "#0A7B5F", text: "#0A7B5F", bg: "#E9F5F1" },
  "Needs rework": { dot: "#B3243C", text: "#B3243C", bg: "#FBEDEF" },
};

function nextWednesday(): Date {
  const now = new Date();
  const target = new Date(now);
  target.setHours(9, 0, 0, 0);
  const delta = (3 - target.getDay() + 7) % 7;
  target.setDate(target.getDate() + delta);
  if (target.getTime() <= now.getTime()) target.setDate(target.getDate() + 7);
  return target;
}

function Countdown() {
  const target = useMemo(nextWednesday, []);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  const ms = Math.max(0, target.getTime() - now);
  const days = Math.floor(ms / 86400000);
  const hours = Math.floor((ms % 86400000) / 3600000);
  const minutes = Math.floor((ms % 3600000) / 60000);
  const seconds = Math.floor((ms % 60000) / 1000);
  const parts: [number, string][] = [
    [days, "days"],
    [hours, "hrs"],
    [minutes, "min"],
    [seconds, "sec"],
  ];
  return (
    <div className="flex flex-col gap-2 sm:items-end">
      <span className="text-sm text-white/70">Demo day countdown</span>
      <div className="flex gap-3">
        {parts.map(([value, label]) => (
          <div key={label} className="min-w-16 rounded-xl bg-white/10 px-3 py-2 text-center">
            <div className="text-2xl font-bold tabular-nums text-white">
              {String(value).padStart(2, "0")}
            </div>
            <div className="text-xs tracking-wide text-white/70">{label}</div>
          </div>
        ))}
      </div>
      <span className="text-sm text-white/70">
        {target.toLocaleDateString(undefined, {
          weekday: "long",
          month: "long",
          day: "numeric",
        })}
        , 9:00 am
      </span>
    </div>
  );
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
        } catch {
          const area = document.createElement("textarea");
          area.value = text;
          document.body.appendChild(area);
          area.select();
          document.execCommand("copy");
          area.remove();
        }
        setCopied(true);
        setTimeout(() => setCopied(false), 1600);
      }}
      className="rounded-full border px-4 py-1.5 text-sm font-semibold transition-colors"
      style={{
        borderColor: "var(--ally-plum)",
        color: copied ? "#FFFFFF" : "var(--ally-plum)",
        background: copied ? "var(--ally-plum)" : "transparent",
      }}
    >
      {copied ? "Copied" : "Copy prompt"}
    </button>
  );
}

function Card({
  useCase,
  entry,
  onChange,
}: {
  useCase: UseCase;
  entry: Entry;
  onChange: (patch: Partial<Entry>) => void;
}) {
  const [open, setOpen] = useState(false);
  const style = statusStyles[entry.status];
  return (
    <section
      className="rounded-xl border bg-white p-6 sm:p-7"
      style={{ borderColor: "#E7E2EC" }}
    >
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="max-w-2xl">
          <div className="mb-2 flex items-center gap-3">
            <span
              className="rounded-full px-3 py-1 text-xs font-bold tracking-wide"
              style={{ background: "#FBEAF5", color: "var(--ally-magenta)" }}
            >
              {useCase.segment}
            </span>
            <span
              className="inline-flex items-center gap-2 rounded-full px-3 py-1 text-xs font-semibold"
              style={{ background: style.bg, color: style.text }}
            >
              <span
                className="h-2 w-2 rounded-full"
                style={{ background: style.dot }}
              />
              {entry.status}
            </span>
          </div>
          <h3
            className="text-2xl font-bold tracking-tight"
            style={{ color: "var(--ally-deep)" }}
          >
            {useCase.title}
          </h3>
          <p className="mt-2 text-base leading-relaxed" style={{ color: "var(--ally-ink)" }}>
            {useCase.driver}
          </p>
        </div>
      </div>

      <div className="mt-6">
        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            className="rounded-full px-5 py-2 text-sm font-semibold text-white"
            style={{ background: "var(--ally-plum)" }}
          >
            {open ? "Hide build prompt" : "Show build prompt"}
          </button>
          <CopyButton text={useCase.prompt} />
        </div>
        {open && (
          <p
            className="mt-4 rounded-xl border p-5 text-base leading-relaxed"
            style={{
              borderColor: "#E7E2EC",
              background: "var(--ally-surface)",
              color: "var(--ally-deep)",
            }}
          >
            {useCase.prompt}
          </p>
        )}
      </div>

      <div className="mt-6 grid gap-5 lg:grid-cols-2">
        <div className="flex flex-col gap-4">
          <label className="flex flex-col gap-2">
            <span className="text-sm font-bold" style={{ color: "var(--ally-deep)" }}>
              Demo link
            </span>
            <input
              type="url"
              value={entry.link}
              placeholder="https://…"
              onChange={(e) => onChange({ link: e.target.value })}
              className="rounded-xl border px-4 py-2.5 text-base outline-none focus:border-[var(--ally-plum)]"
              style={{ borderColor: "#E7E2EC", color: "var(--ally-deep)" }}
            />
            {entry.link.trim() !== "" && (
              <a
                href={entry.link}
                target="_blank"
                rel="noreferrer"
                className="text-sm font-semibold hover:text-[var(--ally-magenta)]"
                style={{ color: "var(--ally-plum)" }}
              >
                Open demo →
              </a>
            )}
          </label>
          <label className="flex flex-col gap-2">
            <span className="text-sm font-bold" style={{ color: "var(--ally-deep)" }}>
              Status
            </span>
            <select
              value={entry.status}
              onChange={(e) => onChange({ status: e.target.value as Status })}
              className="rounded-xl border bg-white px-4 py-2.5 text-base outline-none focus:border-[var(--ally-plum)]"
              style={{ borderColor: "#E7E2EC", color: "var(--ally-deep)" }}
            >
              {statuses.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </label>
        </div>
        <label className="flex flex-col gap-2">
          <span className="text-sm font-bold" style={{ color: "var(--ally-deep)" }}>
            Feedback
          </span>
          <textarea
            value={entry.feedback}
            rows={6}
            placeholder="What needs another pass?"
            onChange={(e) => onChange({ feedback: e.target.value })}
            className="rounded-xl border px-4 py-2.5 text-base leading-relaxed outline-none focus:border-[var(--ally-plum)]"
            style={{ borderColor: "#E7E2EC", color: "var(--ally-deep)" }}
          />
        </label>
      </div>
    </section>
  );
}

export default function App() {
  const [state, setState] = useState<State>(blankState);
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const timers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});

  useEffect(() => {
    fetch(stateUrl)
      .then((r) => r.json())
      .then((data) => setState({ ...blankState, ...data.state }))
      .catch(() => setError("Could not load saved state."))
      .finally(() => setLoaded(true));
  }, []);

  const save = (id: string, entry: Entry) => {
    clearTimeout(timers.current[id]);
    timers.current[id] = setTimeout(() => {
      setSaving(true);
      fetch(stateUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, ...entry }),
      })
        .then((r) => {
          if (!r.ok) throw new Error("save failed");
          setError(null);
        })
        .catch(() => setError("Could not save — your last edit is not persisted."))
        .finally(() => setSaving(false));
    }, 500);
  };

  const update = (id: string, patch: Partial<Entry>) => {
    setState((prev) => {
      const entry = { ...prev[id], ...patch };
      save(id, entry);
      return { ...prev, [id]: entry };
    });
  };

  const ready = useCases.filter((u) => state[u.id]?.status === "Ready").length;
  const pct = Math.round((ready / useCases.length) * 100);

  return (
    <div className="min-h-screen" style={{ background: "var(--ally-surface)" }}>
      <title>Ally Bank — Demo Build Tracker</title>
      <header style={{ background: "var(--ally-plum)" }}>
        <div className="mx-auto flex max-w-5xl flex-col gap-8 px-6 py-12 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="text-sm font-semibold tracking-widest text-white/70">
              CUSTOMER DEMO PREP
            </p>
            <h1 className="mt-3 text-4xl font-bold tracking-tight text-white sm:text-5xl">
              Ally Bank — Demo Build Tracker
            </h1>
            <p className="mt-3 max-w-xl text-lg text-white/80">
              Six use cases to build and rehearse before Wednesday.
            </p>
          </div>
          <Countdown />
        </div>
      </header>

      <main className="mx-auto max-w-5xl px-6 py-12">
        <section
          className="rounded-xl border bg-white p-6 sm:p-7"
          style={{ borderColor: "#E7E2EC" }}
        >
          <div className="flex flex-wrap items-end justify-between gap-4">
            <div>
              <h2 className="text-2xl font-bold" style={{ color: "var(--ally-deep)" }}>
                {ready} of {useCases.length} ready
              </h2>
              <p className="mt-1 text-base" style={{ color: "var(--ally-ink)" }}>
                {saving
                  ? "Saving your edits…"
                  : loaded
                    ? "Edits save automatically."
                    : "Loading saved state…"}
              </p>
            </div>
            <div className="flex flex-wrap gap-4">
              {statuses.map((s) => {
                const count = useCases.filter((u) => state[u.id]?.status === s).length;
                return (
                  <div key={s} className="text-right">
                    <div
                      className="text-2xl font-bold tabular-nums"
                      style={{ color: statusStyles[s].text }}
                    >
                      {count}
                    </div>
                    <div className="text-xs font-semibold" style={{ color: "var(--ally-ink)" }}>
                      {s}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
          <div
            className="mt-6 h-3 w-full overflow-hidden rounded-full"
            style={{ background: "#F1EFF4" }}
          >
            <div
              className="h-full rounded-full transition-all duration-500"
              style={{ width: `${pct}%`, background: "var(--ally-magenta)" }}
            />
          </div>
          {error && (
            <p className="mt-4 text-sm font-semibold" style={{ color: "#B3243C" }}>
              {error}
            </p>
          )}
        </section>

        <div className="mt-8 flex flex-col gap-6">
          {useCases.map((u) => (
            <Card
              key={u.id}
              useCase={u}
              entry={state[u.id]}
              onChange={(patch) => update(u.id, patch)}
            />
          ))}
        </div>

        <p className="mt-12 text-sm" style={{ color: "var(--ally-ink)" }}>
          Internal demo mock. Styled in the spirit of Ally's brand; not affiliated with or
          endorsed by Ally Financial.
        </p>
      </main>
    </div>
  );
}

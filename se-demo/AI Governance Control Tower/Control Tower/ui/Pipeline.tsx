import { useState } from "react";
import { SEV_COLOR, Section, ago } from "./kit";
import type { Filters } from "./state";

export function Pipeline({
  data,
  view,
  toggle,
  apply,
  act,
}: {
  data: any;
  view: any;
  toggle: (k: any, v: string) => void;
  apply: (f: Partial<Filters>) => void;
  act: (b: Record<string, unknown>) => Promise<any>;
}) {
  const [pending, setPending] = useState<string | null>(null);
  const stages: string[] = data.pipeline.stages;
  const fastStages: string[] = data.pipeline.fast_track_stages;
  const items: any[] = view.items.filter((i: any) => i.outcome === "in flight");
  const closed: any[] = view.items.filter((i: any) => i.outcome !== "in flight");

  const advance = async (id: string, outcome?: "implemented" | "killed") => {
    setPending(id);
    try {
      await act({ action: "advance_stage", id, outcome });
    } finally {
      setPending(null);
    }
  };

  const Card = ({ i }: { i: any }) => (
    <div
      className="border-l-2 bg-[var(--color-ink-2)] p-3"
      style={{ borderColor: SEV_COLOR[i.risk] ?? "var(--color-line)" }}
    >
      <div className="flex items-start justify-between gap-2">
        <button
          onClick={() => (i.id.startsWith("build:") ? apply({ build: i.id.slice(6) }) : undefined)}
          className={`text-left text-sm leading-tight font-semibold text-white ${i.id.startsWith("build:") ? "cursor-pointer hover:text-[var(--color-magenta)]" : "cursor-default"}`}
        >
          {i.subject}
        </button>
        <span className="font-mono text-[9px] tracking-[0.16em] whitespace-nowrap uppercase" style={{ color: SEV_COLOR[i.risk] }}>
          {i.risk}
        </span>
      </div>
      <button
        onClick={() => toggle("team", i.team)}
        className="mt-1 cursor-pointer text-[11px] text-[var(--color-fog)] hover:text-white"
      >
        {i.team}
      </button>
      <p className="mt-2 text-[11px] leading-relaxed text-[var(--color-fog)]">{i.rationale}</p>
      <div className="mt-2 font-mono text-[10px] text-[#6c6c78]">
        {i.kind} · in stage {ago(i.stage_entered_at)} · {i.days_in_use}d in use
      </div>
      <div className="mt-2 flex gap-1.5">
        {i.stage === (i.lane === "fast-track" ? fastStages : stages).slice(-1)[0] ? (
          <>
            <button
              disabled={pending === i.id}
              onClick={() => advance(i.id, "implemented")}
              className="cursor-pointer bg-[var(--color-mint)] px-2 py-1 text-[10px] font-semibold tracking-[0.1em] text-black uppercase hover:opacity-85 disabled:opacity-50"
            >
              Implement
            </button>
            <button
              disabled={pending === i.id}
              onClick={() => advance(i.id, "killed")}
              className="cursor-pointer bg-[var(--color-magenta)] px-2 py-1 text-[10px] font-semibold tracking-[0.1em] text-white uppercase hover:opacity-85 disabled:opacity-50"
            >
              Kill
            </button>
          </>
        ) : (
          <button
            disabled={pending === i.id}
            onClick={() => advance(i.id)}
            className="cursor-pointer border border-[var(--color-line)] px-2 py-1 text-[10px] font-semibold tracking-[0.1em] text-[var(--color-fog)] uppercase hover:border-[var(--color-magenta)] hover:text-white disabled:opacity-50"
          >
            Sign off →
          </button>
        )}
      </div>
    </div>
  );

  const Lane = ({ stage, lane }: { stage: string; lane: "standard" | "fast-track" }) => {
    const laneItems = items.filter((i) => i.stage === stage && i.lane === lane);
    return (
      <div className="w-[240px] shrink-0">
        <div
          className="mb-2 flex items-baseline justify-between border-b pb-1.5"
          style={{ borderColor: lane === "fast-track" ? "var(--color-violet)" : "var(--color-line)" }}
        >
          <span className="text-[10px] tracking-[0.16em] text-[#d6d6dd] uppercase">{stage}</span>
          <span className="num text-xs text-[var(--color-fog)]">{laneItems.length}</span>
        </div>
        <div className="space-y-2">
          {laneItems.map((i) => (
            <Card key={i.id} i={i} />
          ))}
          {laneItems.length === 0 ? <div className="h-1" /> : null}
        </div>
      </div>
    );
  };

  return (
    <Section
      id="pipeline"
      eyebrow="Governance"
      title="The approval chain, live"
      lede="Flagged builds and unapproved tools move through AI Working Group → AI Board → Business → Security/IT → Finance → Trial → Implement or Kill. Low-risk items in use under a week take the fast-track lane, which skips full Board and Business review. Every state change writes an immutable audit record."
      right={
        <div className="text-right text-xs text-[var(--color-fog)]">
          <div className="num display text-4xl text-white">{items.length}</div>
          items in flight
          {closed.length ? <div className="mt-1">{closed.length} closed</div> : null}
        </div>
      }
    >
      <div className="mb-3 flex items-center gap-4 text-[11px] text-[var(--color-fog)]">
        <span className="flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 border-l-2 border-[var(--color-line)]" /> standard lane
        </span>
        <span className="flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 border-l-2 border-[var(--color-violet)]" /> fast-track (under one week, low risk)
        </span>
      </div>

      <div className="overflow-x-auto pb-3 scroll-thin">
        <div className="flex gap-4">
          {stages.map((s) => (
            <Lane key={s} stage={s} lane="standard" />
          ))}
        </div>
      </div>

      <div className="mt-6 border-t border-[var(--color-violet)] pt-4">
        <div className="mb-3 font-mono text-[10px] tracking-[0.24em] text-[var(--color-violet)] uppercase">
          Fast-track lane
        </div>
        <div className="overflow-x-auto pb-3 scroll-thin">
          <div className="flex gap-4">
            {fastStages.map((s) => (
              <Lane key={s} stage={s} lane="fast-track" />
            ))}
          </div>
        </div>
      </div>

      <div className="mt-10">
        <div className="mb-2 text-[10px] tracking-[0.2em] text-[var(--color-fog)] uppercase">
          Immutable audit trail · latest {Math.min(12, data.audit.length)} of {data.audit.length} records
        </div>
        <div className="overflow-x-auto scroll-thin">
          <table className="w-full min-w-[720px] text-xs">
            <tbody>
              {data.audit.slice(0, 12).map((r: any) => (
                <tr key={r.seq} className="border-b border-[#1c1c23]">
                  <td className="num py-1.5 pr-4 font-mono text-[var(--color-fog)]">#{r.seq}</td>
                  <td className="py-1.5 pr-4 font-mono whitespace-nowrap text-[var(--color-fog)]">
                    {new Date(r.at).toLocaleString()}
                  </td>
                  <td className="py-1.5 pr-4 text-[#e6e6ea]">{r.actor}</td>
                  <td className="py-1.5 pr-4 text-white">{r.action}</td>
                  <td className="py-1.5 pr-4 font-mono text-[var(--color-fog)]">{r.item_id}</td>
                  <td className="py-1.5 font-mono text-[#c9c9d2]">
                    {r.field}: {r.prior_value ?? "—"} → {r.new_value}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </Section>
  );
}

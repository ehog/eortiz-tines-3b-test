import { useState } from "react";
import { Dot, SEV_COLOR, Section, ago, nf } from "./kit";

const RISK_COLOR: Record<string, string> = SEV_COLOR;

export function Shadow({ data, view, act }: { data: any; view: any; act: (b: Record<string, unknown>) => Promise<any> }) {
  const [pending, setPending] = useState<string | null>(null);
  const entries: any[] = view.shadow;
  const review = entries.filter((e) => e.decision === "review");
  const allow = entries.filter((e) => e.decision === "allow");
  const block = entries.filter((e) => e.decision === "block");
  const changes: any[] = data.shadow.changes ?? [];

  const decide = async (domain: string, decision: "allow" | "block") => {
    setPending(domain);
    try {
      await act({ action: "tool_decision", id: domain, decision });
    } finally {
      setPending(null);
    }
  };

  return (
    <Section
      id="shadow"
      eyebrow="Shadow AI"
      title="Tools nobody approved"
      lede={`Observed AI domain usage from ${(data.shadow.feeds ?? []).map((f: any) => f.label).join(" and ")} is compared against the live allow/block list on every run. Anything unrecognised is enriched and proposed for a decision — the list is state, not a static config.`}
      right={
        <div className="text-right text-xs text-[var(--color-fog)]">
          <div className="num display text-4xl text-white">{review.length}</div>
          awaiting a decision
          <div className="mt-1 font-mono text-[10px] tracking-[0.16em] uppercase">
            enrichment: {data.shadow.enrichment_model}
          </div>
        </div>
      }
    >
      <div className="grid gap-8 lg:grid-cols-[1.35fr_1fr]">
        <div className="space-y-3">
          {review.map((e) => (
            <article key={e.domain} className="border border-[var(--color-line)] bg-[var(--color-ink-2)] p-4">
              <div className="flex flex-wrap items-baseline gap-x-3">
                <span
                  className="font-mono text-[10px] font-semibold tracking-[0.2em] uppercase"
                  style={{ color: RISK_COLOR[e.risk] }}
                >
                  {e.risk} risk
                </span>
                <h3 className="text-base font-semibold text-white">{e.tool}</h3>
                <span className="font-mono text-xs text-[var(--color-fog)]">{e.domain}</span>
              </div>
              <div className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 text-xs text-[#c9c9d2] sm:grid-cols-4">
                <span>
                  <span className="num text-white">{nf.format(e.users)}</span> users
                </span>
                <span>
                  <span className="num text-white">{nf.format(e.devices)}</span> devices
                </span>
                <span>first seen {ago(e.first_seen)}</span>
                <span>{e.feed}</span>
              </div>
              <p className="mt-2 text-xs leading-relaxed text-[var(--color-fog)]">
                <span className="text-[#e6e6ea]">
                  {e.vendor} · {e.category} · {e.hq}
                </span>{" "}
                — {e.risk_notes}
                {e.trains_on_input ? " Trains on submitted content." : ""}
                {e.baa ? "" : " No BAA on file."}
                {e.uploads_detected ? " File uploads observed." : ""}
              </p>
              <div className="mt-1 text-xs text-[var(--color-fog)]">
                Heaviest use: {e.top_teams.join(", ") || "unattributed"}
              </div>
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <span className="font-mono text-[10px] tracking-[0.16em] text-[var(--color-fog)] uppercase">
                  proposed: {e.proposed}
                </span>
                <button
                  disabled={pending === e.domain}
                  onClick={() => decide(e.domain, "block")}
                  className="cursor-pointer bg-[var(--color-magenta)] px-3 py-1.5 text-[11px] font-semibold tracking-[0.12em] text-white uppercase hover:opacity-85 disabled:opacity-50"
                >
                  Add to blocklist
                </button>
                <button
                  disabled={pending === e.domain}
                  onClick={() => decide(e.domain, "allow")}
                  className="cursor-pointer border border-[var(--color-line)] px-3 py-1.5 text-[11px] font-semibold tracking-[0.12em] text-[var(--color-fog)] uppercase hover:border-[#3a3a46] hover:text-white disabled:opacity-50"
                >
                  Allow
                </button>
              </div>
            </article>
          ))}
          {review.length === 0 ? (
            <p className="text-sm text-[var(--color-fog)]">Nothing new detected in this slice of the fleet.</p>
          ) : null}
        </div>

        <div>
          <div className="mb-5">
            <div className="mb-2 text-[10px] tracking-[0.2em] text-[var(--color-fog)] uppercase">
              Current list · {allow.length} allowed / {block.length} blocked
            </div>
            <ul className="divide-y divide-[#1c1c23] border-y border-[var(--color-line)]">
              {[...allow, ...block].map((e) => (
                <li key={e.domain} className="flex items-center gap-2 py-2 text-xs">
                  <Dot color={e.decision === "allow" ? "var(--color-mint)" : "var(--color-magenta)"} />
                  <span className="font-mono text-[11px] text-[#e6e6ea]">{e.domain}</span>
                  <span className="ml-auto text-[var(--color-fog)]">{e.decision}</span>
                  {e.decision === "allow" ? (
                    <button
                      disabled={pending === e.domain}
                      onClick={() => decide(e.domain, "block")}
                      className="cursor-pointer text-[10px] tracking-[0.14em] text-[var(--color-magenta)] uppercase hover:text-white disabled:opacity-50"
                    >
                      block
                    </button>
                  ) : null}
                </li>
              ))}
            </ul>
          </div>

          <div className="mb-2 text-[10px] tracking-[0.2em] text-[var(--color-fog)] uppercase">
            List change history
          </div>
          <ol className="max-h-80 space-y-2 overflow-y-auto pr-2 scroll-thin">
            {changes.slice(0, 40).map((c, i) => (
              <li key={`${c.domain}-${c.at}-${i}`} className="border-l border-[var(--color-line)] pl-3">
                <div className="font-mono text-[11px] text-white">
                  {c.domain} <span className="text-[var(--color-fog)]">{c.from ?? "new"} → {c.to}</span>
                </div>
                <div className="text-[11px] text-[var(--color-fog)]">
                  {new Date(c.at).toLocaleDateString()} · {c.actor} · {c.note}
                </div>
              </li>
            ))}
          </ol>
        </div>
      </div>
    </Section>
  );
}

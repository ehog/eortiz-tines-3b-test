import { Hero, Header } from "./ui/Chrome";
import { Drawer } from "./ui/Drawer";
import { Fleet } from "./ui/Fleet";
import { Pipeline } from "./ui/Pipeline";
import { Roi } from "./ui/Roi";
import { Shadow } from "./ui/Shadow";
import { Spillage } from "./ui/Spillage";
import { ago } from "./ui/kit";
import { useFiltered, useFilters, useSnapshot } from "./ui/state";

const TRUST = [
  [
    "Isolated execution",
    "Every step runs in its own container, built from its own Dockerfile and torn down when the run ends. No build shares a process, a filesystem or memory with another.",
  ],
  [
    "Credentials proxied, never exposed",
    "Secrets live with the connector proxy. Requests leave a step unauthenticated and are signed at egress — build code, logs and the model never see the credential.",
  ],
  [
    "Every action logged",
    "Approvals, rejections, blocklist changes and stage transitions append an immutable audit record: who, what, when, prior value, new value.",
  ],
  [
    "Model-agnostic by configuration",
    "Each step names its model in configuration, and the model it used is shown next to its output. Swapping Claude, OpenAI or Gemini is a config change, not a rebuild.",
  ],
];

export default function App() {
  const { filters, apply, toggle, clear, activeCount } = useFilters();
  const { data, error, busy, reload, act } = useSnapshot();
  const view = useFiltered(data, filters);

  if (error && !data) {
    return (
      <main className="flex min-h-screen items-center justify-center px-6">
        <title>AI Governance Control Tower</title>
        <div className="max-w-md">
          <h1 className="display text-3xl text-white">Control Tower can't reach its data</h1>
          <p className="mt-3 text-sm text-[var(--color-fog)]">{error}</p>
          <button
            onClick={reload}
            className="mt-5 cursor-pointer bg-[var(--color-magenta)] px-4 py-2 text-xs font-semibold tracking-[0.14em] text-white uppercase"
          >
            Retry
          </button>
        </div>
      </main>
    );
  }

  if (!data || !view) {
    return (
      <main className="flex min-h-screen items-center justify-center">
        <title>AI Governance Control Tower</title>
        <div className="animate-pulse font-mono text-xs tracking-[0.3em] text-[var(--color-fog)] uppercase">
          Loading fleet…
        </div>
      </main>
    );
  }

  return (
    <>
      <title>AI Governance Control Tower · Real Chemistry</title>
      <div className="min-h-screen">
        <Header
          data={data}
          filters={filters}
          activeCount={activeCount}
          clear={clear}
          toggle={toggle}
          apply={apply}
          busy={busy}
          reload={reload}
        />
        <main className="mx-auto max-w-[1400px] px-5 lg:px-10">
          <Hero data={data} filters={filters} toggle={toggle} />
          <Fleet data={data} view={view} filters={filters} toggle={toggle} apply={apply} />
          <Spillage data={data} view={view} filters={filters} toggle={toggle} apply={apply} act={act} />
          <Shadow data={data} view={view} act={act} />
          <Pipeline data={data} view={view} toggle={toggle} apply={apply} act={act} />
          <Roi data={data} view={view} filters={filters} toggle={toggle} apply={apply} />

          <footer className="border-t border-[var(--color-line)] py-12">
            <div className="mb-8 max-w-2xl">
              <div className="mb-2 font-mono text-[10px] tracking-[0.28em] text-[var(--color-magenta)] uppercase">
                Trust
              </div>
              <h2 className="display text-3xl text-white">How this holds up under audit</h2>
            </div>
            <div className="grid gap-8 md:grid-cols-2 xl:grid-cols-4">
              {TRUST.map(([title, body]) => (
                <div key={title} className="border-t border-[var(--color-line)] pt-4">
                  <h3 className="mb-2 text-sm font-semibold text-white">{title}</h3>
                  <p className="text-xs leading-relaxed text-[var(--color-fog)]">{body}</p>
                </div>
              ))}
            </div>
            <div className="mt-10 flex flex-wrap gap-x-6 gap-y-1 font-mono text-[10px] tracking-[0.18em] text-[#6c6c78] uppercase">
              <span>Inventory {ago(data.freshness.inventory)}</span>
              <span>Spillage {ago(data.freshness.spillage)}</span>
              <span>Shadow AI {ago(data.freshness.shadow)}</span>
              <span>Governance {ago(data.freshness.pipeline)}</span>
              <span>ROI {ago(data.freshness.roi)}</span>
              <span>{data.audit.length} audit records</span>
              <span>Discovery sources: {data.sources.map((s: any) => s.label).join(" · ")}</span>
            </div>
          </footer>
        </main>

        {filters.build ? <Drawer data={data} buildId={filters.build} close={() => apply({ build: null })} /> : null}
      </div>
    </>
  );
}

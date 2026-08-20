const VOL = "/storage/ai_governance";

async function read(name: string, fallback: any) {
  const f = Bun.file(`${VOL}/${name}`);
  return (await f.exists()) ? await f.json() : fallback;
}

const inventory = await read("inventory.json", null);
if (!inventory) {
  const body = JSON.stringify({ error: "not_collected", message: "Inventory collector has not run yet." });
  process.stdout.write(
    `HTTP/1.1 503 Service Unavailable\r\nContent-Type: application/json\r\nContent-Length: ${Buffer.byteLength(body)}\r\n\r\n${body}`,
  );
  process.exit(0);
}

const spillage = await read("spillage.json", { findings: [], generated_at: null });
const suggestions = await read("suggestions.json", { suggestions: [], model: null, generated_at: null });
const shadow = await read("shadow.json", { entries: [], changes: [], feeds: [], generated_at: null });
const pipeline = await read("pipeline.json", { items: [], stages: [], fast_track_stages: [], generated_at: null });
const roi = await read("roi.json", { headline: null, by_team: [], history: [], duplicates: [], generated_at: null });
const audit = await read("audit.json", { records: [] });

const weekAgo = Date.now() - 7 * 86_400_000;
const openFindings = spillage.findings.filter((f: any) => {
  const s = suggestions.suggestions.find((x: any) => x.finding_id === f.id);
  return !s || s.decision !== "approved";
});

const kpis = {
  builds_in_flight: inventory.builds.length,
  unowned_builds: inventory.builds.filter((b: any) => b.unowned).length,
  open_spillage_alerts: openFindings.length,
  critical_spillage_alerts: openFindings.filter((f: any) => f.severity === "critical").length,
  shadow_tools_this_week: (shadow.entries ?? []).filter((e: any) => new Date(e.first_seen).getTime() >= weekAgo).length,
  shadow_tools_pending_review: (shadow.entries ?? []).filter((e: any) => e.decision === "review").length,
  hours_saved_mtd: roi.headline?.hours_saved_mtd ?? null,
  dollars_saved_mtd: roi.headline?.dollars_saved_mtd ?? null,
  blocked_builds: inventory.builds.filter((b: any) => b.status === "blocked").length,
  pipeline_in_flight: pipeline.items.filter((i: any) => i.outcome === "in flight").length,
};

const models = {
  inventory_normalizer: inventory.normalizer_model,
  fix_suggestions: suggestions.model,
  shadow_enrichment: shadow.enrichment_model ?? null,
};

const payload = {
  served_at: new Date().toISOString(),
  freshness: {
    inventory: inventory.generated_at,
    spillage: spillage.generated_at,
    suggestions: suggestions.generated_at,
    shadow: shadow.generated_at,
    pipeline: pipeline.generated_at,
    roi: roi.generated_at,
  },
  models,
  kpis,
  sources: inventory.sources,
  builds: inventory.builds,
  spillage: { generated_at: spillage.generated_at, coverage_note: spillage.coverage_note, findings: spillage.findings },
  suggestions: suggestions.suggestions,
  shadow,
  pipeline,
  roi,
  audit: audit.records.slice(-400).reverse(),
};

const body = JSON.stringify(payload);
process.stdout.write(
  [
    "HTTP/1.1 200 OK",
    "Content-Type: application/json",
    "Cache-Control: no-store",
    `Content-Length: ${Buffer.byteLength(body)}`,
    "",
    body,
  ].join("\r\n"),
);

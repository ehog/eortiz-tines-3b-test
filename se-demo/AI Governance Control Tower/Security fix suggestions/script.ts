import { MODEL, propose } from "./suggest";

const VOL = "/storage/ai_governance";
const now = new Date().toISOString();

const spillage = await Bun.file(`${VOL}/spillage.json`).json();
const inventory = await Bun.file(`${VOL}/inventory.json`).json();
const builds = new Map(inventory.builds.map((b: any) => [b.id, b]));

const previous = (await Bun.file(`${VOL}/suggestions.json`).exists())
  ? await Bun.file(`${VOL}/suggestions.json`).json()
  : { suggestions: [] };
const decided = new Map(
  previous.suggestions
    .filter((s: any) => s.decision !== "pending")
    .map((s: any) => [s.id, s]),
);

const suggestions = spillage.findings.map((f: any) => {
  const fresh = propose(f, builds.get(f.build_id));
  const prior = decided.get(fresh.id);
  return prior ? { ...fresh, decision: prior.decision, decided_by: prior.decided_by, decided_at: prior.decided_at } : fresh;
});

await Bun.write(
  `${VOL}/suggestions.json`,
  JSON.stringify({ generated_at: now, model: MODEL, scope: "security and bug fixes only", suggestions }, null, 2),
);

console.error(`proposed ${suggestions.length} fixes with ${MODEL} (${decided.size} prior decisions preserved)`);
console.log(JSON.stringify({ generated_at: now, model: MODEL, suggestion_count: suggestions.length }));

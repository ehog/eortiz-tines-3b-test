import { PATTERNS, mask } from "./patterns";

const VOL = "/storage/ai_governance";
const now = new Date().toISOString();

const inventory = await Bun.file(`${VOL}/inventory.json`).json();

type Finding = {
  id: string;
  detected_at: string;
  build_id: string;
  build_name: string;
  team: string;
  owner: string | null;
  classification: string;
  severity: "critical" | "high" | "medium" | "low";
  category: string;
  pattern_id: string;
  pattern_label: string;
  rationale: string;
  surface: string;
  masked_match: string;
  evidence: string;
  status: "open";
};

const findings: Finding[] = [];
let scanned = 0;

for (const build of inventory.builds) {
  const surfaces: Array<{ surface: string; text: string }> = [
    ...build.signals.logs.map((l: string) => ({ surface: "stdout / run log", text: l })),
    { surface: "declared inputs", text: build.signals.io.inputs ?? "" },
    { surface: "declared outputs", text: build.signals.io.outputs ?? "" },
  ].filter((s) => s.text.length > 0);

  scanned += surfaces.length;

  for (const { surface, text } of surfaces) {
    for (const p of PATTERNS) {
      for (const m of text.matchAll(p.re)) {
        const captured = m[1] ?? m[0];
        const id = `${build.id}:${p.id}`;
        if (findings.some((f) => f.id === id)) continue;
        findings.push({
          id,
          detected_at: now,
          build_id: build.id,
          build_name: build.name,
          team: build.team,
          owner: build.owner,
          classification: build.classification,
          severity: p.severity,
          category: p.category,
          pattern_id: p.id,
          pattern_label: p.label,
          rationale: p.rationale,
          surface,
          masked_match: mask(captured),
          evidence: text.replace(captured, mask(captured)).slice(0, 220),
          status: "open",
        });
      }
    }
  }

  for (const domain of build.unapproved_egress ?? []) {
    findings.push({
      id: `${build.id}:egress:${domain}`,
      detected_at: now,
      build_id: build.id,
      build_name: build.name,
      team: build.team,
      owner: build.owner,
      classification: build.classification,
      severity: build.classification === "PHI" || build.classification === "PII" ? "critical" : "high",
      category: "Egress",
      pattern_id: "egress-unapproved",
      pattern_label: `Egress to unapproved domain ${domain}`,
      rationale: "Data leaves the approved processor list; no BAA or DPA on file for this destination.",
      surface: "network egress",
      masked_match: domain,
      evidence: `build sends ${build.classification} data to ${domain}`,
      status: "open",
    });
  }
}

const rank = { critical: 0, high: 1, medium: 2, low: 3 };
findings.sort((a, b) => rank[a.severity] - rank[b.severity] || a.build_name.localeCompare(b.build_name));

const out = {
  generated_at: now,
  scanned_surfaces: scanned,
  scanned_builds: inventory.builds.length,
  pattern_count: PATTERNS.length,
  coverage_note:
    "Only surfaces the collector could enumerate were scanned. Builds from sources with partial coverage may hide additional exposure.",
  findings,
};

await Bun.write(`${VOL}/spillage.json`, JSON.stringify(out, null, 2));

const counts = findings.reduce<Record<string, number>>((a, f) => ((a[f.severity] = (a[f.severity] ?? 0) + 1), a), {});
console.error(`spillage scan: ${findings.length} findings ${JSON.stringify(counts)}`);
for (const f of findings) console.error(`  ${f.severity.padEnd(8)} ${f.build_id} ${f.pattern_id} :: ${f.evidence.slice(0, 90)}`);
console.log(JSON.stringify({ generated_at: now, finding_count: findings.length, by_severity: counts }));

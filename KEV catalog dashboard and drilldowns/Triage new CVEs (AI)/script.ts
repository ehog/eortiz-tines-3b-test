import Anthropic from "@anthropic-ai/sdk";
import { addDays, type Catalog, type NvdCandidate, readStdinJson, type Vulnerability, WATCHLIST_DUE_DAYS } from "./kev";

type Input = { catalog: Catalog; candidates: NvdCandidate[]; nvd: { windowHours: number; fetched: number; error: string | null } };
type Pick = { cveId: string; vendor: string; product: string; name: string; requiredAction: string; rationale: string };

const input = await readStdinJson<Input>();
const system = await Bun.file(new URL("./system.md", import.meta.url)).text();
let watchlist: Vulnerability[] = [];
let usage: unknown = null;

if (input.candidates.length > 0) {
  const client = new Anthropic({
    baseURL: process.env.ANTHROPIC_BASE_URL!.trim().replace(/\/v1\/?$/, ""),
    apiKey: "set-by-connector",
  });
  const pool = input.candidates.map((c) => ({ id: c.cveId, cvss: c.cvss, cwe: c.cwes.join(","), published: c.published, description: c.description }));

  const message = await client.messages
    .stream({
      model: "claude-sonnet-5",
      max_tokens: 8000,
      system: [{ type: "text", text: system, cache_control: { type: "ephemeral" } }],
      tools: [{
        name: "record_triage",
        description: "Record the selected watchlist CVEs with KEV-style metadata.",
        input_schema: {
          type: "object",
          properties: {
            selected: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  cveId: { type: "string" }, vendor: { type: "string" }, product: { type: "string" },
                  name: { type: "string" }, requiredAction: { type: "string" }, rationale: { type: "string" },
                },
                required: ["cveId", "vendor", "product", "name", "requiredAction", "rationale"],
              },
            },
          },
          required: ["selected"],
        },
      }],
      tool_choice: { type: "tool", name: "record_triage" },
      messages: [{ role: "user", content: `Candidate CVEs published in the last ${input.nvd.windowHours} hours (JSON):\n${JSON.stringify(pool)}` }],
    })
    .finalMessage();

  usage = message.usage;
  const block = message.content.find((b) => b.type === "tool_use");
  if (!block || block.type !== "tool_use") throw new Error("Model did not call record_triage");
  const picks = ((block.input as { selected?: Pick[] }).selected ?? []);
  const byId = new Map(input.candidates.map((c) => [c.cveId, c]));
  const used = new Set<string>();

  for (const p of picks) {
    const c = byId.get(p.cveId);
    if (!c || used.has(c.cveId)) continue;
    used.add(c.cveId);
    watchlist.push({
      cveId: c.cveId,
      vendor: p.vendor.trim() || "Unknown",
      product: p.product.trim() || "Unknown",
      name: p.name.trim(),
      dateAdded: c.published,
      description: c.description,
      requiredAction: p.requiredAction.trim(),
      dueDate: addDays(c.published, WATCHLIST_DUE_DAYS),
      ransomware: "No",
      notes: [...c.references, `https://nvd.nist.gov/vuln/detail/${c.cveId}`].join(" ; "),
      cwes: c.cwes,
      source: "NVD",
      cvss: c.cvss,
      severity: c.severity,
      aiRationale: p.rationale.trim(),
    });
  }
}

console.error(JSON.stringify({ event: "ai_triage_complete", candidates: input.candidates.length, selected: watchlist.length, usage }));
console.log(JSON.stringify({ catalog: input.catalog, watchlist, nvd: input.nvd }));

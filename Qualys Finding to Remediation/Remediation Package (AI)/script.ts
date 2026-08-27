// One structured model call per high-priority finding, run with bounded
// concurrency. Findings below the threshold get a deterministic summary built
// from the Qualys vendor solution instead of a model call.
import Anthropic from "@anthropic-ai/sdk";
import systemPrompt from "./system.md" with { type: "text" };
import { runStage } from "./stage";
import type { Envelope, NormalizedFinding, RemediationPackage } from "./types";

const MODEL = "claude-sonnet-5";
const CONCURRENCY = 3;
const MAX_PACKAGES = 8;

// The connector's base URL already ends in /v1, which the SDK appends itself.
const baseURL = (process.env.ANTHROPIC_BASE_URL ?? "https://api.anthropic.com").replace(/\/v1\/?$/, "");

const client = new Anthropic({
  apiKey: "set-by-connector",
  baseURL,
  maxRetries: 2,
});

const TOOL: Anthropic.Tool = {
  name: "submit_remediation_package",
  description: "Submit the remediation package for the supplied Qualys finding.",
  input_schema: {
    type: "object",
    required: [
      "determinable",
      "summary",
      "required_fix",
      "fix_version",
      "commands",
      "code_fix",
      "prerequisites",
      "reboot_required",
      "service_impact",
      "validation",
      "evidence_citations",
      "missing_evidence",
      "confidence",
    ],
    properties: {
      determinable: {
        type: "boolean",
        description: "False when the evidence is too thin to name a specific fix.",
      },
      summary: { type: "string", description: "One or two sentences an approver can read." },
      required_fix: {
        type: "string",
        description: "The specific patch, package version, or change required.",
      },
      fix_version: {
        type: ["string", "null"],
        description: "Target version, package release, or KB identifier. Null when not applicable.",
      },
      commands: {
        type: "array",
        items: {
          type: "object",
          required: ["platform", "description", "command"],
          properties: {
            platform: {
              type: "string",
              description: "Shell or tooling the command runs in, e.g. PowerShell, bash, maven.",
            },
            description: { type: "string" },
            command: { type: "string" },
          },
        },
      },
      code_fix: {
        type: ["object", "null"],
        required: ["file", "language", "before", "after", "note"],
        properties: {
          file: { type: "string" },
          language: { type: "string" },
          before: { type: "string" },
          after: { type: "string" },
          note: { type: "string" },
        },
      },
      prerequisites: { type: "array", items: { type: "string" } },
      reboot_required: { type: "boolean" },
      service_impact: { type: "string" },
      validation: { type: "array", items: { type: "string" } },
      evidence_citations: {
        type: "array",
        items: { type: "string" },
        description: "Short verbatim excerpts from the Qualys evidence that justify the fix.",
      },
      missing_evidence: { type: "array", items: { type: "string" } },
      confidence: { type: "string", enum: ["high", "medium", "low"] },
    },
  },
};

function findingPrompt(f: NormalizedFinding): string {
  return [
    "## Finding",
    `Qualys detection: ${f.finding_id} (QID ${f.qid}, ${f.detection_type})`,
    `Title: ${f.title}`,
    `Class: ${f.vuln_class} / finding type: ${f.finding_type}`,
    `Severity: ${f.severity} of 5, CVSS ${f.cvss_base} (${f.cvss_vector})`,
    `CVEs: ${f.cves.length ? f.cves.join(", ") : "none mapped"}`,
    `Vendor patch available per Qualys: ${f.patch_available ? "yes" : "no"}`,
    `Status: ${f.status}, first found ${f.first_found}, last found ${f.last_found}, detected ${f.times_detected} times`,
    "",
    "## Affected host",
    `Hostname: ${f.asset.hostname} (${f.asset.ip})`,
    `Operating system / runtime: ${f.asset.os}`,
    `Tags: ${f.asset.tags.join(", ") || "none"}`,
    `Application: ${f.owner.application}, owned by ${f.owner.team}`,
    `Environment: ${f.owner.environment}, criticality ${f.owner.criticality}, exposure ${f.owner.exposure}`,
    "",
    "## Affected software (Qualys inventory)",
    JSON.stringify(f.software, null, 2),
    "",
    "## Qualys vendor solution text",
    f.vendor_solution || "(none supplied)",
    "",
    "## Qualys RESULTS evidence",
    "```",
    f.evidence || "(no evidence returned)",
    "```",
  ].join("\n");
}

function fallbackPackage(f: NormalizedFinding, reason: string): RemediationPackage {
  return {
    finding_id: f.finding_id,
    determinable: false,
    summary: `No remediation package was generated for this finding: ${reason}`,
    required_fix: f.vendor_solution || "Not determined.",
    fix_version: null,
    commands: [],
    code_fix: null,
    prerequisites: [],
    reboot_required: false,
    service_impact: "Not assessed.",
    validation: [],
    evidence_citations: [],
    missing_evidence: [reason],
    confidence: "low",
    source: "deterministic",
  };
}

function summaryOnlyPackage(f: NormalizedFinding): RemediationPackage {
  const band = f.risk?.risk_band ?? "low";
  return {
    finding_id: f.finding_id,
    determinable: Boolean(f.vendor_solution),
    summary: `Below the high-priority threshold (${band} band, score ${
      f.risk?.risk_score ?? 0
    }); tracked on the team's change with the Qualys solution text only.`,
    required_fix: f.vendor_solution || "No vendor solution supplied by Qualys.",
    fix_version: (f.software.fixed_version as string | null | undefined) ?? null,
    commands: [],
    code_fix: null,
    prerequisites: [],
    reboot_required: false,
    service_impact: "Not assessed for below-threshold findings.",
    validation: [],
    evidence_citations: [],
    missing_evidence: [],
    confidence: "low",
    source: "deterministic",
  };
}

async function generatePackage(f: NormalizedFinding): Promise<RemediationPackage> {
  const stream = client.messages.stream({
    model: MODEL,
    max_tokens: 4096,
    system: [{ type: "text", text: systemPrompt, cache_control: { type: "ephemeral" } }],
    tools: [TOOL],
    tool_choice: { type: "tool", name: TOOL.name },
    messages: [{ role: "user", content: findingPrompt(f) }],
  });
  const message = await stream.finalMessage();
  const block = message.content.find((c) => c.type === "tool_use");
  if (!block || block.type !== "tool_use") {
    throw new Error(`model returned no tool call for ${f.finding_id}`);
  }
  const input = block.input as Omit<RemediationPackage, "finding_id" | "source">;
  console.error(
    `${f.finding_id}: package generated (${message.usage.input_tokens} in / ${message.usage.output_tokens} out, cache read ${message.usage.cache_read_input_tokens ?? 0})`,
  );
  return {
    ...input,
    commands: input.commands ?? [],
    prerequisites: input.prerequisites ?? [],
    validation: input.validation ?? [],
    evidence_citations: input.evidence_citations ?? [],
    missing_evidence: input.missing_evidence ?? [],
    code_fix: input.code_fix ?? null,
    finding_id: f.finding_id,
    source: "model",
  };
}

async function mapLimited<T, R>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let cursor = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (cursor < items.length) {
        const index = cursor++;
        results[index] = await fn(items[index]!);
      }
    }),
  );
  return results;
}

await runStage<Envelope, Envelope>({
  stage: "remediate",
  upstreamStage: "prioritize",
  handler: async (input, { runId, invocation }) => {
    const findings = input?.findings ?? [];
    const highPriority = findings
      .filter((f) => f.risk?.high_priority)
      .sort((a, b) => (b.risk?.risk_score ?? 0) - (a.risk?.risk_score ?? 0));
    const targets = highPriority.slice(0, MAX_PACKAGES);
    const deferred = highPriority.slice(MAX_PACKAGES);

    let modelFailures = 0;
    const generated = await mapLimited(targets, CONCURRENCY, async (f) => {
      try {
        return await generatePackage(f);
      } catch (err) {
        modelFailures += 1;
        console.error(`${f.finding_id}: generation failed - ${(err as Error).message}`);
        return fallbackPackage(f, `the model call failed (${(err as Error).message})`);
      }
    });
    // A single failed package degrades gracefully; every package failing means the
    // provider or connector is broken and the run should not look successful.
    if (targets.length > 0 && modelFailures === targets.length) {
      throw new Error(
        `all ${targets.length} remediation package generations failed; see stderr for the provider error`,
      );
    }

    const packages = new Map(generated.map((p) => [p.finding_id, p]));
    for (const f of deferred) {
      packages.set(
        f.finding_id,
        fallbackPackage(
          f,
          `more than ${MAX_PACKAGES} high-priority findings in this run, so this one is queued for the next run`,
        ),
      );
    }

    const enriched = findings.map((f) => ({
      ...f,
      remediation:
        packages.get(f.finding_id) ??
        (f.risk?.high_priority ? fallbackPackage(f, "no package produced") : summaryOnlyPackage(f)),
    }));

    const undeterminable = generated.filter((p) => !p.determinable);
    const payload: Envelope = {
      run_id: input?.run_id ?? runId,
      trigger: input?.trigger ?? invocation.trigger,
      stage: "remediate",
      generated_at: input?.generated_at ?? new Date().toISOString(),
      findings: enriched,
      groups: input?.groups ?? [],
      tickets: [],
      notes: [
        `${targets.length} AI remediation packages generated with ${MODEL}`,
        `${findings.length - highPriority.length} below-threshold findings summarised without a model call`,
        undeterminable.length
          ? `${undeterminable.length} findings the model could not determine a fix for: ${undeterminable
              .map((p) => `${p.finding_id} (${p.missing_evidence.join("; ") || "no reason given"})`)
              .join(", ")}`
          : "every generated package named a specific fix",
      ],
    };

    return {
      payload,
      count: targets.length,
      summary: `${targets.length} packages generated, ${undeterminable.length} undeterminable`,
      emit: enriched.length > 0,
    };
  },
});

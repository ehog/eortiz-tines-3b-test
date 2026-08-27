// Renders the human-readable change record: what the batch contains, why each
// finding scored the way it did, and the remediation package an engineer runs.
import type { NormalizedFinding, TeamGroup } from "./types";

function fence(language: string, body: string): string {
  return ["```" + language, body, "```"].join("\n");
}

export function renderFindingSection(f: NormalizedFinding, index: number): string {
  const risk = f.risk;
  const pkg = f.remediation;
  const lines: string[] = [];

  lines.push(
    `### ${index}. ${f.finding_id} — ${f.title}`,
    "",
    `- Host: ${f.asset.hostname} (${f.asset.ip}), ${f.asset.os}`,
    `- Qualys QID ${f.qid}, severity ${f.severity}/5, CVSS ${f.cvss_base}${
      f.cves.length ? `, ${f.cves.join(", ")}` : ", no CVE mapped"
    }`,
    `- Exploitation: ${
      f.kev ? "on the CISA KEV catalog" : f.exploit_in_wild ? "exploited in the wild" : "none reported"
    }`,
    `- Risk score: ${risk?.risk_score ?? "n/a"} (${risk?.risk_band ?? "unscored"}), SLA ${
      risk?.sla_days ?? "n/a"
    } days, due ${risk?.sla_due?.slice(0, 10) ?? "n/a"}`,
    "",
    `**Why this score:** ${risk?.explanation ?? "not scored"}`,
    "",
  );

  if (risk?.factors?.length) {
    lines.push(
      "| Factor | Input | Points |",
      "| --- | --- | --- |",
      ...risk.factors.map((x) => `| ${x.factor} | ${x.input} | ${x.points} / ${x.max_points} |`),
      "",
    );
  }

  if (!pkg) {
    lines.push("_No remediation package attached._", "");
    return lines.join("\n");
  }

  lines.push("**Remediation**", "", pkg.summary, "");

  if (!pkg.determinable) {
    lines.push(
      "> A specific fix could not be determined from the available Qualys evidence.",
      ">",
      ...(pkg.missing_evidence.length
        ? pkg.missing_evidence.map((m) => `> - Missing: ${m}`)
        : ["> - No reason recorded."]),
      "",
      "Resolve the evidence gap before this change can be actioned.",
      "",
    );
    return lines.join("\n");
  }

  lines.push(
    `- Required fix: ${pkg.required_fix}`,
    `- Target version: ${pkg.fix_version ?? "not applicable"}`,
    `- Reboot required: ${pkg.reboot_required ? "yes" : "no"}`,
    `- Service impact: ${pkg.service_impact}`,
    `- Confidence: ${pkg.confidence}`,
    "",
  );

  if (pkg.prerequisites.length) {
    lines.push("Prerequisites:", ...pkg.prerequisites.map((p) => `- ${p}`), "");
  }

  if (pkg.commands.length) {
    lines.push("Change steps:", "");
    for (const c of pkg.commands) {
      lines.push(`- ${c.description} (${c.platform})`, fence(c.platform.toLowerCase(), c.command), "");
    }
  }

  if (pkg.code_fix) {
    lines.push(
      `Code fix — \`${pkg.code_fix.file}\``,
      "",
      pkg.code_fix.note,
      "",
      "Before:",
      fence(pkg.code_fix.language, pkg.code_fix.before),
      "",
      "After:",
      fence(pkg.code_fix.language, pkg.code_fix.after),
      "",
    );
  }

  if (pkg.validation.length) {
    lines.push("Validation:", ...pkg.validation.map((v) => `- ${v}`), "");
  }

  if (pkg.evidence_citations.length) {
    lines.push(
      "Qualys evidence cited:",
      ...pkg.evidence_citations.map((e) => `- \`${e.replace(/`/g, "'")}\``),
      "",
    );
  }

  return lines.join("\n");
}

export function renderTicketBody(
  group: TeamGroup,
  findings: NormalizedFinding[],
  runId: string,
): string {
  const highPriority = findings.filter((f) => f.risk?.high_priority);
  const header = [
    `Vulnerability remediation change for **${group.application}**, owned by **${group.team}**.`,
    "",
    `- Findings batched: ${findings.length} (${highPriority.length} high priority)`,
    `- Highest risk score: ${group.max_risk_score ?? 0} (${group.risk_band ?? "unscored"})`,
    `- SLA date: ${group.sla_due?.slice(0, 10) ?? "n/a"}`,
    `- Assets: ${group.assets.map((a) => a.hostname).join(", ")}`,
    `- Source: Qualys VMDR detections, pipeline run ${runId}`,
    group.owned
      ? ""
      : "- Ownership: no asset-owner record matched these assets, so the change is assigned to Security Operations for attribution.",
    "",
    "---",
    "",
  ].filter((line) => line !== "");

  const sections = findings
    .slice()
    .sort((a, b) => (b.risk?.risk_score ?? 0) - (a.risk?.risk_score ?? 0))
    .map((f, i) => renderFindingSection(f, i + 1));

  return [...header, ...sections].join("\n");
}

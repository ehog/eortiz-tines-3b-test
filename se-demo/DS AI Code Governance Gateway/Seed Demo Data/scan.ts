export type Finding = {
  rule_id: string;
  category: string;
  severity: "critical" | "high" | "medium" | "low";
  title: string;
  detail: string;
  line: number;
  evidence: string;
  weight: number;
};

const ALLOWLISTED_DOMAINS = [
  "api.dentsplysirona.com",
  "internal.dentsplysirona.net",
  "login.microsoftonline.com",
  "azure-foundry.dentsplysirona.com",
  "sap.dentsplysirona.com",
];

const SECRET_RULES: { id: string; title: string; re: RegExp; severity: Finding["severity"]; weight: number }[] = [
  { id: "SEC-001", title: "Hardcoded API key", re: /\b(?:api[_-]?key|apikey)\s*[:=]\s*["'][A-Za-z0-9_\-]{12,}["']/i, severity: "critical", weight: 35 },
  { id: "SEC-002", title: "Hardcoded bearer or access token", re: /\b(?:token|bearer|access[_-]?token)\s*[:=]\s*["'][A-Za-z0-9._\-]{16,}["']/i, severity: "critical", weight: 35 },
  { id: "SEC-003", title: "Hardcoded password", re: /\b(?:password|passwd|pwd)\s*[:=]\s*["'][^"']{4,}["']/i, severity: "high", weight: 25 },
  { id: "SEC-004", title: "Cloud provider key material", re: /\b(AKIA[0-9A-Z]{12,}|sk-[A-Za-z0-9]{20,}|ghp_[A-Za-z0-9]{20,}|xox[baprs]-[A-Za-z0-9-]{10,})\b/, severity: "critical", weight: 40 },
  { id: "SEC-005", title: "Private key block", re: /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/, severity: "critical", weight: 40 },
];

const PHI_RULES: { id: string; title: string; re: RegExp; severity: Finding["severity"]; weight: number }[] = [
  { id: "PHI-001", title: "Patient identifier reference", re: /\b(patient[_-]?id|patient_number|patientId)\b/i, severity: "high", weight: 20 },
  { id: "PHI-002", title: "Medical record number (MRN)", re: /\b(mrn|medical_record_number)\b/i, severity: "critical", weight: 30 },
  { id: "PHI-003", title: "Date of birth field", re: /\b(dob|date_of_birth|birth_date|birthdate)\b/i, severity: "high", weight: 18 },
  { id: "PHI-004", title: "Embedded email list", re: /["'][^"'\s@]+@[^"'\s@]+\.[a-z]{2,}["']\s*,\s*["'][^"'\s@]+@/i, severity: "medium", weight: 12 },
  { id: "PHI-005", title: "Clinical PHI table or export", re: /\b(phi|clinical_records|patient_records|treatment_history)\b/i, severity: "high", weight: 20 },
];

const HANDLING_RULES: { id: string; title: string; detail: string; severity: Finding["severity"]; weight: number; test: (code: string) => boolean }[] = [
  {
    id: "HND-001",
    title: "Missing error handling around external I/O",
    detail: "External calls are made with no try/except/catch or status check — failures will silently corrupt downstream state.",
    severity: "medium",
    weight: 12,
    test: (c) => /\b(requests\.(get|post|put|delete)|fetch\(|httpx\.|urlopen)/i.test(c) && !/\b(try\s*[:{]|catch\s*\(|\.catch\(|raise_for_status|response\.ok|resp\.status)/i.test(c),
  },
  {
    id: "HND-002",
    title: "Unscoped or wildcard credential usage",
    detail: "Credential is requested with wildcard or admin scope instead of a least-privilege named scope.",
    severity: "high",
    weight: 18,
    test: (c) => /(scope\s*[:=]\s*["'](\*|all|admin|full_access)["']|role\s*[:=]\s*["']admin["']|permissions\s*[:=]\s*["']\*["'])/i.test(c),
  },
  {
    id: "HND-003",
    title: "Verification disabled on outbound TLS",
    detail: "TLS certificate verification is disabled, defeating transport security controls.",
    severity: "high",
    weight: 20,
    test: (c) => /(verify\s*=\s*False|rejectUnauthorized\s*:\s*false|NODE_TLS_REJECT_UNAUTHORIZED)/i.test(c),
  },
  {
    id: "HND-004",
    title: "Shell execution from model-generated string",
    detail: "Dynamic shell/eval execution present in generated automation.",
    severity: "high",
    weight: 22,
    test: (c) => /(os\.system\(|subprocess\.(call|run|Popen)\(.*shell\s*=\s*True|eval\(|exec\()/i.test(c),
  },
];

function lineOf(code: string, index: number): number {
  return code.slice(0, index).split("\n").length;
}

function scan(code: string): Finding[] {
  const findings: Finding[] = [];
  const lines = code.split("\n");

  for (const rule of [...SECRET_RULES, ...PHI_RULES]) {
    for (let i = 0; i < lines.length; i++) {
      const m = lines[i].match(rule.re);
      if (!m) continue;
      const category = rule.id.startsWith("SEC") ? "Secrets & credentials" : "PII / PHI exposure";
      findings.push({
        rule_id: rule.id,
        category,
        severity: rule.severity,
        title: rule.title,
        detail: category === "Secrets & credentials"
          ? "Secret material is embedded in the artifact instead of referenced from a scoped credential store."
          : "Regulated personal or health data pattern detected in generated code (Purview-equivalent classification).",
        line: i + 1,
        evidence: lines[i].trim().slice(0, 160),
        weight: rule.weight,
      });
      break;
    }
  }

  const urlRe = /https?:\/\/([A-Za-z0-9._-]+)/g;
  const seen = new Set<string>();
  let m: RegExpExecArray | null;
  while ((m = urlRe.exec(code))) {
    const host = m[1].toLowerCase();
    if (ALLOWLISTED_DOMAINS.includes(host) || seen.has(host)) continue;
    seen.add(host);
    findings.push({
      rule_id: "NET-001",
      category: "Egress control",
      severity: "high",
      title: `Outbound call to non-allowlisted domain (${host})`,
      detail: `${host} is not on the approved egress allowlist. Model-generated automations may only reach reviewed endpoints.`,
      line: lineOf(code, m.index),
      evidence: m[0],
      weight: 22,
    });
  }

  for (const rule of HANDLING_RULES) {
    if (!rule.test(code)) continue;
    const idx = lines.findIndex((l) => rule.test(l));
    findings.push({
      rule_id: rule.id,
      category: "Secure coding hygiene",
      severity: rule.severity,
      title: rule.title,
      detail: rule.detail,
      line: idx >= 0 ? idx + 1 : 1,
      evidence: idx >= 0 ? lines[idx].trim().slice(0, 160) : "",
      weight: rule.weight,
    });
  }

  const order = { critical: 0, high: 1, medium: 2, low: 3 };
  return findings.sort((a, b) => order[a.severity] - order[b.severity] || a.rule_id.localeCompare(b.rule_id));
}

export function scanPayload(code: string) {
  const findings = scan(code);
  const risk_score = Math.min(100, findings.reduce((t, f) => t + f.weight, 0));
  const scan_verdict = risk_score > 70 ? "auto-block" : risk_score < 20 ? "auto-approve" : "needs-review";
  return { findings, risk_score, scan_verdict };
}

if (import.meta.main) {
  const raw = await Bun.stdin.text();
  if (!raw.trim()) {
    console.error("event=scan.failed reason=no_input");
    process.exit(1);
  }
  const submission = JSON.parse(raw);
  const result = scanPayload(String(submission.code_payload ?? ""));
  const counts = result.findings.reduce<Record<string, number>>((a, f) => ({ ...a, [f.severity]: (a[f.severity] ?? 0) + 1 }), {});
  console.error(
    `event=policy.scan submission=${submission.submission_id} findings=${result.findings.length} critical=${counts.critical ?? 0} high=${counts.high ?? 0} medium=${counts.medium ?? 0} risk_score=${result.risk_score} verdict=${result.scan_verdict} rules=${result.findings.map((f) => f.rule_id).join(",") || "none"}`,
  );
  process.stdout.write(JSON.stringify({ ...submission, scan: result }));
}

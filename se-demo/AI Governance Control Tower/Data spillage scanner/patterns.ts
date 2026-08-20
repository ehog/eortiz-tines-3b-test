export type Pattern = {
  id: string;
  label: string;
  category: "PHI" | "PII" | "Secret" | "Client confidential" | "Egress";
  severity: "critical" | "high" | "medium" | "low";
  re: RegExp;
  rationale: string;
};

/** Detection library. Add or tune patterns here — the scanner is data-driven. */
export const PATTERNS: Pattern[] = [
  {
    id: "phi-mrn",
    label: "Medical record number in plaintext",
    category: "PHI",
    severity: "critical",
    re: /\b(?:mrn|member_id)\D{0,3}(\d{4}[-\s]?\d{4,7})\b/gi,
    rationale: "HIPAA identifier #6 written to a log or downstream payload.",
  },
  {
    id: "phi-dob",
    label: "Date of birth alongside clinical context",
    category: "PHI",
    severity: "high",
    re: /\b(?:dob|date of birth)\D{0,4}(\d{4}-\d{2}-\d{2})\b/gi,
    rationale: "HIPAA identifier #3; combined with diagnosis it is fully identifying.",
  },
  {
    id: "phi-icd",
    label: "ICD-10 diagnosis code with patient context",
    category: "PHI",
    severity: "high",
    re: /\b([A-TV-Z]\d{2}\.?\d{0,3})\b(?=[^\n]*(?:patient|zip|member|dx|npi))/g,
    rationale: "Diagnosis linked to an individual is PHI even without a name.",
  },
  {
    id: "pii-ssn",
    label: "Social Security number",
    category: "PII",
    severity: "critical",
    re: /\b(\d{3}-\d{2}-\d{4})\b/g,
    rationale: "Direct identifier; unacceptable in any log or debug dump.",
  },
  {
    id: "pii-phone",
    label: "Personal phone number",
    category: "PII",
    severity: "medium",
    re: /\b(\d{3}-\d{3}-\d{4})\b/g,
    rationale: "Contact identifier attached to a named individual.",
  },
  {
    id: "pii-email",
    label: "External individual email address",
    category: "PII",
    severity: "medium",
    re: /\b([\w.+-]+@(?!realchemistry\.com)[\w-]+\.[a-z]{2,})\b/gi,
    rationale: "Third-party personal data leaving the boundary of the build.",
  },
  {
    id: "pii-name-clinical",
    label: "Patient name adjacent to clinical detail",
    category: "PHI",
    severity: "critical",
    re: /\bpatient ([A-Z][a-z]+ [A-Z][a-z]+)\b/g,
    rationale: "Named individual plus condition — the highest-consequence spill.",
  },
  {
    id: "secret-plaintext",
    label: "Credential material in plaintext",
    category: "Secret",
    severity: "critical",
    re: /\b([A-Z_]*(?:PASSWORD|SECRET|TOKEN|API_KEY)[A-Z_]*\s*=\s*\S+|sk-proj-[\w-]+|pk\.eyJ[\w-]+)/g,
    rationale: "Secrets must be proxied by a connector, never materialised in code or env.",
  },
  {
    id: "client-confidential",
    label: "Confidential client names in a model prompt",
    category: "Client confidential",
    severity: "high",
    re: /\b(Pfizer|Novartis|Regeneron|AstraZeneca|Moderna)\b/g,
    rationale: "Client roster is under NDA; prompts to third-party models are exfiltration.",
  },
];

export function mask(value: string) {
  const v = value.trim();
  if (v.length <= 4) return "•".repeat(v.length);
  return `${v.slice(0, 2)}${"•".repeat(Math.max(3, v.length - 4))}${v.slice(-2)}`;
}

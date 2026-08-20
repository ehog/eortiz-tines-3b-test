export const MODEL = process.env.FIX_MODEL ?? "claude-sonnet-4-5";

/**
 * Scope guard: this step only ever proposes SECURITY or BUG fixes. Anything resembling
 * workflow optimisation, cost tuning, or productivity advice is out of scope by design.
 */
export const SYSTEM_PROMPT = `You are a security engineer reviewing an AI-generated build at a
healthcare marketing company. Given one data-exposure finding, output exactly one concrete fix
that removes the exposure or fixes the defect that caused it. Never suggest performance,
cost, UX, or productivity improvements. Output a minimal unified diff plus one sentence of
rationale. If the fix requires a policy decision rather than a code change, say so explicitly.`;

type Recipe = {
  title: string;
  kind: "security" | "bug";
  before: string[];
  after: string[];
  target: string;
  rationale: string;
  risk_if_ignored: string;
};

const RECIPES: Record<string, Recipe> = {
  "phi-mrn": {
    title: "Redact medical record / member identifiers before logging",
    kind: "security",
    target: "log statement in the build's run handler",
    before: [
      `console.log(\`intake: patient MRN \${record.mrn} routed to \${queue}\`);`,
      `await audit.write({ mrn: record.mrn, queue });`,
    ],
    after: [
      `const mrnRef = hashIdentifier(record.mrn); // HMAC, key from connector`,
      `console.log(\`intake: patient ref \${mrnRef} routed to \${queue}\`);`,
      `await audit.write({ mrn_ref: mrnRef, queue });`,
    ],
    rationale: "Replaces the HIPAA identifier with a keyed reference so logs stay useful but not identifying.",
    risk_if_ignored: "PHI persists in run logs and any downstream log sink, creating a reportable disclosure.",
  },
  "phi-dob": {
    title: "Drop date of birth from the narrative passed downstream",
    kind: "security",
    target: "narrative normaliser",
    before: [`narrative = \`\${text} (DOB \${patient.dob})\`;`],
    after: [
      `const ageBand = bandAge(patient.dob); // "45-54"`,
      `narrative = \`\${text} (age band \${ageBand})\`;`,
    ],
    rationale: "Age band preserves clinical usefulness while removing a direct identifier.",
    risk_if_ignored: "DOB plus diagnosis is fully identifying even when the name is stripped.",
  },
  "phi-icd": {
    title: "Separate diagnosis codes from patient-locating fields",
    kind: "security",
    target: "prompt assembly",
    before: [`prompt = \`zip \${input.zip}, dx \${input.icd10}\`;`],
    after: [
      `prompt = \`region \${toRegion(input.zip)}, therapeutic area \${toTherapeuticArea(input.icd10)}\`;`,
    ],
    rationale: "Coarsens both fields so the pair can no longer re-identify an individual.",
    risk_if_ignored: "Zip plus diagnosis re-identifies patients in small populations.",
  },
  "pii-ssn": {
    title: "Remove the debug dump that serialises raw records",
    kind: "bug",
    target: "debug branch in the ETL worker",
    before: [`if (DEBUG) console.log("debug dump:", JSON.stringify(row));`],
    after: [
      `if (DEBUG) console.error("debug dump:", summarise(row)); // ids and SSN omitted`,
    ],
    rationale: "The dump was a leftover debug aid writing every raw column, including SSN, to stdout.",
    risk_if_ignored: "Social Security numbers are retained in plaintext logs — immediate breach exposure.",
  },
  "pii-phone": {
    title: "Mask contact identifiers in escalation cards",
    kind: "security",
    target: "escalation card renderer",
    before: [`text: \`\${handle} phone \${post.phone} reported a reaction\``],
    after: [`text: \`\${handle} (contact on file) reported a reaction\``],
    rationale: "Responders act on the case reference; the raw phone number adds no operational value.",
    risk_if_ignored: "Personal contact data spreads into a broad Slack channel with wide retention.",
  },
  "pii-email": {
    title: "Store reporter email in the case record, not the log line",
    kind: "security",
    target: "intake logger",
    before: [`console.log(\`reporter email \${reporter.email}\`);`],
    after: [`console.log(\`reporter linked to case \${caseId}\`);`],
    rationale: "Keeps the identifier in the access-controlled system of record only.",
    risk_if_ignored: "Third-party personal data is duplicated into logs outside the case system.",
  },
  "pii-name-clinical": {
    title: "Reference consent records by id instead of patient name",
    kind: "security",
    target: "consent upload handler",
    before: [`log(\`consent uploaded for patient \${name}, dob \${dob}, condition: \${dx}\`);`],
    after: [`log(\`consent \${consentId} uploaded (validated, no PHI in log)\`);`],
    rationale: "Name, DOB and condition together are the highest-consequence combination to log.",
    risk_if_ignored: "A named patient with a diagnosis in plaintext is a reportable HIPAA disclosure.",
  },
  "secret-plaintext": {
    title: "Move the credential behind the connector proxy",
    kind: "security",
    target: "worker environment / build settings",
    before: [
      `SNOWFLAKE_PASSWORD=<literal>  # set in build env`,
      `const conn = connect({ password: process.env.SNOWFLAKE_PASSWORD });`,
    ],
    after: [
      `# credential removed from env; request is proxied and signed at egress`,
      `const conn = connect({}); // auth injected by the connector proxy`,
    ],
    rationale: "Removes the secret from build code, env and logs; the proxy injects auth at request time.",
    risk_if_ignored: "A long-lived production credential is readable by anyone who can view the build or its logs.",
  },
  "client-confidential": {
    title: "Block the client roster from third-party prompts",
    kind: "security",
    target: "prompt pre-flight filter",
    before: [`const prompt = userInput;`],
    after: [
      `const prompt = redactClientNames(userInput); // roster from the client registry`,
      `if (containsRestricted(prompt)) throw new Error("client-confidential content blocked");`,
    ],
    rationale: "Enforces the NDA boundary at the point the prompt leaves the tenant.",
    risk_if_ignored: "Client names under NDA are disclosed to an external model provider.",
  },
  "egress-unapproved": {
    title: "Restrict egress to the approved processor list",
    kind: "security",
    target: "build network policy",
    before: [`await fetch(\`https://\${unapprovedHost}/upload\`, { body: payload });`],
    after: [
      `// destination not on the approved processor list — route via the sanctioned transfer service`,
      `await fetch("https://realchemistry.sharepoint.com/_api/upload", { body: payload });`,
    ],
    rationale: "Sends regulated data only to destinations with a BAA or DPA on file.",
    risk_if_ignored: "Regulated data reaches a processor with no contractual protection or breach obligation.",
  },
};

export type Suggestion = ReturnType<typeof propose>;

/**
 * Swap point for a live model call: replace the recipe lookup with a request to the
 * configured provider using SYSTEM_PROMPT and the finding as the user turn. The returned
 * shape — title, diff, rationale — is what the UI and approval routing depend on.
 */
export function propose(finding: any, build: any) {
  const r = RECIPES[finding.pattern_id];
  const fallback: Recipe = {
    title: `Contain ${finding.category} exposure in ${build?.name ?? finding.build_name}`,
    kind: "security",
    target: finding.surface,
    before: [`// exposure observed on ${finding.surface}`],
    after: [`// remove the identifier from this surface, or gate the surface behind access control`],
    rationale: finding.rationale,
    risk_if_ignored: "Exposure remains on a surface outside the system of record.",
  };
  const recipe = r ?? fallback;

  return {
    id: `fix:${finding.id}`,
    finding_id: finding.id,
    build_id: finding.build_id,
    build_name: finding.build_name,
    team: finding.team,
    owner: finding.owner,
    severity: finding.severity,
    kind: recipe.kind,
    title: recipe.title,
    target: recipe.target,
    rationale: recipe.rationale,
    risk_if_ignored: recipe.risk_if_ignored,
    diff: [
      ...recipe.before.map((l) => ({ sign: "-" as const, text: l })),
      ...recipe.after.map((l) => ({ sign: "+" as const, text: l })),
    ],
    model: MODEL,
    generated_at: new Date().toISOString(),
    decision: "pending" as "pending" | "approved" | "rejected",
    decided_by: null as string | null,
    decided_at: null as string | null,
  };
}

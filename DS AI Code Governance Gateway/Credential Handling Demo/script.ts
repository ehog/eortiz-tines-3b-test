type CredentialRef = {
  name: string;
  purpose: string;
  scope: string;
  injected_at: "runtime";
  visible_to_code: false;
  value: "«never exposed — injected by the 3B credential proxy»";
};

const CREDENTIAL_MAP: Record<string, CredentialRef[]> = {
  "Clinical Data": [
    { name: "ds-clinical-deploy-token", purpose: "Promote artifact to clinical-data production namespace", scope: "space:eortiz / team:Clinical Data / env:prod", injected_at: "runtime", visible_to_code: false, value: "«never exposed — injected by the 3B credential proxy»" },
    { name: "ds-azure-foundry-key", purpose: "HIPAA-scoped model endpoint", scope: "space:eortiz / team:Clinical Data / region-bound", injected_at: "runtime", visible_to_code: false, value: "«never exposed — injected by the 3B credential proxy»" },
  ],
  "R&D-Endodontics": [
    { name: "ds-rnd-deploy-token", purpose: "Promote artifact to R&D production namespace", scope: "space:eortiz / team:R&D-Endodontics / env:prod", injected_at: "runtime", visible_to_code: false, value: "«never exposed — injected by the 3B credential proxy»" },
  ],
  "Digital Dentistry": [
    { name: "ds-digital-deploy-token", purpose: "Promote artifact to digital-dentistry production namespace", scope: "space:eortiz / team:Digital Dentistry / env:prod", injected_at: "runtime", visible_to_code: false, value: "«never exposed — injected by the 3B credential proxy»" },
  ],
  "IT-Ops": [
    { name: "ds-itops-deploy-token", purpose: "Promote artifact to shared infrastructure namespace", scope: "space:eortiz / team:IT-Ops / env:prod", injected_at: "runtime", visible_to_code: false, value: "«never exposed — injected by the 3B credential proxy»" },
  ],
};

const AUDIT_SINK: CredentialRef = {
  name: "ds-audit-sink-token",
  purpose: "Write immutable audit record to the governance ledger",
  scope: "space:eortiz / append-only",
  injected_at: "runtime",
  visible_to_code: false,
  value: "«never exposed — injected by the 3B credential proxy»",
};

const raw = await Bun.stdin.text();
if (!raw.trim()) {
  console.error("event=credentials.failed reason=no_input");
  process.exit(1);
}
const submission = JSON.parse(raw);
const credentials = [...(CREDENTIAL_MAP[submission.team] ?? []), AUDIT_SINK];

console.error(
  `event=credentials.resolved submission=${submission.submission_id} references=${credentials.length} names="${credentials.map((c) => c.name).join(",")}" scopes="${credentials.map((c) => c.scope).join(" | ")}" secret_values_logged=0`,
);

process.stdout.write(
  JSON.stringify({
    ...submission,
    credentials: {
      note: "Credentials are referenced by name and scope only. No secret value is ever read by, logged by, or returned to step code.",
      references: credentials,
    },
  }),
);

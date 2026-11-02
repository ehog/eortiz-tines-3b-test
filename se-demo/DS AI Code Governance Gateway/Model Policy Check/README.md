Config-driven check of the model the developer used against the per-team, per-region allowed-model matrix.

**Trigger:** upstream [Policy Scan](<../Policy Scan/script.ts>).

The matrix lives in [model-policy.ts](model-policy.ts) as data, not logic — that file is what the console's Model Policy tab renders, so a CISO can see enforcement is configuration. Examples: `MP-001` restricts Clinical Data / US to `azure-foundry-claude` (HIPAA BAA), `MP-011` blocks `gpt-4o` for R&D-Endodontics / DE pending a DPIA, and unmapped team/region pairs are denied by default.

Adds a `model_policy` object naming the rule that fired, the permitted models, and the rationale. Logs `event=model_policy.check …`.

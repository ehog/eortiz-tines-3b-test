Folds the three incompatible partner shapes into one canonical healthcare schema.

**Triggered by** [Ingest](../Ingest/script.ts).

**Mappings**

| Concern | Rule |
| --- | --- |
| Trial phase | `Phase 1`, `Phase II`, `phase-3`, `PHASE 3`… → `PHASE1`–`PHASE4`, else `NA` |
| Site country | Names and alpha-3 codes → ISO-3166 alpha-2, else `ZZ` (rejected downstream) |
| NDC | 11-digit, dashed or short codes → zero-padded `5-4-2` |
| Effective date | `YYYY-MM-DD`, `YYYY/MM/DD`, `YYYYMMDD` → ISO-8601 |
| Duplicates | Dropped on `(trialId, NDC)`, keeping the first occurrence |
| XML entities | Decoded (`&amp;` → `&`) |
| Mis-transcoded text | Repaired, and flagged as an `ENCODING_DAMAGE` rejection |

**Schema drift is a hard stop.** If a required `partner_csv` column is missing,
the run is marked `failed` with an owner-attributable payload naming the source,
the missing field, the first affected record and what changed versus the last
good run. It exits 0 so the failure is still recorded and triaged downstream.

An operator-approved mapping override (see [Actions](../Actions/script.ts)) is
the only thing that can alias a renamed column back into place; overrides arrive
in the envelope from Ingest.

Raw payloads are dropped from the envelope here — source text travels no further.

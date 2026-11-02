A security-operations view of CISA's [Known Exploited Vulnerabilities (KEV) Catalog](https://www.cisa.gov/known-exploited-vulnerabilities-catalog), with a watchlist of high-impact CVEs published in the last few days. It runs as two linked pipelines and a web app.

#### Ingestion pipeline (every 4 hours)

```text
Fetch CISA KEV feed → Fetch recent NVD CVEs → Triage new CVEs (AI) → Save catalog snapshot
```

1. [Fetch CISA KEV feed](<Fetch CISA KEV feed/README.md>) downloads and normalizes the official KEV feed.
2. [Fetch recent NVD CVEs](<Fetch recent NVD CVEs/README.md>) pulls CRITICAL/HIGH CVEs published in NVD over the last 72 hours that are not in KEV yet.
3. [Triage new CVEs (AI)](<Triage new CVEs (AI)/README.md>) has Claude pick the 8–20 most enterprise-relevant ones and write KEV-style vendor, product, name, and required action for each.
4. [Save catalog snapshot](<Save catalog snapshot/README.md>) merges everything into `catalog.json` in the `kev` volume and reports what changed.

#### API pipeline (on request)

```text
Catalog API  (/kev/api/catalog) ─┐
                                  ├→ Query catalog snapshot → HTTP response
Metrics API  (/kev/api/metrics) ─┘
```

The route steps parse the request, and [Query catalog snapshot](<Query catalog snapshot/README.md>) reads the snapshot and responds.

#### Web app

[KEV Catalog](<KEV Catalog/README.md>) at `/kev`: Dashboard, Full Catalog, By Vendor, By Product, Ransomware-Linked, and Remediation Status, with drill-down filters and a CVE detail panel.

#### Notes

- Watchlist entries are marked **New · NVD**. They aren't confirmed as exploited, their due date is a suggested 21-day target, and they're kept for 14 days or until CISA adds them to KEV. Dashboard KEV metrics exclude them.
- Remediation buckets use today's UTC date: Overdue (past due), Due soon (within 14 days), On track (later).
- If no snapshot exists yet, the APIs fall back to the live KEV feed (without the watchlist).
- All routes use space access (members of this space only). The schedule runs only after publishing.

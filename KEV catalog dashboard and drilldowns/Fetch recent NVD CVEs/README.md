Receives the KEV catalog and queries the NVD 2.0 API (no key) for CRITICAL and HIGH CVSS v3 CVEs published in the last 72 hours. Drops any already in KEV, rejected, or missing a score or description, then forwards the 150 highest-scoring as `candidates` along with the catalog.

If NVD is unreachable, it logs the error and forwards an empty candidate list, so the KEV snapshot still updates.
